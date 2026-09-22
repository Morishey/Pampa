/* =========================================================
 * Pampa — status — what a professional is doing today
 * One ephemeral ring per professional. They post it from their dashboard — a
 * photo, a clip or a line — it rides the spotlight rail for 24 hours, and then
 * it is gone without anyone deleting it. The store, the rail, the sheet that
 * posts one and the viewer that plays them all live here.
 * ========================================================= */

/* ---------- The model ----------
   A status belongs to the professional, not to the session, so it lives on
   their directory record beside their picture and their portfolio: it survives
   a sign-out and reads the same in every account on the device. Three kinds,
   one shape:

     photo   a picture, shrunk on the way in
     clip    a video file or a link
     note    a line of text over the provider's own trade artwork

   "Live" means younger than 24 hours. The moment is stamped on the way in and
   every read filters on it, so expiry needs no timer, no sweep and no cleanup
   pass that a closed app could miss. */
const STATUS_KEY = "pampa.status.v1";
const STATUS_HOURS = 24;
const STATUS_MS = STATUS_HOURS * 3600 * 1000;
const STATUS_MAX = 6;                 /* live at once, per professional */
const STATUS_PHOTO_MAX = 1080;        /* long edge, before storage */
const STATUS_PHOTO_Q = 0.72;
const STATUS_HOLD_PHOTO = 5000;       /* how long a photo stays on screen */
const STATUS_HOLD_NOTE = 6500;
const STATUS_HOLD_CLIP_FALLBACK = 15000;
const STATUS_HOLD_CLIP_MAX = 20000;

const STATUS_KINDS = [
  { id: "photo", ico: "camera", name: "Photo" },
  { id: "clip", ico: "play", name: "Clip" },
  { id: "note", ico: "chat", name: "Line" },
];

/* ---------- What has been watched ----------
   The only thing about a status that is per-account rather than per-provider:
   a client who has watched a ring should not see it as new again, and the next
   account on the same device should. So the marker is keyed by account, exactly
   like the notification bell's unread mark. */
let statusSeen = { seen: {} };

function loadStatusSeen() {
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && typeof d.seen === "object") statusSeen.seen = d.seen || {};
    }
  } catch (e) {
    console.warn("Pampa: status unreadable", e);
  }
  if (!statusSeen || typeof statusSeen.seen !== "object") statusSeen.seen = {};
}

function saveStatusSeen() {
  try {
    localStorage.setItem(STATUS_KEY, JSON.stringify({ seen: statusSeen.seen }));
    return true;
  } catch (e) {
    console.warn("Pampa: status not saved", e);
    return false;
  }
}

function statusSeenMap() {
  const key = accountKey();
  if (!statusSeen.seen[key]) statusSeen.seen[key] = {};
  return statusSeen.seen[key];
}

function statusWasSeen(id) {
  return !!statusSeenMap()[id];
}

function markStatusSeen(id) {
  if (!id) return;
  const map = statusSeenMap();
  if (map[id]) return;
  map[id] = new Date().toISOString();
  saveStatusSeen();
}

/* ---------- What clients leave on a status ----------
   Reactions, messages and views live in their own store, keyed by status id,
   because a status may be a seeded one that is rebuilt on every read and so
   has no body of its own to carry them. One reaction per account — sending a
   different emoji replaces the first, the way the stories rail behaves — and
   any number of short messages. Views are counted unique per account, and the
   owner's own looks are never counted. */
const STATUS_SOCIAL_KEY = "pampa.status.social.v1";
const STATUS_EMOJI = ["\u2764\uFE0F", "\uD83D\uDD25", "\uD83D\uDC4F", "\uD83D\uDE0D"];
const STATUS_MSG_MAX = 140;
let statusSocial = {};

function loadStatusSocial() {
  try {
    const raw = localStorage.getItem(STATUS_SOCIAL_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && typeof d.threads === "object") statusSocial = d.threads || {};
    }
  } catch (e) {
    console.warn("Pampa: status social unreadable", e);
  }
  if (!statusSocial || typeof statusSocial !== "object") statusSocial = {};
  /* A message needs a name to be answered by. Messages written before replies
     existed have none, so they are given a stable one on the way in — built
     from their position and their own timestamp, so the same message gets the
     same key on every device and every load. */
  Object.keys(statusSocial).forEach(function (sid) {
    const t = statusSocial[sid];
    if (!t || !Array.isArray(t.messages)) return;
    t.messages.forEach(function (m, i) {
      if (!m.id) m.id = "m" + (i + 1) + String(m.at || "").replace(/\D/g, "").slice(-6);
    });
  });
}

function saveStatusSocial() {
  try {
    localStorage.setItem(STATUS_SOCIAL_KEY, JSON.stringify({ threads: statusSocial }));
    return true;
  } catch (e) {
    console.warn("Pampa: status social not saved", e);
    return false;
  }
}

function statusThread(id) {
  if (!statusSocial[id]) statusSocial[id] = { reactions: [], messages: [], views: {} };
  const t = statusSocial[id];
  if (!Array.isArray(t.reactions)) t.reactions = [];
  if (!Array.isArray(t.messages)) t.messages = [];
  if (!t.views || typeof t.views !== "object") t.views = {};
  return t;
}

/* A read-only look, so the bell and the insights card never create threads
   just by asking whether one exists. */
function statusThreadRead(id) {
  const t = statusSocial[id];
  return t || { reactions: [], messages: [], views: {} };
}

function meStatusId() { return accountKey(); }
function meStatusName() { return (state.user || {}).name || "Someone"; }

function statusReactionOf(id) {
  return statusThreadRead(id).reactions.find(function (r) { return r.byId === meStatusId(); }) || null;
}

