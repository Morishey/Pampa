/* =========================================================
 * Pampa — directory — who is out there and how far
 * The provider directory, distance maths, the rating store, bios and the coverage map.
 * ========================================================= */

/* ---------- Provider directory ---------- */
/* One model for everyone who takes jobs. A seeded stylist carries a hand-picked
   coverage list; a provider who registered carries none and covers every area
   within VISIT_KM of their studio, so signing up never asks them to draw a
   coverage map.
   The directory is a property of the app on this device, not of a session: it
   has its own storage key and survives logout, so a stylist who signs up stays
   discoverable and bookable by whoever uses the app next. */
const DIR_KEY = "pampa.directory.v1";
const VISIT_KM = 14;

function loadDirectory() {
  try {
    const raw = localStorage.getItem(DIR_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.providers)) state.providers = d.providers;
    }
  } catch (e) {
    console.warn("Pampa: directory unreadable", e);
  }
  if (!Array.isArray(state.providers)) state.providers = [];
}

/* Returns false when the write was refused — a full device must not lose a
   portfolio photo silently, and the caller that added one has to know. */
function saveDirectory() {
  try {
    localStorage.setItem(DIR_KEY, JSON.stringify({ providers: state.providers }));
    return true;
  } catch (e) {
    console.warn("Pampa: directory not saved", e);
    return false;
  }
}

/* Every account this device has seen, keyed by phone. This is what makes
   "Sign in" and "Create account" genuinely different doors: a number we know
   signs straight back in, a number we don't continues into onboarding. Clients
   live here too — the directory stays providers-only, because a client must
   never appear in another client's discovery. */
const ACCOUNTS_KEY = "pampa.accounts.v1";
let accounts = {};

function loadAccounts() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.accounts) accounts = d.accounts;
    }
  } catch (e) {
    console.warn("Pampa: accounts unreadable", e);
  }
  if (!accounts || typeof accounts !== "object") accounts = {};
}

function saveAccounts() {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify({ accounts: accounts }));
  } catch (e) {
    console.warn("Pampa: accounts not saved", e);
  }
}

function accountByPhone(phone) {
  return (phone && accounts[phone]) || null;
}

/* Written whenever the signed-in profile changes, so the next sign-in restores
   name, trade and area without walking onboarding again. It merges into the
   existing record: the credential and the face live on the same account, and a
   routine save of the name must never be the thing that drops them. */
function rememberAccount() {
  const u = state.user;
  if (!u || !u.phone) return;
  const acc = accounts[u.phone] || {};
  acc.name = u.name;
  acc.role = u.role || "client";
  acc.trade = u.trade || null;
  acc.area = u.area || null;
  acc.coords = u.coords || null;
  acc.address = u.address || "";
  /* Assigned, not conditionally set: a picture that was *removed* has to be
     able to reach the account book too. `if (u.dp)` left the old picture in
     place for ever, so "Remove photo" showed the initial until the next sign-in
     and then handed the deleted face straight back. */
  acc.dp = u.dp || "";
  accounts[u.phone] = acc;
  saveAccounts();
  return acc;
}

/* Providers that came with the app, shaped exactly like a registration: their
   own trade, their own studio area, and coverage derived from the radius rather
   than a hand-written list. They are what a client sees when the directory holds
   someone other than themselves — real distances, real trades, real coverage. */
/* Nkechi arrives paused on purpose: the switch that turns bookings off is only
   discoverable if the client side of it can be seen without a second account. */
const PROVIDER_SEED = [
  { id: "ade", name: "Ade", skill: "Barbing", cats: ["barb"], studio: "surulere", rating: 0, jobs: 0 },
  { id: "ireti", name: "Ireti", skill: "Hair", cats: ["hair"], studio: "gbagada", rating: 4.6, jobs: 12 },
  { id: "nkechi", name: "Nkechi", skill: "Nails", cats: ["nails"], studio: "ajah", rating: 0, jobs: 0, available: false },
];

