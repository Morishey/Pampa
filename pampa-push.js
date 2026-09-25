/*
 * Pampa — the push half of notifications.
 *
 * The in-app bell and the page-raised notifications keep working exactly as
 * before; this module adds the piece only a server can do: the phone chimes
 * while Pampa is closed entirely. The shape is deliberately old-school so it
 * runs in any browser the rest of the app runs in.
 *
 * The chain, end to end:
 *
 *   permission granted  ── the user's explicit yes, never assumed
 *   service worker      ── must be registered and active
 *   server key          ── GET {SERVER}/vapid-public-key
 *   subscribe           ── pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })
 *   register            ── POST {SERVER}/subscribe  with the account string
 *   → the server can now reach this device even when the app is closed
 *
 * PAMPA_SERVER is the only configuration. For local testing with the
 * reference server in tools/push-server.js it is the loopback origin; the
 * deployment sets its own.
 */
(function (global) {
  "use strict";

  /* http://127.0.0.1 is a secure context, so the reference server works as-is.
     Change this one constant for production. */
  var SERVER = "http://127.0.0.1:8787";

  function urlB64ToUint8Array(b64) {
    var norm = b64.replace(/-/g, "+").replace(/_/g, "/");
    while (norm.length % 4) norm += "=";
    var raw = atob(norm);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  function supported() {
    /* `"serviceWorker" in navigator` is not the question this needs to ask. A
       browser can own the property and hold nothing in it — an embedded
       WebView, or the stub a headless run installs — and then `reg()` reads
       getRegistration off undefined and throws. Every caller here does catch,
       but sign-out called this outside its own guard, and one throw in the
       middle of a teardown left the dashboard standing and the session
       unrevoked. Ask for a service worker that can actually be questioned. */
    var sw = navigator.serviceWorker;
    return !!(global.window &&
      sw && typeof sw.getRegistration === "function" &&
      "PushManager" in window &&
      "Notification" in window &&
      window.fetch);
  }

  function reg() {
    return navigator.serviceWorker.getRegistration().then(function (r) {
      return r || null;
    });
  }

  function state() {
    if (!supported()) return Promise.resolve({ state: "unsupported", why: "This browser has no push channel" });
    if (Notification.permission === "denied") {
      return Promise.resolve({ state: "blocked", why: "Notifications are blocked in your browser settings" });
    }
    return reg().then(function (r) {
      if (!r) return { state: "noworker", why: "The app shell has not finished registering" };
      return r.pushManager.getSubscription().then(function (sub) {
        if (sub) return { state: Notification.permission === "granted" ? "on" : "prompt", sub: sub };
        return { state: Notification.permission === "granted" ? "unsubscribed" : "prompt" };
      });
    }).catch(function () {
      return { state: "unsupported", why: "The push manager could not be read" };
    });
  }

  /* One pass of "make sure this account is reachable". Returns a plain status
     the caller can show a human. Never prompts for permission on its own —
     the button in Profile owns that conversation. */
  function ensureSubscribed(accountKey) {
    if (!supported()) return Promise.resolve({ ok: false, state: "unsupported" });
    if (Notification.permission !== "granted") return Promise.resolve({ ok: false, state: "prompt" });
    return reg().then(function (r) {
      if (!r) return { ok: false, state: "noworker" };
      return fetch(SERVER + "/vapid-public-key", { cache: "no-store" })
        .then(function (res) {
          if (!res.ok) throw new Error("server " + res.status);
          return res.json();
        })
        .then(function (cfg) {
          if (!cfg || !cfg.key) throw new Error("no key");
          return r.pushManager.getSubscription().then(function (existing) {
            const p = existing
              ? Promise.resolve(existing)
              : r.pushManager.subscribe({
                  userVisibleOnly: true,
                  applicationServerKey: urlB64ToUint8Array(cfg.key),
                });
            return p.then(function (sub) {
              var j = sub.toJSON();
              return fetch(SERVER + "/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  account: accountKey,
                  endpoint: j.endpoint,
                  keys: j.keys,
                  ua: navigator.userAgent,
                }),
              }).then(function () { return { ok: true, state: "on" }; });
            });
          });
        });
    }).catch(function () {
      return { ok: false, state: "unreachable" };
    });
  }

  function forget(endpoint) {
    if (!window.fetch) return;
    try {
      fetch(SERVER + "/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: endpoint }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) { /* nothing to do */ }
  }

  function unsubscribeAll(accountKey) {
    if (!supported()) return Promise.resolve(false);
    return reg().then(function (r) {
      if (!r) return false;
      return r.pushManager.getSubscription().then(function (sub) {
        if (!sub) return false;
        forget(sub.endpoint);
        return sub.unsubscribe();
      }).catch(function () { return false; });
    }).catch(function () { return false; });
  }

  /* The subscription can outlive the account that made it: resubscribe under
     the name now signed in. The page calls this right after sign-in. */
  function rebind(accountKey) {
    if (!supported() || Notification.permission !== "granted") return Promise.resolve(false);
    return reg().then(function (r) {
      if (!r) return false;
      return r.pushManager.getSubscription().then(function (sub) {
        if (!sub || !sub.endpoint || !sub.toJSON().keys) return false;
        var j = sub.toJSON();
        return fetch(SERVER + "/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account: accountKey, endpoint: j.endpoint, keys: j.keys, ua: navigator.userAgent }),
        }).then(function () { return true; }).catch(function () { return false; });
      }).catch(function () { return false; });
    }).catch(function () { return false; });
  }

  var api = {
    state: state,
    ensureSubscribed: ensureSubscribed,
    unsubscribeAll: unsubscribeAll,
    rebind: rebind,
  };
  global.PampaPush = api;
})(window);