function reactToStatus(id, emoji) {
  const t = statusThread(id);
  const prev = t.reactions.find(function (r) { return r.byId === meStatusId(); });
  const now = new Date().toISOString();
  if (prev && prev.emoji === emoji) return { ok: false, msg: "same" };
  if (prev) {
    prev.emoji = emoji;
    prev.at = now;
  } else {
    t.reactions.push({ by: meStatusName(), byId: meStatusId(), emoji: emoji, at: now });
  }
  saveStatusSocial();
  return { ok: true };
}

function sendStatusMessage(id, text) {
  const clean = String(text || "").trim().slice(0, STATUS_MSG_MAX);
  if (!clean) return { ok: false, msg: "Write something first" };
  const t = statusThread(id);
  t.messages.push({ id: statusMsgId(), by: meStatusName(), byId: meStatusId(), text: clean, at: new Date().toISOString() });
  /* a thread is a conversation about a day, not an archive: the newest thirty
     stand, and the oldest fall off the front */
  if (t.messages.length > 30) t.messages.splice(0, t.messages.length - 30);
  saveStatusSocial();
  return { ok: true };
}

/* Every message carries its own key, so a reply can name the message it is
   answering instead of guessing from what came last. */
function statusMsgId() {
  return "m" + Date.now() + "-" + Math.floor(Math.random() * 1000);
}

/* The professional answering a client, from the bell rather than from the
   story viewer: the reply is threaded onto the message it answers, so both
   sides read one conversation. */
function sendStatusReply(statusId, msgId, text) {
  const clean = String(text || "").trim().slice(0, STATUS_MSG_MAX);
  if (!clean) return { ok: false, msg: "Write a reply first" };
  const t = statusThread(statusId);
  const parent = t.messages.find(function (m) { return m.id === msgId; });
  if (!parent) return { ok: false, msg: "That message is no longer here" };
  t.messages.push({
    id: statusMsgId(),
    by: meStatusName(),
    byId: meStatusId(),
    text: clean,
    at: new Date().toISOString(),
    replyTo: msgId,
    to: parent.by,
  });
  if (t.messages.length > 30) t.messages.splice(0, t.messages.length - 30);
  saveStatusSocial();
  return { ok: true, to: parent.by };
}

/* Has this message been answered by me already? The bell says so on the row
   instead of offering the same reply all day. */
function statusRepliedTo(statusId, msgId) {
  const mine = meStatusId();
  return (statusThreadRead(statusId).messages || []).some(function (m) {
    return m.replyTo === msgId && m.byId === mine;
  });
}

/* The last thing said by the other side, which is what a reader standing in the
   viewer wants above the composer: the owner sees the newest client message,
   a client sees the professional's newest answer to them. */
function statusLastWord(statusId, ownerView) {
  const meKey = meStatusId();
  const msgs = statusThreadRead(statusId).messages || [];
  let best = null;
  msgs.forEach(function (m) {
    if (!m.at || m.byId === meKey) return;
    const answersMe = !ownerView && msgs.some(function (x) { return x.id === m.replyTo && x.byId === meKey; });
    const saidToOwner = ownerView && !m.replyTo;
    if (!answersMe && !saidToOwner) return;
    if (!best || String(m.at) > String(best.at)) best = m;
  });
  return best;
}

/* Which professional a status id belongs to. Status ids are their own namespace
   (a stored status is "s<stamp>", a curated one is "seed:<provider>:<item>")
   and neither carries the provider, so the owner is found by asking the market
   and the seeds who owns it. */
function providerForStatusId(id) {
  return allProviders().find(function (p) {
    return statusItems(p).some(function (s) { return s.id === id; });
  }) || null;
}

function statusRecordView(id) {
  const t = statusThread(id);
  if (t.views[meStatusId()]) return;
  t.views[meStatusId()] = new Date().toISOString();
  saveStatusSocial();
}

function statusViewCount(id) {
  return Object.keys(statusThreadRead(id).views).length;
}

/* ---------- Reading a professional's statuses ---------- */
function statusLive(items) {
  const now = Date.now();
  return (Array.isArray(items) ? items : []).filter(function (s) {
    return s && s.expiresAt && new Date(s.expiresAt).getTime() > now;
  });
}

/* A seeded professional's status is curated the way their portfolio is: rebuilt
   from the seed on every read, so it is theirs, it is alive, and it is never
   stale on a device that has been open since yesterday. */
function statusItems(p) {
  if (!p) return [];
  const stored = Array.isArray(p.status) ? p.status : [];
  const seed = p.seed ? seedStatusFor(p.id) : [];
  return statusLive(stored.concat(seed)).slice(0, STATUS_MAX);
}

function statusHasNew(p) {
  return statusItems(p).some(function (s) { return !statusWasSeen(s.id); });
}

function statusNewest(p) {
  const items = statusItems(p);
  let best = null;
  items.forEach(function (s) {
    if (!best || new Date(s.at).getTime() > new Date(best.at).getTime()) best = s;
  });
  return best;
}

function statusClock(iso) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const h = Math.floor(mins / 60);
  return h + "h ago";
}

function statusLeftText(s) {
  if (!s || !s.expiresAt) return "";
  const mins = Math.max(0, Math.round((new Date(s.expiresAt).getTime() - Date.now()) / 60000));
  if (mins < 60) return mins + "m left";
  return Math.round(mins / 60) + "h left";
}

/* The trade artwork a note borrows, so a line of text still looks like the
   professional who wrote it rather than a blank card. */
function catForProvider(id) {
  const s = STYLISTS.find(function (x) { return x.id === id; }) ||
    PROVIDER_SEED.find(function (x) { return x.id === id; });
  return (s && s.cats && s.cats[0]) || "barb";
}

