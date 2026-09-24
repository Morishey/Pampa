/* =========================================================
 * Pampa — sheets — everything that edits a professional
 * The bio, contact, photo and portfolio sheets, and the full-screen work viewer.
 * ========================================================= */

/* ---------- Bio sheet ---------- */
function openBioSheet() {
  const u = state.user || {};
  const input = $("#bioInput");
  if (input) input.value = u.bio || "";
  showSheetEl("#bioSheet");
}

/* Personal details: name, email, social handles. These are editable; the role
   and the trade are set once at sign-up and are not. */
function openContactSheet() {
  const u = state.user || {};
  const set = (id, v) => { const el = $(id); if (el) el.value = v || ""; };
  set("#ctName", u.name);
  set("#ctEmail", u.email);
  const s = u.social || {};
  set("#ctIg", s.ig);
  set("#ctTt", s.tt);
  set("#ctX", s.x);
  showSheetEl("#contactSheet");
}

function saveContact() {
  if (!state.user) return;
  const u = state.user;
  const name = ($("#ctName").value || "").trim();
  if (name) u.name = name.slice(0, 40);
  const email = ($("#ctEmail").value || "").trim();
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) u.email = email.slice(0, 80);
  else if (email) { toast("That email doesn't look right — saved the rest"); delete u.email; }
  else delete u.email;
  const handle = v => { v = (v || "").trim().replace(/^@/, "").slice(0, 40); return v || null; };
  const social = { ig: handle($("#ctIg").value), tt: handle($("#ctTt").value), x: handle($("#ctX").value) };
  if (social.ig || social.tt || social.x) u.social = social;
  else delete u.social;
  save();
  rememberAccount();
  registerProviderSelf();
  /* And to the account itself: registerProviderSelf only speaks for a
     professional's public record, so without this a client's name and handles
     never left the phone — and the name on a booking card is read from the
     account. */
  if (typeof dbPushAccountDetails === "function") dbPushAccountDetails();
  /* The email is the one field here that is also a way in, so it is saved
     through the door that can say no in words — an address somebody else
     already signs in with is refused, and the person is told, rather than
     believing they can sign in with an address that was never stored. */
  if (typeof dbSetEmail === "function") dbSetEmail(u.email || "");
  hideSheetEl("#contactSheet");
  renderProfile();
  renderWork();
  toast("Details saved");
}

function saveBio() {
  const input = $("#bioInput");
  const text = input ? input.value.trim() : "";
  if (!state.user) return;
  if (text) state.user.bio = text.slice(0, 220);
  else delete state.user.bio;
  if (state.user.trade) registerProviderSelf();   // the directory carries the bio too
  save();
  hideSheetEl("#bioSheet");
  renderProfile();
  if (state.providerView) renderProviderProfile();
  toast(text ? "Bio saved — clients see it on your profile" : "Bio cleared — Pampa writes one for you");
}

/* ---------- Profile photo ---------- */
function openDpSheet() {
  renderDpSheet();
  showSheetEl("#dpSheet");
}

function renderDpSheet() {
  const body = $("#dpBody");
  if (!body) return;
  const p = myProviderRecord() || { name: (state.user || {}).name };
  const dp = dpOf(p);
  body.innerHTML =
    '<div class="dpPreview">' + avatarHtml(p, "huge") + "</div>" +
    '<p class="finePrint">A square crop of your face works best. Pampa shrinks it to ' +
      DP_MAX + "px before saving, so it stays light on a client's phone." +
      (dp ? "" : " Until you add one, clients see your initial.") + "</p>";
  const clear = $("#dpClear");
  if (clear) clear.style.display = dp ? "" : "none";
}

/* Who owns the face: a professional's lives on their public record, a client's
   on their account. The top nav shows it either way. */
function dpOwner() {
  return myProviderRecord() || (state.user || null);
}

function pickDpFile(file) {
  const who = dpOwner();
  if (!who) { toast("Sign in first"); return; }
  const isPro = who !== state.user;
  /* a phone photo is several megabytes: redrawing it to 320px is real work,
     and it is done before the picture can appear anywhere */
  work($("#dpPick"), shrinkImage(file, DP_MAX, DP_QUALITY)).then(function (dataUrl) {
    const before = who.dp;
    const beforeUser = (state.user || {}).dp;
    who.dp = dataUrl;
    /* The account carries the face too: it is what the nav reads, and a
       professional's public record and their own account must never disagree
       about what they look like. */
    if (state.user) state.user.dp = dataUrl;
    if (isPro && !saveDirectory()) {
      who.dp = before;
      if (state.user) state.user.dp = beforeUser;
      toast("This device is out of storage — try a smaller photo");
      return;
    }
    rememberAccount();
    save();
    refreshProviderSurfaces();
    /* A pro's face rides along with their public record above; a client has no
       such record, so the account is the only place their picture can live. */
    if (typeof dbPushAccountDetails === "function") dbPushAccountDetails();
    toast("Profile photo saved");
  }).catch(function () {
    toast("Could not read that image");
  });
}

