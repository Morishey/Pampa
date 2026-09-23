/* =============================================================================
 * Pampa — the render audit
 *
 * The cascade guard's self-test proves the engine judges right; this file
 * proves the shipped app renders right. It boots a real headless Chromium
 * over the DevTools protocol, loads the app from a throwaway local server,
 * walks every surface a person can reach — client and professional, views,
 * sheets, the clip feed, the story viewer — and on each one asks the cascade
 * the browser actually resolved: for every floating component on screen, does
 * a rule that never names it take a geometry declaration away from the rule
 * that does?
 *
 * This is the check the nav-badge bug earned. That bug was invisible to every
 * static look at the source, because "does this selector ever apply here" is
 * a question about rendered containment — which only a browser answers. So
 * the audit renders, and judges from the DOM outwards: selector matching is
 * el.matches(), specificity and order are the browser's own, media conditions
 * hold only where they really hold, and a rule for another surface never
 * meets a component it can never sit above.
 *
 * No dependencies: this repo deliberately has no node_modules, and modern
 * Node ships a WebSocket. The browser is whatever Chrome or Edge is installed
 * — launched headless with its own temporary profile, pointed at a server on
 * 127.0.0.1 that dies with the run. Nothing is signed in anywhere: every
 * account, directory, booking and session the surfaces need is staged into
 * localStorage before the app's own scripts run, and every call the app would
 * make to the cloud is refused at the fetch level, so the run is hermetic —
 * the same audit on any machine, and the live database never hears of it.
 *
 *   node tools/render-audit.mjs             # audit every surface
 *   node tools/render-audit.mjs --list      # the surfaces, and exit
 *   node tools/render-audit.mjs --no-plant  # skip the planted-trap proof
 *   node tools/render-audit.mjs --keep-open # leave Chrome up for poking
 *   node tools/render-audit.mjs --shots=dir  # also write a PNG per pass
 *
 * It runs as a leg of tools/verify-db.mjs (SKIP'd where no browser exists)
 * and can be driven standalone.
 * ========================================================================== */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const guard = await import("./cascade-guard.mjs");
const LIVE_CHECK = guard.LIVE_CHECK;

/* The widths people actually hold — a small Android, a large Android, and a
   tablet/desktop window. A media rule that only applies at 360px is only
   judged there, and a component whose own rule loses only in the desktop
   layout is a finding the phone pass could never see. */
const WIDTHS = [[360, 780], [412, 915], [800, 900]];

/* ---------- The surfaces --------------------------------------------------
   Each is what a person does to stand here. Who is signed in and what their
   device holds is decided by the staging below, so every one of these is
   reachable exactly as a fresh-but-used device reaches it. Signed-out
   surfaces name the auth page they stand on. */
const SURFACES = [
  { name: "welcome screen", signedOut: true, auth: "welcomePage", open: "void 0" },
  { name: "location screen", signedOut: true, auth: "location", open: "openLocation('signup')" },
  { name: "client · home", open: 'switchView("home")' },
  { name: "client · bookings", open: 'switchView("bookings")' },
  { name: "client · profile", open: 'switchView("profile")' },
  { name: "client · booking sheet", open: 'openSheet("cut")' },
  { name: "client · pay (escrow) sheet", open: 'openPaySheet("bRend1")' },
  { name: "client · dispute sheet", open: 'openDisputeSheet("bRend1")' },
  { name: "client · rate sheet", open: 'openRateSheet("bRend1")' },
  { name: "client · notifications", open: "openNotifySheet()" },
  { name: "client · provider profile", open: 'openProviderProfile("tunde")' },
  { name: "clip feed", open: "openClipFeed({})" },
  { name: "story viewer", open: 'openStory("tunde")' },
  { name: "pro · home", pro: true, open: 'enterProView("home")' },
  { name: "pro · work", pro: true, open: 'enterProView("work")' },
  { name: "pro · bookings", pro: true, open: 'enterProView("bookings")' },
  { name: "pro · profile", pro: true, open: 'enterProView("profile")' },
  { name: "pro · status upload", pro: true, open: "openStatusSheet()" },
  { name: "pro · folio sheet", pro: true, open: "openFolioSheet()" },
  { name: "pro · bio sheet", pro: true, open: "openBioSheet()" },
  { name: "pro · contact sheet", pro: true, open: "openContactSheet()" },
  { name: "pro · photo sheet", pro: true, open: "openDpSheet()" },
];

