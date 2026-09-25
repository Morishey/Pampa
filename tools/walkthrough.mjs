/* =============================================================================
 * Pampa — the walk
 *
 * The render audit asks whether every surface *draws*; this asks whether the
 * things on it *work*. It boots a real Chromium on the local copy of the app,
 * signs in on the live database as a pair of throwaway accounts — a client and
 * a professional who can book each other — and then walks the product the way
 * a person would: taps a tab, opens the card on it, answers the sheet that
 * comes up, and asks each time whether the screen did what the tap meant.
 *
 * Why live rather than staged: almost every road in this app now runs through
 * Postgres. A walk on a staged device judges the offline fallbacks, which are
 * the rare path, and would never see a booking placed, paid, accepted,
 * finished and released — the thing the product actually is. The two accounts
 * are named QA and are safe to remove with supabase/.temp/purge-qa.mjs.
 *
 * What it reports, per step: what was tapped, whether it was found at all,
 * what changed, and anything the page complained about while it happened —
 * uncaught exceptions, console errors, failed requests. A flow that leaves a
 * console error behind is a flow that broke somewhere the screen still draws.
 *
 *   node tools/walkthrough.mjs                # the whole walk
 *   node tools/walkthrough.mjs --census       # inventory of what is tappable
 *   node tools/walkthrough.mjs --only=<name>  # one leg
 *   node tools/walkthrough.mjs --journey      # the escrow journey, ledger-checked
 * ========================================================================== */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bootApp } from "./render-audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- The database, from Node --------------------------------------- */

const CONFIG = readFileSync(join(root, "js", "config.js"), "utf8");
const URL_BASE = CONFIG.match(/url:\s*"([^"]+)"/)[1].replace(/\/+$/, "");
const ANON = CONFIG.match(/anonKey:\s*"([^"]+)"/)[1];