function ensureProviderSeed() {
  PROVIDER_SEED.forEach(function (s) {
    const at = state.providers.findIndex(function (p) { return p.id === s.id; });
    if (at !== -1) {
      /* A seeded record follows its seed rather than its stored copy: it has no
         owner who could have changed the answer, and an install that was already
         open before this switch existed would otherwise never show the paused
         state the app ships with. seedDefault is the seed value already applied,
         so a shipped change lands once and then stops being rewritten. */
      const rec = state.providers[at];
      const want = s.available !== false;
      if (rec.seed && (rec.seedDefault === undefined || rec.seedDefault !== want)) {
        rec.seedDefault = want;
        rec.available = want;
        saveDirectory();
      }
      return;
    }
    state.providers.push({ id: s.id, name: s.name, skill: s.skill, cats: s.cats.slice(),
      studio: s.studio, rating: s.rating, jobs: s.jobs, covers: null, seed: true,
      available: s.available !== false, seedDefault: s.available !== false });
  });
}

/* ---------- Availability ---------- */
/* Whether a provider is taking new bookings right now. Absent means yes, so a
   record written before this switch existed — and every seeded stylist — stays
   bookable. Pausing is about *new* bookings only: a job already paid into
   escrow is a promise, and the pro still has to work it and get paid for it. */
function providerAvailable(p) {
  if (!p) return true;
  return p.available !== false;
}

/* The street address a walk-in client should come to: what the provider put on
   their own profile when they registered, falling back to the area name. */
function studioAddressFor(p) {
  if (!p) return "";
  return p.address || "";
}

/* The signed-in professional's own switch. False when they have no provider
   record to write to, so the caller can say why. */
function setProviderAvailable(on) {
  const me = myProviderRecord();
  if (!me) return false;
  me.available = !!on;
  saveDirectory();
  refreshBookableSurfaces();
  return true;
}

/* ---------- Sessions ----------
   Who the switch cannot speak for. A professional in a session is unbookable
   whatever they have set, and their switch is still on: they are working, not
   off. Everything that asks "may a new booking start with this person?" asks
   here, and only here — the answer is one function so the four surfaces that
   state it cannot drift apart. */
function providerInSession(p, now) {
  return p ? activeSession(p.id, now) : null;
}

function providerBookable(p, now) {
  return providerAvailable(p) && !providerInSession(p, now);
}

/* Every surface that states whether a provider is bookable: the professional's
   dashboard, their Home card, the discovery strip other people see, and their
   own public page when it happens to be open behind the switch — plus a booking
   sheet that is open on top of a session that just began or just settled. */
function refreshBookableSurfaces() {
  renderStylists();
  if (state.user && state.user.role === "pro") {
    renderWork();
    renderProHomeCard();
  }
  const pv = $("#view-provider");
  const pvOpen = state.providerView && pv && getComputedStyle(pv).display !== "none";
  if (pvOpen) renderProviderProfile();
  const sheet = $("#bookingSheet");
  if (sheet && sheet.classList.contains("show") && state.draft) renderSheet();
}

/* A session starts and ends on the clock, not on a tap, so the app has to
   notice on its own: a pro whose client releases at 12:40 is bookable again at
   12:40, and one whose 10:30 job has just come due is unbookable from 10:30,
   without anybody reloading anything. The ledger is re-read on a timer and the
   surfaces are only redrawn when the answer actually changed, so a long
   session in progress costs nothing and nothing flickers. */
let sessionTimer = null;
let sessionSig = "";

/* What the surfaces would say: every live booking, and whether its session has
   begun. A change in either half is what a redraw is owed for. */
function sessionSignature() {
  const now = Date.now();
  return state.bookings.filter(sessionLive).map(function (b) {
    return b.id + ":" + b.stylistId + ":" + (sessionStart(b) <= now ? "in" : "due");
  }).sort().join("|");
}

function sessionTick(force) {
  if (!state.user) return;
  const sig = sessionSignature();
  if (!force && sig === sessionSig) return;
  sessionSig = sig;
  refreshBookableSurfaces();
}

function startSessionWatch() {
  sessionTick(true);
  if (sessionTimer) return;
  sessionTimer = setInterval(sessionTick, 30000);
}

