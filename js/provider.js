/* =========================================================
 * Pampa — provider — the public profile
 * A professional's page: bio, services with prices, rating history, coverage and their work, plus the review sheet.
 * ========================================================= */

/* ---------- Provider profile (public page) ---------- */
/* Everything a client needs to decide: who they are, what they charge, how
   they have been rated and exactly where they will travel. */
function starRow(n) {
  const full = Math.round(Number(n) || 0);
  let out = "";
  for (let i = 1; i <= 5; i++) out += '<span class="star' + (i <= full ? " on" : "") + '">' + icon("star") + "</span>";
  return '<span class="starsRow">' + out + "</span>";
}

function providerStatsHtml(p) {
  const s = ratingStats(p);
  const km = kmToStudio(p);
  const covers = coversClient(p);
  const tiles = [
    { k: "Average", v: s.avg ? s.avg.toFixed(1) : "—", note: s.reviews ? s.reviews + " review" + (s.reviews === 1 ? "" : "s") : (s.base ? "from Pampa history" : "no ratings yet") },
    { k: "Jobs done", v: String(p.jobs || 0), note: p.jobs ? "completed & paid" : "none yet" },
    { k: "Distance", v: km == null ? "—" : fmtKm(km), note: hasLocation() ? "from your area" : "set your location" },
    { k: "Home visits", v: covers ? "Yes" : "No", note: covers ? "travels to you" : "studio only" },
  ];
  return '<div class="provStats">' + tiles.map(function (t) {
    return '<div class="provStat"><p class="psK">' + esc(t.k) + '</p><p class="psV">' + esc(t.v) + '</p><p class="psN">' + esc(t.note) + "</p></div>";
  }).join("") + "</div>";
}

function providerServicesHtml(p) {
  const offered = servicesForProvider(p);
  const isMe = p.id === selfKey();
  if (!offered.length) {
    return '<p class="finePrint">This provider has not published any services for their trade yet.</p>';
  }
  /* A range, not a number: the price a client pays is one they name inside
     these two, so the card shows the pair rather than a figure nobody has
     agreed to yet. */
  return '<div class="svcRows">' + offered.map(function (sv) {
    const r = rangeFor(p, sv.id);
    return '<div class="svcRow">' +
      '<span class="svcIco">' + icon(sv.ico) + "</span>" +
      '<span class="svcInfo"><b>' + esc(sv.name) + "</b><small>" + sv.dur + " min \u00b7 pick your price</small></span>" +
      '<span class="svcPrice">' + esc(rangeText(r)) + "</span>" +
      (isMe ? "" : '<button class="bookBtn small" data-providerbook="' + esc(sv.id) + '">Book</button>') +
      "</div>";
  }).join("") + "</div>" +
    '<p class="finePrint">You name the price inside each range \u2014 ' + esc(p.name || "they") +
      " accepts it or answers with one of their own. Home visits add a travel fee of " + naira(TRAVEL.base) +
      " covering the first " + TRAVEL.freeKm + " km, then " + naira(TRAVEL.perKm) + " per km beyond that.</p>";
}

function providerRatingsHtml(p) {
  const s = ratingStats(p);
  if (!s.avg && !s.list.length) {
    return '<p class="finePrint">No ratings yet. A review can only be posted by a client who released escrow on a completed job.</p>';
  }
  const head = '<div class="rateHead">' +
    '<p class="rateBig">' + s.avg.toFixed(1) + '</p>' +
    '<div class="rateMeta">' + starRow(s.avg) +
      '<p class="finePrint">' + s.count + ' rating' + (s.count === 1 ? "" : "s") +
        (s.reviews ? " · " + s.reviews + " written here" : s.base ? " · from Pampa history" : "") + "</p>" +
    "</div></div>";
  const total = s.list.length;
  const bars = total
    ? '<div class="rateBars">' + s.dist.map(function (n, i) {
        const stars = 5 - i;
        const pct = Math.round((n / total) * 100);
        return '<div class="rateBarRow"><span>' + stars + "</span>" +
          '<span class="rateBar"><i style="width:' + pct + '%"></i></span>' +
          '<span class="rateCount">' + n + "</span></div>";
      }).join("") + "</div>"
    : '<p class="finePrint">The average comes from completed jobs before Pampa kept reviews. Reviews written here appear below.</p>';
  const list = total
    ? '<div class="reviewList">' + s.list.map(function (r) {
        return '<div class="review"><div class="revTop">' + starRow(r.stars) +
          '<b>' + esc(r.by || "Client") + "</b><small>" + esc(fmtWhen(r.at)) + "</small></div>" +
          (r.comment ? '<p class="revText">' + icon("quote") + esc(r.comment) + "</p>" : "") +
          (r.serviceName ? '<p class="finePrint">' + esc(r.serviceName) + "</p>" : "") +
          "</div>";
      }).join("") + "</div>"
    : "";
  return head + bars + list;
}