/* ---------- The seeded shop window ----------
   The professionals the app ships with have statuses the way they have
   portfolios, so a fresh install opens with a rail worth tapping. Each entry
   borrows one of their own seeded work photos (or the clip they already carry)
   and is stamped a plausible number of minutes back, so the ring reads as a day
   that has actually happened rather than as a fixture. */
/* Four of the seeded professionals post today, and the rest do not — which is
   the point: a rail where every ring is lit and every card is badged says
   nothing about who is actually at work. The live tier on the discovery list
   only means something when it is a minority of the market, so the curated
   seeds are one per trade and the other three go about their day. */
const SEED_STATUS = {
  amara: [
    { mins: 38, kind: "photo", work: "am1", note: "Knotless, done this morning" },
    { mins: 214, kind: "note", text: "Two braiding slots left today \u2014 knotless from \u20a618,000." },
  ],
  tunde: [
    { mins: 26, kind: "clip", work: "tu3", note: "Line-up and beard shape" },
    { mins: 168, kind: "photo", work: "tu1", note: "Skin fade" },
  ],
  zainab: [
    { mins: 55, kind: "photo", work: "za1", note: "Gel set, fresh off the table" },
    { mins: 300, kind: "note", text: "Gel sets till 8pm \u2014 walk-ins welcome at the Ikeja studio." },
  ],
  sofia: [
    { mins: 74, kind: "photo", work: "so2", note: "Facial bar" },
    { mins: 250, kind: "clip", work: "so3", note: "Pressure work, shoulders" },
  ],
};

function seedStatusFor(id) {
  const list = SEED_STATUS[id] || [];
  const works = SEED_WORKS[id] || [];
  return list.map(function (s, i) {
    const w = s.work
      ? works.find(function (x) { return x.id === s.work; })
      : null;
    let kind = s.kind;
    let src = "";
    if (w && kind === "clip") src = w.src;
    /* a work photo is stored as a 420px square for the gallery; a status fills
       a phone, so the same photograph is asked for again at portrait size */
    else if (w) src = photoSrc(w.src, 720, 1280);
    else kind = "note";
    const at = Date.now() - (s.mins || 30) * 60000;
    return {
      id: "seed:" + id + ":" + (s.work || i),
      kind: kind,
      src: src,
      text: kind === "note" ? s.text : "",
      bg: catForProvider(id),
      note: s.note || "",
      at: new Date(at).toISOString(),
      expiresAt: new Date(at + STATUS_MS).toISOString(),
      seed: true,
    };
  });
}

/* A status that has aged out is dropped the next time the app opens, so the
   stored record never grows a tail of dead stories. */
function pruneStatuses() {
  let changed = false;
  state.providers.forEach(function (p) {
    if (!Array.isArray(p.status) || !p.status.length) return;
    const keep = p.status.filter(function (s) {
      return s.seed || new Date(s.expiresAt).getTime() > Date.now();
    });
    if (keep.length !== p.status.length) {
      p.status = keep;
      changed = true;
    }
  });
  if (changed) saveDirectory();
}

/* ---------- The rail ----------
   Who is on it, in the order a reader actually wants: their own ring first when
   they are a professional, then whoever has something they have not watched,
   then the freshest, then the nearest. Exactly the stories rail's logic — new
   first, and everything else sorted by how recent it is. */
function storyEntries() {
  const me = myProviderRecord();
  const out = [];
  if (me) out.push({ provider: me, items: statusItems(me), mine: true });
  allProviders().forEach(function (p) {
    if (me && p.id === me.id) return;
    if (p.id === selfKey()) return;
    const items = statusItems(p);
    if (items.length) out.push({ provider: p, items: items, mine: false });
  });
  const others = out.filter(function (e) { return !e.mine; });
  others.sort(function (a, b) {
    const an = statusHasNew(a.provider) ? 0 : 1;
    const bn = statusHasNew(b.provider) ? 0 : 1;
    if (an !== bn) return an - bn;
    const af = new Date(statusNewest(a.provider).at).getTime();
    const bf = new Date(statusNewest(b.provider).at).getTime();
    if (af !== bf) return bf - af;
    return kmToStudio(a.provider) - kmToStudio(b.provider);
  });
  return out.filter(function (e) { return e.mine; }).concat(others);
}

function storyFaceHtml(p) {
  const dp = dpOf(p);
  return '<span class="ringFace">' +
    (dp ? '<img src="' + esc(dp) + '" alt="">' : esc(initials(p.name))) + "</span>";
}

/* One ring: the avatar inside an unbroken gold ring when there is something the
   reader has not watched, a quiet one when they have, and a dashed one for the
   professional's own empty slot. The badge on their own ring posts a new one. */
function storyRingHtml(entry) {
  const p = entry.provider;
  const items = entry.items;
  const fresh = items.length ? statusHasNew(p) : false;
  const state = !items.length ? "none" : fresh ? "new" : "seen";
  const label = entry.mine ? "Your status" : p.name;
  const sub = entry.mine
    ? (items.length ? items.length + " live" : "Add")
    : (items.length ? statusClock(statusNewest(p).at) : "");
  return '<div class="storyRing" role="button" tabindex="0" data-story="' + esc(p.id) + '"' +
      ' aria-label="' + esc(label + (items.length ? ", " + items.length + " to watch" : ", nothing posted yet")) + '">' +
    '<span class="ringArt ' + state + '">' + storyFaceHtml(p) +
      (entry.mine ? '<button class="ringPlus" data-status-open="1" aria-label="Post a status">' + icon("plus") + "</button>" : "") +
      (fresh ? '<span class="ringDot" aria-hidden="true"></span>' : "") +
    "</span>" +
    '<span class="ringName">' + esc(label) + "</span>" +
    '<span class="ringSub">' + esc(sub) + "</span>" +
  "</div>";
}

