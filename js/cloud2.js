/* =========================================================
 * Pampa — cloud, the account half
 *
 * cloud.js moved the ledger; this file moves the rest of what a session
 * touches. Three jobs, all behind the same dbConfigured() door:
 *
 *  1. Accounts. Sign-up and sign-in go to Postgres, the token is the
 *     session, and the account the server answers with is adopted into
 *     state.user — the same shape the onboarding screens built by hand,
 *     so everything downstream reads it without knowing.
 *
 *  2. Discovery. The directory becomes the database's answer: every
 *     professional registered anywhere, with the distance the server
 *     itself measured between the two stored points. The rows are cached
 *     in memory only — they are other people's data, refreshed on every
 *     entry, and saving them would be one more store to go stale.
 *
 *  3. Flags. Whether this account works the resolution desk is the
 *     server's word, not the device's, so the desk screen is drawn only
 *     for accounts the database has flagged.
 *
 * When there is no database, every function here steps aside and the app
 * is the device-local product it always was.
 * ========================================================= */

/* True once a session token has been exchanged for a profile this boot: it is
   how the splash screen's queued timers know to stay out of the way. */
let dbSessionLanded = false;

/* ---------- The directory cache ---------- */

/* The server's directory, mapped onto the provider-record shape every
   renderer already reads. Rebuilt on each sync; never written to disk. */
let dbCloudProviders = [];

function dbCloudRows() {
  return dbCloudProviders;
}

/* The signed-in professional's own public identity, once the database knows
   them: the uuid the bookings carry as stylistId. A client has none. */
function dbSelfProviderId() {
  const u = state.user || {};
  return u.serverId && u.role === "pro" ? u.serverId : null;
}

/* The key the local stores used before this account was adopted — the
   phone-keyed provider record and the bookings written for it. Adoption
   re-keys both onto the uuid, and needs to know where they came from. */
function dbLegacySelfKey() {
  const u = state.user || {};
  return "p:" + (u.phone || "guest");
}

/* ---------- Adopting the server's account ---------- */

/* Take the account JSON the register/login/me calls answer with and make it
   the signed-in profile. Returns an object shaped like the accounts-book
   entry signInReturning expects, so both doors — returning and fresh — walk
   the same road afterwards. */
function dbAdoptAccount(acct) {
  if (!acct || !acct.id) return null;
  const u = state.user || {};
  const wasKey = selfKey();

  u.name = acct.name || u.name || "Guest";
  /* The client identity is the phone the account keeps. A username account
     has an empty one — bookings still match, because the comparison below
     also reads clientId. */
  if (acct.phone) u.phone = acct.phone;
  else if (!u.phone) u.phone = acct.username || "";
  u.role = acct.role || u.role || "client";
  u.trade = acct.trade || null;
  u.area = acct.area || u.area || null;
  u.address = acct.address || u.address || "";
  if (acct.coords) u.coords = { lat: Number(acct.coords.lat), lng: Number(acct.coords.lng) };
  u.dp = acct.dp || "";
  u.serverId = acct.id;

  /* Re-key the device's record of this account onto the uuid. A professional
     who tested on this device before the database existed has bookings and a
     directory record keyed by their phone; the uuid is who the server says
     they are, and everything that matches bookings by id has to agree. */
  const newKey = selfKey();
  if (newKey !== wasKey) {
    const rec = state.providers.find(function (p) { return p.id === wasKey; });
    if (rec) rec.id = newKey;
    state.bookings.forEach(function (b) {
      if (b.stylistId === wasKey) b.stylistId = newKey;
    });
  }

  state.user = u;
  save();
  saveAccounts();
  registerProviderSelf();
  return {
    name: u.name,
    phone: u.phone,
    role: u.role,
    trade: u.trade,
    area: u.area,
    coords: u.coords || null,
    coordsAccuracy: u.coordsAccuracy || null,
    address: u.address || "",
    dp: u.dp || "",
  };
}

/* A session token may outlive the profile it belongs to — a cleared ledger,
   a second device, an account made before the cloud was wired. On boot the
   token is asked who it is; the answer becomes the session, or the token is
   retired where it stands (a 28000 clears itself inside dbCall). */