function renderProviderProfile() {
  const p = stylistById(state.providerView);
  if (!p) return;
  const s = ratingStats(p);
  const km = kmToStudio(p);
  const covers = coversClient(p);
  const isMe = p.id === selfKey();
  /* bookable now — their switch, and no client in the chair */
  const open = providerBookable(p);
  const withClient = providerInSession(p);
  const area = (areaById(p.studio) || {}).name;
  $("#providerWho").textContent = p.name + " · " + p.skill;

  const works = worksOf(p);
  const hero = '<div class="provHero">' +
    avatarHtml(p, "huge") +
    "<h3>" + esc(p.name) + youTag(p) + "</h3>" +
    '<p class="provTrade">' + esc(p.skill) + (area ? " · based in " + esc(area) : "") + "</p>" +
    '<p class="provRate">' + ratingHtml(p) + "</p>" +
    '<div class="provChips">' +
      '<span class="provChip ' + (open ? "on" : withClient ? "busy" : "off") + '">' + icon(open ? "check" : "clock") +
        (open ? "Taking bookings" : withClient ? "In session" : "Books paused") + "</span>" +
      '<span class="provChip">' + icon("pin") + esc(awayText(km)) + "</span>" +
      '<span class="provChip' + (covers ? " on" : "") + '">' + icon(covers ? "house" : "store") +
        (covers ? "Visits you" : "Studio only") + "</span>" +
      (p.jobs ? '<span class="provChip">' + icon("wrench") + p.jobs + " jobs</span>" : "") +
    "</div>" +
    (isMe
      ? '<div class="provCtas"><button class="ghostBtn wide" data-editbio="1">' + icon("quote") + "Edit my bio</button></div>"
      : open
        ? '<div class="provCtas"><button class="bookBtn wide" data-book-stylist="' + esc(p.id) + '">Book ' + esc(p.name) + "</button></div>"
        : withClient
          ? '<div class="provCtas"><button class="bookBtn wide" disabled>' + icon("clock") + " In session — free after settlement</button></div>" +
            '<p class="finePrint">' + esc(p.name) + " is with a client and the money for that job is still in escrow. Their next opening comes back the moment that session is settled, and their work and prices stay up meanwhile.</p>"
          : '<div class="provCtas"><button class="bookBtn wide" disabled>' + icon("clock") + " Not taking bookings</button></div>" +
            '<p class="finePrint">' + esc(p.name) + " has new bookings switched off right now. Their work and prices stay up so you can see what they do and come back.</p>") +
    "</div>";

  const bio = '<div class="card provCard"><div class="provCardHead">' + icon("user") + "<h4>About</h4>" +
    (isMe ? '<button class="linkBtn" data-editbio="1">Edit</button>' : "") + "</div>" +
    '<p class="provBio">' + esc(bioFor(p)) + "</p></div>";

  /* Work sits above the price list on purpose: a client chooses a person by
     what they have made before they read what it costs. */
  const work = works.length
    ? '<div class="card provCard"><div class="provCardHead">' + icon("gallery") +
        "<h4>Work · " + works.length + "</h4>" +
        (isMe ? '<button class="linkBtn" data-openfolio="1">Manage</button>' : "") + "</div>" +
        providerWorkHtml(p) + "</div>"
    : (isMe
      ? '<div class="card provCard"><div class="provCardHead">' + icon("gallery") + "<h4>Work</h4></div>" +
        '<p class="provBio">Photos of finished cuts, braids and sets are the fastest way to be booked.</p>' +
        '<div class="provCtas"><button class="ghostBtn wide" data-openfolio="1">' + icon("plus") + "Add work</button></div></div>"
      : "");

  $("#providerBody").innerHTML =
    hero +
    providerStatsHtml(p) +
    bio +
    work +
    '<div class="card provCard"><div class="provCardHead">' + icon("scissors") + "<h4>Services &amp; prices</h4></div>" +
      providerServicesHtml(p) + "</div>" +
    '<div class="card provCard"><div class="provCardHead">' + icon("star") + "<h4>Ratings" + (s.reviews ? " · " + s.reviews : "") + "</h4></div>" +
      providerRatingsHtml(p) + "</div>" +
    '<div class="card provCard"><div class="provCardHead">' + icon("map") + "<h4>Coverage</h4></div>" +
      coverageMapHtml(p) + "</div>";
}

/* The gallery: photos as tiles, clips with a play badge. Tapping one opens the
   full-size viewer; the tile itself is the button. */
function providerWorkHtml(p) {
  const works = worksOf(p);
  if (!works.length) return '<p class="provBio">No work shown yet.</p>';
  return '<div class="folioGrid">' + works.map(function (w, i) {
    const vid = isVideoWork(w);
    const id = clipIdFor(p.id, w.id);
    /* A clip opens the rail at itself rather than a viewer with one video in
       it — the rail is where it can be liked and commented on. */
    const open = vid
      ? 'data-clipopen="' + esc(id) + '"'
      : 'data-work-view="' + esc(w.id) + '" data-work-provider="' + esc(p.id) + '"';
    return '<button class="workTile" ' + open + " " +
        'aria-label="' + (vid ? "Play clip " : "View photo ") + (i + 1) + '">' +
      (vid
        ? '<span class="workThumb vid">' + icon("play") + "</span>"
        : '<img class="workThumb" src="' + esc(w.src) + '" alt="" loading="lazy">') +
      (w.note ? '<span class="workNote">' + esc(w.note) + "</span>" : "") +
      (vid
        ? '<span class="workSocial">' + icon("heart") +
            '<b data-likecount="' + esc(id) + '">' + clipLikeTotal({ id: id, provider: p }) + "</b>" +
            icon("chat") + '<b data-commentcount="' + esc(id) + '">' + commentsFor(id).length + "</b></span>"
        : "") +
      "</button>";
  }).join("") + "</div>";
}

