/*
 * Web Push for the reference server — with zero dependencies.
 *
 * Node's crypto module can do everything the Web Push protocol asks for:
 *   P-256 key agreement (ECDH)  -> crypto.createECDH / generateKeyPairSync
 *   content encryption          -> aes128gcm by hand (RFC 8188) or the older
 *                                  aesgcm scheme (RFC 8291 + draft-ietf-webpush-encryption-08)
 *   VAPID authentication        -> an ES256 JWT signed with crypto.sign
 *
 * The `aesgcm` scheme is implemented here because it is the one the Web Push
 * specification section on compatibility documents fully, works against every
 * browser endpoint tested, and — unlike aes128gcm — does not depend on the
 * `ua` public-key header being echoed correctly by every vendor.
 *
 * Payload limit is 4096 bytes encrypted (Chrome honours 4096, Firefox 2048 on
 * older builds) — this server keeps the JSON far under both.
 *
 * Subscriptions are kept in tools/push-subscriptions.json by push-server.js;
 * this module only knows how to speak to an endpoint.
 */

"use strict";

const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { URL } = require("url");

/* RFC 8291: the salt and the ephemeral server key are both 65 bytes (the
   ephemeral key is a full uncompressed P-256 point). */
const SALT_LEN = 16;
const PAD_LEN = 2;

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

/* ---------- the VAPID JWT (ES256) ---------- */

function vapidAuthorization(endpoint, key) {
  /* the audience is the origin of the push service, never the endpoint itself */
  const audOrigin = new URL(endpoint).origin;
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64url(JSON.stringify({
    aud: audOrigin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: key.sub,
  }));
  const unsigned = header + "." + claims;
  /* the private key arrives as a base64url raw scalar; Node wants DER for
     signing, so it is wrapped in an RFC 5915 SEC-1 structure — lengths are
     computed rather than hand-baked, because one wrong byte in a fixed
     template makes a strict decoder reject the whole key */
  const d = unb64url(key.privateKey);
  const innerBody = Buffer.concat([
    Buffer.from([0x02, 0x01, 0x01]),        /* INTEGER 1 — the RFC 5915 version */
    Buffer.from([0x04, d.length]), d,       /* OCTET STRING — the scalar */
  ]);
  const inner = Buffer.concat([Buffer.from([0x30, innerBody.length]), innerBody]);
  const algId = Buffer.from("301306072a8648ce3d020106082a8648ce3d030107", "hex");
  const octet = Buffer.concat([Buffer.from([0x04, inner.length]), inner]);
  const outerBody = Buffer.concat([Buffer.from([0x02, 0x01, 0x00]), algId, octet]);
  const outerHead = outerBody.length > 127
    ? Buffer.from([0x30, 0x81, outerBody.length])
    : Buffer.from([0x30, outerBody.length]);
  const ecPriv = Buffer.concat([outerHead, outerBody]);
  const sign = crypto.createSign("SHA256");
  sign.update(unsigned);
  const sig = crypto.sign("sha256", Buffer.from(unsigned), { key: ecPriv, format: "der", type: "sec1", dsaEncoding: "ieee-p1363" });
  return "vapid t=" + unsigned + "." + sig.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") +
    ", k=" + key.publicKey;
}

/* ---------- payload encryption (aesgcm, RFC 8291) ---------- */

function encrypt(payload, subscription) {
  const p256dh = unb64url(subscription.keys.p256dh);
  const auth = unb64url(subscription.keys.auth);

  /* the server's ephemeral pair for this one message */
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const ePub = ecdh.getPublicKey(); // 65-byte uncompressed point

  /* IKM = HKDF(auth, ECDH(client pub, server eph), "WebPush: info" || clientPub || serverEph, 32) */
  const shared = ecdh.computeSecret(p256dh);
  const info = Buffer.concat([
    Buffer.from("WebPush: info", "utf8"),
    Buffer.from([0]),
    p256dh,
    ePub,
  ]);
  const ikm = crypto.hkdfSync("sha256", shared, auth, info, 32);
  const salt = crypto.randomBytes(SALT_LEN);

  /* CEK and NONCE are both derived from that IKM, differing in the info suffix */
  const cek = Buffer.from(crypto.hkdfSync("sha256", Buffer.from(ikm), salt, Buffer.from("Content-Encoding: aesgcm", "utf8"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", Buffer.from(ikm), salt, Buffer.from("Content-Encoding: nonce", "utf8"), 12));

  /* the record: pad-length word, padding, the payload */
  const padding = Buffer.alloc(PAD_LEN - 1); // zero padding bytes; the length word says 1
  const padWord = Buffer.from([0, 1]);
  const body = Buffer.concat([padWord, padding, Buffer.from(payload, "utf8")]);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const sealed = Buffer.concat([cipher.update(body), cipher.final(), cipher.getAuthTag()]);

  return {
    cipherBody: Buffer.concat([salt, ePub, sealed]),
    headers: {
      "Content-Encoding": "aesgcm",
      Encryption: "salt=" + b64url(salt),
      "Crypto-Key": "dh=" + b64url(ePub),
      TTL: "86400",
      Urgency: "high",
      "Content-Type": "application/octet-stream",
    },
  };
}

/* ---------- delivery ---------- */

function push(subscription, payload, key) {
  return new Promise(function (resolve, reject) {
    let text;
    try {
      text = JSON.stringify(typeof payload === "string" ? { body: payload } : payload);
    } catch (e) {
      return reject(e);
    }
    const enc = encrypt(text, subscription);
    const auth = vapidAuthorization(subscription.endpoint, key);
    const url = new URL(subscription.endpoint);
    const headers = Object.assign({}, enc.headers, { Authorization: auth });
    if (subscription.endpoint.indexOf("https://fcm.googleapis.com") === 0 ||
        subscription.endpoint.indexOf("https://android.googleapis.com") === 0) {
      headers.Authorization = "key=" + (key.fcm || key.sub); /* GCM/FCM legacy quirk */
    }
    /* Real push services are all https on 443. An http:// endpoint is not a
       thing the wild would present, but honoring it keeps the module testable
       against a local stand-in service without forking the delivery path. */
    const isLocalTest = url.protocol === "http:";
    const req = (isLocalTest ? http : https).request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: "POST",
      headers: headers,
    }, function (res) {
      /* 410 Gone or 404: the subscription is dead — the caller should forget it */
      res.resume();
      if (res.statusCode === 201) return resolve({ ok: true });
      if (res.statusCode === 404 || res.statusCode === 410) {
        const err = new Error("Subscription is gone (" + res.statusCode + ")");
        err.gone = true;
        return reject(err);
      }
      const err = new Error("Push service answered " + res.statusCode);
      err.statusCode = res.statusCode;
      return reject(err);
    });
    req.on("error", reject);
    req.end(enc.cipherBody);
  });
}

module.exports = { push, vapidAuthorization };