function clearDp() {
  const who = dpOwner();
  if (!who || !who.dp) return;
  const isPro = who !== state.user;
  pampaConfirm({
    title: "Remove your photo?",
    body: "You'll show as your initial until you upload a new one.",
    confirmLabel: "Remove photo",
  }).then(function (yes) {
    if (!yes) return;
    delete who.dp;
    if (state.user) delete state.user.dp;
    if (isPro) saveDirectory();
    rememberAccount();
    save();
    refreshProviderSurfaces();
    /* the removal reaches the server too, or other devices keep the old face */
    if (typeof dbPushAccountDetails === "function") dbPushAccountDetails();
    toast("Photo removed — you show as your initial again");
  });
}

/* ---------- Portfolio ---------- */
let workDraft = { note: "", link: "" };

function openFolioSheet() {
  renderFolioSheet();
  showSheetEl("#folioSheet");
}

function renderFolioSheet() {
  const body = $("#folioBody");
  if (!body) return;
  const rec = myProviderRecord();
  const works = worksOf(rec);
  const grid = works.length
    ? '<div class="folioGrid">' + works.map(function (w, i) {
        const id = clipIdFor(rec ? rec.id : "", w.id);
        return '<div class="folioTile">' +
          (isVideoWork(w)
            ? '<span class="folioThumb vid">' + icon("play") + "</span>" +
              /* the owner sees how their clip is doing, where they manage it */
              '<span class="workSocial">' + icon("heart") +
                '<b data-likecount="' + esc(id) + '">' + clipLikeTotal({ id: id, provider: rec || {} }) + "</b>" +
                icon("chat") + '<b data-commentcount="' + esc(id) + '">' + commentsFor(id).length + "</b></span>" +
              /* the length, where every player in the world puts it. Older clips
                 were added before the app measured them, so it is optional. */
              (w.dur ? '<span class="workDur">' + fmtDur(w.dur) + "</span>" : "")
            : '<img class="folioThumb" src="' + esc(w.src) + '" alt="">') +
          '<button class="folioX" data-work-rm="' + esc(w.id) + '" aria-label="Remove work ' + (i + 1) + '">' +
            icon("close") + "</button></div>";
      }).join("") + "</div>"
    : emptyState("search", "No work shown yet", "Add a few photos of cuts, braids or sets you have finished — clients decide on them.");

  body.innerHTML = grid +
    '<div class="sheetBlock"><label>Paste a video link</label>' +
      '<div class="addrField">' + icon("play") +
        '<input id="workLink" type="url" maxlength="300" placeholder="Paste a video link (mp4, YouTube…)">' +
        '<button class="fieldGo" data-addlink="1" aria-label="Add this link">' + icon("plus") + "</button>" +
      "</div>" +
      '<p class="finePrint">Paste a link and tap +, or use <b>Add a video</b> below for a clip from this device — it is cut down to fit ' +
        VIDEO_MAX_MB + " MB and posted with its own length. It never leaves this phone.</p>" +
    "</div>" +
    '<p class="finePrint">Photos are shrunk to ' + WORK_MAX + "px on the long edge. A clip plays inline in the viewer. " + works.length + " of " + WORK_LIMIT + " used.</p>";

  const room = works.length < WORK_LIMIT;
  const pick = $("#folioPick");
  if (pick) pick.style.display = room ? "" : "none";
  const vid = $("#videoPick");
  if (vid) vid.style.display = room ? "" : "none";
}

/* A clip straight from the device. A video cannot be shrunk the way a photo can
   without a transcoder, so the file is kept whole and only accepted while it
   fits the storage budget the whole directory shares. */