/* Unwrap what the server answers. register and login return { token, account };
   me returns the account itself. Accepting both here means the callers below
   never have to know which door they came through. */
function dbUnwrapSession(res) {
  if (!res) return null;
  if (res.account && res.account.id) return res;
  if (res.id) return { account: res };
  return null;
}

async function dbCloudRestore() {
  if (!dbConfigured()) return;
  if (!dbSignedIn()) {
    /* No session — but this device may still be holding an identity the server
       issued (serverId), which is what a refused token leaves behind once
       dbCall has thrown it away. The cached dashboard is not a session, and
       showing it is exactly how the app came to look signed in while the
       server had no idea who was calling. A device-local account has no
       serverId and keeps the local product it has always been. */
    if (state.user && state.user.serverId) pampaSessionEnded();
    return;
  }
  let res = null;
  try {
    res = dbUnwrapSession(await db.me());
  } catch (e) {
    return; /* dbCall has already ended the session and said why */
  }
  if (!res || !res.account) return;
  const hadUser = !!state.user;
  dbAdoptAccount(res.account);
  await dbCloudSync();
  if (!hadUser && state.user && state.user.name) {
    /* The intro's timers are still queued behind this call: they are told to
       stand down, or a splash screen would slide back over the dashboard a
       second after it opened. */
    dbSessionLanded = true;
    const intro = $(".intro");
    const welcome = $(".welcomePage");
    if (intro) intro.style.display = "none";
    if (welcome) { welcome.style.display = "none"; welcome.classList.add("entered"); }
    enterApp();
    toast("Welcome back, " + state.user.name);
  }
}

/* ---------- The sync: bookings, directory, flags ---------- */

/* Called on entering the app and after a location save: the three reads that
   keep the device honest about a world other devices are changing. Each is
   cheap, each is silent on failure — a flaky connection must not turn into
   an error screen on a dashboard that still has its cache. */
async function dbCloudSync() {
  if (!dbSignedIn()) return;
  const fix = (state.user || {}).coords || null;
  await Promise.all([
    dbSyncBookings(),
    dbSyncDirectory(fix),
    dbSyncFlags(),
  ]);
  refreshBookableSurfaces();
  renderBookings();
  renderProfile();
  renderNotify();
}

/* The directory. The client's position rides the call: the server measures
   each professional from it, so the distances the cards show are the ones
   the database computed between the two stored points — including the
   fix-to-fix kind both sides gave a position for. */
async function dbSyncDirectory(fix) {
  if (!dbSignedIn()) return false;
  try {
    const rows = await db.directory(fix ? fix.lat : null, fix ? fix.lng : null, null);
    if (!Array.isArray(rows)) return false;
    dbCloudProviders = rows.map(function (r) {
      return {
        id: r.id,
        providerAccountId: r.id,
        cloud: true,
        name: r.name,
        dp: r.dp || null,
        skill: r.tradeName || r.skill || "Professional",
        cats: [r.trade],
        studio: r.studio || null,
        rating: r.rating || 0,
        jobs: r.jobs || 0,
        /* The distance as the server measured it, rounded to a tenth of a
           kilometre there. null when either side has no point on file, in
           which case the local area-centre fallback answers instead. */
        serverKm: r.km == null ? null : Number(r.km),
        bio: r.bio || null,
        available: r.available !== false,
        inSessionServer: !!r.inSession,
        busyWith: r.busyWith || null,
        since: r.since || null,
        ranges: r.rates || {},
        works: [],
      };
    });
    return true;
  } catch (e) {
    console.warn("Pampa: directory sync failed", e);
    return false;
  }
}

/* Whether this account works the desk. Only the server knows; the flag is
   not part of any public profile, and the entry is hidden until it says so. */
async function dbSyncFlags() {
  if (!dbSignedIn()) return false;
  try {
    const f = await db.myFlags();
    state.deskFlags = { desk: !!(f && f.desk), admin: !!(f && f.admin) };
    return true;
  } catch (e) {
    console.warn("Pampa: flags unavailable", e);
    state.deskFlags = null;
    return false;
  }
}