async function rpc(fn, args) {
  const res = await fetch(URL_BASE + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: {
      apikey: ANON, Authorization: "Bearer " + ANON,
      "Content-Type": "application/json", Accept: "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(fn + ": " + ((data && data.message) || res.status));
  return data;
}

/* The pair the walk books with. Fixed handles so a re-run reuses them, and
   passwords long enough for whatever the server insists on. */
const PEOPLE = {
  client: {
    handle: "8099990011", name: "QA Walk", password: "Walk-2461-Qa!",
    role: "client", area: "surulere", address: "3 Walk Street, Surulere",
    coords: { lat: 6.5000, lng: 3.3500 },
  },
  pro: {
    handle: "8099990012", name: "QA Chair", password: "Chair-7395-Qa!",
    role: "pro", trade: "barb", area: "surulere",
    address: "5 Chair Close, Surulere", coords: { lat: 6.4988, lng: 3.3488 },
  },
};

async function sessionFor(who) {
  const p = PEOPLE[who];
  try {
    const s = await rpc("pampa_login", { p_handle: p.handle, p_password: p.password });
    if (s && s.token) return s;
  } catch (e) {
    /* The register fallback below answers a *new* cast member. An existing
       one whose login was refused has a different problem — its password was
       changed under it (as QA Walk's was, the day the change-password flow
       was proven live) — and registering again says nothing about that. The
       failure is named before the fallback can dress it up as a missing
       account. */
    if (!/already has an account/i.test(String((e && e.message) || e))) throw e;
  }
  return rpc("pampa_register", {
    p_handle: p.handle, p_password: p.password, p_name: p.name,
    p_role: p.role, p_trade: p.trade || null, p_area_id: p.area,
    p_address: p.address, p_lat: p.coords.lat, p_lng: p.coords.lng, p_dp: null,
  });
}

/* ---------- What runs in the page ----------------------------------------- */

/* The little vocabulary every leg is written in: find something the way a
   person does (by what it says), tap it the way a browser would (a real click
   event, so every listener on the way up hears it), and ask afterwards whether
   the screen changed. Nothing here calls the app's own functions — a walk that
   opens a sheet by name would pass on a button that does nothing. */
const HELPERS = `
window.__W = (function () {
  var found = [];
  function vis(el) {
    if (!el) return false;
    var s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") return false;
    if (el.closest && el.closest('[aria-hidden="true"]')) return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }
  function txt(el) { return (el.textContent || "").replace(/\\s+/g, " ").trim(); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  /* What a control is called is not always what it says: a star row reads
     "5 stars" to a screen reader and nothing at all in its text. So a tap by
     name matches the accessible name too — text, aria-label or title. */
  function name(el) {
    return [txt(el), el.getAttribute && el.getAttribute("aria-label"), el.getAttribute && el.getAttribute("title")]
      .filter(Boolean).join(" ");
  }
  function byText(sel, want, root) {
    var list = all(sel, root).filter(vis);
    var hit = list.filter(function (el) { return name(el).toLowerCase().indexOf(String(want).toLowerCase()) !== -1; });
    /* the smallest thing that says it, which is the button rather than the card */
    hit.sort(function (a, b) { return txt(a).length - txt(b).length; });
    return hit[0] || null;
  }
  function tap(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    var opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: window };
    el.dispatchEvent(new MouseEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
    return true;
  }
  function tapText(sel, want, root) { return tap(byText(sel, want, root)); }
  function shown(sel) { var el = document.querySelector(sel); return !!el && vis(el); }
  function sheetOpen() { return shown(".sheet.show") || shown("#sheetOverlay"); }
  function watch(fn, ms) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        var ok = false;
        try { ok = !!fn(); } catch (e) {}
        if (ok || Date.now() - t0 > ms) return resolve({ ok: ok, ms: Date.now() - t0 });
        setTimeout(poll, 25);
      })();
    });
  }
  function inventory() {
    var sel = "button, a, [role=button], input, select, textarea, [data-view], [data-goto], [onclick]";
    var seen = [];
    all(sel).filter(vis).forEach(function (el) {
      var label = txt(el) || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.name || el.value || "";
      label = String(label).slice(0, 46);
      var key = el.tagName + "|" + (el.className && el.className.baseVal === undefined ? String(el.className).split(" ")[0] : "") + "|" + label;
      if (seen.indexOf(key) !== -1) return;
      seen.push(key);
      var watchers = ["data-view", "data-goto", "data-tab", "data-sheet", "data-open", "id"].map(function (a) {
        var v = el.getAttribute(a);
        return v ? a + "=" + String(v).slice(0, 30) : null;
      }).filter(Boolean).join(" ");
      found.push({ tag: el.tagName.toLowerCase(), label: label, attrs: watchers });
    });
    return found;
  }
  return { vis: vis, txt: txt, name: name, all: all, byText: byText, tap: tap, tapText: tapText,
           shown: shown, sheetOpen: sheetOpen, watch: watch, inventory: inventory,
           reset: function () { found = []; return true; } };
})();
true;
`;

/* ---------- The walk ------------------------------------------------------ */

const out = [];
const say = (line) => { out.push(line); console.log(line); };

/* What every leg of the walk needs, and what the journey needs too: a real
   browser, a real session on the real database, and the app standing on its
   own restore road. Shared so a change to the boot changes both. */
async function standUp(cdp, app, opts, report) {
  const session = await sessionFor(opts.who || "client");
  await cdp.evaluate(HELPERS);
  await cdp.evaluate(`(function () {
    dbSessionSet(${JSON.stringify(session)});
    return true;
  })()`);
  /* The reload is the point: the device is put in the state a returning
     person's phone is in — a token in storage and nothing else — and the
     app's own restore road (dbCloudRestore → pampa_me → dbCloudSync) is what
     puts the dashboard up. */
  await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + app.port + "/index.html" });
  await cdp.evaluate(`(function () {
    var t0 = Date.now();
    return new Promise(function (resolve) {
      (function poll() {
        var app = document.getElementById("app");
        var up = app && app.style.display !== "none" && document.querySelector(".view");
        if (up || Date.now() - t0 > 20000) return resolve(!!up);
        setTimeout(poll, 120);
      })();
    });
  })()`);
  await sleep(1800);
  await cdp.evaluate(HELPERS);
  const who = await cdp.evaluate("(function(){ return { name: (state.user||{}).name, role: (state.user||{}).role, view: state.view, signedIn: dbSignedIn() }; })()");
  say("· signed in as " + who.name + " (" + who.role + ") · view " + who.view);
  if (report) report.who = who;
  return who;
}