/* ---------- The staging ---------------------------------------------------
   Written into the page before the app's own scripts run. Everything the
   surfaces need lives on the device; the cloud is a refused fetch so the app
   takes its own offline roads, and the geolocation/service-worker APIs are
   stubbed so a headless run is quiet. */
function stageSource() {
  const client = {
    name: "Renda Client", phone: "08000000222", role: "client",
    area: "surulere", address: "9 Renda Street, Surulere",
    coords: { lat: 6.5, lng: 3.35 }, coordsAccuracy: 12,
  };
  const pro = {
    name: "Renda Pro", phone: "08000000111", role: "pro", trade: "barb",
    area: "surulere", address: "12 Renda Close, Surulere",
    coords: { lat: 6.5, lng: 3.35 }, coordsAccuracy: 12,
  };
  const provider = {
    id: "p:08000000111", owner: "08000000111", name: "Renda Pro",
    skill: "Barbing", rating: 4.6, jobs: 41, cats: ["barb"], studio: "surulere",
    coords: { lat: 6.5, lng: 3.35 }, coordsAccuracy: 12, covers: null,
    bio: "Fades, line-ups, beard sculpting.",
    works: [
      { id: "rw1", kind: "photo", src: "photo-1503951914875-452162b0f3f1", note: "Skin fade" },
      { id: "rw2", kind: "photo", src: "photo-1622286342621-4bd786c2447c", note: "Classic cut" },
    ],
    dp: null, email: "pro@renda.test", social: { ig: "renda.pro" },
    address: "12 Renda Close, Surulere", available: true,
    ranges: { cut: { min: 3000, max: 5000 }, beard: { min: 1500, max: 2500 } },
    status: [{ id: "rs1", kind: "photo", src: "photo-1622286342621-4bd786c2447c",
      note: "Shop open", at: new Date(Date.now() - 36e5).toISOString(), views: 3 }],
  };
  /* One booking in the state that opens the escrow sheets, the rate sheet and
     the work card: paid, confirmed, measured. The local shape is what the
     escrow module itself writes. */
  /* The ledger the surfaces stand on. The first booking is the client's, in
     the state that opens the escrow sheets, the rate sheet and the work card.
     The rest are here because a card is only audited where it renders: a
     professional's Bookings tab is empty without a job keyed to their own
     provider id, and a card with no steps, no trail and no counter is a card
     whose controls are never in the DOM to be judged. */
  const now = new Date().toISOString();
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const mkBooking = (id, over) => Object.assign({
    id,
    serviceId: "cut", stylistId: "tunde", stylistName: "Tunde",
    clientName: "Renda Client", clientPhone: "08000000222",
    date: day(1), time: "10:00",
    loc: "home", areaId: "surulere", areaName: "Surulere",
    address: "9 Renda Street, Surulere", studioAddress: "", studioAreaName: "",
    km: 1.2, kmPrecise: true, travelFee: 1200,
    price: 3500, total: 4700,
    offer: { price: 3500, at: now, by: "Renda Client" },
    priceRange: { min: 3000, max: 5000 },
    status: "confirmed", proMarkedDone: false,
    createdAt: now,
    pay: { method: "card", ref: "ESC-" + id, amount: 4700, fee: 470, netToPro: 4230, paidAt: now },
    history: [{ at: now, label: "Booking placed" }],
  }, over);
  const MINE = "p:08000000111";
  const booking = mkBooking("bRend1", {
    negotiation: { status: "open", rounds: [{ by: "client", price: 3500, note: "", at: now }] },
  });
  /* A professional's own two sides: what is waiting on them, what the client
     has released, and a job under dispute — the three cards the desk reads. */
  const bookings = [
    booking,
    mkBooking("bRendWait", {
      time: "13:00", status: "escrowed",
      negotiation: { status: "open", rounds: [
        { by: "client", price: 3500, note: "", at: now },
        { by: "pro", price: 4200, note: "Long hair, twenty minutes more.", at: now },
      ] },
    }),
    mkBooking("bRendPro1", {
      stylistId: MINE, time: "09:00", status: "escrowed",
      history: [{ at: now, label: "Booking placed" }, { at: now, label: "Payment held in escrow" }],
    }),
    mkBooking("bRendPro2", {
      stylistId: MINE, time: "15:00", km: 3.4, proMarkedDone: true,
      history: [{ at: now, label: "Booking placed" }, { at: now, label: "Payment held in escrow" },
        { at: now, label: "Marvis accepted the job" }],
    }),
    mkBooking("bRendPro3", {
      stylistId: MINE, time: "17:00", loc: "studio", status: "released",
      studioAddress: "14 Shop Row, Surulere", studioAreaName: "Surulere", travelFee: 0,
      rated: { stars: 5, comment: "Sharp fade, kept time." },
      history: [{ at: now, label: "Booking placed" }, { at: now, label: "Payment held in escrow" },
        { at: now, label: "Marvis marked the job done" }, { at: now, label: "Marvis released ₦4,230" }],
    }),
    mkBooking("bRendPro4", {
      stylistId: MINE, time: "12:00", status: "disputed",
      dispute: { reason: "The job wasn't finished", note: "Left a patch at the back.", at: now, photos: [] },
      history: [{ at: now, label: "Booking placed" }, { at: now, label: "Payment held in escrow" },
        { at: now, label: "Marvis reported a problem" }],
    }),
  ];
  return `
    (function () {
      var P = ${JSON.stringify({ client, pro, provider, bookings })};
      var put = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
      put("pampa.accounts.v1", { accounts: {} });
      put("pampa.directory.v1", { providers: [P.provider] });
      put("pampa.bookings.v1", { bookings: P.bookings });
      window.__STAGE = P;
      /* The cloud is refused, not absent: the app's offline roads are the ones
         a device on a bad network takes, and refusing keeps this run hermetic
         — the live project never hears of it and no network stall can hang. */
      var realFetch = window.fetch ? window.fetch.bind(window) : null;
      window.fetch = function (input, init) {
        var url = typeof input === "string" ? input : (input && input.url) || "";
        if (url.indexOf("supabase") !== -1) {
          return Promise.reject(new TypeError("render-audit: cloud refused"));
        }
        return realFetch ? realFetch(input, init) : Promise.reject(new TypeError("no fetch"));
      };
      try { Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true }); } catch (e) {}
      try { Object.defineProperty(navigator, "serviceWorker", { value: undefined, configurable: true }); } catch (e) {}
      try {
        Object.defineProperty(Notification, "permission", { value: "denied", configurable: true });
        Object.defineProperty(Notification, "requestPermission", { value: function () { return Promise.resolve("denied"); }, configurable: true });
      } catch (e) {}
    })();`;
}