function stopSessionWatch() {
  if (sessionTimer) clearInterval(sessionTimer);
  sessionTimer = null;
  sessionSig = "";
}

function providerCovers(st) {
  if (st.covers && st.covers.length) return st.covers;
  const studio = areaById(st.studio);
  if (!studio) return [];
  return AREAS.filter(function (a) { return haversineKm(studio, a) <= VISIT_KM; })
    .map(function (a) { return a.id; });
}

/* The provider record the signed-in user registered as, or null if they are
   only here to book. Records are keyed by the phone the account was created
   with, so a record stays findable — and stays its own identity — after its
   owner logs out. */
/* A provider record is keyed by the phone the account registered with, because
   the directory, the bookings and the payout destinations are all keyed by it.
   Before a number exists there is no identity to register, and the fallback key
   is a placeholder that migrateProviders() adopts onto the real one — never a
   second provider sitting in everyone else's discovery list. */
const GUEST_KEY = "p:guest";

function selfKey() {
  const u = state.user || {};
  return "p:" + (u.phone || "guest");
}

function providerSelf() {
  const key = selfKey();
  return state.providers.find(function (p) { return p.id === key; }) || null;
}

/* Everyone bookable: the seeded stylists plus local registrations, first. */
function allProviders() {
  const seedIds = {};
  STYLISTS.forEach(function (s) { seedIds[s.id] = true; });
  /* local registrations shadow their seed by id, so the seed never appears twice */
  const seen = {};
  const local = state.providers.filter(function (p) {
    if (seen[p.id]) return false;
    seen[p.id] = true;
    return true;
  });
  return local.concat(STYLISTS.map(function (s) {
    /* a seed with no portfolio would leave the spotlight strip empty on a
       fresh install; the curated seed works give every pro a public gallery,
       and a curated status gives every pro a ring on the stories rail */
    return s.works
      ? s
      : Object.assign({ works: seedWorksFor(s.id), status: seedStatusFor(s.id) }, s);
  }));
}

/* Create/refresh/remove your provider record from your trade + area. Called
   whenever either changes, so the directory never holds a stale profile. */
function registerProviderSelf() {
  const u = state.user || {};
  const t = tradeById(u.trade);
  /* No number, no record: registering under the placeholder key would strand a
     provider with no studio in the directory for good. */
  if (!u.phone) return;
  const key = selfKey();
  const at = state.providers.findIndex(function (p) { return p.id === key; });
  if (!t) {
    if (at !== -1) {
      state.providers.splice(at, 1);
      saveDirectory();
    }
    return;
  }
  const prev = at === -1 ? null : state.providers[at];
  const rec = {
    id: key,
    owner: u.phone || "guest",
    name: u.name || "You",
    skill: t.name,
    rating: prev ? prev.rating : 0,
    jobs: prev ? prev.jobs : 0,
    cats: [t.id],
    studio: u.area || null,
    covers: null,
    /* the bio is part of the public record, not just the session */
    bio: u.bio !== undefined && u.bio !== null ? u.bio : (prev && prev.bio) || null,
    /* the picture and the portfolio are the provider's, not the session's, so
       they survive logout and ride along every time this record is rebuilt */
    dp: prev ? prev.dp || null : null,
    works: prev && Array.isArray(prev.works) ? prev.works : [],
    /* Personal contact details ride the public record so the provider's page
       and their dashboard agree on them. A sign-in restores only part of the
       profile — name, number, area, address, picture — so anything this record
       already knows and the session does not carry is kept rather than reset;
       otherwise a provider would lose their bio by simply logging back in. */
    email: u.email !== undefined && u.email !== null ? u.email : (prev && prev.email) || null,
    social: u.social !== undefined && u.social !== null ? u.social : (prev && prev.social) || null,
    /* where a walk-in client comes to, and whether new bookings are open.
       Both are the provider's own, so they survive a rebuild of this record
       the way the picture and the portfolio do. */
    address: u.address || (prev ? prev.address : null) || null,
    available: prev ? prev.available !== false : true,
    /* the pro's own rates per service. Absent means "the default band around
       the catalogue price", so a record written before rates existed — and
       every seeded stylist — still answers with a usable range. */
    ranges: prev && prev.ranges ? prev.ranges : {},
    /* today's status rides the public record the way the portfolio does: it is
       theirs, it outlives the session, and a rebuild of this record — a
       sign-in, a change of address — must not wipe a story that is still
       live on other people's devices. */
    status: prev && Array.isArray(prev.status) ? prev.status : [],
  };
  if (at === -1) state.providers.push(rec);
  else state.providers[at] = rec;
  saveDirectory();
}

