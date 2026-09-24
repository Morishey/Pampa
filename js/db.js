/* =========================================================
 * Pampa — the database client
 *
 * A thin client, not an SDK. The app has no build step and no dependencies, and
 * the whole API surface it needs from Postgres is "call this function with these
 * arguments and give me the JSON back". That is one fetch, so that is what this
 * is: no bundled Supabase client, nothing to install, nothing to keep in step
 * with a version.
 *
 * The session is a bearer token, not a JWT. Signing in returns a token that the
 * database has recorded against an account; every later call sends it, and the
 * function on the other side works out who is calling and refuses anything they
 * are not party to. That is why the token is treated like a password: it lives
 * in localStorage (so it survives a reload), it expires in sixty days, and
 * signing out revokes it server-side rather than merely forgetting it here.
 * ========================================================= */

const PAMPA_SESSION_KEY = "pampa.session.v1";

/* ---------- The session ---------- */

function dbSession() {
  try {
    const raw = localStorage.getItem(PAMPA_SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.token) return null;
    return s;
  } catch (e) {
    console.warn("Pampa: session unreadable", e);
    return null;
  }
}

function dbSessionSet(session) {
  try {
    if (!session || !session.token) localStorage.removeItem(PAMPA_SESSION_KEY);
    else {
      localStorage.setItem(PAMPA_SESSION_KEY, JSON.stringify(session));
      /* A live token means the dead one has been replaced, so the app is
         allowed to hear about the next refusal. */
      dbDeadSession = false;
    }
  } catch (e) {
    console.warn("Pampa: session not saved", e);
  }
}

/* Has this device already been told its session is dead? The refusal arrives
   once per call, and several calls are usually in flight together — the boot
   sync alone is three — so without this the app would sign the same person out
   three times and stack three explanations. */
let dbDeadSession = false;

/* The token alone, for the calls below. */
function dbToken() {
  const s = dbSession();
  return s ? s.token : null;
}

/* Signed in as far as this device knows. The database is the authority — a
   revoked or expired token is only discovered on the next call. When that
   happens dbCall ends the session itself (see below), so a caller has nothing
   to do about the dead session: it only has to decide what to say about the
   action that failed. */
function dbSignedIn() {
  return dbConfigured() && !!dbToken();
}

/* ---------- The call ---------- */

/* One function call against PostgREST. Arguments are named exactly as the SQL
   declares them (p_token, p_booking, …), so there is no positional guessing on
   either side.

   Errors are turned into ordinary Error objects carrying `code` and `status`,
   because the caller's job is usually just to show the message: a refused
   transition comes back saying what went wrong in words a person can read. */