/* Helpers that run in the page alongside the app's own globals. */
const PAGE_HELPERS = `
  window.enterProView = function (name) {
    if (!state.user || state.user.role !== "pro") throw new Error("staging: not a pro");
    state.view = name;
    switchView(name);
  };
`;

/* Per-surface pre-steps, as page expressions. */
const STAGE_SIGNED_OUT = `
  (function () {
    localStorage.removeItem("pampa.data.v1");
    try { if (typeof tearDownSession === "function") tearDownSession(); } catch (e) {}
    document.getElementById("app").style.display = "none";
    AUTH_PAGES.forEach(function (p) {
      var el = document.getElementById(p);
      if (el) el.style.display = "none";
    });
  })()`;
const stageAs = (userJson) => `
  (function () {
    state.user = JSON.parse('${userJson}');
    save();
    var app = document.getElementById("app");
    if (app.style.display === "none") enterApp();
    else renderNavAvatar();
  })()`;
const CLIENT_JSON = JSON.stringify({
  name: "Renda Client", phone: "08000000222", role: "client",
  area: "surulere", address: "9 Renda Street, Surulere",
  coords: { lat: 6.5, lng: 3.35 }, coordsAccuracy: 12,
}).replace(/'/g, "&#39;");
const PRO_JSON = JSON.stringify({
  name: "Renda Pro", phone: "08000000111", role: "pro", trade: "barb",
  area: "surulere", address: "12 Renda Close, Surulere",
  coords: { lat: 6.5, lng: 3.35 }, coordsAccuracy: 12,
}).replace(/'/g, "&#39;");

/* The generic sweep between surfaces: every overlay closed, so the next one
   starts from the same place a person would. */
const SWEEP = `
  (function () {
    var fns = ["closeSheet", "closeClipFeed", "closeStory", "exitProviderProfile", "closeComments"];
    for (var i = 0; i < fns.length; i++) {
      try { if (typeof window[fns[i]] === "function") window[fns[i]](); } catch (e) {}
    }
  })()`;

/* ---------- The local server ---------------------------------------------- */
function startServer() {
  const MIME = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json", ".webmanifest": "application/manifest+json",
    ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
    ".ico": "image/x-icon", ".webp": "image/webp", ".woff2": "font/woff2",
  };
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      const path = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0]);
      const rel = path === "/" ? "index.html" : path.replace(/^\/+/, "");
      const full = join(root, rel);
      if (!existsSync(full)) { res.writeHead(404); res.end("no"); return; }
      try {
        res.writeHead(200, { "Content-Type": MIME[extname(full)] || "application/octet-stream" });
        res.end(readFileSync(full));
      } catch (e) { res.writeHead(404); res.end("no"); }
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

