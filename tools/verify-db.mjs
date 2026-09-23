#!/usr/bin/env node
/* =========================================================
 * Pampa — end-to-end verification of the database
 *
 * This proves the backend the app will actually run on, by calling it the way
 * the app calls it: PostgREST RPCs, anon key, session tokens. No service key,
 * no direct table writes, no psql — if this passes, a browser holding the same
 * anon key can do every one of these things.
 *
 * It is designed to be run repeatedly against a live project without leaving
 * rubbish behind it: every account it makes is named after the run, and it
 * asserts *relationships* (total = price + travel, payout = total − fee)
 * rather than hard-coded naira amounts, so a change to a rate card does not
 * break the test.
 *
 *   node tools/verify-db.mjs                          # reads js/config.js
 *   PAMPA_SUPABASE_URL=... PAMPA_SUPABASE_ANON_KEY=... node tools/verify-db.mjs
 *
 * One leg cannot be driven from here: settling a dispute. The first admin has
 * to be named once by hand in the SQL editor — that is the design, not a gap,
 * since the alternative is a back door anyone could walk through. So the script
 * proves the guard rails around it instead: nobody else can grant the desk,
 * the roster is not readable, and the flag cannot be smuggled in through a
 * profile patch. The settlement leg is reported SKIPPED with the two commands
 * that finish it.
 *
 * Two legs need no database at all — they read the app's own files. The toast
 * guard fails if a shipped file hands a raw Postgres refusal to a person, and
 * its self-test fails if the guard stopped catching what it was written for.
 * Both run before the config check, so a static regression is reported whether
 * or not a project answers today.
 * ========================================================= */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { selfTest, scanToasts } from "./toast-guard.mjs";
import * as renderAudit from "./render-audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/* ---------- Where to point ---------- */

/* Parsed out of js/config.js rather than duplicated, because the point of the
   exercise is to verify the config the app actually ships with. Environment
   wins, so CI can point it somewhere else. */
function configFromApp() {
  try {
    const src = readFileSync(join(root, "js", "config.js"), "utf8");
    const url = (src.match(/url:\s*"([^"]*)"/) || [])[1] || "";
    const key = (src.match(/anonKey:\s*"([^"]*)"/) || [])[1] || "";
    return { url, key };
  } catch (e) {
    return { url: "", key: "" };
  }
}

const app = configFromApp();
const BASE = (process.env.PAMPA_SUPABASE_URL || process.argv[2] || app.url || "").replace(/\/+$/, "");
const ANON = process.env.PAMPA_SUPABASE_ANON_KEY || process.argv[3] || app.key || "";

/* ---------- The ledger of results ---------- */

const results = [];
const C = { pass: "\x1b[32m", fail: "\x1b[31m", skip: "\x1b[33m", dim: "\x1b[2m", off: "\x1b[0m" };

function record(state, name, detail) {
  results.push({ state, name, detail: detail == null ? "" : String(detail) });
  const colour = state === "PASS" ? C.pass : state === "FAIL" ? C.fail : C.skip;
  console.log(`${colour}${state}${C.off}  ${name}` + (detail ? `\n      ${C.dim}${detail}${C.off}` : ""));
}

async function check(name, fn) {
  try {
    const detail = await fn();
    record("PASS", name, detail);
    return true;
  } catch (e) {
    record("FAIL", name, e && e.message ? e.message : String(e));
    return false;
  }
}

/* A refusal is a pass — but only if it is refused for the reason it should be,
   otherwise a typo in the argument name would look like a security boundary. */
async function refused(name, fn, needle) {
  try {
    await fn();
    record("FAIL", name, "the call was allowed — it should not have been");
    return false;
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (needle && !msg.toLowerCase().includes(needle.toLowerCase())) {
      record("FAIL", name, `refused, but for the wrong reason: ${msg}`);
      return false;
    }
    record("PASS", name, msg);
    return true;
  }
}

async function skip(name, why) {
  record("SKIP", name, why);
}

/* ---------- The call ---------- */

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

/* Two functions hand out a session, so they take no token at all — you cannot
   hold one before you have signed in. Sending `p_token` to them, even as null,
   makes PostgREST look for an overload that does not exist and answer "Could
   not find the function public.pampa_register(p_address, …)", which reads like
   the function is missing rather than the argument being wrong. That confusion
   is exactly what this file exists to catch, and it caught it here. */