function openProviderProfile(providerId) {
  const p = stylistById(providerId);
  if (!p) return;
  state.providerView = p.id;
  renderProviderProfile();
  const el = $("#providerProfile");
  el.style.display = "flex";
  el.scrollTop = 0;
}

function exitProviderProfile() {
  $("#providerProfile").style.display = "none";
  state.providerView = null;
}

/* ---------- Rating + release sheet ---------- */
const rateDraft = { bookingId: null, stars: 5, comment: "" };
const RATE_WORDS = ["", "Poor", "Fair", "Good", "Great", "Excellent"];

function openRateSheet(bookingId) {
  const b = findBooking(bookingId);
  if (!b) return;
  if (!canRelease(b)) {
    toast("Wait until the stylist marks the job done, or the appointment time passes");
    return;
  }
  rateDraft.bookingId = bookingId;
  rateDraft.stars = 5;
  rateDraft.comment = "";
  renderRateSheet();
  showSheetEl("#rateSheet");
}

function renderRateSheet() {
  const b = findBooking(rateDraft.bookingId);
  if (!b) return;
  const sv = SERVICES.find(function (s) { return s.id === b.serviceId; }) || {};
  const net = b.pay ? b.pay.netToPro : 0;
  const stars = [1, 2, 3, 4, 5].map(function (n) {
    return '<button class="rateStar' + (n <= rateDraft.stars ? " on" : "") + '" data-rate="' + n +
      '" aria-label="' + n + " star" + (n === 1 ? "" : "s") + '">' + icon("star") + "</button>";
  }).join("");
  $("#rateSub").textContent = "Your review appears on " + (b.stylistName || "their") + "'s public profile";
  $("#rateBody").innerHTML =
    '<div class="rateWho"><span class="avatar">' + esc(initials(b.stylistName)) + "</span>" +
      '<div><b>' + esc(b.stylistName || "Your stylist") + "</b><small>" + esc(sv.name || "Service") +
      " · " + esc(b.date) + "</small></div></div>" +
    '<div class="ratePick">' + stars + "</div>" +
    '<p class="rateWord" id="rateWord">' + esc(RATE_WORDS[rateDraft.stars]) + "</p>" +
    '<textarea class="bioInput" id="rateNote" maxlength="180" rows="3" placeholder="How did it go? (optional)"></textarea>' +
    '<p class="finePrint">Releasing ' + naira(net) + " to " + esc(b.stylistName || "the stylist") +
      " now. A job can only be reviewed once, and only by the client who paid for it." + "</p>";
  $("#rateSubmit").innerHTML = "Release " + naira(net) + " &amp; post review";
}

function paintRateStars() {
  $$("#rateBody [data-rate]").forEach(function (btn) {
    btn.classList.toggle("on", Number(btn.dataset.rate) <= rateDraft.stars);
  });
  const word = $("#rateWord");
  if (word) word.textContent = RATE_WORDS[rateDraft.stars];
}

/* Money must never be held hostage by the review UI: releasing without a
   review stays one tap away, and the release itself is the escrow primitive. */
function finishRelease(postReview) {
  const b = findBooking(rateDraft.bookingId);
  if (!b) {
    hideSheetEl("#rateSheet");
    return;
  }
  const noteEl = $("#rateNote");
  const comment = noteEl ? noteEl.value.trim() : "";
  const res = releasePayment(b.id);
  if (!res.ok) {
    toast(res.msg);
    hideSheetEl("#rateSheet");
    renderBookings();
    return;
  }
  if (postReview) {
    const sv = SERVICES.find(function (s) { return s.id === b.serviceId; }) || {};
    const stars = rateDraft.stars;
    addRating(b.stylistId, {
      stars: stars,
      at: new Date().toISOString(),
      by: (state.user || {}).name || "Client",
      comment: comment,
      serviceId: b.serviceId,
      serviceName: sv.name || "",
      bookingId: b.id,
    });
    b.rated = { stars: stars, at: new Date().toISOString(), comment: comment };
    ledgerNote(b, "Client rated " + stars + " star" + (stars === 1 ? "" : "s") +
      (comment ? ': "' + clip(comment, 60) + '"' : ""));
    save();
    toast("Released " + naira(res.net) + " · " + stars + "-star review posted");
  } else {
    toast("Released " + naira(res.net) + " to " + (b.stylistName || "your stylist"));
  }
  hideSheetEl("#rateSheet");
  renderBookings();
  renderStylists();
  renderNotify();
  /* the first money through the door is the moment the app is worth keeping:
     one quiet offer to be installed, twice at most, never again after that */
  maybeNudgeInstall();
}