function coversClient(st) {
  const u = state.user || {};
  if (!u.area) return false;
  return providerCovers(st).indexOf(u.area) !== -1;
}

function stylistsForService(serviceId) {
  const sv = SERVICES.find(function (s) { return s.id === serviceId; });
  if (!sv) return [];
  /* one entry per provider: a local registration shadows the seed carrying the
     same id, and the signed-in pro appears once, as themselves */
  const seen = {};
  const out = [];
  allProviders().forEach(function (st) {
    if (seen[st.id]) return;
    seen[st.id] = true;
    if (st.cats.indexOf(sv.cat) !== -1) out.push(st);
  });
  return out;
}

/* The services a given provider actually offers — their trade, priced. */
function servicesForProvider(st) {
  if (!st) return [];
  return SERVICES.filter(function (s) { return st.cats.indexOf(s.cat) !== -1; });
}

/* The one service a card leads with: the first of their *first* trade, so a
   professional who works across two reads as the one they registered as rather
   than as whichever the catalogue happens to list first. */
function headlineServiceFor(st) {
  if (!st) return null;
  const offered = servicesForProvider(st);
  const primary = (st.cats || [])[0];
  return offered.filter(function (s) { return s.cat === primary; })[0] || offered[0] || null;
}

/* A stylist cannot hold two bookings for the same date + time. Cancelled and
 * declined bookings release their slot again. */
function slotTaken(stylistId, date, time, ignoreId) {
  return state.bookings.some(function (b) {
    if (b.id === ignoreId) return false;
    const s = statusOf(b);
    if (s === "cancelled" || s === "declined") return false;
    return b.stylistId === stylistId && b.date === date && b.time === time;
  });
}

/* Set one service's floor and ceiling. The keys are the service ids the trade
   covers, so a professional can never publish a rate for work they do not do. */
function setProviderRange(provider, serviceId, min, max) {
  const sv = SERVICES.find(function (s) { return s.id === serviceId; });
  if (!provider || !sv) return { ok: false, msg: "Unknown service" };
  const lo = roundTo50(min);
  const hi = roundTo50(max);
  if (!(lo > 0) || !(hi > 0)) return { ok: false, msg: "Enter both a low and a high price" };
  if (lo > hi) return { ok: false, msg: "The low price cannot be above the high one" };
  if (!provider.ranges) provider.ranges = {};
  provider.ranges[serviceId] = { min: lo, max: hi };
  saveDirectory();
  return { ok: true, range: provider.ranges[serviceId] };
}

/* Reads the rates card's fields back. Every service is validated before any of
   them is written, so a bad pair stops the whole save rather than leaving half
   the card applied and a toast that does not say which half. */
function saveRates() {
  const me = myProviderRecord();
  if (!me) return { ok: false, msg: "Your work profile isn't ready yet" };
  const offered = servicesForProvider(me);
  const wanted = [];
  for (let i = 0; i < offered.length; i++) {
    const sv = offered[i];
    const lo = $('[data-rate-min="' + sv.id + '"]');
    const hi = $('[data-rate-max="' + sv.id + '"]');
    if (!lo || !hi) continue;
    const min = roundTo50(lo.value);
    const max = roundTo50(hi.value);
    if (!(min > 0) || !(max > 0)) return { ok: false, msg: sv.name + ": enter both prices" };
    if (min > max) return { ok: false, msg: sv.name + ": the low price is above the high one" };
    wanted.push({ id: sv.id, min: min, max: max });
  }
  if (!wanted.length) return { ok: false, msg: "Nothing to save yet" };
  wanted.forEach(function (w) { setProviderRange(me, w.id, w.min, w.max); });
  /* the range is what clients pick inside, so every surface that publishes it
     is redrawn now rather than on the next visit */
  refreshBookableSurfaces();
  return { ok: true, msg: "Rates saved — clients now pick inside " + wanted.length + " service" + (wanted.length === 1 ? "" : "s") };
}

