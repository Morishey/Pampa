/* =========================================================
 * Pampa — clips — the rail and the conversation under it
 * The full-screen vertical rail, and the comments sheet where a thread can run two ways.
 * ========================================================= */

/* ---------- Clips: the vertical rail ---------- */
/* Every clip on the device, from every professional who has one, watched the
   way a feed is watched: a full screen at a time, moving by itself, with the
   person who made it one tap away. */
let clipFeedState = { scope: "foryou", items: [], index: 0, muted: true, observer: null, lastTap: 0, tapTimer: 0 };

function clipItems(scope) {
  const out = [];
  allProviders().forEach(function (p) {
    worksOf(p).forEach(function (w) {
      if (!isVideoWork(w)) return;
      out.push({ id: clipIdFor(p.id, w.id), provider: p, work: w });
    });
  });
  const near = scope === "near";
  return out
    .filter(function (c) { return !near || coversClient(c.provider); })
    .sort(function (a, b) { return clipScore(b) - clipScore(a); });
}

/* The order, and the only claim it makes: professionals who can come to you
   lead, then the ones nearest your area, and among equals the clips more people
   have liked. It is a rule you can read, not a black box. */
function clipScore(clip) {
  const km = kmToStudio(clip.provider);
  const reach = coversClient(clip.provider) ? 45 : 0;
  const close = km == null ? 0 : Math.max(0, 45 - km * 2.2);
  return reach + close + Math.min(clipLikeTotal(clip), 60) * 0.5;
}

function clipSlideHtml(clip, i) {
  const p = clip.provider;
  const km = kmToStudio(p);
  const yt = youtubeId(clip.work.src);
  const playable = videoLooksPlayable(clip.work.src);
  /* the caption uses the same label as the discovery card, so the rail and the
     strip never describe the same person differently */
  const note = clip.work.note ||
    (clip.work.name
      ? providerSkill(p) + " · " + String(clip.work.name).replace(/\.[a-z0-9]{2,4}$/i, "")
      : "Clip from " + p.name);
  let stage;
  if (playable) {
    stage = '<video class="clipVideo" muted loop playsinline preload="none" data-clipsrc="' + esc(clip.work.src) + '"></video>' +
      '<span class="clipSpinner" aria-hidden="true"></span>';
  } else if (yt) {
    stage = '<div class="clipPoster"><img src="https://i.ytimg.com/vi/' + esc(yt) + '/hqdefault.jpg" alt="">' +
      '<button class="wvYtPlay" data-ytplay="' + esc(yt) + '">' + icon("play") + "Load the player</button></div>";
  } else {
    stage = '<div class="clipPoster clipPosterArt">' + scene((p.cats || ["barb"])[0], "still") +
      '<a class="wvLink" href="' + esc(clip.work.src) + '" target="_blank" rel="noopener noreferrer">' +
      icon("play") + "Open this clip</a></div>";
  }
  return '<article class="clipSlide" data-clip="' + esc(clip.id) + '" data-clipindex="' + i + '">' +
    '<div class="clipStage" data-cliptap>' + stage + "</div>" +
    '<div class="clipScrim"></div>' +
    '<div class="clipMeta">' +
      '<button class="clipWho" data-goto-pro="' + esc(p.id) + '">' + avatarHtml(p, "small") +
        '<span class="clipWhoText"><b>' + esc(p.name) + '</b><small>' + esc(providerSkill(p)) +
        (km == null ? "" : " · " + esc(fmtKm(km))) + "</small></span></button>" +
      '<p class="clipNote">' + esc(note) + "</p>" +
    "</div>" +
    '<div class="clipRail">' +
      '<button class="clipAct like' + (hasLiked(clip.id) ? " on" : "") + '" data-cliplike="' + esc(clip.id) + '" aria-label="Like">' +
        icon("heart") + '<b data-raillikes="' + esc(clip.id) + '">' + clipLikeTotal(clip) + "</b></button>" +
      '<button class="clipAct" data-clipcomments="' + esc(clip.id) + '" aria-label="Comments">' +
        icon("chat") + '<b data-railcomments="' + esc(clip.id) + '">' + commentCount(clip.id) + "</b></button>" +
      '<button class="clipAct" data-goto-pro="' + esc(p.id) + '" aria-label="Open profile"><span data-icon="userRing"></span></button>' +
      '<button class="clipAct" id="clipSound" aria-label="Sound">' + icon(clipFeedState.muted ? "soundOff" : "sound") + "</button>" +
    "</div>" +
    '<p class="clipHint">Tap to pause · double-tap to like · scroll for the next</p>' +
  "</article>";
}