async function addWorkVideoFile(file) {
  const rec = myProviderRecord();
  if (!rec) { toast("Add a trade first — work lives on your public page"); return; }
  if (!file) return;
  if (worksOf(rec).length >= WORK_LIMIT) { toast("That is the whole portfolio for now — remove one first"); return; }
  if (!/^video\//i.test(file.type || "")) { toast("That file is not a video"); return; }

  const pick = $("#videoPick");
  const label = pick ? pick.textContent : "";
  setBusy(pick, true);
  beginWork();
  try {
    /* The clip is re-encoded down to something this device can hold, and it
       takes about as long as the clip lasts — so the button counts it out. */
    const out = await compressClip(file, function (frac) {
      setWorkProgress(frac);
      if (pick) pick.textContent = "Cutting clip \u00b7 " + Math.round(frac * 100) + "%";
    });
    const entry = {
      id: "w" + Date.now(),
      kind: "video",
      src: out.src,
      name: file.name || "clip",
      note: "",
      dur: out.duration,
      at: new Date().toISOString()
    };
    /* Read the list again rather than reusing what was captured before the
       encode: that wait is seconds long, and anything added during it would
       be dropped by a stale array. */
    const current = worksOf(rec);
    rec.works = current.concat([entry]);
    if (!saveDirectory()) {
      rec.works = current;
      toast("This device is out of storage \u2014 paste a video link instead");
      return;
    }
    renderFolioSheet();
    refreshProviderSurfaces();
    toast(clipSavedText(out));
  } catch (e) {
    toast(clipErrorMessage(e));
  } finally {
    if (pick) pick.textContent = label;
    setBusy(pick, false);
    endWork();
  }
}

function addWorkFiles(files) {
  const rec = myProviderRecord();
  if (!rec) { toast("Add a trade first — work lives on your public page"); return; }
  const works = worksOf(rec);
  const room = WORK_LIMIT - works.length;
  if (room <= 0) { toast("That is the whole portfolio for now — remove one first"); return; }
  const take = files.slice(0, room);
  const pick = $("#folioPick");
  work(pick, Promise.all(take.map(function (f) { return shrinkImage(f, WORK_MAX, WORK_QUALITY); })))
    .then(function (urls) {
      const added = urls.map(function (src, i) {
        return { id: "w" + Date.now() + i, kind: "photo", src: src, note: "", at: new Date().toISOString() };
      });
      rec.works = works.concat(added);
      if (!saveDirectory()) {
        rec.works = works;
        toast("This device is out of storage — try smaller photos");
        return;
      }
      renderFolioSheet();
      refreshProviderSurfaces();
      toast(added.length + " work" + (added.length === 1 ? "" : "s") + " added");
    })
    .catch(function () { toast("Could not read one of those images"); });
}

function addWorkLink() {
  const rec = myProviderRecord();
  const input = $("#workLink");
  const url = input ? input.value.trim() : "";
  if (!rec) { toast("Add a trade first — work lives on your public page"); return; }
  if (!/^https?:\/\//i.test(url)) { toast("Paste a full link, starting with https://"); return; }
  const works = worksOf(rec);
  if (works.length >= WORK_LIMIT) { toast("That is the whole portfolio for now — remove one first"); return; }
  rec.works = works.concat([{ id: "w" + Date.now(), kind: "video", src: url, note: "", at: new Date().toISOString() }]);
  if (!saveDirectory()) {
    rec.works = works;
    toast("This device could not save that link");
    return;
  }
  if (input) input.value = "";
  renderFolioSheet();
  refreshProviderSurfaces();
  toast("Video added to your work");
}

function removeWork(id) {
  const rec = myProviderRecord();
  if (!rec) return;
  pampaConfirm({
    title: "Remove this work?",
    body: "Clients will no longer see it on your profile.",
    confirmLabel: "Remove",
  }).then(function (yes) {
    if (!yes) return;
    rec.works = worksOf(rec).filter(function (w) { return w.id !== id; });
    saveDirectory();
    renderFolioSheet();
    refreshProviderSurfaces();
    toast("Removed");
  });
}

/* ---------- Work viewer ---------- */
function openWorkView(src, label, isVideo) {
  const el = $("#workView");
  const stage = $("#workViewStage");
  if (!el || !stage) return;
  const yt = isVideo ? youtubeId(src) : null;
  if (isVideo && yt) {
    /* A share link gets a poster and two ways out, never an eager player. The
       YouTube iframe pulls in the whole player — hundreds of kilobytes and a
       second connection — and on a weak device merely opening a portfolio item
       would pay that cost, or crash on it. The player loads on the tap. */
    stage.innerHTML = '<div class="wvYt">' +
      '<img class="wvYtThumb" src="https://i.ytimg.com/vi/' + esc(yt) + '/hqdefault.jpg" alt="">' +
      '<button class="wvYtPlay" data-ytplay="' + esc(yt) + '">' + icon("play") + "Load the player</button>" +
      '<a class="wvYtOpen" href="https://www.youtube.com/watch?v=' + esc(yt) + '" target="_blank" rel="noopener noreferrer">' +
        "Open on YouTube instead</a>" +
      "</div>";
    const thumb = stage.querySelector(".wvYtThumb");
    if (thumb) thumb.addEventListener("error", function () { thumb.remove(); });
  } else if (isVideo && videoLooksPlayable(src)) {
    stage.innerHTML = '<video class="wvVideo" src="' + esc(src) + '" controls playsinline preload="metadata"></video>';
  } else if (isVideo) {
    stage.innerHTML = '<a class="wvLink" href="' + esc(src) + '" target="_blank" rel="noopener noreferrer">' +
      icon("play") + "Open this clip</a>";
  } else {
    stage.innerHTML = '<img class="wvImg" src="' + esc(src) + '" alt="">';
  }
  $("#workViewLabel").textContent = label || "";
  el.style.display = "flex";
}

function closeWorkView() {
  const el = $("#workView");
  if (!el) return;
  el.style.display = "none";
  /* drop the media so a video stops playing when the viewer closes */
  $("#workViewStage").innerHTML = "";
}