function renderStories() {
  const strip = $("#storyStrip");
  if (!strip) return;
  bindStripScroll(strip);
  spotAutoWire();
  spotAutoStart();
  const show = storyEntries().filter(function (e) { return e.items.length || e.mine; });
  if (!show.length) {
    strip.innerHTML = emptyState("empty", "Nobody has posted today",
      "When a professional posts a photo, a clip or a line, their ring appears here for 24 hours.");
    return;
  }
  strip.innerHTML = show.map(storyRingHtml).join("");
}

/* ---------- The viewer ----------
   A story is watched one at a time inside one provider's set, and then the rail
   hands over to the next provider with something new — the same contract the
   stories rail has everywhere else. Progress is a real timer, not an animation
   callback: the bars are painted from the same duration the timer runs on, so
   they can never disagree, and a phone that throttles a background tab slows
   both together. */
const story = {
  list: [], p: 0, i: 0, timer: null, hold: 0, started: 0,
  paused: false, elapsed: 0, video: null, clipDur: 0,
};

/* Not every reason to stand still is a pause the reader asked for. A finger
   held on the picture is one reason; a message being typed is another. Each
   reason holds the story, and it carries on only when the last one lets go —
   so lifting a finger in the middle of a sentence never sends the story on to
   the next professional while the client is still writing to this one. */
const storyHolds = {};

function storyHoldOn(why) {
  storyHolds[why] = true;
  storyPause();
}

function storyHoldOff(why) {
  delete storyHolds[why];
  if (!Object.keys(storyHolds).length) storyResume();
}

function storyHoldsClear() {
  Object.keys(storyHolds).forEach(function (k) { delete storyHolds[k]; });
}

function storyPlayable() {
  return storyEntries().filter(function (e) { return e.items.length; });
}

function openStory(providerId, statusId) {
  const me = myProviderRecord();
  /* their own empty ring is not a story to watch: it is the invitation to post */
  if (me && providerId === me.id && !statusItems(me).length) {
    openStatusSheet();
    return;
  }
  const list = storyPlayable();
  if (!list.length) {
    toast("Nothing posted right now");
    return;
  }
  let at = 0;
  if (providerId) {
    const found = list.findIndex(function (e) { return e.provider.id === providerId; });
    at = found === -1 ? 0 : found;
  }
  story.list = list;
  story.p = at;
  story.i = 0;
  /* the bell's status rows name the exact status the news was about */
  if (statusId && list[at]) {
    const item = list[at].items.findIndex(function (x) { return x.id === statusId; });
    if (item !== -1) story.i = item;
  }
  story.paused = false;
  story.elapsed = 0;
  const el = $("#storyView");
  if (!el) return;
  el.classList.remove("paused");
  el.style.display = "flex";
  document.body.classList.add("storyOpen");
  renderStory();
}

function closeStory() {
  storyClear();
  storyHoldsClear();
  if (story.video) {
    try { story.video.pause(); } catch (e) { /* already gone */ }
    story.video = null;
  }
  story.clipDur = 0;
  story.paused = false;
  story.elapsed = 0;
  const el = $("#storyView");
  if (el) {
    el.classList.remove("paused");
    el.style.display = "none";
    el.style.transform = "";
  }
  const stage = $("#storyStage");
  if (stage) stage.innerHTML = "";
  document.body.classList.remove("storyOpen");
  /* what has been watched is now read, so every ring behind the viewer and the
     count on the professional's own card are redrawn */
  renderStories();
  renderWorkStatus();
}

function storyHoldFor(item) {
  if (item.kind === "photo") return STATUS_HOLD_PHOTO;
  if (item.kind === "note") return STATUS_HOLD_NOTE;
  if (!story.clipDur) return STATUS_HOLD_CLIP_FALLBACK;
  return Math.min(STATUS_HOLD_CLIP_MAX, Math.max(3000, Math.round(story.clipDur * 1000) + 800));
}

function storyClear() {
  if (story.timer) {
    clearTimeout(story.timer);
    story.timer = null;
  }
}

/* The bar and the timer are armed together and from the same number. */
function storyArm(ms) {
  storyClear();
  story.hold = ms;
  story.elapsed = 0;
  story.started = Date.now();
  const el = $("#storyView");
  if (el) {
    el.classList.remove("paused");
    const live = el.querySelector(".svBar.live");
    if (live) live.style.setProperty("--hold", ms + "ms");
  }
  story.timer = setTimeout(function () { storyStep(1); }, ms);
}

function storyPause() {
  if (story.paused || !story.timer) return;
  const el = $("#storyView");
  if (!el || el.style.display === "none") return;
  storyClear();
  story.paused = true;
  story.elapsed = Date.now() - story.started;
  el.classList.add("paused");
  if (story.video) {
    try { story.video.pause(); } catch (e) { /* nothing to pause */ }
  }
}

function storyResume() {
  if (!story.paused) return;
  story.paused = false;
  const el = $("#storyView");
  if (el) el.classList.remove("paused");
  if (story.video) {
    const played = story.video.play();
    if (played && played.catch) played.catch(function () { /* autoplay refused */ });
  }
  /* whatever the finger already spent counts: a press-and-hold pauses the bar
     where it stood rather than starting the story again */
  const left = Math.max(600, story.hold - (story.elapsed || 0));
  story.started = Date.now();
  story.elapsed = 0;
  storyClear();
  story.timer = setTimeout(function () { storyStep(1); }, left);
}

function storyStep(delta) {
  const entry = story.list[story.p];
  if (!entry) { closeStory(); return; }
  const next = story.i + delta;
  if (next >= entry.items.length) {
    /* the end of a professional's set is the start of the next one's */
    if (story.p + 1 >= story.list.length) { closeStory(); return; }
    story.p += 1;
    story.i = 0;
    renderStory();
    return;
  }
  if (next < 0) {
    if (story.p === 0) { story.i = 0; renderStory(); return; }
    story.p -= 1;
    story.i = story.list[story.p].items.length - 1;
    renderStory();
    return;
  }
  story.i = next;
  renderStory();
}

