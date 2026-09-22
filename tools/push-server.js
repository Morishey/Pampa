#!/usr/bin/env node
/*
 * The reference push server for Pampa.
 *
 * The app's client half (js/pwa.js) subscribes every account it is
 * signed into and posts each subscription here. This file receives them,
 * keeps them per account, and delivers a JSON payload per event when asked.
 * It is small on purpose: it is the proof that the client half is real, and
 * the stub a production backend replaces.
 *
 *   node tools/push-server.js             # port 8787
 *   PORT=9000 node tools/push-server.js   # any port
 *
 * Generate the VAPID keys once and keep them:
 *   node -e "const c=require('crypto');const k=c.generateKeyPairSync('ec',{namedCurve:'prime256v1'});const raw=k.publicKey.export({format:'der',type:'spki'});const priv=k.privateKey.export({format:'der',type:'sec1'});console.log('PUSH_PUBLIC=' + raw.slice(-65).toString('base64url'));console.log('PUSH_PRIVATE=' + priv.slice(-32).toString('base64url'));console.log('PUSH_SUBJECT=mailto:you@example.com')"
 *
 * Endpoints
 *   GET  /vapid-public-key  -> { key }            (the client fetches this to subscribe)
 *   POST /subscribe         -> { ok }             body: { account, endpoint, keys:{p256dh,auth}, ua }
 *   POST /unsubscribe       -> { ok }             body: { endpoint }
 *   POST /announce          -> { sent, gone }     body: { account, title, body, tag, url }
 *   GET  /health            -> { ok, subscriptions }
 *
 * Storage is tools/push-subscriptions.json. It holds public keys and endpoint
 * URLs only — no names, no phones beyond the opaque account string the app
 * itself chooses to send, and nothing that decrypts anything.
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const push = require("./push.js");

/* A PORT that is unset, empty or zero falls back to the default — binding to
   port 0 would work but the URL it prints would be a lie. */
const RAW_PORT = Number(process.env.PORT);
const PORT = Number.isInteger(RAW_PORT) && RAW_PORT > 0 ? RAW_PORT : 8787;
const STORE = path.join(__dirname, "push-subscriptions.json");
const SUBJECT = process.env.PUSH_SUBJECT || "mailto:ops@pampa.example";
const PUBLIC_KEY = process.env.PUSH_PUBLIC || "";
const PRIVATE_KEY = process.env.PUSH_PRIVATE || "";

const vapid = {
  subject: SUBJECT,
  publicKey: PUBLIC_KEY,
  privateKey: PRIVATE_KEY,
};

function loadSubs() {
  try {
    const raw = fs.readFileSync(STORE, "utf8");
    const d = JSON.parse(raw);
    if (d && typeof d.accounts === "object") return d;
  } catch (e) { /* first run */ }
  return { accounts: {} };
}
function saveSubs(db) {
  fs.writeFileSync(STORE, JSON.stringify(db, null, 2));
}

function body(req) {
  return new Promise(function (resolve, reject) {
    let text = "";
    req.on("data", function (c) {
      text += c;
      if (text.length > 64 * 1024) req.destroy();
    });
    req.on("end", function () {
      try { resolve(text ? JSON.parse(text) : {}); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function send(res, code, obj) {
  const text = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

/* Deliver one payload to every live subscription an account holds. Dead ones
   (the push service answered 410/404) are removed on the spot — that is the
   whole lifecycle a real backend needs. */
async function announce(db, account, payload) {
  const subs = (db.accounts[account] || []);
  const keep = [];
  let sent = 0;
  let gone = 0;
  for (const sub of subs) {
    try {
      await push.push(sub, payload, vapid);
      sent += 1;
      keep.push(sub);
    } catch (e) {
      if (e && e.gone) { gone += 1; continue; }
      /* transient: keep the subscription, count it as not delivered */
      keep.push(sub);
    }
  }
  if (gone) {
    db.accounts[account] = keep;
    saveSubs(db);
  }
  return { sent: sent, gone: gone };
}

const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      const db = loadSubs();
      const n = Object.values(db.accounts).reduce(function (a, l) { return a + l.length; }, 0);
      return send(res, 200, { ok: true, subscriptions: n, vapidConfigured: !!(PUBLIC_KEY && PRIVATE_KEY) });
    }
    if (req.method === "GET" && url.pathname === "/vapid-public-key") {
      if (!PUBLIC_KEY) return send(res, 503, { error: "VAPID keys not configured — see the header comment" });
      return send(res, 200, { key: PUBLIC_KEY });
    }
    if (req.method === "POST" && url.pathname === "/subscribe") {
      if (!PUBLIC_KEY || !PRIVATE_KEY) return send(res, 503, { error: "VAPID keys not configured" });
      const b = await body(req);
      if (!b.account || !b.endpoint || !b.keys || !b.keys.p256dh || !b.keys.auth) {
        return send(res, 400, { error: "account, endpoint and keys are required" });
      }
      const db = loadSubs();
      const list = db.accounts[b.account] || (db.accounts[b.account] = []);
      const i = list.findIndex(function (s) { return s.endpoint === b.endpoint; });
      const rec = { endpoint: b.endpoint, keys: b.keys, ua: String(b.ua || "").slice(0, 200), at: new Date().toISOString() };
      if (i === -1) list.push(rec); else list[i] = rec;
      saveSubs(db);
      return send(res, 200, { ok: true, count: list.length });
    }
    if (req.method === "POST" && url.pathname === "/unsubscribe") {
      const b = await body(req);
      const db = loadSubs();
      let removed = 0;
      Object.keys(db.accounts).forEach(function (acc) {
        const before = db.accounts[acc].length;
        db.accounts[acc] = db.accounts[acc].filter(function (s) { return s.endpoint !== b.endpoint; });
        removed += before - db.accounts[acc].length;
        if (!db.accounts[acc].length) delete db.accounts[acc];
      });
      if (removed) saveSubs(db);
      return send(res, 200, { ok: true, removed: removed });
    }
    if (req.method === "POST" && url.pathname === "/announce") {
      if (!PUBLIC_KEY || !PRIVATE_KEY) return send(res, 503, { error: "VAPID keys not configured" });
      const b = await body(req);
      if (!b.account || !b.title) return send(res, 400, { error: "account and title are required" });
      const db = loadSubs();
      const payload = {
        title: String(b.title).slice(0, 120),
        body: String(b.body || "").slice(0, 240),
        tag: String(b.tag || "pampa").slice(0, 60),
        url: String(b.url || "/").slice(0, 300),
      };
      const r = await announce(db, b.account, payload);
      return send(res, 200, { ok: true, sent: r.sent, gone: r.gone });
    }
    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
});

if (!PUBLIC_KEY || !PRIVATE_KEY) {
  console.log("Pampa push server — VAPID keys are not set yet.");
  console.log("Generate a pair (command in the file header), then:");
  console.log("  PUSH_PUBLIC=... PUSH_PRIVATE=... PUSH_SUBJECT=mailto:you@example.com node tools/push-server.js");
  console.log("Serving anyway — subscribe/announce will answer 503 until configured.\n");
}
server.listen(PORT, "127.0.0.1", function () {
  console.log("Pampa push reference server on http://127.0.0.1:" + PORT);
});