export async function runWalk(opts = {}) {
  const app = await bootApp({ live: true, ...opts });
  if (app.skipped) return { skipped: true, why: app.why };
  const { cdp, close } = app;
  const report = { steps: [], complaints: [], legs: [] };

  const step = async (name, fn) => {
    cdp.drain();
    let result = null;
    let threw = null;
    try { result = await fn(); } catch (e) { threw = String((e && e.message) || e); }
    const notes = cdp.complaints();
    report.steps.push({ name, result, threw, notes });
    say(
      "  " + (threw ? "THREW " : "") + name +
      (result && result.why ? " — " + result.why : "") +
      (notes.length ? "  · " + notes.length + " page complaint(s)" : "")
    );
    if (notes.length) say("      " + notes.slice(0, 4).join("\n      "));
    return result;
  };

  try {
    await standUp(cdp, app, opts, report);

    /* --do is how a leg is written before it is a leg: a small list of steps
       run against the standing app, each one either tapping something by what
       it says or dumping what is on the screen now. It is the exploratory
       half of this tool — the walking half is the legs below it. */
    if (opts.do) {
      for (const spec of opts.do) {
        if (spec.wait) { await sleep(spec.wait); continue; }
        if (spec.eval) {
          const got = await cdp.evaluate(spec.eval);
          say("    = " + JSON.stringify(got).slice(0, 400));
          continue;
        }
        if (spec.open) {
          const err = await cdp.evaluate(`(function(){ try { ${spec.open}; return null; } catch (e) { return String(e && e.message || e); } })()`);
          say("    · opened " + spec.open + (err ? " — THREW " + err : ""));
          await sleep(spec.wait || 700);
          continue;
        }
        if (spec.tapSel) {
          const hit = await cdp.evaluate(`(function(){
            var el = document.querySelector(${JSON.stringify(spec.tapSel)});
            if (!el || !__W.vis(el)) return { found: false };
            var what = __W.txt(el).slice(0, 60);
            __W.tap(el);
            return { found: true, what: what };
          })()`);
          say("    · tap " + spec.tapSel + " → " + (hit.found ? "\"" + hit.what + "\"" : "NOT FOUND"));
          if (!hit.found) report.missing = (report.missing || []).concat([spec.tapSel]);
          await sleep(spec.wait || 700);
          continue;
        }
        if (spec.tap) {
          const [sel, text] = spec.tap;
          const hit = await cdp.evaluate(`(function(){
            var el = __W.byText(${JSON.stringify(sel)}, ${JSON.stringify(text)});
            if (!el) return { found: false };
            var what = __W.txt(el).slice(0, 60);
            __W.tap(el);
            return { found: true, what: what };
          })()`);
          say("    · tap " + JSON.stringify(text) + " → " + (hit.found ? "\"" + hit.what + "\"" : "NOT FOUND"));
          if (!hit.found) report.missing = (report.missing || []).concat([text]);
          await sleep(spec.wait || 700);
          continue;
        }
        if (spec.set) {
          const [sel, value] = spec.set;
          const done = await cdp.evaluate(`(function(){
            var el = document.querySelector(${JSON.stringify(sel)});
            if (!el) return false;
            el.focus();
            var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            var setter = Object.getOwnPropertyDescriptor(proto, "value").set;
            setter.call(el, ${JSON.stringify(value)});
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          })()`);
          say("    · set " + sel + " = " + JSON.stringify(value) + (done ? "" : " (NOT FOUND)"));
          await sleep(spec.wait || 600);
          continue;
        }
        if (spec.text) {
          const got = await cdp.evaluate(`(function(){
            var el = document.querySelector(${JSON.stringify(spec.text)});
            return el ? __W.txt(el).slice(0, 500) : null;
          })()`);
          say("    ‹ " + spec.text + " › " + (got === null ? "(nothing there)" : got));
          if (spec.text.startsWith(".toast") || spec.text.includes("toast")) report.toast = got;
          await sleep(spec.wait || 300);
          continue;
        }
        if (spec.dump) {
          const rows = await cdp.evaluate("(function(){ __W.reset(); return __W.inventory(); })()");
          report["dump_" + spec.dump] = rows;
          say("    ▸ " + spec.dump + " (" + rows.length + ")");
          rows.forEach((c) => say("      " + c.tag.padEnd(7) + (c.attrs ? "[" + c.attrs + "] " : "").padEnd(26) + c.label));
          continue;
        }
      }
    }

    if (opts.census) {
      const views = ["home", "bookings", "wallet", "profile", "work"];
      for (const v of views) {
        const got = await step("census · " + v, async () => {
          const tapped = await cdp.evaluate(`(function(){
            var t = document.querySelector('.tab[data-view="${v}"]');
            if (!t) return { found: false };
            __W.tap(t);
            return { found: true };
          })()`);
          await sleep(900);
          const inv = await cdp.evaluate("(function(){ __W.reset(); var rows = __W.inventory(); return { view: state.view, visible: __W.shown('#view-' + state.view), controls: rows }; })()");
          report["census_" + v] = inv;
          say("    " + (inv.view === v ? "✓" : "✗ view is " + inv.view) + " · " + inv.controls.length + " controls");
          inv.controls.forEach((c) => say("      " + c.tag.padEnd(7) + (c.attrs ? "[" + c.attrs + "] " : "").padEnd(30) + c.label));
          return { why: inv.view === v ? "" : "tab did not land on " + v, tapped };
        });
      }
    }

    report.complaints = cdp.complaints();
    return report;
  } finally {
    if (!opts.keepOpen) await close();
  }
}