function storyStageFill(item) {
  const stage = $("#storyStage");
  if (!stage) return;
  if (story.video) {
    try { story.video.pause(); } catch (e) { /* already gone */ }
    story.video = null;
  }
  story.clipDur = 0;
  if (item.kind === "photo") {
    stage.innerHTML = '<img class="svImg" src="' + esc(item.src) + '" alt="">';
    return;
  }
  if (item.kind === "clip") {
    const yt = youtubeId(item.src);
    if (yt) {
      /* a share link gets a poster, never an eager player: the same rule the
         work viewer follows, and for the same reason */
      stage.innerHTML = '<div class="svYt">' +
        '<img class="svYtThumb" src="https://i.ytimg.com/vi/' + esc(yt) + '/hqdefault.jpg" alt="">' +
        '<button class="svYtPlay" data-ytplay="' + esc(yt) + '">' + icon("play") + " Load the player</button></div>";
      const thumb = stage.querySelector(".svYtThumb");
      if (thumb) thumb.addEventListener("error", function () { thumb.remove(); });
      return;
    }
    if (videoLooksPlayable(item.src)) {
      stage.innerHTML = '<video class="svVideo" src="' + esc(item.src) + '" playsinline muted preload="metadata"></video>';
      const v = stage.querySelector("video");
      if (!v) return;
      story.video = v;
      v.addEventListener("loadedmetadata", function () {
        story.clipDur = v.duration || 0;
        /* the set is re-armed for the real length of the clip, but only while
           this is still the story on screen */
        if (story.video === v && !story.paused) storyArm(storyHoldFor(item));
      });
      v.addEventListener("ended", function () {
        if (story.video === v) storyStep(1);
      });
      const played = v.play();
      if (played && played.catch) played.catch(function () { /* muted autoplay refused: the bar still runs */ });
      return;
    }
    stage.innerHTML = '<a class="wvLink" href="' + esc(item.src) + '" target="_blank" rel="noopener noreferrer">' +
      icon("play") + " Open this clip</a>";
    return;
  }
  /* a line of text, over the professional's own trade artwork */
  const bg = item.bg || catForProvider(item.provider || "");
  stage.innerHTML = '<div class="svNote">' + scene(bg, "still") +
    "<p>" + esc(item.text) + "</p></div>";
}

function renderStory() {
  const entry = story.list[story.p];
  if (!entry) { closeStory(); return; }
  const item = entry.items[story.i];
  if (!item) { closeStory(); return; }
  const p = entry.provider;

  const bars = $("#svBars");
  if (bars) {
    bars.innerHTML = entry.items.map(function (_, i) {
      return '<span class="svBar' + (i < story.i ? " done" : i === story.i ? " live" : "") + '"><i></i></span>';
    }).join("");
  }
  const face = $("#svFace");
  if (face) face.innerHTML = storyFaceHtml(p);
  const name = $("#svName");
  if (name) {
    name.innerHTML = esc(entry.mine ? "Your status" : p.name) +
      (entry.mine ? '<span class="svYou">You</span>' : "");
  }
  const when = $("#svWhen");
  if (when) {
    when.textContent = statusClock(item.at) + " \u00b7 " + statusLeftText(item) +
      " \u00b7 " + (story.i + 1) + " of " + entry.items.length +
      (entry.mine ? "" : " \u00b7 " + esc(providerSkill(p)));
  }

  storyStageFill(Object.assign({}, item, { provider: p.id }));

  const foot = $("#svFoot");
  if (foot) {
    const caption = item.kind === "note" ? "" : (item.note || "");
    const mine = statusReactionOf(item.id);
    /* The exchange, quoted where the next sentence is written: the owner reads
       the newest client message, a client reads the professional's newest
       answer. One line — the bell is where the list of them lives. */
    const lastWord = statusLastWord(item.id, !!entry.mine);
    const said = lastWord
      ? '<p class="svLast"><b>' + esc(lastWord.by) + "</b>" + esc(shortText(lastWord.text, 84)) + "</p>"
      : "";
    foot.innerHTML =
      (caption ? '<p class="svCaption">' + esc(caption) + "</p>" : "") +
      said +
      (entry.mine
        ? '<div class="svActs">' +
            '<button class="svAct" data-status-open="1">' + icon("plus") + " Post another</button>" +
            '<button class="svAct danger" data-status-del="' + esc(item.id) + '">' + icon("trash") + " Delete this</button>" +
          "</div>"
        : '<div class="svReact">' +
            STATUS_EMOJI.map(function (e) {
              return '<button class="svEmoji' + (mine && mine.emoji === e ? " on" : "") +
                '" data-react="' + e + '" aria-label="React ' + e + '">' + e + "</button>";
            }).join("") +
            '<span class="svMsgWrap">' +
              '<input id="svMsg" type="text" maxlength="' + STATUS_MSG_MAX + '" placeholder="Say something\u2026" autocomplete="off">' +
              '<button class="svMsgGo" data-svmsg="' + esc(item.id) + '" aria-label="Send">' + icon("send") + "</button>" +
            "</span>" +
          "</div>" +
          '<div class="svActs">' +
            '<button class="svAct" data-svprofile="' + esc(p.id) + '">' + icon("user") + " Profile</button>" +
            (providerInSession(p)
              ? '<span class="svAct off">' + icon("clock") + " In session</span>"
              : providerAvailable(p)
                ? '<button class="svAct primary" data-svbook="' + esc(p.id) + '">' + icon("calendar") + " Book</button>"
                : '<span class="svAct off">' + icon("clock") + " Not taking bookings</span>") +
          "</div>");
  }

  markStatusSeen(item.id);
  /* a client's watch is the professional's insight: counted once per account,
     never for the owner previewing their own */
  if (!entry.mine) statusRecordView(item.id);
  storyArm(storyHoldFor(item));
}