/* ---------- Chromium over CDP --------------------------------------------- */
export function findBrowser() {
  const candidates = [
    process.env.PAMPA_BROWSER,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || "cdp error"));
        else resolve(msg.result);
      }
    });
  }
  static connect(wsUrl, timeoutMs = 15000) {
    const cdp = new Cdp(wsUrl);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("cdp: websocket timed out")), timeoutMs);
      cdp.ws.addEventListener("open", () => { clearTimeout(t); resolve(cdp); }, { once: true });
      cdp.ws.addEventListener("error", () => { clearTimeout(t); reject(new Error("cdp: websocket refused")); }, { once: true });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error("cdp: " + method + " timed out")); }
      }, 30000);
    });
  }
  async evaluate(expr) {
    const r = await this.send("Runtime.evaluate", {
      expression: expr, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      const text = (d.exception && (d.exception.description || d.exception.value)) || d.text || "page error";
      throw new Error(String(text).split("\n").slice(0, 3).join(" | "));
    }
    return r.result && r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function launchBrowser(exe, profileDir) {
  const args = [
    "--headless=new", "--remote-debugging-port=0",
    "--user-data-dir=" + profileDir, "--no-first-run", "--no-default-browser-check",
    "--disable-features=Translate", "--window-size=390,844", "about:blank",
  ];
  const proc = spawn(exe, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", (d) => { stderr += d; });
  /* the chosen port is printed to stderr as "DevTools listening on ws://…" */
  const wsBase = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("browser did not open a debug port; stderr tail: " + stderr.slice(-300))), 20000);
    const timer = setInterval(() => {
      const at = stderr.indexOf("DevTools listening on ");
      if (at >= 0) {
        clearInterval(timer); clearTimeout(t);
        resolve(stderr.slice(at + "DevTools listening on ".length).trim().split(/\s+/)[0]);
      }
    }, 100);
  });
  return { proc, wsBase };
}

async function pageTarget(wsBase) {
  /* the discovery endpoint lives at the origin: the browser url carries a
     /devtools/browser/<id> path that is websocket-only */
  const origin = "http://" + wsBase.replace("ws://", "").split("/")[0];
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    try {
      const res = await fetch(origin + "/json/list");
      const list = await res.json();
      const page = list.find((tg) => tg.type === "page");
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
    await sleep(150);
  }
  throw new Error("no page target appeared");
}

