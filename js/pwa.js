/* =========================================================
 * Pampa — pwa — install, permission, and the nudge
 * The home-screen install, the notification permission, the clip news watch and the one-time install offer.
 * ========================================================= */

/* ---------- The app itself: install and notifications ---------- */
/* Two things turn this page into an app on a phone: it can be put on a home
   screen, and it can tell you what happened while you were not looking.

   Both are honest about the platform. Install is offered when the browser
   offers it, explained when it cannot be offered (iOS Safari has no install
   API at all), and stated plainly once it has happened. Notifications need
   permission — and this app has no server, so a notification is raised by the
   app itself while it is open. A deployment with a backend would push them;
   nothing here pretends otherwise. */
let deferredInstall = null;
let swRegistration = null;
let newsTimer = null;

function isStandalone() {
  if (window.navigator.standalone === true) return true;
  if (!window.matchMedia) return false;
  return window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches;
}

/* iPadOS reports itself as a Mac; the touch points give it away. */
function isAppleMobile() {
  const ua = navigator.userAgent || "";
  if (/iphone|ipod|ipad/i.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  /* a service worker needs a secure origin; plain http on a LAN address has
     neither the worker nor the install offer, which is worth not pretending
     otherwise about */
  const secure = location.protocol === "https:" || location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";
  if (!secure) return;
  navigator.serviceWorker.register("sw.js").then(function (reg) {
    swRegistration = reg;
  }).catch(function (e) {
    console.warn("Pampa: the app shell was not cached", e);
  });
}

/* Raises a real notification. The service worker is preferred, because on
   Android a Notification built by the page itself is unreliable; the page API
   is the fallback where there is no worker. (The sender itself lives with the
   deep-link helpers near the top of the file, so bell, system and push all
   share one routing vocabulary.) */

function notifyPermission() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/* What the two rows in Profile say, and the note in the bell sheet. One state
   function, so no screen can claim notifications are on while they are off. */
function renderInstall() {
  const row = $("#installEntry");
  const title = $("#installTitle");
  const note = $("#installNote");
  if (!row || !title || !note) return;
  if (isStandalone()) {
    row.setAttribute("aria-disabled", "true");
    row.classList.add("isOn");
    title.textContent = "Installed — this is the app";
    note.textContent = "Pampa sits on your home screen and opens without the browser around it.";
    return;
  }
  row.removeAttribute("aria-disabled");
  row.classList.remove("isOn");
  if (deferredInstall) {
    title.textContent = "Install Pampa";
    note.textContent = "One tap, and it opens from your home screen like any other app.";
    return;
  }
  if (isAppleMobile()) {
    title.textContent = "Add to Home Screen";
    note.textContent = "Tap Share in Safari, then Add to Home Screen.";
    return;
  }
  title.textContent = "Install Pampa";
  note.textContent = "Open your browser menu and choose Install app or Add to Home screen.";
}

function renderNotifyPermit() {
  const btn = $("#notifyPermitBtn");
  const note = $("#notifyPermitNote");
  const text = $("#notifyPermitText");
  const perm = notifyPermission();
  const entryTitle = $("#notifyTitle");
  const entryNote = $("#notifyNote");
  const show = function (message, button) {
    if (note) { note.textContent = message || ""; note.style.display = message ? "block" : "none"; }
    if (btn) btn.style.display = button ? "flex" : "none";
  };
  if (perm === "unsupported") {
    show("This browser cannot show notifications. The bell keeps everything here either way.", false);
    if (entryTitle) entryTitle.textContent = "Notifications unavailable";
    if (entryNote) entryNote.textContent = "This browser has no notifications API — the bell in the top bar keeps the list.";
    return;
  }
  if (perm === "granted") {
    show("Notifications are on. You will hear about bookings, escrow and replies even with the app in the background.", false);
    if (entryTitle) entryTitle.textContent = "Notifications are on";
    if (entryNote) entryNote.textContent = "Bookings, escrow and replies reach you outside the app.";
    return;
  }
  if (perm === "denied") {
    show("Notifications are blocked for Pampa in your browser settings.", false);
    if (entryTitle) entryTitle.textContent = "Notifications are blocked";
    if (entryNote) entryNote.textContent = "Allow them in your browser's site settings to hear about bookings.";
    return;
  }
  show("", true);
  if (text) text.textContent = "Turn on notifications";
  if (entryTitle) entryTitle.textContent = "Turn on notifications";
  if (entryNote) entryNote.textContent = "Hear about bookings, escrow and replies to your clips.";
}

function askNotifyPermission() {
  const perm = notifyPermission();
  if (perm === "unsupported") { toast("This browser cannot show notifications"); return; }
  if (perm === "granted") { toast("Notifications are already on"); return; }
  if (perm === "denied") { toast("Blocked in your browser settings"); return; }
  const asked = Notification.requestPermission();
  Promise.resolve(asked).then(function (res) {
    renderNotifyPermit();
    if (res === "granted") {
      /* history is not news: the cursor jumps to the newest event there is,
         so switching notifications on never replays yesterday */
      if (!notifyStore.announced) notifyStore.announced = {};
      const all = notifyEvents();
      notifyStore.announced[accountKey()] = all.length ? all[0].at : new Date().toISOString();
      saveNotify();
      showSystemNote("Notifications are on",
        "We will tell you when a booking moves, escrow settles, or someone answers a clip.");
      /* permission was the only thing missing from the push chain — connect it
         now rather than waiting for the next sign-in */
      if (window.PampaPush) bindPushToAccount();
      renderPushStatus();
      toast("Notifications on");
    } else {
      toast(res === "denied" ? "Notifications stay off" : "Notifications not turned on");
    }
  }).catch(function () {
    renderNotifyPermit();
    toast("Notifications not turned on");
  });
}

function doInstall() {
  if (isStandalone()) { toast("Pampa is already installed"); return; }
  if (deferredInstall) {
    deferredInstall.prompt();
    const choice = deferredInstall.userChoice;
    deferredInstall = null;
    if (choice && choice.then) {
      choice.then(function (res) {
        renderInstall();
        if (res && res.outcome === "accepted") toast("Pampa is on your home screen");
      });
    } else {
      renderInstall();
    }
    return;
  }
  toast(isAppleMobile() ? "Share → Add to Home Screen" : "Browser menu → Install app");
}

/* ---------- News announcements ---------- */
/* News is what has happened since the last time this account was told about
   anything. The cursor is per account and lives with the unread marker, so
   signing in as somebody else never silences their news or leaks the other's. */
function primeNewsCursor() {
  const key = accountKey();
  if (!notifyStore.announced) notifyStore.announced = {};
  if (notifyStore.announced[key]) return;
  const all = notifyEvents();
  notifyStore.announced[key] = all.length ? all[0].at : new Date().toISOString();
  saveNotify();
}

function startNewsWatch() {
  primeNewsCursor();
  if (newsTimer) return;
  newsTimer = setInterval(announceNews, 45000);
}

function stopNewsWatch() {
  if (newsTimer) clearInterval(newsTimer);
  newsTimer = null;
}

/* The wider world can leave something while the app is in the background: ask
   again the moment it comes back to the front. */
window.addEventListener("beforeinstallprompt", function (e) {
  e.preventDefault();
  deferredInstall = e;
  renderInstall();
});
window.addEventListener("appinstalled", function () {
  deferredInstall = null;
  renderInstall();
  toast("Pampa installed");
});
document.addEventListener("visibilitychange", function () {
  if (document.hidden || !state.user) return;
  announceNews();
  /* Coming back to the front is the other moment the world outside has to be
     asked again: a phone put down with the desk open is a phone whose desk is
     as old as the hour it was put down. Shorter than the view-tap throttle —
     returning to the app is a stronger reason to ask than tapping a tab. */
  if (typeof dbCloudSyncSoon === "function") dbCloudSyncSoon(3000);
});
registerServiceWorker();

/* ---------- The install nudge ----------
 * A client who has just settled their first booking has felt what the app is
 * for; that is the moment a home-screen icon means something. The offer is
 * made at most twice in the life of the device — once after that first
 * settlement, once much later — and never while the app is already
 * installed, never to a professional (their dashboard is the workplace, not
 * the habit being formed), and never twice to somebody who said "not now"
 * minutes ago.
 */
const NUDGE_KEY = "pampa.nudge.v1";

function nudgeStore() {
  try { return JSON.parse(localStorage.getItem(NUDGE_KEY)) || {}; } catch (e) { return {}; }
}

function saveNudge(n) {
  try { localStorage.setItem(NUDGE_KEY, JSON.stringify(n)); } catch (e) {}
}

function maybeNudgeInstall() {
  if (isStandalone()) return;                       /* already installed */
  if ((state.user || {}).role === "pro") return;    /* pros are not the habit being formed */
  const n = nudgeStore();
  if (n.count >= 2 || n.dismissedAt) return;        /* twice ever, then silence */
  const settled = state.bookings.some(function (b) {
    return (b.clientPhone || "") === ((state.user || {}).phone || "") &&
      (statusOf(b) === "released" || (b.rated && b.rated.at));
  });
  if (!settled) return;                             /* nothing completed yet */
  if (n.dismissedAt && Date.now() - n.dismissedAt < 7 * 24 * 3600 * 1000) return;
  const at = Date.now();
  n.count = (n.count || 0) + 1;
  n.at = at;
  saveNudge(n);
  setTimeout(function () {
    if (!state.user || isStandalone()) return;
    const sh = $("#nudgeSheet");
    if (!sh) return;
    renderInstall();
    showSheetEl("#nudgeSheet");
  }, 1600);
}

function closeNudge(rememberDismiss) {
  hideSheetEl("#nudgeSheet");
  if (rememberDismiss) {
    const n = nudgeStore();
    n.dismissedAt = Date.now();
    saveNudge(n);
  }
}

function nudgeDoInstall() {
  closeNudge(false);
  doInstall();
}

document.addEventListener("click", function (e) {
  const t = e.target.closest ? e.target : e.target.parentElement;
  if (!t) return;
  if (t.closest("#closeNudge") || t.closest("#nudgeDismiss")) { closeNudge(true); return; }
  if (t.closest("#nudgeInstall")) { nudgeDoInstall(); return; }
});

/* A notification tap on a running app arrives as a hash change (the worker
   calls client.navigate) — route it the same way a cold start is routed. */
window.addEventListener("hashchange", function () {
  if (!document.hidden && state.user) consumeRoute();
});