function openClipFeed(opts) {
  const el = $("#clipFeed");
  if (!el) return;
  const o = opts || {};
  if (o.scope) clipFeedState.scope = o.scope;
  clipFeedState.items = clipItems(clipFeedState.scope);
  clipFeedState.index = 0;
  if (o.clipId) {
    const at = clipFeedState.items.findIndex(function (c) { return c.id === o.clipId; });
    if (at === -1) {
      /* a clip outside the current scope (a studio-only pro, say) is still
         watchable: the whole rail is loaded and the scope follows the clip */
      clipFeedState.scope = "foryou";
      clipFeedState.items = clipItems("foryou");
      const at2 = clipFeedState.items.findIndex(function (c) { return c.id === o.clipId; });
      clipFeedState.index = at2 === -1 ? 0 : at2;
    } else {
      clipFeedState.index = at;
    }
  }
  el.style.display = "flex";
  renderClipFeed();
  document.body.classList.add("clipsOpen");
}

function renderClipFeed() {
  const scroller = $("#clipScroller");
  if (!scroller) return;
  const items = clipFeedState.items;
  $$(".clipTab").forEach(function (t) {
    t.classList.toggle("active", t.dataset.clipscope === clipFeedState.scope);
  });
  if (!items.length) {
    scroller.innerHTML = '<div class="clipEmpty">' +
      emptyState("search", "No clips to watch yet",
        clipFeedState.scope === "near"
          ? "Nobody who covers your area has posted a clip yet — try For you."
          : "When a professional adds a video to their work it plays here. Add one to your own page from Work → My work.") +
      "</div>";
    return;
  }
  scroller.innerHTML = items.map(clipSlideHtml).join("");
  hydrateIcons(scroller);
  /* start where we were asked to, without an animated scroll on open */
  const start = items[clipFeedState.index] ? clipFeedState.index : 0;
  scroller.scrollTop = start * scroller.clientHeight;
  observeClipSlides();
}

/* Only the clip on screen loads and plays; the ones either side are warm. No
   autoplay until the rail is on screen, and a refused play() is not an error —
   it means this browser wants a tap, which the stage already offers. */
function observeClipSlides() {
  const scroller = $("#clipScroller");
  if (!scroller) return;
  if (clipFeedState.observer) clipFeedState.observer.disconnect();
  if (!window.IntersectionObserver) {
    clipPlayIndex(0);
    return;
  }
  const heights = {};
  const obs = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      const slide = e.target;
      const idx = Number(slide.dataset.clipindex) || 0;
      const video = slide.querySelector(".clipVideo");
      if (e.isIntersecting && e.intersectionRatio > 0.6) {
        heights[idx] = true;
        clipFeedState.index = idx;
        clipPlayIndex(idx);
      } else if (video) {
        video.pause();
      }
    });
  }, { root: scroller, threshold: [0.6, 0.9] });
  $$(".clipSlide").forEach(function (s) { obs.observe(s); });
  clipFeedState.observer = obs;
}

/* Loads the clip that just arrived on screen, and pauses the one that left. */
function clipPlayIndex(idx) {
  $$(".clipSlide").forEach(function (slide) {
    const i = Number(slide.dataset.clipindex) || 0;
    const video = slide.querySelector(".clipVideo");
    if (!video) return;
    if (i === idx) {
      if (!video.getAttribute("src")) video.setAttribute("src", video.dataset.clipsrc || "");
      video.muted = clipFeedState.muted;
      bindClipVideoFallback(video, slide);
      const attempt = video.play();
      if (attempt && attempt.catch) {
        attempt.catch(function () {
          slide.classList.add("paused");
        });
      }
    } else if (!video.paused) {
      video.pause();
    }
  });
}

/* A clip that cannot play — a dead link, or a device with no network — says so
   in its own slide instead of sitting there black. */
function bindClipVideoFallback(video, slide) {
  if (!video || video.__fallbackBound) return;
  video.__fallbackBound = true;
  video.addEventListener("error", function () {
    const stage = slide.querySelector(".clipStage");
    if (!stage) return;
    stage.innerHTML = '<div class="clipPoster clipPosterArt">' +
      scene("barb", "still") +
      '<p class="clipDead">This clip will not play here — check your connection.</p></div>';
  });
}