/* ---------- Ratings ---------- */
/* Reviews are stored per provider on the device, next to the directory, so a
   reputation survives logout exactly the way the profile does. A provider's
   baseline (the rating and job count they arrived with) is blended with the
   reviews written here, so a fresh five actually moves the number. */
const RATING_KEY = "pampa.ratings.v1";
let ratingStore = {};

function loadRatings() {
  try {
    const raw = localStorage.getItem(RATING_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && typeof d === "object") ratingStore = d;
    }
  } catch (e) {
    console.warn("Pampa: ratings unreadable", e);
  }
  if (!ratingStore || typeof ratingStore !== "object") ratingStore = {};
}

function saveRatings() {
  try {
    localStorage.setItem(RATING_KEY, JSON.stringify(ratingStore));
    return true;
  } catch (e) {
    console.warn("Pampa: ratings not saved", e);
    return false;
  }
}

function ratingsFor(providerId) {
  return ratingStore[providerId] || [];
}

function addRating(providerId, entry) {
  if (!providerId) return false;
  if (!ratingStore[providerId]) ratingStore[providerId] = [];
  ratingStore[providerId].unshift(entry);   // newest first
  saveRatings();
  renderStylists();
  renderNotify();
  return true;
}

/* The one number everything reads: baseline history blended with reviews from
   this device, plus the distribution for the profile page. */
function ratingStats(p) {
  const reviews = p ? ratingsFor(p.id) : [];
  const baseCount = p && p.rating ? (p.jobs || 0) : 0;
  const baseSum = p && p.rating ? p.rating * baseCount : 0;
  const sum = reviews.reduce(function (s, r) { return s + (Number(r.stars) || 0); }, 0);
  const count = baseCount + reviews.length;
  const dist = [0, 0, 0, 0, 0];               // 5★ first, down to 1★
  reviews.forEach(function (r) {
    const i = 5 - Math.min(5, Math.max(1, Math.round(Number(r.stars) || 5)));
    dist[i] += 1;
  });
  return {
    avg: count ? (baseSum + sum) / count : 0,
    count: count,
    base: baseCount,
    reviews: reviews.length,
    dist: dist,
    list: reviews,
  };
}

