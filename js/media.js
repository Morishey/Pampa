/* =========================================================
 * Pampa — media — pictures and clips
 * Profile pictures, portfolio photographs and video, kept small enough to live on one device.
 * ========================================================= */

/* ---------- Display pictures and portfolios ---------- */
/* A provider is a person, so the directory holds a picture of them and the
   work they have done. Both arrive from the device's own file picker and are
   shrunk here before they are stored: a phone photo is 3–5 MB and the whole
   directory shares a few megabytes of localStorage with everything else, so
   the original can never be written. */
const DP_MAX = 320;      /* long edge of a profile photo */
const WORK_MAX = 900;    /* long edge of a portfolio photo */
const WORK_LIMIT = 9;    /* portfolio size, to keep one pro from eating storage */
const DP_QUALITY = 0.78;
const WORK_QUALITY = 0.72;

function shrinkImage(file, maxPx, quality) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onerror = function () { reject(new Error("read")); };
    reader.onload = function () {
      const img = new Image();
      img.onerror = function () { reject(new Error("decode")); };
      img.onload = function () {
        try {
          const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL("image/jpeg", quality));
        } catch (e) {
          reject(e);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function dpOf(p) {
  return (p && typeof p.dp === "string" && p.dp) ? p.dp : "";
}

/* One avatar markup for every surface, so a provider who has a picture looks
   like themselves on the home row, in the booking sheet, on their profile and
   in the header — and initials only stand in until they add one. */
function avatarHtml(p, cls) {
  const dp = dpOf(p);
  return '<span class="avatar' + (cls ? " " + cls : "") + '">' +
    (dp ? '<img src="' + esc(dp) + '" alt="">' : esc(initials(p && p.name))) + "</span>";
}

function worksOf(p) {
  return (p && Array.isArray(p.works)) ? p.works : [];
}

function isVideoWork(w) {
  return !!w && w.kind === "video";
}

/* A clip is stored as a link, or as the file itself when it is small enough to
   live in device storage. Anything that plays inline says so here; a share
   link (a YouTube page, a Drive folder) opens where it lives. */
const VIDEO_MAX_MB = 1.5;
const VIDEO_MAX_BYTES = Math.round(VIDEO_MAX_MB * 1024 * 1024);

function videoLooksPlayable(src) {
  const s = String(src || "");
  if (/^(data|blob):video\//i.test(s)) return true;
  if (/^data:/i.test(s)) return false;
  return /\.(mp4|webm|ogv|ogg|mov|m4v)(\?|#|$)/i.test(s);
}

function fileSizeText(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

/* One provider's face or portfolio changed. Every surface that shows them is
   redrawn here — the dashboard, the activity card, the profile and the strip a
   client books from — so a new picture is never one tab behind the upload. */
function refreshProviderSurfaces() {
  renderDpSheet();
  renderProfile();
  renderNavAvatar();
  renderWork();
  renderProHomeCard();
  if (state.providerView) renderProviderProfile();
  /* the market carries their public card, so redraw it too when it is on screen */
  if ((state.user || {}).role !== "pro") {
    renderStories();
    renderStylists();
  }
}

function youtubeId(src) {
  const m = String(src || "").match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/);
  return m ? m[1] : null;
}

/* The provider record this account owns, or null — a client never has one. */
function myProviderRecord() {
  const u = state.user || {};
  if (!u.trade) return null;
  return state.providers.find(function (p) { return p.id === selfKey(); }) || null;
}

/* What the app calls a provider's line of work on a card, a profile or a clip
   caption: their own words when they came with one, the trade otherwise. */
function providerSkill(p) {
  return (p && (p.skill || tradeNameFor(p))) || "Professional";
}

/* A provider's trade name as one word, for matching what a client typed. */
function tradeNameFor(p) {
  const t = TRADES.find(function (x) { return (p.cats || []).indexOf(x.id) !== -1; });
  return t ? t.name : (p.skill || "");
}

