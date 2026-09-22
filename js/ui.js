/* =========================================================
 * Pampa — ui — waiting, saying so, and moving between screens
 * One spinner and one bar for work that waits, the toasts, the pre-auth page steps and the nav avatar.
 * ========================================================= */

/* ---------- Loading ----------
   One spinner, one bar, for every action that actually waits on something —
   a password being hashed, a photograph being redrawn, a file being read, a
   fix from the GPS. Two shapes because the two answer different questions:
   the button spinner says *this button is working and cannot be pressed
   again*, the top bar says *the app is working, wherever you are looking*.
   The bar only appears if the work outlasts 140ms, so the many operations
   that finish instantly never flash a bar at all. */
let workDepth = 0;
let workTimer = 0;
let workHide = 0;

function setBusy(btn, on) {
  if (!btn) return;
  btn.classList.toggle("btnBusy", !!on);
  if (on) {
    btn.setAttribute("aria-busy", "true");
    btn.setAttribute("disabled", "disabled");
  } else {
    btn.removeAttribute("aria-busy");
    btn.removeAttribute("disabled");
  }
}

function workBar() {
  let el = document.getElementById("workBar");
  if (!el) {
    el = document.createElement("div");
    el.id = "workBar";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = "<span></span>";
    document.body.appendChild(el);
  }
  return el;
}

function beginWork() {
  workDepth += 1;
  if (workDepth > 1) return;
  clearTimeout(workHide);
  workTimer = setTimeout(function () {
    const el = workBar();
    const fill = el.firstChild;
    el.classList.add("on");
    el.classList.remove("done");
    fill.style.width = "10%";
    requestAnimationFrame(function () { fill.style.width = "72%"; });
  }, 140);
}

function endWork() {
  workDepth = Math.max(0, workDepth - 1);
  if (workDepth) return;
  clearTimeout(workTimer);
  const el = document.getElementById("workBar");
  if (!el || !el.classList.contains("on")) return;
  const fill = el.firstChild;
  el.classList.add("done");
  fill.style.width = "100%";
  workHide = setTimeout(function () {
    el.classList.remove("on", "done");
    fill.style.width = "0%";
  }, 260);
}

/* An action that returns a promise: busy button, top bar, both cleared
   whichever way it settles. */
function work(btn, promise) {
  setBusy(btn, true);
  beginWork();
  return Promise.resolve(promise).then(function (v) {
    setBusy(btn, false);
    endWork();
    return v;
  }, function (e) {
    setBusy(btn, false);
    endWork();
    throw e;
  });
}

/* ---------- Toasts ---------- */
function toast(msg, kind) {
  const box = $("#toasts");
  const el = document.createElement("div");
  el.className = "toast " + (kind || "");
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(function () { el.classList.add("show"); }, 20);
  setTimeout(function () {
    el.classList.remove("show");
    setTimeout(function () { el.remove(); }, 300);
  }, 2600);
}

/* ---------- Page navigation (pre-auth) ---------- */
const AUTH_PAGES = ["welcomePage", "number", "otp", "name", "password", "role", "trade", "location"];

/* A step slides in on the strength of its .show class, so the class has to come
   off the page being left as well as the one being entered. Without that, every
   page kept the class from its first visit and the whole flow animated exactly
   once per session — walking back from the address step to the role screen
   arrived already in place. The entry repeats the dance the views use: off,
   displayed at the start position, one forced reflow, then on. */
function showPage(id) {
  AUTH_PAGES.forEach(function (p) {
    if (p === id) return;
    const el = document.getElementById(p);
    if (el) {
      el.classList.remove("show");
      el.style.display = "none";
    }
  });
  const target = document.getElementById(id);
  target.classList.remove("show");
  target.style.removeProperty("display");
  void target.offsetWidth;
  target.classList.add("show");
  if (id === "welcomePage") target.classList.add("entered");
  remeasureCues(target);
}

/* Cues are a measurement, and a box measured while it was hidden reports
   "fits" — it had no height yet. Showing a page or a view is therefore a
   moment the measurement has to be taken again, in the frame after the box
   exists. The ResizeObserver on each scroller catches this too; this is the
   belt to its braces, and the answer on an engine without one. */
function remeasureCues(root) {
  if (!root) return;
  const run = function () {
    if (root.classList && root.classList.contains("cueScroll")) updateScrollCue(root);
    root.querySelectorAll(".cueScroll").forEach(updateScrollCue);
  };
  if (window.requestAnimationFrame) requestAnimationFrame(run);
  else run();
}

/* ---------- Rendering: home ---------- */
function initials(name) {
  return (name || "P").trim().charAt(0).toUpperCase() || "P";
}

/* The account's own face, wherever it is shown outside the provider card: the
   top nav on Home. A professional's picture lives on their directory record, a
   client's on the account, and both end up in the same place. */
function accountFace() {
  const u = state.user || {};
  const rec = state.providers && myProviderRecord ? myProviderRecord() : null;
  return (u.dp || (rec && rec.dp) || "");
}

function renderNavAvatar() {
  const u = state.user || {};
  const dp = accountFace();
  const face = dp
    ? '<img src="' + esc(dp) + '" alt="">'
    : esc(initials(u.name));
  const label = u.name ? u.name + " — your profile" : "Your profile";
  ["#homeAvatar", "#workAvatar"].forEach(function (sel) {
    const el = $(sel);
    if (!el) return;
    el.innerHTML = face;
    el.setAttribute("aria-label", label);
  });
}