async function dbCall(fn, args) {
  if (!dbConfigured()) {
    const err = new Error("No database is configured");
    err.code = "no_database";
    throw err;
  }

  const body = Object.assign({}, args || {});
  /* Every function that touches data takes the token. Adding it here rather
     than at each call site means a call can never accidentally go out
     anonymous — a signed-out caller sends `p_token: null` and is told so in
     words ("Not signed in"), rather than being handed someone else's data.

     The two exceptions are the ones that hand out a session in the first place.
     They declare no `p_token` at all, and PostgREST resolves a function call by
     matching the argument names it is given — so sending them a token, even a
     null one, makes it look for an overload that does not exist and answer
     "Could not find the function public.pampa_register(…)". That reads like the
     function is missing, which is why it is worth naming here. */
  const MINTS_A_SESSION = { pampa_register: true, pampa_login: true };
  if (body.p_token === undefined && !MINTS_A_SESSION[fn]) body.p_token = dbToken();

  let res;
  try {
    res = await fetch(PAMPA_SUPABASE.url.replace(/\/+$/, "") + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: {
        apikey: PAMPA_SUPABASE.anonKey,
        Authorization: "Bearer " + PAMPA_SUPABASE.anonKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const err = new Error("Can't reach Pampa right now — check your connection");
    err.code = "offline";
    err.cause = e;
    throw err;
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = null;
    }
  }

  if (!res.ok) {
    /* A raised exception in PL/pgSQL arrives as { message, code, hint }. 28000
       is "not signed in" / "session ended", which is the one error the app
       handles itself rather than showing as a toast. */
    const err = new Error(
      (data && (data.message || data.hint || data.details)) ||
      "That did not go through (" + res.status + ")"
    );
    err.code = (data && data.code) || String(res.status);
    err.status = res.status;
    if (err.code === "28000") {
      /* There is a difference between "signed out" and "no longer signed in",
         and it is the whole point of this branch. A call that *carried* a token
         and was refused anyway means the session this device holds is dead:
         revoked, expired at sixty days, or the account was deleted underneath
         it. Left alone, that state is a dashboard that still looks signed in
         while every call behind it is refused — so the app is told, once, and
         it signs the person out properly. A call that carried no token was
         never signed in, and is only ever told "not signed in".

         pampa_logout is excluded because the caller is already leaving: asking
         to end a session cannot be news that it ended. */
      const carriedToken = !!body.p_token;
      dbSessionSet(null);
      if (carriedToken && fn !== "pampa_logout" && !dbDeadSession) {
        dbDeadSession = true;
        if (typeof pampaSessionEnded === "function") pampaSessionEnded();
        /* And the refusal itself is marked as said. The sign-in screen explains
           this one in a line that stays put while the person types; a toast
           raised by whichever call happened to notice would repeat the same
           sentence and be gone before the field was filled. Callers ask
           dbText() below rather than reading .message themselves. */
        err.silent = true;
      }
    }
    throw err;
  }

  return data;
}

/* What a caller should show for a refused call: the server's own words, or the
   fallback it was handed. A refusal the app has already explained somewhere the
   person can still read comes back null — there is nothing to add, so nothing
   is added. Pair it with toast(), which says nothing when handed nothing.

   `prefix` introduces the server's own sentence only — "Pampa couldn't save
   that account: " in front of a Postgres refusal — so a fallback that is
   already a finished sentence is never doubled up. tools/toast-guard.mjs is
   the fence: every sink that shows an error's words reads them from here. */
function dbText(e, fallback, prefix) {
  if (e && e.silent) return null;
  if (e && e.message) return (prefix || "") + e.message;
  return fallback || null;
}

/* ---------- What the app calls ---------- */
/* Named after what they do, not after the SQL function, so the call sites read
   like the product. Each one returns the shape the app already renders — the
   migrations emit the same field names booking-sheet.js and the cards use, so
   switching the app over is a matter of replacing the local write with this
   call and nothing else. */

const db = {
  /* Accounts */
  register: (fields) => dbCall("pampa_register", fields),
  login: (handle, password) =>
    dbCall("pampa_login", { p_handle: handle, p_password: password }),
  logout: async () => {
    const token = dbToken();
    dbSessionSet(null);
    if (token) {
      /* Revoking server-side matters: forgetting the token here would leave a
         live session on the account for sixty days. Failure to reach the
         server must not keep somebody signed in on the device. */
      try {
        await dbCall("pampa_logout", { p_token: token });
      } catch (e) {
        console.warn("Pampa: session not revoked", e);
      }
    }
    return true;
  },
  me: () => dbCall("pampa_me"),
  updateProfile: (patch) => dbCall("pampa_update_profile", { p_patch: patch }),
  changePassword: (current, next) =>
    dbCall("pampa_change_password", { p_current: current || "", p_new: next }),
  setAvailability: (available) =>
    dbCall("pampa_set_availability", { p_available: available }),
  setRates: (rates) => dbCall("pampa_set_rates", { p_rates: rates }),

  /* Reference data: the same nine services and four trades on every device. */
  trades: () => dbCall("pampa_trades"),
  services: () => dbCall("pampa_services"),
  areas: () => dbCall("pampa_areas"),

  /* Discovery */
  directory: (lat, lng, trade) =>
    dbCall("pampa_directory", { p_lat: lat, p_lng: lng, p_trade: trade || null }),
  provider: (id) => dbCall("pampa_provider_public", { p_provider: id }),

  /* Bookings */
  bookings: () => dbCall("pampa_bookings"),
  createBooking: (fields) => dbCall("pampa_booking_create", fields),
  payBooking: (id, method) =>
    dbCall("pampa_booking_pay", { p_booking: id, p_method: method }),
  acceptBooking: (id) => dbCall("pampa_booking_accept", { p_booking: id }),
  counterBooking: (id, price, note) =>
    dbCall("pampa_booking_counter", { p_booking: id, p_price: price, p_note: note || "" }),
  agreeBooking: (id) => dbCall("pampa_booking_agree", { p_booking: id }),
  declineCounter: (id) => dbCall("pampa_booking_counter_decline", { p_booking: id }),
  declineBooking: (id) => dbCall("pampa_booking_decline", { p_booking: id }),
  completeBooking: (id) => dbCall("pampa_booking_complete", { p_booking: id }),
  releaseBooking: (id, rating, note) =>
    dbCall("pampa_booking_release", { p_booking: id, p_rating: rating || null, p_note: note || "" }),
  cancelBooking: (id) => dbCall("pampa_booking_cancel", { p_booking: id }),

  /* The desk. `myFlags` is how the app knows whether to draw the desk at all:
     it is told about its own account and nobody else's. Granting is an admin
     action, enforced in the database — a client calling this is refused, not
     ignored. */
  myFlags: () => dbCall("pampa_my_flags"),
  deskGrant: (handle, on) =>
    dbCall("pampa_desk_grant", { p_handle: handle, p_on: on === undefined ? true : !!on }),
  deskRoster: () => dbCall("pampa_desk_roster"),

  /* Disputes and the desk */
  disputeBooking: (id, reason, photos, note) =>
    dbCall("pampa_booking_dispute", { p_booking: id, p_reason: reason, p_photos: photos || [], p_note: note || "" }),
  replyToDispute: (id, note, photos) =>
    dbCall("pampa_booking_dispute_reply", { p_booking: id, p_note: note, p_photos: photos || [] }),
  deskQueue: () => dbCall("pampa_desk_queue"),
  settleDispute: (id, outcome, percent) =>
    dbCall("pampa_desk_settle", { p_booking: id, p_outcome: outcome, p_percent: percent }),

  /* Money. The wallet is the account's own money view: the destinations a
     payout can land in, the payouts already made, and what escrow still holds.
     Every one of these answers with the same JSON, so a caller re-renders from
     the server's word rather than reassembling it locally. */
  wallet: () => dbCall("pampa_wallet"),
  addDestination: (kind, label, details, isDefault) =>
    dbCall("pampa_add_destination", {
      p_kind: kind, p_label: label, p_details: details, p_default: isDefault,
    }),
  setDefaultDestination: (id) =>
    dbCall("pampa_set_default_destination", { p_destination: id }),
  removeDestination: (id) =>
    dbCall("pampa_remove_destination", { p_destination: id }),
  /* Money released before a destination existed: it is already recorded as a
     payout, waiting; this is what finally tells it where to go. */
  assignPayout: (payout, destination) =>
    dbCall("pampa_assign_payout", { p_payout: payout, p_destination: destination }),
};