/* ---------- Registration ---------- */

/* Sign-up walks four screens after the password: role, trade, location. The
   server wants all of it in one call, so the credentials are held here until
   the last screen saves — and only then does the account exist anywhere but
   this device. */
let pendingReg = null;

function dbArmRegistration(handle, password, name) {
  pendingReg = { handle: handle, password: password, name: name };
}

/* Run when the onboarding's location step completes: everything the server
   asks for is on the table by then. A refused registration is not a wall —
   the account stays device-local with a word about why, which is the same
   state the app was in before the cloud was wired at all. */
async function dbFinishRegistration(areaId, address, point) {
  if (!pendingReg || !dbConfigured()) { pendingReg = null; return; }
  const u = state.user || {};
  const body = {
    p_handle: pendingReg.handle,
    p_password: pendingReg.password,
    p_name: pendingReg.name,
    p_role: u.role === "pro" ? "pro" : "client",
    p_trade: u.trade || null,
    p_area_id: areaId || null,
    p_address: address || "",
    p_lat: point ? point.lat : null,
    p_lng: point ? point.lng : null,
    p_dp: u.dp || null,
  };
  const reg = pendingReg;
  pendingReg = null;
  try {
    const res = await db.register(body);
    dbSessionSet(res);
    dbAdoptAccount(res.account);
    await dbCloudSync();
    toast("Account saved to Pampa — sign in with it on any device");
  } catch (e) {
    if (e.code === "offline" || e.code === "no_database") {
      console.warn("Pampa: registration deferred — offline");
      return;
    }
    toast(e && e.message
      ? "Pampa couldn't save that account: " + e.message
      : "Pampa couldn't save that account — you're on this device only");
  }
}

/* ---------- The push-outs ---------- */

/* The profile a professional edits is public on the server the moment it is
   saved here. Fire-and-forget: the save must not wait on the network, and a
   failed push is retried by the next save of anything. */
function dbPushProfile(patch) {
  if (!dbSignedIn()) return;
  db.updateProfile(patch).catch(function (e) {
    console.warn("Pampa: profile push failed", e);
  });
}

/* The account's own details: the name a booking card is drawn with, the face
   beside it, and the handles somebody may want to reach you on. A professional
   keeps a public record as well — registerProviderSelf pushes that on every
   save — but the *account* is where the name a booking is filed under comes
   from, and it is the only place a client keeps theirs at all. Before this
   existed, a professional's edits travelled and a client's did not: rename
   yourself and the card the professional read still said what you were called
   at sign-up, because pampa_booking_create stores the account's display_name.

   Fire-and-forget, like the other pushes: a save must not wait on the network,
   and the next save carries anything that failed. */
function dbPushAccountDetails() {
  if (!dbSignedIn()) return;
  const u = state.user || {};
  if (!u.name) return;
  const s = u.social || {};
  db.updateProfile({
    name: u.name,
    dp: u.dp || "",
    socials: { ig: s.ig || null, tt: s.tt || null, x: s.x || null },
  }).catch(function (e) {
    console.warn("Pampa: account push failed", e);
  });
}

function dbPushAvailability(on) {
  if (!dbSignedIn()) return;
  db.setAvailability(!!on).catch(function (e) {
    console.warn("Pampa: availability push failed", e);
  });
}

/* The price bands a professional publishes, keyed by service id exactly as
   the rates screen holds them. The server re-validates every pair — floor,
   ceiling, order, service-in-trade — so a bad save is refused there even if
   the screen ever let one through. */
function dbPushRates(ranges) {
  if (!dbSignedIn() || !ranges || typeof ranges !== "object") return;
  db.setRates(ranges).catch(function (e) {
    console.warn("Pampa: rates push failed", e);
  });
}

/* ---------- Sign-out ---------- */

/* The device forgets; the server revokes. Both halves live in db.logout —
   this only makes sure the caches this file owns die with the session. */
function dbCloudSignOut() {
  dbCloudProviders = [];
  state.deskFlags = null;
  if (dbSignedIn()) db.logout();
}