/* ---------- The run ------------------------------------------------------- */
export async function runRenderAudit(opts = {}) {
  const exe = findBrowser();
  if (!exe) return { skipped: true, why: "no Chrome or Edge found — set PAMPA_BROWSER to a chromium binary" };

  if (opts.list) return { listOnly: true, surfaces: SURFACES.map((s) => s.name) };

  /* --only=<substring> is for working on one surface: the whole walk is only
     minutes, but iterating on a single sheet should not cost them. */
  const picks = opts.only ? SURFACES.filter((s) => s.name.indexOf(opts.only) !== -1) : SURFACES;
  if (opts.only && !picks.length) return { skipped: false, surfaces: [], findings: [], planted: -1, noMatch: opts.only };

  const srv = await startServer();
  const port = srv.address().port;
  const profile = mkdtempSync(join(tmpdir(), "pampa-render-"));
  const { proc, wsBase } = await launchBrowser(exe, profile);
  let cdp;
  const surfaceResults = [];
  const findings = [];
  let planted = -1;
  let plantError = null;
  try {
    cdp = await Cdp.connect(await pageTarget(wsBase));
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: stageSource() + "\n" + PAGE_HELPERS });
    await cdp.send("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html" });

    /* the app is live when its own navigation works; then the intro is given
       its 1.8 s to finish so the welcome screen is standing when audited */
    await cdp.evaluate(`(function () {
      var t0 = Date.now();
      return new Promise(function (resolve) {
        (function poll() {
          var ok = false;
          try { ok = typeof switchView === "function" && !!document.querySelector(".view"); } catch (e) {}
          if (ok || Date.now() - t0 > 15000) return resolve(ok);
          setTimeout(poll, 120);
        })();
      });
    })()`);
    await sleep(2600);

    for (const surf of picks) {
      const row = { name: surf.name, ok: true, findings: 0, note: "" };
      const started = Date.now();
      if (opts.progress) console.error("· " + surf.name);
      try {
        /* who is standing here */
        if (surf.signedOut) {
          await cdp.evaluate(STAGE_SIGNED_OUT);
          await cdp.evaluate(`(function () {
            var el = document.getElementById(${JSON.stringify(surf.auth)});
            if (el) { el.style.display = "block"; el.style.opacity = "1"; }
          })()`);
        } else if (surf.pro) {
          await cdp.evaluate(stageAs(PRO_JSON));
        } else {
          await cdp.evaluate(stageAs(CLIENT_JSON));
        }

        await cdp.evaluate(`(function(){ window.__openErr = null; try { ${surf.open} } catch (e) { window.__openErr = String((e && e.message) || e); } })()`);
        const openErr = await cdp.evaluate("window.__openErr");
        if (openErr) row.note = "opener: " + openErr;
        await sleep(650);

        /* the proof that the check still bites: plant a bigger weapon than
           the original bug — a broad rule with !important — over the nav
           badge on the client home, expect it reported, then take it back */
        if (opts.plant !== false && surf.name === "client · home" && !openErr) {
          try {
            await cdp.evaluate(`(function () {
              var s = document.createElement("style");
              s.id = "__plantedTrap";
              s.textContent = ".tab > span { position: absolute !important; top: 61px; }";
              document.head.appendChild(s);
            })()`);
            const pr = await cdp.evaluate(LIVE_CHECK);
            planted = ((pr && pr.findings) || []).length;
          } finally {
            await cdp.evaluate(`(function(){ var s = document.getElementById("__plantedTrap"); if (s) s.remove(); })()`).catch(() => {});
          }
          if (!planted) plantError = "planted trap was NOT reported — the check has stopped catching the bug it exists for";
        }

        const judge = async (label) => {
          const raw = await cdp.evaluate(LIVE_CHECK);
          const found = (raw && raw.findings) || [];
          for (const f of found) findings.push(Object.assign({ surface: label }, f));
          return { count: found.length, surface: raw && raw.surfaces };
        };

        /* --shots=<dir> is for the work that is judged with the eye rather
           than the cascade: one PNG per surface per width, named the same way
           the run names them, so a layout change can be looked at before it
           is argued about. */
        const shoot = async (label) => {
          if (!opts.shots) return;
          try {
            const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
            mkdirSync(opts.shots, { recursive: true });
            writeFileSync(join(opts.shots, label.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") + ".png"),
              Buffer.from(shot.data, "base64"));
          } catch (e) { /* a missed picture never fails the audit */ }
        };

        const base = await judge(surf.name);
        row.findings = base.count;
        row.surface = base.surface;
        await shoot(surf.name + " @ window");

        /* the same surface at every width, judged where those rules apply */
        for (const [w, h] of WIDTHS) {
          const wrow = { name: surf.name + " @ " + w, ok: true, findings: 0, note: "" };
          try {
            await cdp.send("Emulation.setDeviceMetricsOverride", {
              width: w, height: h, deviceScaleFactor: 1, mobile: w < 600,
            });
            await sleep(320);
            const got = await judge(wrow.name);
            wrow.findings = got.count;
            wrow.surface = got.surface;
            await shoot(wrow.name);
          } catch (e) {
            wrow.ok = false;
            wrow.note = String((e && e.message) || e).slice(0, 200);
          }
          surfaceResults.push(wrow);
        }
        await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
      } catch (e) {
        row.ok = false;
        row.note = String((e && e.message) || e).slice(0, 240);
      }
      await cdp.evaluate(SWEEP).catch(() => {});
      if (opts.progress) console.error("  " + surf.name + " — " + (Date.now() - started) + "ms");
      surfaceResults.push(row);
    }
  } finally {
    if (cdp && !opts.keepOpen) cdp.close();
    if (!opts.keepOpen) {
      try { proc.kill(); } catch (e) {}
      await sleep(250);
      try { spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" }); } catch (e) {}
      try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
      try { srv.close(); } catch (e) {}
    }
  }

  /* a silent self-proof is worse than none: if the planted trap ever stops
     being caught, the audit fails even when the surfaces look clean */
  if (plantError) {
    findings.push({ surface: "(self-proof)", element: "planted trap", prop: "position/top",
      own: ".tab > span.tabDot — the shipped rule", beatenBy: plantError, computed: "n/a" });
  }

  return {
    skipped: false,
    browser: exe,
    surfaces: surfaceResults,
    findings,
    planted,
    plantError,
    profile: opts.keepOpen ? profile : null,
    port: opts.keepOpen ? port : null,
  };
}