function closeClipFeed() {
  const el = $("#clipFeed");
  if (!el) return;
  $$("#clipScroller .clipVideo").forEach(function (v) {
    v.pause();
    /* release the data: a rail of clips should not hold memory it is not using */
    v.removeAttribute("src");
    v.load();
  });
  if (clipFeedState.observer) clipFeedState.observer.disconnect();
  clipFeedState.observer = null;
  el.style.display = "none";
  document.body.classList.remove("clipsOpen");
  /* counts may have moved while the rail was open */
  refreshClipCounts();
}

function toggleClipSound(btn) {
  clipFeedState.muted = !clipFeedState.muted;
  $$("#clipScroller .clipVideo").forEach(function (v) { v.muted = clipFeedState.muted; });
  $$("#clipScroller #clipSound").forEach(function (b) {
    b.innerHTML = icon(clipFeedState.muted ? "soundOff" : "sound");
    hydrateIcons(b);
  });
  if (btn) hydrateIcons(btn);
  toast(clipFeedState.muted ? "Muted" : "Sound on");
}

/* Tap pauses, double-tap likes: the second tap wins over the first, exactly as
   it does in the app this is modelled on. */
function clipStageTap(slide) {
  const now = Date.now();
  if (now - clipFeedState.lastTap < 280) {
    clipFeedState.lastTap = 0;
    clearTimeout(clipFeedState.tapTimer);
    slide.classList.remove("paused");
    const likeBtn = slide.querySelector("[data-cliplike]");
    if (likeBtn && !likeBtn.classList.contains("on")) likeBtn.click();
    burstHeart(slide);
    return;
  }
  clipFeedState.lastTap = now;
  clipFeedState.tapTimer = setTimeout(function () {
    clipFeedState.lastTap = 0;
    const video = slide.querySelector(".clipVideo");
    if (!video) return;
    if (video.paused) {
      const attempt = video.play();
      if (attempt && attempt.catch) attempt.catch(function () {});
      slide.classList.remove("paused");
    } else {
      video.pause();
      slide.classList.add("paused");
    }
  }, 200);
}

/* The heart that blooms where the finger landed. Transform + opacity only. */
function burstHeart(slide) {
  const el = document.createElement("span");
  el.className = "heartBurst";
  el.innerHTML = icon("heart");
  slide.appendChild(el);
  setTimeout(function () { el.remove(); }, 800);
}

/* Every count on the page follows a like or a comment, so a tile in a gallery
   never disagrees with the rail it opens. */
function refreshClipCounts(id) {
  allClips().forEach(function (clip) {
    $$('[data-likecount="' + clip.id + '"]').forEach(function (b) {
      b.textContent = clipLikeTotal(clip);
    });
    $$('[data-commentcount="' + clip.id + '"]').forEach(function (b) {
      b.textContent = commentCount(clip.id);
    });
    $$('[data-raillikes="' + clip.id + '"]').forEach(function (b) {
      b.textContent = clipLikeTotal(clip);
    });
    $$('[data-railcomments="' + clip.id + '"]').forEach(function (b) {
      b.textContent = commentCount(clip.id);
    });
    $$('[data-cliplike="' + clip.id + '"]').forEach(function (b) {
      b.classList.toggle("on", hasLiked(clip.id));
    });
  });
}

let clipLikeId = null;

function clipFor(id) {
  return allClips().find(function (c) { return c.id === id; }) || null;
}

function allClips() {
  const out = [];
  allProviders().forEach(function (p) {
    worksOf(p).forEach(function (w) {
      if (!isVideoWork(w)) return;
      out.push({ id: clipIdFor(p.id, w.id), provider: p, work: w });
    });
  });
  return out;
}

/* ---------- Comments ---------- */
/* The clip's owner: the one voice that answers a comment with a reply. */

function isMyClip(id) {
  const me = myProviderRecord();
  if (!me) return false;
  /* a clip id is providerId + ":" + work id, and a provider id carries a phone
     number with colons in nothing — but the prefix is the whole provider id, so
     the check is "does it start with my id plus the separator", not a split on
     the first colon (a phone inside the id would break that) */
  return String(id).indexOf(me.id + ":") === 0;
}

function openComments(id) {
  clipLikeId = id;
  const clip = clipFor(id);
  const sheet = $("#commentSheet");
  if (!sheet || !clip) return;
  clearReplyTarget();
  setCommentTitle();
  const sub = $("#commentSub");
  if (sub) sub.textContent = clip.provider.name + " · " + (clip.work.note || providerSkill(clip.provider));
  const input = $("#commentInput");
  if (input) input.value = "";
  renderComments();
  sheet.classList.add("show");
  sheet.style.display = "block";
  $("#sheetOverlay").style.display = "block";
}

