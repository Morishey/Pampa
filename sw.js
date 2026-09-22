/* Pampa service worker.
 *
 * Three jobs, and no more than those:
 *
 * 1. Make the app installable and let it open with no connection. Chrome only
 *    offers "Install" to a page with a service worker that handles fetches, and
 *    once installed the shell has to come from somewhere — so the shell is
 *    cached here.
 *
 * 2. Show notifications — the ones the page raises while it is open, and the
 *    ones the push server sends when the app is closed entirely. Either way a
 *    tap lands on the exact booking or clip the news was about.
 *
 * 3. Keep the push subscription alive: when the push service drops one (a
 *    browser update, a cleared site store), `pushsubscriptionchange` re-news
 *    it with the server so the phone keeps being reachable.
 *
 * It is deliberately conservative about what it caches. Only this origin's own
 * files are stored; photography from the image CDN and clips from the video CDN
 * are left alone, because caching megabytes of other people's media to show one
 * screen is how an offline cache becomes a storage complaint. Navigation is
 * network-first, so a deployed change is never hidden behind a stale shell.
 */

const VERSION = "pampa-shell-v17";

/* The files the app cannot open without. The versioned copies of the CSS and
   JS are added at install time by reading the real page, so a version bump
   never leaves the shell holding an older stylesheet than the markup. */
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./img/icon-192.png",
  "./img/icon-512.png",
  "./img/apple-touch-icon.png",
  "./img/icon-maskable-512.png",
  /* the wordmark the app shows, and the tab icons made from it by
     tools/make-logo.py */
  "./img/pampa-logo.png",
  "./img/favicon-32.png",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    (async function () {
      const cache = await caches.open(VERSION);
      let html = "";
      try {
        const res = await fetch("./index.html", { cache: "reload" });
        if (res && res.ok) html = await res.text();
      } catch (e) {
        /* offline install: fall back to the plain shell list */
      }
      const urls = new Set(SHELL);
      /* every local script, stylesheet and image the page actually asks for,
         query string and all, so the exact URLs the page uses are the ones
         held in the cache */
      String(html).replace(/(?:href|src)="([^"]+)"/g, function (m, url) {
        if (/^(https?:)?\/\//i.test(url) || /^data:/i.test(url)) return m;
        if (/\.(css|js|png|jpg|jpeg|svg|webp|avif|webmanifest)(\?|$)/i.test(url)) urls.add(url);
        return m;
      });
      await Promise.all(
        [...urls].map(function (url) {
          return cache.add(new Request(url, { cache: "reload" })).catch(function () {});
        })
      );
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    (async function () {
      const keys = await caches.keys();
      await Promise.all(
        keys.map(function (k) {
          return k === VERSION ? null : caches.delete(k);
        })
      );
      await self.clients.claim();
    })()
  );
});

function isAsset(url) {
  return /\.(css|js|png|jpg|jpeg|svg|webp|avif|woff2?|webmanifest)$/i.test(url.pathname);
}

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  /* other origins — the photo CDN, the video CDN — are none of this cache's
     business */
  if (url.origin !== self.location.origin) return;

  /* A page load: always try the network first, and only fall back to the shell
     when the device really is offline. */
  if (req.mode === "navigate") {
    event.respondWith(
      (async function () {
        try {
          const res = await fetch(req);
          const cache = await caches.open(VERSION);
          cache.put("./index.html", res.clone()).catch(function () {});
          return res;
        } catch (e) {
          const cached = await caches.match("./index.html", { ignoreSearch: true });
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  if (!isAsset(url)) return;

  /* Everything else local: the cache answers instantly, and a miss is fetched
     and kept. The URL is matched exactly — including ?v= — so a version bump
     can never be served yesterday's stylesheet. */
  event.respondWith(
    (async function () {
      const hit = await caches.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && res.ok && res.type === "basic") {
          const cache = await caches.open(VERSION);
          cache.put(req, res.clone()).catch(function () {});
        }
        return res;
      } catch (e) {
        return Response.error();
      }
    })()
  );
});

/* Tapping a notification should land on the thing the news was about — a
   booking's escrow desk, a clip's comments — not just the app root. A deep
   link is carried in notification.data.url and routed by the app itself
   (see js/activity.js, which owns parseRoute and consumeRoute). */
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    (async function () {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if (client.url.indexOf(self.registration.scope) === 0) {
          await client.focus();
          if (client.navigate) client.navigate(target).catch(function () {});
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});

/* The closed-app channel. The payload is the same small JSON the reference
   server in tools/push-server.js sends: title, body, tag, url. The URL is
   absolute here because the worker may run with no page at all. */
self.addEventListener("push", function (event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Pampa", body: event.data ? event.data.text() : "" };
  }
  if (!data.title && !data.body) return;
  const raw = data.url || "./";
  const url = /^https?:\/\//i.test(raw) ? raw : new URL(raw, self.registration.scope).href;
  event.waitUntil(
    self.registration.showNotification(data.title || "Pampa", {
      body: data.body || "",
      tag: data.tag || "pampa",
      icon: "./img/icon-192.png",
      badge: "./img/icon-192.png",
      data: { url: url },
    })
  );
});

/* Push services retire subscriptions without asking — a browser update or a
   cleared store is enough. Rather than go quiet, the worker hands the fresh
   subscription to the server as soon as the page next runs, so the account is
   reachable again. (A worker alone cannot know which account it serves; the
   page does, and binds it on boot.) */
self.addEventListener("pushsubscriptionchange", function (event) {
  event.waitUntil(
    (async function () {
      /* the old one is dead on the server side; the new one is re-registered
         by the page's rebind() on next boot — set a marker it will read */
      const cache = await caches.open("pampa-push-meta");
      await cache.put("__resubscribe__", new Response("1"));
    })()
  );
});

/* Notifications can also be raised from the SW side, which is the path Android
   prefers for anything that should outlive the page. */
self.addEventListener("message", function (event) {
  const data = event.data || {};
  if (data.type !== "notify" || !data.title) return;
  const raw = data.url || "./";
  const url = /^https?:\/\//i.test(raw) ? raw : new URL(raw, self.registration.scope).href;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body || "",
      tag: data.tag || "pampa",
      icon: "./img/icon-192.png",
      badge: "./img/icon-192.png",
      data: { url: url },
    })
  );
});