/* ---------- Command line -------------------------------------------------- */
function main() {
  const args = process.argv.slice(2);
  const opts = {
    plant: !args.includes("--no-plant"),
    keepOpen: args.includes("--keep-open"),
    list: args.includes("--list"),
    progress: args.includes("--progress"),
    only: (args.find((a) => a.startsWith("--only=")) || "").slice(7) || null,
    shots: (() => {
      const a = args.find((x) => x.startsWith("--shots"));
      return a ? (a.split("=")[1] || join(root, "supabase/.temp/shots")) : null;
    })(),
  };
  runRenderAudit(opts).then((r) => {
    if (r.listOnly) { console.log(r.surfaces.map((s) => "  · " + s).join("\n")); return; }
    if (r.skipped) { console.log("SKIP  render audit — " + r.why); process.exit(0); }
    const name = r.browser.split(/[\\/]/).pop();
    console.log("\nPampa render audit · " + name + " · " + r.surfaces.length + " surfaces" +
      (r.planted >= 0 ? " · planted trap caught (" + r.planted + " finding" + (r.planted === 1 ? "" : "s") + ")" : "") + "\n");
    for (const s of r.surfaces) {
      const flag = !s.ok ? "ERR " : s.findings ? "FAIL" : "pass";
      console.log(flag + "  " + s.name + (s.findings ? " — " + s.findings + " out-ranked" : "") +
        (s.note ? "   (" + s.note + ")" : ""));
    }
    if (r.findings.length) {
      console.log("");
      for (const f of r.findings) {
        console.log("FAIL  [" + f.surface + "] " + f.element + " { " + f.prop + " }");
        console.log("      own:       " + f.own);
        console.log("      beaten by: " + f.beatenBy);
        console.log("      computed:  " + f.prop + " = " + f.computed);
      }
    }
    if (opts.shots) console.log("\nshots written to " + opts.shots);
    if (opts.keepOpen) console.log("\nkept open: devtools " + r.port + " · profile " + r.profile);
    console.log("");
    process.exit(r.findings.length ? 1 : 0);
  }).catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
}

if (process.argv[1] && process.argv[1].endsWith("render-audit.mjs")) main();