/* The story on screen right now — the reaction and message actions read it
   from here so they never need their own copy of the position. */
function storyCurrentItem() {
  const entry = story.list[story.p];
  return entry ? entry.items[story.i] : null;
}

function statusReactTap(emoji) {
  const item = storyCurrentItem();
  if (!item) return;
  const res = reactToStatus(item.id, emoji);
  if (!res.ok) {
    toast("Already sent " + emoji);
    return;
  }
  /* in place, so the message being typed survives the tap */
  $$("#svFoot .svEmoji").forEach(function (b) {
    b.classList.toggle("on", b.getAttribute("data-react") === emoji);
  });
  const entry = story.list[story.p];
  toast(emoji + " sent to " + (entry ? entry.provider.name : "them"));
}

function statusSendTap() {
  const item = storyCurrentItem();
  const inp = $("#svMsg");
  if (!item) return;
  const res = sendStatusMessage(item.id, inp ? inp.value : "");
  if (!res.ok) {
    toast(res.msg);
    return;
  }
  if (inp) { inp.value = ""; inp.blur(); }
  const entry = story.list[story.p];
  toast("Sent \u2014 " + (entry ? entry.provider.name : "they") + " will see it in the bell");
}

/* ---------- The composer ----------
   One sheet, three kinds. The draft survives a re-render (changing kind, or
   picking a picture) because it lives outside the DOM, which is the same trick
   the portfolio sheet uses. */
const statusDraft = { kind: "photo", src: "", note: "", bg: "", workPick: false };

function openStatusSheet() {
  const me = myProviderRecord();
  if (!me) {
    toast("Only a professional account can post a status");
    return;
  }
  const hasPhoto = worksOf(me).some(function (w) { return !isVideoWork(w); });
  statusDraft.kind = hasPhoto ? "photo" : "note";
  statusDraft.src = "";
  statusDraft.note = "";
  statusDraft.bg = catForProvider(me.id);
  statusDraft.workPick = false;
  renderStatusSheet();
  showSheetEl("#statusSheet");
}

function statusPickable(me) {
  return STATUS_KINDS.map(function (k) {
    const on = statusDraft.kind === k.id;
    return '<button class="chip' + (on ? " active" : "") + '" data-status-kind="' + k.id + '">' +
      icon(k.ico) + esc(k.name) + "</button>";
  }).join("");
}

/* A work photo is stored at gallery size; when it is reused as a status the
   same photograph is asked for again at the size a phone fills. */
function statusSrcFromWork(src) {
  const m = String(src || "").match(/images\.unsplash\.com\/(photo-[\w-]+)/);
  return m ? photoSrc(m[1], 720, 1280) : src;
}

function statusThumbHtml(s, p) {
  if (s.kind === "photo") {
    return '<span class="statusThumb"><img src="' + esc(s.src) + '" alt="" loading="lazy"></span>';
  }
  if (s.kind === "clip") {
    const yt = youtubeId(s.src);
    return '<span class="statusThumb vid">' +
      (yt ? '<img src="https://i.ytimg.com/vi/' + esc(yt) + '/hqdefault.jpg" alt="" loading="lazy">' : icon("play")) +
      "</span>";
  }
  /* The words are the whole tile, and nothing decorates them: a 74px tile also
     carries a views badge in one top corner and a delete button in the other,
     and a quote glyph above the caption was the one thing too many — it sat
     under the badge and pushed the last line into the "23h left" band. The
     gold wash behind the words says "note" without spending a line on it. */
  return '<span class="statusThumb note">' +
    '<b>' + esc(String(s.text || "").slice(0, 42)) + "</b></span>";
}