/* ===========================================================================
 * The journey — book → pay → counter → accept → top-up → confirm
 *
 * One booking, walked end to end the way the two of them actually go: the
 * client finds the professional, names a price, pays it into escrow; the
 * professional counters; the client agrees, tops the escrow up to the agreed
 * figure, and the booking confirms. It is the road the top-up bug broke —
 * agreed-pending used to come back as an open counter, the sheet priced the
 * debt at ₦0 — so it is kept as a leg of its own and run beside the guards.
 *
 * The screens are driven, but the truth is not taken from them: every
 * assertion reads the ledger itself back from Postgres through the app's own
 * read (pampa_bookings, the very call the Bookings tab is drawn from), so a
 * screen that merely claims the money moved cannot pass.
 *
 *   node tools/walkthrough.mjs --journey
 * ========================================================================== */
async function runJourney() {
  const app = await bootApp({ live: true });
  if (app.skipped) return { skipped: true, why: app.why };
  const { cdp, close } = app;
  const results = [];
  const complaints = [];
  let failed = 0;

  const ok = (name, pass, detail) => {
    results.push({ name, pass, detail });
    console.log("  " + (pass ? "ok  " : "FAIL") + "  " + name + (detail ? "  · " + detail : ""));
    if (!pass) failed++;
  };
  /* what the page said while the step ran — a console error a screen hides
     is still a broken flow */
  const heard = (name) => {
    const notes = cdp.complaints();
    if (notes.length) complaints.push({ name, notes });
  };

  const day = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const clientSession = await sessionFor("client");
  const proSession = await sessionFor("pro");
  /* the ledger, read the way the app reads it */
  const row = async (id) => {
    const rows = await rpc("pampa_bookings", { p_token: clientSession.token });
    return (Array.isArray(rows) ? rows : []).find(function (r) { return r.id === id; }) || null;
  };
  /* A booking just placed is not in the ledger the instant the dialog closes:
     the server call is still in the air, and a single read can beat the row
     here. So the first read polls, and the row it waits for is the one whose
     id was not on the desk before the confirm tap — which needs no knowledge
     of the row's shape beyond its id, and is what makes a re-run safe against
     the bookings earlier runs left behind on the same day. */
  const rowSoon = async (before, tries) => {
    for (let i = 0; i < (tries || 10); i++) {
      try {
        const rows = await rpc("pampa_bookings", { p_token: clientSession.token });
        const fresh = (Array.isArray(rows) ? rows : []).filter(function (r) {
          return r.date === day && !before.has(r.id);
        });
        if (fresh.length) return fresh[0];
      } catch (e) { /* unreachable for a moment — ask again */ }
      await sleep(800);
    }
    return null;
  };

  /* Name-cross probe. Registered ONCE as a document-start script, so it is
     standing before the app's own code runs on every load: it waits for
     db.updateProfile to exist, wraps it, and records every profile patch the
     device pushes — with the moment — into window.__PP. Paired with the
     database-side audit trigger this names the writer of a crossed
     display_name from both ends: the patch the device sent and the statement
     that stored it. */
  const PRE_REG = `(function () {
    if (window.__PP_ARMED) return;
    window.__PP_ARMED = true;
    window.__PP = [];
    var t = setInterval(function () {
      if (typeof db !== "undefined" && db && typeof db.updateProfile === "function" && !db.updateProfile.__probe) {
        clearInterval(t);
        var orig = db.updateProfile;
        var wrapped = function (patch) {
          try { window.__PP.push({ at: new Date().toISOString(), patch: JSON.parse(JSON.stringify(patch || {})) }); } catch (e) {}
          return orig.apply(db, arguments);
        };
        wrapped.__probe = true;
        db.updateProfile = wrapped;
      }
    }, 10);
  })()`;

  const drainPushes = async () => {
    try {
      const got = await cdp.evaluate("(function(){ return JSON.stringify(window.__PP || []); })()");
      return JSON.parse(got);
    } catch (e) { return []; }
  };

  console.log("Pampa journey · book → pay → counter → accept → top-up → confirm\n");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PRE_REG });
  try {
    /* ---- the client books -------------------------------------------- */
    const booted = await standUp(cdp, app, { who: "client" }, null);
    /* A name canary. The walk's cast exists so a re-run reuses the same two
       accounts; if the client's server-side display name ever reads like the
       pro's again — as it was found to, today — the journey stops here rather
       than walking a pair of twins and calling the screens green. */
    ok("the client boots as QA Walk", !!(booted && booted.name === "QA Walk"),
      booted ? String(booted.name) : "nobody landed");
    if (!booted || booted.name !== "QA Walk") return { failed, results, complaints };
    const clientPushes = await drainPushes();
    /* The boot pushed no profile patch. It had the last account's dashboard
       still cached — the single-browser-profile stand-in for a shared phone —
       and a patch pushed here would write that stale identity onto this
       session's account row. The gate lives in cloud2.js; this is its
       regression leg. */
    ok("the client's boot pushes nobody's identity", clientPushes.length === 0,
      clientPushes.length ? clientPushes.map(function (p) { return JSON.stringify(p.patch); }).join(" | ").slice(0, 90) : "silent");

    await cdp.evaluate(`(function () {
      var chip = __W.byText(".nearChip", "QA");
      if (!chip) return "QA Chair is not on the home list";
      __W.tap(chip);
      return true;
    })()`);
    await sleep(1400);
    await cdp.evaluate(`(function () { __W.tap(__W.byText(".bookBtn", "QA Chair")); return true; })()`);
    await sleep(1400);
    heard("booking sheet opened");

    const dateTook = await cdp.evaluate(`(function () {
      var el = document.getElementById("bookDate");
      var set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      for (var i = 0; i < 2; i++) {
        el.focus(); set.call(el, ${JSON.stringify(day)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        if (el.value === ${JSON.stringify(day)}) break;
      }
      return el.value;
    })()`);
    ok("the sheet took the date", dateTook === day, String(dateTook));
    await sleep(600);
    await cdp.evaluate(`(function () { __W.tap(__W.byText(".chip", "Lowest")); return true; })()`);
    await sleep(500);
    const slot = await cdp.evaluate(`(function () {
      var el = document.querySelector("#slotGrid .slot:not([disabled])");
      if (!el) return null;
      var t = el.textContent.trim();
      __W.tap(el);
      return t;
    })()`);
    ok("a slot answers for " + day, !!slot, slot || "no open slot in the grid");
    await sleep(500);

    await cdp.evaluate(`(function () { __W.tap(__W.byText(".nextbtn", "Confirm booking")); return true; })()`);
    await sleep(900);
    /* The snapshot the placement is measured against: every id already in the
       ledger before the confirm tap. Without it there is no telling the new
       booking from the ones earlier runs left behind on the same day. */
    let before;
    try {
      const rows = await rpc("pampa_bookings", { p_token: clientSession.token });
      before = new Set((Array.isArray(rows) ? rows : []).map(function (r) { return r.id; }));
    } catch (e) {
      ok("the ledger answers before the booking is placed", false, String((e && e.message) || e));
      return { failed, results, complaints };
    }

    await cdp.evaluate(`(function () { __W.tap(__W.byText(".confirmBtn", "Confirm booking")); return true; })()`);
    heard("booking placed");

    const placed = await rowSoon(before);
    ok("the booking is in the ledger under its server id", !!placed,
      placed ? String(placed.id).slice(0, 8) + " · " + placed.status : "nothing for " + day);
    if (!placed) return { failed, results, complaints };
    const id = placed.id;

    /* ---- the client funds it ------------------------------------------ */
    await cdp.evaluate(`(function () { __W.tap(document.querySelector('.tab[data-view="bookings"]')); return true; })()`);
    await sleep(1600);
    await cdp.evaluate(`(function () {
      __W.tap(document.querySelector('[data-pay="' + ${JSON.stringify(id)} + '"]'));
      return true;
    })()`);
    await sleep(1000);
    const payPrice = await cdp.evaluate(`document.getElementById("payPrice").textContent`);
    await cdp.evaluate(`(function () { __W.tap(document.getElementById("payNow")); return true; })()`);
    await sleep(3000);
    heard("payment into escrow");
    const funded = await row(id);
    ok("the money is in escrow (" + (payPrice || "?") + ")",
      !!(funded && funded.status === "escrowed"),
      funded ? "status " + funded.status + " · " + ((funded.pay && funded.pay.ref) || "no ref") : "no row");

    /* ---- the professional counters ------------------------------------ */
    await cdp.evaluate(`(function () {
      dbSessionSet(${JSON.stringify(proSession)});
      return true;
    })()`);
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + app.port + "/index.html" });
    await sleep(3600);
    await cdp.evaluate(HELPERS);
    const proPushes = await drainPushes();
    heard("professional boots");
    await cdp.evaluate(`(function () { __W.tap(document.querySelector('.tab[data-view="work"]')); return true; })()`);
    await sleep(1800);
    await cdp.evaluate(`(function () { __W.tap(document.getElementById("workOpenPro")); return true; })()`);
    await sleep(1500);
    const desk = await cdp.evaluate(`(function () {
      var pb = document.getElementById("proBody");
      return pb && pb.textContent.length > 0;
    })()`);
    ok("the desk opens with the request on it", !!desk);
    /* scoped to the booking, not the first button on the desk: a re-run must
       not counter somebody's earlier request */
    const nego = await cdp.evaluate(`(function () {
      var el = document.querySelector('[data-negotiate="' + ${JSON.stringify(id)} + '"]');
      if (!el || !__W.vis(el)) return false;
      __W.tap(el);
      return true;
    })()`);
    ok("Negotiate price is on the request", !!nego);
    await sleep(1100);
    await cdp.evaluate(`(function () {
      var el = document.getElementById("negoPrice");
      var set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      el.focus(); set.call(el, "3450");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await sleep(400);
    await cdp.evaluate(`(function () { __W.tap(document.getElementById("negoSend")); return true; })()`);
    await sleep(2600);
    heard("counter sent");
    const countered = await row(id);
    const openPrice = countered && countered.negotiation && countered.negotiation.status === "countered"
      ? countered.negotiation.price : null;
    ok("the counter is on the table at ₦3,450", openPrice === 3450,
      openPrice == null ? "negotiation is " + JSON.stringify((countered && countered.negotiation || {}).status) : "₦" + openPrice);

    /* ---- the client accepts: agreed, not yet paid up ------------------- */
    await cdp.evaluate(`(function () {
      dbSessionSet(${JSON.stringify(clientSession)});
      return true;
    })()`);
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + app.port + "/index.html" });
    await sleep(3600);
    await cdp.evaluate(HELPERS);
    const acceptPushes = await drainPushes();
    await cdp.evaluate(`(function () { __W.tap(document.querySelector('.tab[data-view="bookings"]')); return true; })()`);
    await sleep(1600);
    const acceptBtn = await cdp.evaluate(`(function () {
      var el = document.querySelector('[data-acceptcounter="' + ${JSON.stringify(id)} + '"]');
      return el && __W.vis(el) ? el.textContent.trim() : null;
    })()`);
    ok("the open counter is asking to be accepted", !!acceptBtn, acceptBtn || "no accept button");
    await cdp.evaluate(`(function () {
      __W.tap(document.querySelector('[data-acceptcounter="' + ${JSON.stringify(id)} + '"]'));
      return true;
    })()`);
    await sleep(2600);
    heard("counter accepted");
    const agreed = await row(id);
    const owe = agreed && agreed.negotiation && agreed.negotiation.topUp > 0
      ? agreed.negotiation.topUp : null;
    ok("the agreement waits for its top-up", owe === 1000,
      owe == null ? "no topUp recorded" : "topUp ₦" + owe);

    /* ---- the top-up sheet reads the agreed price, not the counter ------ */
    const topupBtn = await cdp.evaluate(`(function () {
      var el = document.querySelector('[data-topup="' + ${JSON.stringify(id)} + '"]');
      return el && __W.vis(el) ? el.textContent.trim() : null;
    })()`);
    ok("the card offers the top-up", !!topupBtn, topupBtn || "no top-up button on the card");
    await cdp.evaluate(`(function () {
      __W.tap(document.querySelector('[data-topup="' + ${JSON.stringify(id)} + '"]'));
      return true;
    })()`);
    await sleep(1100);
    const sheet = await cdp.evaluate(`(function () {
      var fee = document.querySelector("#paySheet .feeBox");
      var now = document.getElementById("payNow");
      return {
        price: document.getElementById("payPrice").textContent,
        now: now ? now.textContent : null,
        fee: fee ? fee.textContent : ""
      };
    })()`);
    ok('the sheet says "Pay now ₦1,000", not ₦0',
      !!(sheet && /1,000/.test(sheet.price) && /1,000/.test(sheet.now || "")),
      sheet ? sheet.price + " · " + sheet.now : "no sheet");
    ok("the sheet reads the agreed total, not the escrow balance",
      !!(sheet && /4,450/.test(sheet.fee) && /3,450/.test(sheet.fee)),
      sheet ? sheet.fee.replace(/\s+/g, " ").trim() : "no fee box");
    await cdp.evaluate(`(function () { __W.tap(document.getElementById("payNow")); return true; })()`);
    await sleep(3200);
    heard("top-up paid");

    const done = await row(id);
    const agreedAt = done && done.negotiation ? done.negotiation.agreed : null;
    ok("confirmed at the agreed price",
      !!(done && done.status === "confirmed" && agreedAt === 3450),
      done ? "status " + done.status + " · agreed ₦" + agreedAt : "no row");
    ok("the escrow now holds the whole agreed total",
      !!(done && done.pay && done.pay.amount === 4450 && done.pay.netToPro === 4000),
      done && done.pay ? "₦" + done.pay.amount + " held · ₦" + done.pay.netToPro + " to the stylist" : "no pay");

    const finalPushes = await drainPushes();
    const pushes = clientPushes.concat(proPushes, acceptPushes, finalPushes);
    if (pushes.length) {
      console.log("\nprofile patches the devices pushed:");
      pushes.forEach(function (p) {
        console.log("  " + p.at + "  " + JSON.stringify(p.patch));
      });
    }

    console.log("\njourney: book → pay → counter → accept → top-up → confirm — " +
      (failed ? failed + " failed" : "all " + results.length + " assertions clear") +
      (complaints.length ? " · " + complaints.length + " step(s) left page complaints" : " · no page complaints"));
    complaints.forEach(function (c) {
      console.log("  complaints after " + c.name + ":");
      c.notes.slice(0, 4).forEach(function (n) { console.log("    " + n); });
    });
    return { failed, complaints, results };
  } finally {
    await close();
  }
}

if (process.argv[1] && process.argv[1].endsWith("walkthrough.mjs")) {
  const args = process.argv.slice(2);
  const doArg = (args.find((a) => a.startsWith("--do=")) || "").slice(5);
  const opts = {
    census: args.includes("--census"),
    keepOpen: args.includes("--keepOpen"),
    do: doArg ? JSON.parse(doArg) : null,
    only: (args.find((a) => a.startsWith("--only=")) || "").split("=")[1] || null,
    who: (args.find((a) => a.startsWith("--who=")) || "").split("=")[1] || "client",
  };
  if (args.includes("--journey")) {
    const j = await runJourney();
    if (j.skipped) { console.log("SKIP — " + j.why); process.exit(0); }
    process.exit(j.failed ? 1 : 0);
  }
  const r = await runWalk(opts);
  if (r.skipped) { console.log("SKIP — " + r.why); process.exit(0); }
  const hard = r.steps.filter((s) => s.threw || s.notes.length);
  console.log("\n" + r.steps.length + " steps · " + hard.length + " with trouble");
  process.exit(hard.length ? 1 : 0);
}