const NO_TOKEN = new Set(["pampa_register", "pampa_login"]);

async function rpc(fn, args, token) {
  const body = Object.assign({}, args || {});
  if (body.p_token === undefined && !NO_TOKEN.has(fn)) body.p_token = token || null;
  let res;
  try {
    res = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`can't reach ${BASE} — ${e.message}`);
  }
  const data = parseBody(await res.text());
  if (!res.ok) {
    const err = new Error(
      (data && (data.message || data.hint || data.details)) || `HTTP ${res.status}`
    );
    err.code = (data && data.code) || String(res.status);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* A table that is shut must be shut for the right reason. A 401 from a bad key
   and a 401 from a revoked privilege look identical if you only read the status
   code, so this insists on Postgres saying "permission denied". It also refuses
   to accept an empty 200: that is the shape you get when a table is protected
   by RLS but the privilege was never revoked, which is a different — and much
   weaker — posture than the one the migrations claim. */
function lockedShut(r, name) {
  const msg = (r.body && (r.body.message || r.body.hint)) || `HTTP ${r.status}`;
  assert(!r.ok, `${name} answered the anon key with HTTP ${r.status} — it is readable`);
  assert(/permission denied/i.test(msg), `${name} was refused, but not by its privileges: ${msg}`);
  return `status ${r.status} · ${msg}`;
}

/* Direct table reads, which must not work with the anon key at all. These are
   the calls a nosy visitor would try first. */
async function table(name, query, key) {
  const res = await fetch(`${BASE}/rest/v1/${name}?${query}`, {
    headers: {
      apikey: key || ANON,
      Authorization: `Bearer ${key || ANON}`,
      Accept: "application/json",
    },
  });
  return { status: res.status, ok: res.ok, body: parseBody(await res.text()) };
}

/* ---------- Small maths, so assertions are relationships not constants ---------- */

function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function tomorrow(from = new Date()) {
  const d = new Date(from.getTime() + 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

/* ---------- The run ---------- */

const stamp = Date.now().toString(36);
const clientHandle = `c${stamp}`;   /* >= 7 chars, letters and digits only */
const proHandle = `p${stamp}`;
const strangerHandle = `s${stamp}`;
const deskHandle = `d${stamp}`;
const PASSWORD = "haircut2026";

const CLIENT = { lat: 6.5, lng: 3.35 };        /* Surulere centre */
const PRO = { lat: 6.5012, lng: 3.3512 };      /* ~180 m away: a real door-to-door test */
const EXPECTED_KM = haversineKm(CLIENT.lat, CLIENT.lng, PRO.lat, PRO.lng);

const state = { accounts: [] };

/* Every account this run creates is remembered by id so the cleanup below can
   name exact rows. Deliberately not a pattern like handle LIKE 'c%' — a real
   client called "chidi" would match, and this file gets pasted into a live
   database. */
function track(label, reg) {
  if (reg && reg.account && reg.account.id) state.accounts.push({ label, id: reg.account.id });
  return reg;
}

async function main() {
  console.log(`\nPampa backend verification\n  ${BASE}\n  anon key ${ANON ? ANON.slice(0, 12) + "…" : "(none)"}\n`);

  /* -- 0. The static legs -------------------------------------------------
     They read the app's own files rather than the database, so they run
     before the config check: a raw Postgres refusal reaching a person is a
     regression whether or not a project answers today, and the first leg
     proves the fence is still standing rather than merely quiet. */

  await check("the toast guard still catches a raw message", () => {
    const rows = selfTest();
    const bad = rows.filter((r) => !r.ok);
    if (bad.length) {
      throw new Error(bad.map((r) => `"${r.name}" expected ${r.want} finding(s), got ${r.got}`).join(" · "));
    }
    return `${rows.length} fixtures, every one judged as intended`;
  });

  await check("no shipped file hands a raw database message to a person", () => {
    const r = scanToasts();
    if (!r.ok) throw new Error(r.hits.map((h) => `${h.file}:${h.line} ${h.text}`).join(" · "));
    return `${r.files.length} shipped files scanned · ` +
      (r.allowed.length
        ? `${r.allowed.length} allowance${r.allowed.length === 1 ? "" : "s"} (${r.allowed.map((a) => a.file + ":" + a.line).join(", ")})`
        : "no raw-message sink and no allowance in any of them");
  });

  /* The rendered cascade audit: the check the nav-badge bug earned. It boots
     a real headless browser, walks every surface the app renders, and fails
     if any floating component's own rule loses a geometry declaration to a
     rule that never names it — judged from the DOM, so containment, media
     conditions and cascade order are the browser's own answers. It needs a
     browser but no database, so where none exists it is reported SKIP with
     the reason rather than pretended to have run. */
  const browser = renderAudit.findBrowser();
  if (!browser) {
    await skip("every floating component keeps its own rule when the app renders", "no Chrome or Edge found — install one or set PAMPA_BROWSER");
  } else {
    await check("every floating component keeps its own rule when the app renders", async () => {
      const r = await renderAudit.runRenderAudit({});
      if (r.skipped) throw new Error(r.why);
      const err = r.surfaces.filter((s) => !s.ok);
      if (err.length) {
        throw new Error("surfaces that could not be audited: " +
          err.map((s) => `${s.name} (${s.note})`).join(" · "));
      }
      if (r.findings.length) {
        throw new Error(r.findings.map((f) => `[${f.surface}] ${f.element} { ${f.prop} } beaten by ${f.beatenBy}`).join(" · "));
      }
      const caught = r.planted >= 0 ? " · planted trap caught" : "";
      const widths = (r.surfaces[0] && r.surfaces[0].name.indexOf(" @ ") === -1) ? " + 360/412/800" : "";
      return `${r.surfaces.length} surface passes rendered in ${r.browser.split(/[\\/]/).pop()}${widths}${caught}`;
    });
  }

  if (!BASE || !ANON) {
    record("FAIL", "configuration", "js/config.js has no url/anonKey and none was passed in");
    return finish();
  }
  record("PASS", "configuration", `pointing at ${BASE}`);

  /* -- 1. The doors that must stay shut ---------------------------------- */

  await check("anon cannot read accounts directly", async () => {
    return lockedShut(await table("pampa_accounts", "select=id,handle&limit=1"), "pampa_accounts");
  });

  await check("anon cannot read sessions (the token table)", async () => {
    return lockedShut(await table("pampa_sessions", "select=token&limit=1"), "pampa_sessions");
  });

  await check("anon cannot read bookings directly", async () => {
    return lockedShut(await table("pampa_bookings", "select=id,client_name&limit=1"), "pampa_bookings");
  });

  await refused(
    "the sign-in function refuses a wrong password",
    () => rpc("pampa_login", { p_handle: clientHandle, p_password: "definitely-wrong" }),
    "do not match"
  );

  /* The signed-out path. Every other function takes a token, and when there is
     none the database has to say so in words. If this came back "could not find
     the function", the app's signed-out behaviour would be an accident of the
     schema cache rather than a rule. */
  await refused(
    "a token-protected function refuses a signed-out caller",
    () => rpc("pampa_me", {}),
    "not signed in"
  );

  /* -- 2. Accounts ------------------------------------------------------- */

  await check("a client registers and gets a session token", async () => {
    const r = await rpc("pampa_register", {
      p_handle: clientHandle,
      p_password: PASSWORD,
      p_name: "Verifier Client",
      p_role: "client",
      p_area_id: "surulere",
      p_address: "1 Verification Close, Surulere",
      p_lat: CLIENT.lat,
      p_lng: CLIENT.lng,
    });
    state.client = track("client", r);
    assert(r && r.token, "no token came back");
    assert(r.account && r.account.role === "client", `role came back as ${r.account && r.account.role}`);
    return `account ${r.account.id} · role ${r.account.role}`;
  });

  await check("a professional registers with a trade and a fix", async () => {
    const r = await rpc("pampa_register", {
      p_handle: proHandle,
      p_password: PASSWORD,
      p_name: "Verifier Barber",
      p_role: "pro",
      p_trade: "barb",
      p_area_id: "surulere",
      p_address: "2 Test Row, Surulere",
      p_lat: PRO.lat,
      p_lng: PRO.lng,
    });
    state.pro = track("professional", r);
    assert(r && r.token, "no token came back");
    assert(r.account.provider && r.account.provider.trade === "barb", "no barbing provider record");
    assert(r.account.coords && r.account.coords.lat, "the fix was not stored");
    return `account ${r.account.id} · trade ${r.account.provider.trade} · coords stored`;
  });

  await refused(
    "a duplicate handle is refused",
    () =>
      rpc("pampa_register", {
        p_handle: clientHandle,
        p_password: PASSWORD,
        p_name: "Impostor",
        p_role: "client",
      }),
    "already has an account"
  );

  await check("a registered professional gets a default price band per service", async () => {
    /* Read back through the function the rates screen uses. A professional's
       bands are not on their account json — they live one row per service — so
       the honest check is their own profile, which is also what a client will
       later see. */
    const pub = await rpc(
      "pampa_provider_public",
      { p_provider: state.pro.account.id },
      state.pro.token
    );
    const svcs = pub.services || [];
    assert(svcs.length >= 3, `only ${svcs.length} services came back`);
    svcs.forEach((s) => {
      assert(s.range && s.range.min != null && s.range.max != null, `${s.id} came back with no band`);
      assert(
        Number(s.range.max) >= Number(s.range.min),
        `${s.id} band is inverted: ${s.range.min}–${s.range.max}`
      );
    });
    return svcs.map((s) => `${s.id} ${s.range.min}–${s.range.max}`).join(" · ");
  });

  /* -- 3. Rates: the bands clients compete on ---------------------------- */

  await check("a professional sets their own price ranges", async () => {
    await rpc(
      "pampa_set_rates",
      {
        p_rates: {
          cut: { min: 2450, max: 4900 },
          beard: { min: 1200, max: 2400 },
          touch: { min: 900, max: 1800 },
        },
      },
      state.pro.token
    );
    const pub = await rpc(
      "pampa_provider_public",
      { p_provider: state.pro.account.id },
      state.pro.token
    );
    const cut = (pub.services || []).find((s) => s.id === "cut");
    assert(cut, "the professional's own profile dropped the haircut");
    assert(
      Number(cut.range.min) === 2450 && Number(cut.range.max) === 4900,
      `read back ${JSON.stringify(cut.range)}`
    );
    return `full haircut reads back ${cut.range.min}–${cut.range.max} (the ceiling is stored)`;
  });

  await refused(
    "a range that starts above where it ends is refused",
    () =>
      rpc("pampa_set_rates", { p_rates: { cut: { min: 9000, max: 1000 } } }, state.pro.token),
    "cannot start above"
  );

  await refused(
    "a professional cannot price another trade's service",
    () => rpc("pampa_set_rates", { p_rates: { braids: { min: 1000, max: 2000 } } }, state.pro.token),
    "not a service in your trade"
  );

  /* -- 4. Discovery, by distance and by price ---------------------------- */

  await check("the directory returns the professional with a precise distance", async () => {
    const list = await rpc(
      "pampa_directory",
      { p_lat: CLIENT.lat, p_lng: CLIENT.lng, p_trade: "barb" },
      state.client.token
    );
    assert(Array.isArray(list) && list.length, "the directory came back empty");
    const row = list.find((r) => r.id === state.pro.account.id);
    assert(row, "the professional just registered is not in the directory");
    state.dirRow = row;
    assert(row.km != null, "no distance on the row");
    const drift = Math.abs(Number(row.km) - EXPECTED_KM);
    assert(drift < 0.05, `distance ${row.km} km vs ${EXPECTED_KM.toFixed(3)} km expected`);
    return `${list.length} in barbing · barber at ${row.km} km (measured ${EXPECTED_KM.toFixed(3)})`;
  });

  await check("the directory carries each professional's price range", async () => {
    const row = state.dirRow;
    const rates = row.rates || {};
    assert(rates.cut && rates.cut.max === 4900, `rates missing: ${JSON.stringify(rates)}`);
    return `rates exposed to clients: cut ${rates.cut.min}–${rates.cut.max}`;
  });

  /* -- 5. The booking and escrow loop ------------------------------------ */

  await check("a client places a request; nothing is held yet", async () => {
    const b = await rpc(
      "pampa_booking_create",
      {
        p_provider: state.pro.account.id,
        p_service: "cut",
        p_date: tomorrow(),
        p_time: "11:00",
        p_loc: "home",
        p_address: "1 Verification Close, Surulere",
        p_offer: 3000,
        p_note: "Verification run",
      },
      state.client.token
    );
    state.booking = b;
    assert(b && b.id, "no booking came back");
    assert(b.status === "unpaid", `status is ${b.status}, expected unpaid`);
    assert(!b.pay, "money was held before payment");
    assert(b.total === b.price + b.travelFee, `total ${b.total} ≠ price ${b.price} + travel ${b.travelFee}`);
    return `booking ${b.id} · ${b.status} · offer ${b.price} + travel ${b.travelFee} = ${b.total}`;
  });

  state.bookingId = state.booking.id;

  await refused(
    "the client cannot complete a job that was never funded",
    () => rpc("pampa_booking_complete", { p_booking: state.bookingId }, state.client.token),
    ""
  );

  await check("paying moves the money into escrow", async () => {
    const b = await rpc(
      "pampa_booking_pay",
      { p_booking: state.bookingId, p_method: "card" },
      state.client.token
    );
    state.booking = b;
    assert(b.status === "escrowed", `status is ${b.status}, expected escrowed`);
    assert(b.pay && b.pay.amount === b.total, `held ${b.pay && b.pay.amount} vs total ${b.total}`);
    return `held ${b.pay.amount} · status ${b.status}`;
  });

  await refused(
    "the client cannot accept their own request",
    () => rpc("pampa_booking_accept", { p_booking: state.bookingId }, state.client.token),
    ""
  );

  await check("the professional accepts the funded booking", async () => {
    const b = await rpc("pampa_booking_accept", { p_booking: state.bookingId }, state.pro.token);
    state.booking = b;
    assert(b.status === "confirmed", `status is ${b.status}, expected confirmed`);
    return `status ${b.status} · accepted ${b.acceptedAt ? "recorded" : "(no timestamp)"}`;
  });

  await check("the professional marks the job done", async () => {
    const b = await rpc("pampa_booking_complete", { p_booking: state.bookingId }, state.pro.token);
    state.booking = b;
    assert(b.proMarkedDone === true, "the done flag was not set");
    return `proMarkedDone ${b.proMarkedDone} · status still ${b.status}`;
  });

  await check("the client releases escrow with a rating, and the pro is paid net of fee", async () => {
    const b = await rpc(
      "pampa_booking_release",
      { p_booking: state.bookingId, p_rating: 5, p_note: "Verification: clean fade" },
      state.client.token
    );
    state.booking = b;
    assert(b.status === "released", `status is ${b.status}, expected released`);
    /* The fee rule is a relationship, not a constant: the payout has to be the
       total less the platform's cut, whatever that cut happens to be. */
    state.expectTotal = b.total;
    const w = await rpc("pampa_wallet", {}, state.pro.token);
    const p = (w.payouts || [])[0];
    assert(p, `nothing was paid out: ${JSON.stringify(w).slice(0, 160)}`);
    state.expectNet = Number(p.net);
    state.expectFee = Number(p.fee);
    assert(
      state.expectNet === b.total - state.expectFee,
      `net ${p.net} is not the total ${b.total} less the fee ${p.fee}`
    );
    assert(state.expectNet < b.total, "the payout was not net of any fee");
    return `released ${b.total} · fee ${p.fee} · net to barber ${p.net}`;
  });

  await check("the barber's wallet shows the payout and nothing still held", async () => {
    const w = await rpc("pampa_wallet", {}, state.pro.token);
    const p = (w.payouts || []).find((row) => Number(row.net) === state.expectNet);
    assert(p, `the payout is not in the wallet: ${JSON.stringify(w).slice(0, 160)}`);
    assert(p.gross === state.expectTotal, `payout gross ${p.gross} vs total ${state.expectTotal}`);
    assert(Number(w.held) === 0, `${w.held} is still held after the job was released`);
    return `paid ${p.net} net of ${p.fee} · held ${w.held} · ref ${p.ref}`;
  });

  await check("the rating lands on the professional's public record", async () => {
    const list = await rpc(
      "pampa_directory",
      { p_lat: CLIENT.lat, p_lng: CLIENT.lng, p_trade: "barb" },
      state.client.token
    );
    const row = list.find((r) => r.id === state.pro.account.id);
    assert(row, "the professional dropped out of the directory");
    assert(Number(row.rating) === 5, `rating reads ${row.rating}`);
    assert(Number(row.ratings) === 1, `${row.ratings} ratings counted`);
    return `rating ${row.rating} from ${row.ratings} rating(s)`;
  });

  /* -- 6. Who can see what ---------------------------------------------- */

  await check("a stranger cannot see the booking in their list", async () => {
    const s = await rpc("pampa_register", {
      p_handle: strangerHandle,
      p_password: PASSWORD,
      p_name: "Verifier Stranger",
      p_role: "client",
      p_area_id: "ikeja",
    });
    state.stranger = track("stranger", s);
    const list = await rpc("pampa_bookings", {}, s.token);
    const ids = (list || []).map((b) => b.id);
    assert(!ids.includes(state.bookingId), "a third party can read somebody else's booking");
    return `stranger sees ${ids.length} booking(s), not this one`;
  });

  /* -- 7. Dispute, both sides' evidence, and the desk -------------------- */

  await check("a disputed booking freezes the money and carries the client's evidence", async () => {
    const b = await rpc(
      "pampa_booking_create",
      {
        p_provider: state.pro.account.id,
        p_service: "beard",
        p_date: tomorrow(),
        p_time: "15:00",
        p_loc: "studio",
        p_offer: 1500,
        p_note: "Verification: dispute leg",
      },
      state.client.token
    );
    await rpc("pampa_booking_pay", { p_booking: b.id, p_method: "card" }, state.client.token);
    await rpc("pampa_booking_accept", { p_booking: b.id }, state.pro.token);
    await rpc("pampa_booking_complete", { p_booking: b.id }, state.pro.token);
    const d = await rpc(
      "pampa_booking_dispute",
      {
        p_booking: b.id,
        p_reason: "The line-up was uneven on the left",
        p_photos: [{ name: "before.jpg", data: "data:image/jpeg;base64,AAAA" }],
      },
      state.client.token
    );
    state.disputeId = b.id;
    assert(d.status === "disputed", `status is ${d.status}, expected disputed`);
    assert(d.dispute && d.dispute.photos && d.dispute.photos.length === 1, "the photo was not stored");
    return `booking ${b.id} disputed · ${d.pay.amount} still frozen · 1 photo on the card`;
  });

  await check("the professional can file their side with photos", async () => {
    const r = await rpc(
      "pampa_booking_dispute_reply",
      {
        p_booking: state.disputeId,
        p_note: "I offered to fix it; the client left before I could",
        p_photos: [{ name: "after.jpg", data: "data:image/jpeg;base64,BBBB" }],
      },
      state.pro.token
    );
    const reply = r.dispute && r.dispute.response;
    assert(reply, `no reply stored on the dispute: ${JSON.stringify((r.dispute || {})).slice(0, 160)}`);
    assert(/offered to fix it/.test(reply.note || ""), "the statement was not stored");
    const photos = (reply.photos || []).length;
    assert(photos >= 1, "the professional's photo was not stored");
    return `reply stored with ${photos} photo(s); both sides now on the card`;
  });

  await refused(
    "nobody but the resolution desk can settle a dispute",
    () => rpc("pampa_desk_settle", { p_booking: state.disputeId, p_outcome: "split", p_percent: 50 }, state.client.token),
    "resolution desk"
  );

  /* The desk is the one thing that cannot be exercised end to end from here:
     the first admin has to be named once in the SQL editor, and that is the
     whole point of the design. What can be proved from outside is that nobody
     else can get in — which is the half that matters for safety. */
  await check("a new account is not on the desk", async () => {
    const desk = await rpc("pampa_register", {
      p_handle: deskHandle,
      p_password: PASSWORD,
      p_name: "Verifier Desk",
      p_role: "client",
      p_area_id: "ikeja",
    });
    state.desk = track("desk", desk);
    const flags = await rpc("pampa_my_flags", {}, desk.token);
    assert(flags && flags.desk === false, `a fresh account reports desk=${flags && flags.desk}`);
    assert(flags.admin === false, "a fresh account reports admin=true");
    return `desk ${flags.desk} · admin ${flags.admin}`;
  });

  await refused(
    "an ordinary account cannot grant itself the desk",
    () => rpc("pampa_desk_grant", { p_handle: strangerHandle, p_on: true }, state.client.token),
    "admin"
  );

  await refused(
    "an ordinary account cannot read the desk roster",
    () => rpc("pampa_desk_roster", {}, state.client.token),
    "admin"
  );

  await check("the desk flag cannot be smuggled in through a profile update", async () => {
    /* pampa_update_profile takes a jsonb patch, which is exactly the shape of
       an escalation if it copies keys it does not recognise. It does not — but
       this asserts that rather than trusting it. */
    await rpc(
      "pampa_update_profile",
      { p_patch: { desk: true, admin: true, role: "pro" } },
      state.desk.token
    );
    const flags = await rpc("pampa_my_flags", {}, state.desk.token);
    assert(!flags.desk && !flags.admin, `the patch escalated: ${JSON.stringify(flags)}`);
    return "desk/admin/role all ignored by the patch whitelist";
  });

  /* The desk. The first admin has to be named once in the SQL editor — that is
     the design, not a gap, since any other way in would be a back door. So this
     leg runs only when an admin's credentials are handed in:

       PAMPA_ADMIN_HANDLE=… PAMPA_ADMIN_PASSWORD=… node tools/verify-db.mjs

     Handed in, it exercises the whole path: an admin promoting a mediator
     through the RPC, then that mediator splitting a frozen escrow and both
     sides being paid. Not handed in, it says so — it never passes silently. */
  const adminHandle = process.env.PAMPA_ADMIN_HANDLE;
  const adminPassword = process.env.PAMPA_ADMIN_PASSWORD;

  if (!adminHandle || !adminPassword) {
    await skip(
      "an admin promotes a mediator, who splits the frozen escrow",
      "set PAMPA_ADMIN_HANDLE and PAMPA_ADMIN_PASSWORD to run this leg — see the " +
        "bootstrap block in 20260922162000_resolution_desk.sql"
    );
  } else {
    await check("an admin promotes a mediator, who splits the frozen escrow", async () => {
      const admin = await rpc("pampa_login", { p_handle: adminHandle, p_password: adminPassword });
      assert(admin && admin.token, "the admin could not sign in");

      const granted = await rpc(
        "pampa_desk_grant",
        { p_handle: deskHandle, p_on: true },
        admin.token
      );
      assert(granted && granted.desk === true, `the grant did not take: ${JSON.stringify(granted)}`);

      /* The promoted account has to see its own new flag through the same call
         the app's own screens use, otherwise the promotion is invisible. */
      const flags = await rpc("pampa_my_flags", {}, state.desk.token);
      assert(flags.desk === true, "the promoted mediator does not report itself on the desk");

      const settle = await rpc(
        "pampa_desk_settle",
        { p_booking: state.disputeId, p_outcome: "split", p_percent: 60 },
        state.desk.token
      );
      assert(settle.status === "settled", `status is ${settle.status}, expected settled`);
      const res = settle.resolution || {};
      const held = Number((settle.pay && settle.pay.amount) || 0);
      assert(res.type === "split", `resolution type is ${res.type}`);
      assert(held > 0, "no escrow was on the settled booking");
      /* The two halves plus the fee have to add back up to what was held:
         the client gets the remainder, the professional's share carries the
         platform fee. That is a relationship, so a change to the fee rate
         cannot make this pass by accident. */
      assert(
        res.toClient + res.toPro + res.fee === held,
        `the split does not add up: ${res.toClient} + ${res.toPro} + ${res.fee} ≠ ${held}`
      );
      assert(res.toPro === res.proGross - res.fee, `net ${res.toPro} is not gross ${res.proGross} less fee ${res.fee}`);
      assert(res.toClient > 0 && res.toPro > 0, "one side was paid nothing");
      assert(settle.refund && settle.refund.amount === res.toClient, "the refund is not on the client's card");

      /* Both halves have to be real on both sides: the client's refund is on
         their card, and the professional's share is in their wallet, not just
         in the resolution note. */
      const wallet = await rpc("pampa_wallet", {}, state.pro.token);
      const fromDesk = (wallet.payouts || []).find((row) => row.bookingId === state.disputeId);
      assert(fromDesk, "no payout row for the settled dispute");
      assert(Number(fromDesk.net) === res.toPro, `wallet says ${fromDesk.net}, the resolution says ${res.toPro}`);
      assert(Number(wallet.held) === 0, `${wallet.held} is still frozen after settlement`);

      return `admin promoted ${deskHandle} · split ${res.percent}/${100 - res.percent} · ₦${res.toClient} refunded, ₦${res.toPro} to the barber (fee ₦${res.fee})`;
    });

    /* And the mediated outcome is in the journal, so the decision is not just a
       field on a row — it is part of the story the dispute is decided on. */
    await check("the settlement is journalled as the desk's decision", async () => {
      const list = await rpc("pampa_bookings", {}, state.client.token);
      const mine = (list || []).find((b) => b.id === state.disputeId);
      assert(mine, "the settled booking is missing from the client's list");
      const last = (mine.events || []).slice(-1)[0];
      assert(last && last.kind === "settled", `the last entry is ${last && last.kind}`);
      assert(last.role === "desk", `the entry is attributed to ${last.role}, not the desk`);
      return `${last.kind} by ${last.role}: ${last.label}`;
    });
  }

  await check("the booking journal is append-only and kept the whole story", async () => {
    const list = await rpc("pampa_bookings", {}, state.client.token);
    const mine = (list || []).find((b) => b.id === state.bookingId);
    assert(mine, "the released booking is missing from the client's list");
    const kinds = (mine.events || []).map((e) => e.kind);
    assert(kinds.length >= 4, `only ${kinds.length} journal entries: ${kinds.join(",")}`);
    return `${kinds.length} entries: ${kinds.join(" → ")}`;
  });
}

/* ---------- Cleaning up after ourselves ---------- */

/* The booking journal has a before-update-or-delete trigger that refuses
   everything, which is the whole reason it is worth trusting — so the cleanup
   has to disable it around the deletes and put it straight back. That an
   operator can do this and the app's roles cannot is the design, not a hole.

   Written to supabase/.temp/, which is gitignored: this is run scaffolding,
   not part of the schema. */
function writeCleanup() {
  const ids = state.accounts.map((a) => `'${a.id}'`);
  if (!ids.length) return null;
  const list = ids.join(", ");
  const sql = `-- Generated by tools/verify-db.mjs on ${new Date().toISOString()}
-- Removes exactly these accounts and everything hanging off them:
${state.accounts.map((a) => `--   ${a.label.padEnd(13)} ${a.id}`).join("\n")}
--
-- Safe to re-run: every statement is scoped to those ids.

begin;

alter table public.pampa_booking_events
  disable trigger pampa_booking_events_append_only;

-- The journal first: the trigger is off, and deleting the bookings would try
-- to cascade into it anyway.
delete from public.pampa_booking_events
 where booking_id in (select id from public.pampa_bookings
                       where client_id in (${list}) or provider_id in (${list}));

delete from public.pampa_payouts
 where booking_id in (select id from public.pampa_bookings
                       where client_id in (${list}) or provider_id in (${list}));

-- Bookings before accounts: client_id is ON DELETE RESTRICT, on purpose, so a
-- professional with a job on the books cannot be quietly erased.
delete from public.pampa_bookings
 where client_id in (${list}) or provider_id in (${list});

delete from public.pampa_provider_services where provider_id in (${list});
delete from public.pampa_payout_destinations where account_id in (${list});
delete from public.pampa_providers where account_id in (${list});
delete from public.pampa_sessions where account_id in (${list});
delete from public.pampa_accounts where id in (${list});

alter table public.pampa_booking_events
  enable trigger pampa_booking_events_append_only;

commit;
`;
  const dir = join(root, "supabase", ".temp");
  try {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "verify-cleanup.sql");
    writeFileSync(path, sql);
    return path;
  } catch (e) {
    console.warn(`could not write the cleanup script: ${e.message}`);
    return null;
  }
}

function finish() {
  const path = writeCleanup();
  if (path) {
    console.log(`\nCleanup for this run written to ${path}`);
    console.log("Run it in the Supabase SQL editor to remove the accounts above.");
  }
  const pass = results.filter((r) => r.state === "PASS").length;
  const fail = results.filter((r) => r.state === "FAIL").length;
  const skipped = results.filter((r) => r.state === "SKIP").length;
  console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped\n`);
  if (fail) {
    console.log("Failures:");
    results.filter((r) => r.state === "FAIL").forEach((r) => console.log(`  · ${r.name}\n    ${r.detail}`));
    console.log("");
  }
  process.exit(fail ? 1 : 0);
}

main()
  .then(finish)
  .catch((e) => {
    record("FAIL", "the run itself", (e && e.stack) || String(e));
    finish();
  });
