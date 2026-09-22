/* =========================================================
 * Pampa — social — likes, comments and identity
 * Who liked what and who said what, kept per clip and per account.
 * ========================================================= */

/* ---------- Clips: likes and comments ---------- */
/* What other people think of a clip, kept on this device. A clip is addressed
   by provider + work id, so the same clip carries the same counts wherever it
   is shown: the rail, the gallery tile and the owner's own portfolio. */
const SOCIAL_KEY = "pampa.social.v1";
let social = { likes: {}, comments: {} };

function loadSocial() {
  try {
    const raw = localStorage.getItem(SOCIAL_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && typeof d === "object") {
        social.likes = d.likes || {};
        social.comments = d.comments || {};
      }
    }
  } catch (e) {
    console.warn("Pampa: likes unreadable", e);
  }
  /* Normalise on the way in, once, so every later reader sees one shape:
     a like is { by, name, at }, a comment is { id, by, byId, at, text, replies }.
     Likes and comments written by older builds carry no moment and no id; they
     keep their place in the count and get a synthesised id so a provider can
     still reply to them. */
  Object.keys(social.likes).forEach(function (id) {
    const list = social.likes[id];
    if (!Array.isArray(list)) { delete social.likes[id]; return; }
    social.likes[id] = list.map(function (e) {
      return typeof e === "string" ? { by: e, name: "", at: "" } : e;
    });
  });
  Object.keys(social.comments).forEach(function (id) {
    const list = social.comments[id];
    if (!Array.isArray(list)) { delete social.comments[id]; return; }
    social.comments[id] = list.map(function (c) {
      c.replies = Array.isArray(c.replies) ? c.replies : [];
      if (!c.id) c.id = "c" + String(c.at || "").replace(/\D/g, "").slice(-9) + (c.by || "x");
      return c;
    });
  });
}

function saveSocial() {
  try {
    localStorage.setItem(SOCIAL_KEY, JSON.stringify(social));
    return true;
  } catch (e) {
    console.warn("Pampa: likes not saved", e);
    return false;
  }
}

function clipIdFor(providerId, workId) {
  return providerId + ":" + workId;
}

/* Who a like belongs to. Signed out, the device itself is the identity — the
   alternative is a heart that cannot be un-pressed. */
function viewerId() {
  return (state.user && state.user.phone) || "this-device";
}

/* A clip's public count is its provider's standing blended with the likes given
   on this device, the same baseline-plus-local shape the ratings use: a fresh
   install has nobody else's taps in it, and a count of zero under every clip
   would read as a broken page rather than an honest one. */
function baselineLikes(p, id) {
  const st = ratingStats(p) || {};
  const rating = st.avg || p.rating || 0;
  const jobs = Math.max(p.jobs || 0, st.reviews || 0);
  const standing = (jobs * 3 + rating * 14) / 2;
  /* The clip's own id feeds the spread, so two clips by one person do not read
     as an identical count on every load. A professional with no history has no
     baseline: their clip starts at the likes it has actually been given. */
  const seed = String(id || p.id || "").split("").reduce(function (a, c) { return a + c.charCodeAt(0) * 7; }, 0);
  return Math.round(standing * (0.85 + (seed % 31) / 100));
}

function clipLikes(id) {
  return likeEntries(id).length;
}

/* Who liked a clip, one record per tap, newest last. */
function likeEntries(id) {
  const raw = social.likes[id];
  if (!Array.isArray(raw)) return [];
  return raw.map(function (e) {
    return typeof e === "string" ? { by: e, name: "", at: "" } : e;
  });
}

function clipLikeTotal(clip) {
  return baselineLikes(clip.provider, clip.id) + clipLikes(clip.id);
}

function hasLiked(id) {
  return likeEntries(id).some(function (e) { return e.by === viewerId(); });
}

function toggleLike(id) {
  const list = likeEntries(id).slice();
  const i = list.findIndex(function (e) { return e.by === viewerId(); });
  const liked = i === -1;
  if (liked) list.push({ by: viewerId(), name: viewerName(), at: new Date().toISOString() });
  else list.splice(i, 1);
  social.likes[id] = list;
  saveSocial();
  return liked;
}

function commentsFor(id) {
  return social.comments[id] || [];
}

/* A comment plus its replies: what the number under a clip counts. */
function commentCount(id) {
  return commentsFor(id).reduce(function (n, c) { return n + 1 + (c.replies || []).length; }, 0);
}

/* A reply is addressed to the author of the comment, not to whoever happens to
   be looking at it, so an author is always written down with the words. */
function commentAuthor() {
  return {
    by: (state.user || {}).name || "Guest",
    byId: viewerId(),
    at: new Date().toISOString(),
  };
}

function freshCommentId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* Returns the entry that was written (truthy) or null. With a parentId the
   text lands as a reply under that comment, which is how a provider answers. */
function addComment(id, text, parentId) {
  const clean = String(text || "").trim().slice(0, 240);
  if (!clean) return null;
  const entry = commentAuthor();
  entry.text = clean;
  /* the conversation is a two-way turn: the owner answers a client's comment,
     the client answers the owner's latest reply. A client cannot open a reply
     themselves (that is what the comment box is for) and nobody answers a
     reply from their own side, so a thread can never become an argument
     between strangers. */
  const mine = isMyClip(id);
  const list = commentsFor(id).slice();
  if (parentId) {
    if (!mine) {
      const pre = list.find(function (c) { return c.id === parentId; });
      const reps = ((pre || {}).replies || []);
      const lastId = reps.length ? (reps[reps.length - 1].id || "") : "";
      /* the thread must be waiting on the client: the professional said the
         last word (reply ids start with "r") */
      if (String(lastId).charAt(0) !== "r") return null;
    }
    const at = list.findIndex(function (c) { return c.id === parentId; });
    if (at === -1) return null;
    const target = Object.assign({}, list[at]);
    entry.id = freshCommentId(mine ? "r" : "u");
    target.replies = (target.replies || []).concat([entry]);
    list[at] = target;
  } else {
    /* top-level comments are open to everyone — what is gated is answering
       inside a thread */
    entry.id = freshCommentId("c");
    entry.replies = [];
    list.push(entry);
  }
  social.comments[id] = list;
  if (!saveSocial()) return null;
  return entry;
}

/* What a name is called when it is quoted back: the name they gave, the record
   they signed up under, or just "someone" for a tap made while signed out. */
function viewerName() {
  return (state.user || {}).name || "Someone";
}

function nameOf(by, name) {
  return name || (by === "this-device" ? "Someone" : String(by || "Someone").split("@")[0]);
}

