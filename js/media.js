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

/* A clip's length, as a clip is labelled everywhere else in the world. */
function fmtDur(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

/* =========================================================
   Clips: from what the phone recorded to something postable

   A few seconds of phone video is 20-80 MB, which is more than this device's
   whole storage budget. Rather than refusing it, the clip is re-encoded here,
   on the device: played through a canvas at a sane long edge and recorded back
   out at a bitrate chosen so the result fits. If the whole clip cannot fit at a
   quality worth posting, it is trimmed to the length that does, and it says so.

   Nothing is uploaded and no library is involved — the browser's own recorder
   does the work. That is the only shape of this feature that belongs in an app
   with no build step and no dependencies, and it means the file never leaves
   the phone it was filmed on.
   ========================================================= */

/* A clip larger than this is not opened at all: pulling a 500 MB film into
   memory to then throw most of it away would freeze a phone. */
const VIDEO_INPUT_MAX_MB = 60;
const VIDEO_INPUT_MAX_BYTES = VIDEO_INPUT_MAX_MB * 1024 * 1024;

/* The long edge worth keeping. A portfolio tile shows a few hundred pixels and
   the feed is watched on a phone, so 1080p is bytes spent on nothing visible. */
const CLIP_LONG_EDGES = [720, 480, 360];
const CLIP_FPS = 30;
const CLIP_AUDIO_BPS = 64000;
/* Below this the picture falls apart; it is the floor the trim is decided
   against, so a long clip gets cut rather than smeared. */
const CLIP_MIN_BPS = 350000;
const CLIP_MAX_BPS = 2500000;

const CLIP_MIMES = [
  'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
  "video/mp4",
  'video/webm;codecs="vp9,opus"',
  'video/webm;codecs="vp8,opus"',
  "video/webm",
];

function clipMime() {
  if (typeof MediaRecorder === "undefined") return null;
  for (let i = 0; i < CLIP_MIMES.length; i++) {
    try {
      if (MediaRecorder.isTypeSupported(CLIP_MIMES[i])) return CLIP_MIMES[i];
    } catch (e) { /* unsupported values must not stop the search */ }
  }
  return null;
}

/* Can this device re-encode at all? Asked before offering the upload, so the
   control is never a promise the browser cannot keep. */
function clipRecorderAvailable() {
  if (!clipMime()) return false;
  const proto = window.HTMLCanvasElement && HTMLCanvasElement.prototype;
  return !!(proto && (proto.captureStream || proto.mozCaptureStream));
}

/* Whether frames can be pushed by hand. This is the difference between an
   export that works and one that silently produces nothing: a canvas captured
   at a fixed frame rate only yields frames while the browser is compositing,
   which stops when the tab is occluded, dimmed or in the background. Asking
   the track for a frame right after each draw takes the compositor out of the
   loop, so the clip exports either way. */
function clipManualFrames() {
  try {
    const c = document.createElement("canvas");
    c.width = 2;
    c.height = 2;
    const s = c.captureStream ? c.captureStream(0) : (c.mozCaptureStream ? c.mozCaptureStream(0) : null);
    const t = s && s.getVideoTracks ? s.getVideoTracks()[0] : null;
    const ok = !!(t && typeof t.requestFrame === "function");
    if (s) s.getTracks().forEach(function (x) { x.stop(); });
    return ok;
  } catch (e) {
    return false;
  }
}

function loadClipMeta(url) {
  return new Promise(function (resolve, reject) {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.crossOrigin = "anonymous";
    let settled = false;
    const fail = function () {
      if (settled) return;
      settled = true;
      reject(new Error("unreadable"));
    };
    v.onerror = fail;
    const ok = function () {
      if (settled) return;
      settled = true;
      resolve({ el: v, duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    };
    v.onloadedmetadata = function () {
      if (settled) return;
      if (!v.videoWidth || !v.videoHeight) { fail(); return; }
      if (isFinite(v.duration) && v.duration > 0) { ok(); return; }

      /* Files recorded in a browser carry no length in their metadata: the
         duration reads as Infinity. That includes this app's own exports, screen
         recordings, and clips off some phones. Seeking far past the end makes
         the browser walk the file and work the length out — the only way to
         learn it — and the seek is undone by whoever plays the clip next. */
      let tries = 0;
      const settle = function () {
        if (settled) return;
        if (isFinite(v.duration) && v.duration > 0) { ok(); return; }
        if (tries++ > 12) { fail(); return; }
        window.setTimeout(function () {
          if (settled) return;
          try { v.currentTime = 1e101; } catch (e) { fail(); }
        }, 60);
      };
      v.ondurationchange = settle;
      v.ontimeupdate = settle;
      settle();
    };
    v.src = url;
  });
}

/* Even dimensions: encoders refuse or silently distort an odd height. */
function clipScale(w, h, longEdge) {
  const longest = Math.max(w, h);
  const k = longest > longEdge ? longEdge / longest : 1;
  const even = function (n) { return Math.max(2, Math.round(n * k / 2) * 2); };
  return { w: even(w), h: even(h) };
}

/* How much of the clip can be kept at a bitrate worth watching. A short clip
   keeps all of it at a high bitrate; a long one is cut to fit rather than
   degraded into mush. */
function clipPlan(duration, budgetBytes, withAudio) {
  const audio = withAudio ? CLIP_AUDIO_BPS : 0;
  const usableBits = budgetBytes * 8;
  const videoBps = Math.round(usableBits / duration) - audio;
  if (videoBps >= CLIP_MIN_BPS) {
    return { seconds: duration, videoBps: Math.min(videoBps, CLIP_MAX_BPS), trimmed: false };
  }
  const fits = Math.max(1, Math.floor(usableBits / (CLIP_MIN_BPS + audio)));
  return { seconds: Math.min(fits, duration), videoBps: CLIP_MIN_BPS, trimmed: fits < duration };
}

function recordClip(source, canvas, seconds, videoBps, mime, withAudio, onProgress) {
  return new Promise(function (resolve, reject) {
    const ctx = canvas.getContext("2d");
    if (!ctx) { reject(new Error("no-canvas")); return; }
    let rec = null;
    let stream = null;
    let raf = 0;
    let pump = 0;
    let done = false;
    let frames = 0;
    let lastDraw = 0;

    const stopAll = function () {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (pump) window.clearInterval(pump);
      pump = 0;
      try { source.pause(); } catch (e) { /* already stopped */ }
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    };

    const manual = clipManualFrames();
    let track = null;
    try {
      stream = canvas.captureStream
        ? canvas.captureStream(manual ? 0 : CLIP_FPS)
        : canvas.mozCaptureStream(manual ? 0 : CLIP_FPS);
      track = stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
      /* Best effort: the clip keeps its sound when the browser will hand it
         over. A silent recording is a far better outcome than a failed one,
         so a refusal here is not an error. */
      if (withAudio) {
        try {
          const from = source.captureStream ? source.captureStream() : (source.mozCaptureStream ? source.mozCaptureStream() : null);
          if (from) from.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
        } catch (e) { /* video-only */ }
      }
    } catch (e) {
      reject(new Error("no-capture"));
      return;
    }

    const hasAudio = stream.getAudioTracks().length > 0;
    try {
      rec = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: videoBps,
        audioBitsPerSecond: hasAudio ? CLIP_AUDIO_BPS : 0,
      });
    } catch (e) {
      stopAll();
      reject(new Error("no-recorder"));
      return;
    }

    const chunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onerror = function () {
      if (done) return;
      done = true;
      stopAll();
      reject(new Error("recorder-failed"));
    };
    const handOver = function () {
      resolve({ blob: new Blob(chunks, { type: mime.split(";")[0] }), frames: frames });
    };
    rec.onstop = function () {
      if (done) return;
      done = true;
      stopAll();
      handOver();
    };

    const finish = function () {
      if (done) return;
      try { if (rec.state !== "inactive") rec.stop(); else { done = true; handOver(); } }
      catch (e) { done = true; reject(new Error("recorder-failed")); }
    };

    /* One frame: the composite, and the progress the caller asked to show. */
    const step = function () {
      if (done) return;
      if (source.ended || source.currentTime >= seconds) { finish(); return; }
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      /* Hand the drawn frame to the recorder directly when the browser allows
         it, so a frame exists whether or not anything is compositing. */
      if (manual && track && track.requestFrame) {
        try { track.requestFrame(); } catch (e) { /* fall back to the compositor */ }
      }
      frames += 1;
      lastDraw = performance.now();
      if (onProgress) onProgress(Math.min(1, source.currentTime / seconds));
    };

    /* Frames are pumped two ways on purpose. requestAnimationFrame is the
       smooth path while the page is in front of somebody. It stops firing
       altogether when a tab is occluded, backgrounded or saving power — and
       an export that stops drawing still has to finish, so a timer forces a
       frame whenever the frame pace falls behind. Relying on requestAnimation
       Frame alone meant a phone that dimmed mid-export produced an empty clip
       that looked like a success. */
    const tick = function () {
      if (done) return;
      step();
      raf = requestAnimationFrame(tick);
    };
    pump = window.setInterval(function () {
      if (done) return;
      if (performance.now() - lastDraw > 120) step();
    }, Math.round(1000 / CLIP_FPS));

    /* A clock as well: a clip whose timestamps stall (some MOV files) would
       otherwise record for ever. */
    const deadline = window.setTimeout(finish, Math.ceil(seconds * 1000) + 1500);
    const clearDeadline = function () { window.clearTimeout(deadline); };
    rec.addEventListener("stop", clearDeadline);

    const begin = function () {
      try { source.currentTime = 0; } catch (e) { /* already at the start */ }
      const played = source.play();
      const start = function () {
        try { rec.start(250); } catch (e) { done = true; stopAll(); reject(new Error("recorder-failed")); return; }
        tick();
      };
      if (played && played.then) played.then(start).catch(function () { done = true; stopAll(); reject(new Error("cannot-play")); });
      else start();
    };


    if (source.readyState >= 1 && source.currentTime === 0) {
      begin();
    } else {
      /* Rewind first. A clip whose length had to be measured is parked past its
         own end, and waiting on a seek nobody asked for would hang for ever. */
      source.addEventListener("seeked", begin, { once: true });
      try { source.currentTime = 0; } catch (e) { begin(); }
    }
    source.addEventListener("ended", finish, { once: true });
  });
}

/* The one entry point the app uses. Returns a data URL ready to store, plus the
   length that gets posted beside it. */
async function compressClip(file, onProgress) {
  if (!/^video\//i.test(file.type || "")) throw new Error("not-a-video");
  if (file.size > VIDEO_INPUT_MAX_BYTES) throw new Error("too-big");
  const mime = clipMime();
  if (!mime || !clipRecorderAvailable()) throw new Error("no-recorder");

  const url = URL.createObjectURL(file);
  let meta;
  try {
    meta = await loadClipMeta(url);
  } catch (e) {
    URL.revokeObjectURL(url);
    throw new Error("unreadable");
  }

  const hasAudio = true; /* planned for, whether or not it survives capture */
  const budget = VIDEO_MAX_BYTES;
  let best = null;

  try {
    for (let i = 0; i < CLIP_LONG_EDGES.length; i++) {
      const size = clipScale(meta.width, meta.height, CLIP_LONG_EDGES[i]);
      const plan = clipPlan(meta.duration, budget, hasAudio);
      const canvas = document.createElement("canvas");
      canvas.width = size.w;
      canvas.height = size.h;
      const made = await recordClip(meta.el, canvas, plan.seconds, plan.videoBps, mime, hasAudio, onProgress);
      /* A recording holding no frames is not a small clip, it is a failed one,
         and storing it would leave a blank tile behind a cheerful toast. */
      if (!made.frames || !made.blob.size || made.blob.size < 2048) {
        throw new Error("recorder-failed");
      }
      const blob = made.blob;
      const attempt = {
        blob: blob, width: size.w, height: size.h,
        seconds: plan.seconds, trimmed: plan.trimmed, videoBps: plan.videoBps,
      };
      if (!best || blob.size < best.blob.size) best = attempt;
      if (blob.size <= budget) break;
      /* Over budget: the encoder ignored the requested bitrate. Rather than
         guess again at the same size, step the resolution down and retry. */
      try { meta.el.currentTime = 0; } catch (e) { /* at the start already */ }
    }
  } finally {
    URL.revokeObjectURL(url);
    try { meta.el.pause(); meta.el.removeAttribute("src"); meta.el.load(); } catch (e) { /* nothing to release */ }
  }

  if (!best) throw new Error("recorder-failed");
  if (best.blob.size > budget) throw new Error("cannot-fit");

  const dataUrl = await new Promise(function (resolve, reject) {
    const r = new FileReader();
    r.onerror = function () { reject(new Error("unreadable")); };
    r.onload = function () { resolve(String(r.result || "")); };
    r.readAsDataURL(best.blob);
  });

  return {
    src: dataUrl,
    size: best.blob.size,
    duration: best.seconds,
    width: best.width,
    height: best.height,
    trimmed: best.trimmed,
    originalDuration: meta.duration,
  };
}

/* Every failure a clip can raise, in words a person can act on. The codes are
   internal; only these sentences are ever shown. */
function clipErrorMessage(err) {
  const code = (err && err.message) || "";
  if (code === "not-a-video") return "That file is not a video";
  if (code === "too-big") {
    return "That clip is over " + VIDEO_INPUT_MAX_MB + " MB \u2014 trim it on your phone first, or paste a link";
  }
  if (code === "unreadable") return "Could not read that clip \u2014 try another file";
  if (code === "cannot-fit") {
    return "That clip would not squeeze into " + VIDEO_MAX_MB + " MB without ruining it \u2014 paste a link instead";
  }
  if (code === "no-recorder" || code === "no-capture" || code === "recorder-failed") {
    return "This browser cannot re-encode a clip \u2014 paste a video link instead";
  }
  if (code === "cannot-play") return "The browser would not play that clip \u2014 try another file";
  return "Could not prepare that clip";
}

/* One place decides what the client is told about what just happened, so the
   portfolio and the status rail describe a re-encoded clip the same way. */
function clipSavedText(result) {
  const length = fmtDur(result.duration);
  if (result.trimmed) {
    return "Trimmed to " + length + " (" + fileSizeText(result.size) + ") \u2014 that is as much as fits";
  }
  return length + " clip ready \u00b7 " + fileSizeText(result.size);
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