function setCommentTitle() {
  const title = $("#commentTitle");
  if (title) title.textContent = "Comments · " + commentCount(clipLikeId);
}

/* Who the next post answers, if anyone. A reply is aimed at one comment and
   says so above the box, so nobody has to guess which thread they are in. */
let replyTarget = null;

function clearReplyTarget() {
  replyTarget = null;
  const chip = $("#replyChip");
  if (chip) chip.style.display = "none";
  const input = $("#commentInput");
  if (input) input.placeholder = "Add a comment…";
}

function setReplyTarget(commentId) {
  const c = commentsFor(clipLikeId).find(function (x) { return x.id === commentId; });
  if (!c) return;
  replyTarget = commentId;
  const chip = $("#replyChip");
  const text = $("#replyChipText");
  if (text) text.textContent = "Replying to " + c.by;
  if (chip) chip.style.display = "flex";
  const input = $("#commentInput");
  if (input) {
    input.placeholder = "Reply to " + c.by + "…";
    input.focus();
  }
}

function commentRowHtml(c, owner) {
  const reps = c.replies || [];
  const replies = reps.map(function (r, i) {
    /* a client answers only the professional's latest word: the button sits
       on that reply row and aims back at the parent thread, so every answer
       stays one level deep under the comment that started it */
    const answer = !owner && i === reps.length - 1 && String(r.id || "").charAt(0) === "r"
      ? '<button class="replyGo" data-replyto="' + esc(c.id) + '">' + icon("reply") + "Reply</button>"
      : "";
    return '<div class="replyRow"><span class="commentAva small">' + esc(initials(r.by)) + "</span>" +
      '<span class="commentInfo"><b>' + esc(r.by) + "</b>" +
        '<small>' + esc(fmtWhen(r.at)) + (r.byId && r.byId === viewerId() ? " · you" : "") + "</small>" +
        "<p>" + esc(r.text) + "</p>" + answer + "</span></div>";
  }).join("");
  /* the reply control belongs to the clip's owner: a provider answers their own
     commenters, and nobody's comment turns into a public argument */
  /* two one-level rules, never an argument between strangers: the owner may
     answer any top-level comment; a client may answer only while the
     professional holds the last word in that thread */
  /* ids carry their author in the first letter: r· = the professional's reply,
     u· = a client's answer, c· = a top-level comment */
  const lastId = reps.length ? (reps[reps.length - 1].id || "") : "";
  const canAnswer = owner || String(lastId).charAt(0) === "r";
  const replyBtn = canAnswer
    ? '<button class="replyGo" data-replyto="' + esc(c.id) + '">' + icon("reply") + "Reply</button>"
    : "";
  const thread = replies
    ? '<div class="replyList">' + replies + "</div>"
    : "";
  return '<div class="commentRow" data-comment="' + esc(c.id) + '">' +
    '<span class="commentAva">' + esc(initials(c.by)) + "</span>" +
    '<span class="commentInfo"><b>' + esc(c.by) + "</b><small>" + esc(fmtWhen(c.at)) +
      (c.byId && c.byId === viewerId() ? " · you" : "") + "</small>" +
      "<p>" + esc(c.text) + "</p>" + replyBtn + thread + "</span></div>";
}

function renderComments() {
  const body = $("#commentBody");
  if (!body) return;
  const list = commentsFor(clipLikeId);
  const owner = isMyClip(clipLikeId);
  body.innerHTML = list.length
    ? list.map(function (c) { return commentRowHtml(c, owner); }).join("")
    : '<p class="commentEmpty">' + (owner
        ? "No comments yet — when a client says something about this clip it lands here, and you can answer it."
        : "No comments yet — say the first thing.") + "</p>";
}

function postComment() {
  const input = $("#commentInput");
  const text = input ? input.value : "";
  if (!clipLikeId) return;
  if (!String(text).trim()) { toast("Write something first"); return; }
  const wasReply = !!replyTarget;
  const written = addComment(clipLikeId, text, replyTarget);
  if (!written) { toast("This device is out of storage"); return; }
  if (input) input.value = "";
  clearReplyTarget();
  setCommentTitle();
  renderComments();
  refreshClipCounts();
  renderNotify();
  toast(wasReply ? "Reply posted" : "Comment posted");
}