/* ---------- Bios ---------- */
function listNames(names) {
  if (names.length <= 1) return names[0] || "";
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

/* A provider who has not written a bio still reads as a person rather than a
   blank card: trade, where they work from, what they cover, and their history. */
function bioFor(p) {
  if (!p) return "";
  if (p.bio) return p.bio;
  const area = (areaById(p.studio) || {}).name;
  const covers = providerCovers(p).map(function (id) { return (areaById(id) || {}).name; }).filter(Boolean);
  const s = ratingStats(p);
  const bits = [];
  bits.push(p.name + " takes " + String(p.skill || "beauty").toLowerCase() + " work" +
    (area ? " from " + area : "") + ".");
  if (covers.length > 3) {
    bits.push("Travels for home visits across " + covers.length + " areas — " +
      covers.slice(0, 3).join(", ") + " and " + (covers.length - 3) + " more.");
  } else if (covers.length) {
    bits.push("Travels to " + listNames(covers) + " for home visits.");
  } else {
    bits.push("Studio only for now — no home visits.");
  }
  if (p.jobs) {
    bits.push(p.jobs + " job" + (p.jobs === 1 ? "" : "s") + " completed" +
      (s.avg ? " at an average of " + s.avg.toFixed(1) + " stars." : ", no ratings yet."));
  } else {
    bits.push("New to Pampa — no completed jobs yet.");
  }
  return bits.join(" ");
}

/* ---------- Coverage map ---------- */
/* Drawn to scale in kilometres: studio at the centre, the radius they will
   travel, every area inside it, and the client's own area if it is known. */
function coverageMapHtml(p) {
  const studio = areaById(p.studio);
  if (!studio) {
    return '<p class="finePrint">No studio area set yet, so there is nothing to map. ' +
      "Pampa books this provider as studio-only in the meantime.</p>";
  }
  const clientArea = areaById(((state.user || {}).area) || "");
  /* a client who lives where the provider works would draw two pins on the
     same spot and stack the labels, so that case is stated instead */
  const coincides = !!clientArea && clientArea.id === p.studio;
  const covers = providerCovers(p).map(function (id) { return areaById(id); }).filter(Boolean);
  const kmOff = function (a) {
    const dLat = (a.lat - studio.lat) * 111.32;
    const dLng = (a.lng - studio.lng) * 111.32 * Math.cos(studio.lat * Math.PI / 180);
    return { x: dLng, y: dLat };
  };
  const pts = covers.map(kmOff);
  const you = clientArea && !coincides ? kmOff(clientArea) : null;
  if (you) pts.push(you);
  const far = pts.reduce(function (m, o) { return Math.max(m, Math.abs(o.x), Math.abs(o.y)); }, 0);
  const reach = Math.max(VISIT_KM, far) + 3;
  const size = reach * 2;
  const dot = reach * 0.032;
  const font = (reach * 0.07).toFixed(2);
  const at = function (o) { return o.x.toFixed(1) + " " + (-o.y).toFixed(1); };
  /* At 14 km of reach two pins a couple of kilometres apart share a label
     line, so close pairs get stacked vertically instead of side by side. */
  const close = !!you && Math.hypot(you.x, you.y) < 6;
  const labelX = close ? (you.x / 2).toFixed(1) : "0";
  const studioY = -(close ? dot * 6 : dot * 2.6);
  const youY = you ? (close ? dot * 6 - you.y * 0.2 : -you.y + dot * 3.4) : 0;

  /* the dots are the projected points, each still tied to the area it came
     from so a hover names it */
  const dots = covers.map(function (a, i) {
    const o = pts[i];
    return '<circle cx="' + o.x.toFixed(1) + '" cy="' + (-o.y).toFixed(1) + '" r="' + dot.toFixed(2) +
      '" class="covDot"><title>' + esc(a.name) + "</title></circle>";
  }).join("");

  const body =
    '<circle cx="0" cy="0" r="' + VISIT_KM + '" class="covReach"/>' +
    dots +
    (you ? '<path class="covLink" d="M0 0 L' + at(you) + '"/>' : "") +
    '<circle cx="0" cy="0" r="' + (dot * 1.7).toFixed(2) + '" class="covStudio"/>' +
    '<text x="' + labelX + '" y="' + studioY.toFixed(2) + '" font-size="' + font + '" class="covLabel" text-anchor="middle">Studio · ' + esc(studio.name) + "</text>" +
    /* the "you" label sits below its pin so it can never collide with the
       studio label above */
    (you ? '<circle cx="' + you.x.toFixed(1) + '" cy="' + (-you.y).toFixed(1) + '" r="' + dot.toFixed(2) + '" class="covYou"/>' +
      '<text x="' + (close ? labelX : you.x.toFixed(1)) + '" y="' + youY.toFixed(2) + '" font-size="' + font + '" class="covLabel you" text-anchor="middle">You · ' + esc((clientArea || {}).name) + "</text>" : "");

  const rows = covers.map(function (a) {
    const km = kmFromClient(a.id);
    return '<p class="covRow"><span>' + icon("pin") + esc(a.name) + "</span><b>" + (km == null ? "—" : fmtKm(km)) + "</b></p>";
  }).join("") || '<p class="finePrint">No areas fall inside the travel radius.</p>';

  return '<div class="covMap"><svg viewBox="' + [-reach, -reach, size, size].join(" ") + '" aria-hidden="true">' + body + "</svg></div>" +
    '<p class="covLegend">' + icon("map") + "Gold ring = the " + VISIT_KM + " km this provider travels. " +
      (you ? "The violet pin is you."
        : coincides ? "You are in the same area as the studio."
        : "Set your location to see yourself on this map.") + "</p>" +
    '<div class="covList">' + rows + "</div>";
}