function renderStatusSheet() {
  const body = $("#statusBody");
  const me = myProviderRecord();
  if (!body || !me) return;
  const live = statusItems(me);
  const kind = statusDraft.kind;

  const sub = $("#statusSub");
  if (sub) {
    sub.textContent = live.length
      ? live.length + " of " + STATUS_MAX + " live \u00b7 each lasts " + STATUS_HOURS + " hours"
      : "Shows on the spotlight rail for " + STATUS_HOURS + " hours";
  }

  const liveBlock = live.length
    ? '<div class="sheetBlock"><label>Live now</label><div class="statusTiles">' +
        live.map(function (s) {
          return '<div class="statusTile">' + statusThumbHtml(s, me) +
            '<span class="statusTileWhen">' + esc(statusLeftText(s)) + "</span>" +
            '<button class="folioX" data-status-del="' + esc(s.id) + '" aria-label="Delete this status">' +
              icon("close") + "</button></div>";
        }).join("") + "</div>" +
      '<p class="finePrint">Clients browsing today see these as rings on the spotlight rail. Deleting one takes it off every device that has not looked yet.</p></div>'
    : '<div class="sheetBlock"><label>Nothing live</label>' +
      '<p class="finePrint">Post a photo of work finished today, a short clip, or a line about your day. It shows on the rail for ' +
      STATUS_HOURS + " hours and then goes by itself.</p></div>";

  let picker = "";
  if (kind === "photo") {
    const fromWork = worksOf(me).filter(function (w) { return !isVideoWork(w); });
    picker = '<div class="sheetBlock"><label>Photo</label>' +
      (statusDraft.src
        ? '<div class="statusPreviewBig"><img src="' + esc(statusDraft.src) + '" alt=""></div>'
        : '<p class="finePrint">A finished job photographs best upright, in daylight.</p>') +
      '<div class="rowBtns">' +
        '<button class="nextbtn tight" id="statusPickPhoto">' +
          icon("camera") + (statusDraft.src ? " Change photo" : " Choose a photo") + "</button>" +
        (fromWork.length
          ? '<button class="nextbtn tight ghost" id="statusPickWork">Use a work photo</button>'
          : "") +
      "</div>" +
      (statusDraft.workPick && fromWork.length
        ? '<div class="statusWorkGrid">' + fromWork.slice(0, WORK_LIMIT).map(function (w) {
            return '<button class="statusWorkTile" data-status-usework="' + esc(w.id) + '">' +
              '<img src="' + esc(w.src) + '" alt="" loading="lazy"></button>';
          }).join("") + "</div>"
        : "") +
      "</div>";
  } else if (kind === "clip") {
    picker = '<div class="sheetBlock"><label>Clip</label>' +
      (statusDraft.src
        ? '<div class="statusPreviewBig"><video src="' + esc(statusDraft.src) + '" playsinline muted preload="metadata"></video></div>'
        : '<p class="finePrint">A short clip from this device (up to ' + VIDEO_MAX_MB +
          " MB \u2014 longer is better as a link), or paste a link below.</p>") +
      '<div class="rowBtns"><button class="nextbtn tight" id="statusPickClip">' +
        icon("play") + (statusDraft.src ? " Change clip" : " Choose a clip") + "</button></div>" +
      '<div class="addrField">' + icon("play") +
        '<input id="statusLink" type="url" maxlength="300" placeholder="Or paste a video link (mp4, YouTube\u2026)">' +
        '<button class="fieldGo" data-status-addlink="1" aria-label="Use this link">' + icon("plus") + "</button>" +
      "</div></div>";
  } else {
    picker = '<div class="sheetBlock"><label>Your line</label>' +
      '<textarea class="bioInput" id="statusText" maxlength="120" rows="3" ' +
        'placeholder="e.g. Two slots left today \u2014 knotless from \u20a618,000.">' + esc(statusDraft.note) + "</textarea>" +
      '<div class="chipRow">' + TRADES.map(function (t) {
        return '<button class="chip' + (statusDraft.bg === t.id ? " active" : "") + '" data-status-bg="' + t.id + '">' +
          icon(t.ico) + esc(t.name) + "</button>";
      }).join("") + "</div>" +
      '<p class="finePrint">The drawing behind your words.</p></div>';
  }

  const caption = kind === "note" ? "" :
    '<div class="sheetBlock"><label>Caption (optional)</label>' +
      '<input class="rateIn wide" type="text" id="statusNote" maxlength="80" ' +
        'value="' + esc(statusDraft.note) + '" placeholder="e.g. Knotless, done this morning"></div>';

  body.innerHTML = liveBlock + '<div class="sheetBlock"><label>Post</label>' +
    '<div class="chipRow">' + statusPickable(me) + "</div></div>" +
    picker + caption +
    '<p class="finePrint">Live for ' + STATUS_HOURS + " hours \u00b7 up to " + STATUS_MAX +
      " at a time \u00b7 photos are shrunk to " + STATUS_PHOTO_MAX + "px before they are saved.</p>";

  const post = $("#statusPost");
  if (post) {
    const ready = statusDraftReady();
    post.disabled = !ready;
    post.textContent = "Post status";
  }
}

function statusDraftReady() {
  if (statusDraft.kind === "note") return !!String(statusDraft.note || "").trim();
  return !!statusDraft.src;
}

function statusSetKind(kind) {
  statusDraft.kind = kind;
  if (kind === "clip" && statusDraft.src && !videoLooksPlayable(statusDraft.src) && !youtubeId(statusDraft.src)) statusDraft.src = "";
  if (kind === "photo" && statusDraft.src && /^data:video/.test(statusDraft.src)) statusDraft.src = "";
  renderStatusSheet();
}

function statusSetBg(bg) {
  statusDraft.bg = bg;
  renderStatusSheet();
  const box = $("#statusText");
  if (box) box.focus();
}

function statusAddPhoto(file) {
  const me = myProviderRecord();
  if (!me || !file) return;
  const btn = $("#statusPickPhoto");
  work(btn, shrinkImage(file, STATUS_PHOTO_MAX, STATUS_PHOTO_Q))
    .then(function (url) {
      statusDraft.kind = "photo";
      statusDraft.src = url;
      renderStatusSheet();
      toast("Photo ready \u2014 add a caption and post it");
    })
    .catch(function () { toast("Could not read that image"); });
}

function statusAddClip(file) {
  const me = myProviderRecord();
  if (!me || !file) return;
  if (!/^video\//i.test(file.type || "")) { toast("That file is not a video"); return; }
  if (file.size > VIDEO_MAX_BYTES) {
    toast("That clip is " + fileSizeText(file.size) + " \u2014 over the " + VIDEO_MAX_MB +
      " MB a status can hold. Paste a link instead.");
    return;
  }
  const reader = new FileReader();
  const btn = $("#statusPickClip");
  setBusy(btn, true);
  beginWork();
  reader.onerror = function () {
    setBusy(btn, false);
    endWork();
    toast("Could not read that clip");
  };
  reader.onload = function () {
    setBusy(btn, false);
    endWork();
    statusDraft.kind = "clip";
    statusDraft.src = String(reader.result || "");
    renderStatusSheet();
    toast("Clip ready \u2014 post it");
  };
  reader.readAsDataURL(file);
}

function statusUseWork(workId) {
  const me = myProviderRecord();
  const w = worksOf(me).find(function (x) { return x.id === workId; });
  if (!w) return;
  statusDraft.kind = isVideoWork(w) ? "clip" : "photo";
  statusDraft.src = isVideoWork(w) ? w.src : statusSrcFromWork(w.src);
  statusDraft.note = statusDraft.note || (w.note || "");
  statusDraft.workPick = false;
  renderStatusSheet();
}

function statusUseLink() {
  const input = $("#statusLink");
  const url = input ? input.value.trim() : "";
  if (!/^https?:\/\//i.test(url)) {
    toast("Paste a full link, starting with https://");
    return;
  }
  statusDraft.kind = "clip";
  statusDraft.src = url;
  renderStatusSheet();
  toast(youtubeId(url) ? "YouTube clip ready \u2014 post it" : "Clip ready \u2014 post it");
}

function publishStatus() {
  const me = myProviderRecord();
  if (!me) {
    toast("Only a professional account can post a status");
    return;
  }
  if (!statusDraftReady()) {
    toast(statusDraft.kind === "note" ? "Write your line first" : "Pick something to post first");
    return;
  }
  if (statusItems(me).length >= STATUS_MAX) {
    toast("That is " + STATUS_MAX + " live at once \u2014 delete one first");
    return;
  }
  const now = Date.now();
  const entry = {
    id: "s" + now,
    kind: statusDraft.kind,
    src: statusDraft.kind === "note" ? "" : statusDraft.src,
    text: statusDraft.kind === "note" ? String(statusDraft.note || "").trim().slice(0, 120) : "",
    note: statusDraft.kind === "note" ? "" : String(statusDraft.note || "").trim().slice(0, 80),
    bg: statusDraft.bg || catForProvider(me.id),
    at: new Date(now).toISOString(),
    expiresAt: new Date(now + STATUS_MS).toISOString(),
  };
  const before = Array.isArray(me.status) ? me.status.slice() : [];
  me.status = before.concat([entry]);
  if (!saveDirectory()) {
    me.status = before;
    toast("This device could not save that \u2014 try a smaller photo");
    return;
  }
  statusDraft.src = "";
  statusDraft.note = "";
  statusDraft.workPick = false;
  hideSheetEl("#statusSheet");
  renderStories();
  renderWorkStatus();
  toast("Posted \u2014 live for " + STATUS_HOURS + " hours");
}

function deleteStatus(id) {
  const me = myProviderRecord();
  if (!me || !id) return;
  const before = Array.isArray(me.status) ? me.status.slice() : [];
  me.status = before.filter(function (s) { return s.id !== id; });
  if (!saveDirectory()) {
    me.status = before;
    toast("Could not delete that just now");
    return;
  }
  const viewer = $("#storyView");
  if (viewer && viewer.style.display === "flex") closeStory();
  renderStatusSheet();
  renderWorkStatus();
  renderStories();
  toast("Status deleted");
}

/* ---------- The professional's own card ----------
   What they are showing today, from the dashboard, with the one control that
   matters: post another, or take one down. */
function renderWorkStatus() {
  const wrap = $("#workStatus");
  if (!wrap) return;
  const me = myProviderRecord();
  if (!me) {
    wrap.innerHTML = "";
    return;
  }
  const live = statusItems(me);
  /* what today's statuses did: unique viewers per status, and the messages
     clients left — both read from the same store the rail writes to. The count
     is of what clients said, not of everything in the thread: a professional's
     own replies are not news to them, and counting them made the line claim
     two messages when one had arrived. */
  const mineKey = meStatusId();
  const totalViews = live.reduce(function (n, s) { return n + statusViewCount(s.id); }, 0);
  const totalMsgs = live.reduce(function (n, s) {
    return n + (statusThreadRead(s.id).messages || []).filter(function (m) { return m.byId !== mineKey; }).length;
  }, 0);
  const totalReacts = live.reduce(function (n, s) { return n + statusThreadRead(s.id).reactions.length; }, 0);
  const row = live.length
    ? '<div class="statusTiles">' + live.map(function (s) {
        const views = statusViewCount(s.id);
        return '<div class="statusTile" data-story="' + esc(me.id) + '" role="button" tabindex="0"' +
            ' aria-label="Watch your status">' +
          statusThumbHtml(s, me) +
          (views ? '<span class="tileViews" title="' + views + ' view' + (views === 1 ? "" : "s") + ' on this status">' + icon("eye") + views + "</span>" : "") +
          '<span class="statusTileWhen">' + esc(statusLeftText(s)) + "</span>" +
          '<button class="folioX" data-status-del="' + esc(s.id) + '" aria-label="Delete this status">' +
            icon("close") + "</button></div>";
      }).join("") + "</div>"
    : "";
  const insight = live.length
    ? (totalViews || totalMsgs || totalReacts
      ? live.length + " live \u00b7 " + totalViews + " view" + (totalViews === 1 ? "" : "s") +
        " \u00b7 " + totalReacts + " reaction" + (totalReacts === 1 ? "" : "s") +
        " \u00b7 " + totalMsgs + " message" + (totalMsgs === 1 ? "" : "s") +
        " \u2014 all of it lands in your bell."
      : live.length + " live on the spotlight rail. Reactions, messages and views land in your bell as clients watch.")
    : "";
  wrap.innerHTML =
    '<div class="card statusCard">' +
      '<div class="provCardHead">' + icon("sparkle") + "<h4>Today's status</h4>" +
        '<button class="linkBtn" data-status-open="1">' + (live.length ? "Manage" : "Post") + "</button></div>" +
      row +
      '<p class="finePrint">' + (live.length
        ? insight + " A status lasts " + STATUS_HOURS + " hours and then goes by itself \u2014 tap one to see what clients see."
        : "Post a photo, a short clip or a line about today. It shows on the spotlight rail for " +
          STATUS_HOURS + " hours, then disappears on its own.") + "</p>" +
      '<div class="provCtas"><button class="ghostBtn wide" data-status-open="1">' +
        icon("camera") + (live.length ? " Post another" : " Post a status") + "</button></div>" +
    "</div>";
}
