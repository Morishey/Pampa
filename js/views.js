/* =========================================================
 * Pampa — views — the dashboards
 * Profile, the app views, the professional dashboard and the way into the app.
 * ========================================================= */

/* ---------- Rendering: profile ---------- */
function renderProfile() {
  const u = state.user || {};
  $("#profileName").textContent = u.name || "—";
  $("#profilePhone").textContent = u.phone || "—";
  const emailEl = $("#profileEmail");
  if (emailEl) emailEl.textContent = u.email || "—";
  const socialEl = $("#profileSocial");
  if (socialEl) {
    const s = u.social || {};
    const tags = [s.ig && "IG @" + s.ig, s.tt && "TT @" + s.tt, s.x && "X @" + s.x].filter(Boolean);
    socialEl.textContent = tags.length ? tags.join(" · ") : "—";
  }
  $("#profileArea").textContent = hasLocation() ? clientAreaName() : "Not set";
  $("#profileAddress").textContent = u.address || "—";
  const role = roleById(u.role || "client");
  $("#profileRole").textContent = role ? role.tag : "Client";
  const myTrade = tradeById(u.trade);
  /* a trade is set once, at sign-up: it is what the whole escrow side hangs
     off, so the row states it and there is no button to change it */
  $("#profileTrade").textContent = myTrade ? myTrade.name : "Client only";
  const bioText = $("#profileBio");
  if (bioText) bioText.textContent = u.bio ? u.bio : (myTrade ? "Pampa writes one from your trade" : "—");
  const bioBtnText = $("#editBioText");
  if (bioBtnText) bioBtnText.textContent = u.bio ? "Edit my bio" : "Add a bio for clients";

  /* Everyone has a face — it is the top nav on Home and the avatar beside your
     own name. Only a professional has a public page to put it on, and only a
     professional has a portfolio, so that half is theirs alone. */
  const rec = myProviderRecord();
  const face = rec || u;
  const head = $("#proToolsHead");
  if (head) head.textContent = rec ? "Your public page" : "Your picture";
  const folioOn = $("#editPortfolio");
  if (folioOn) folioOn.style.display = rec ? "" : "none";
  const dpRow = $("#dpRow");
  if (dpRow) {
    const works = rec ? worksOf(rec) : null;
    dpRow.innerHTML = avatarHtml(face, "huge") +
      '<div class="dpMeta"><b>' + esc(face.name || u.name || "You") + "</b><small>" +
      (dpOf(face)
        ? (rec ? "Profile photo set" : "Profile photo set — it shows in the top nav")
        : "No photo yet — you show as your initial") + "</small>" +
      (works
        ? "<small>" + works.length + " work" + (works.length === 1 ? "" : "s") + " on your page</small>"
        : "<small>Only you see this — clients never browse clients</small>") +
      "</div>";
  }
  const photoBtn = $("#editPhotoText");
  if (photoBtn) photoBtn.textContent = dpOf(face) ? "Change my profile photo" : "Add a profile photo";
  const pwBtn = $("#changePasswordText");
  if (pwBtn) {
    const acc = accountByPhone(u.phone);
    pwBtn.textContent = acc && acc.hash ? "Change my password" : "Create my password";
  }
  const folioBtn = $("#editPortfolioText");
  if (folioBtn && rec) {
    const n = worksOf(rec).length;
    folioBtn.textContent = n ? "My work · " + n : "Add work photos & videos";
  }
  const profAvatar = $("#profileAvatar");
  const myDp = dpOf(rec);
  if (myDp) profAvatar.innerHTML = '<img src="' + esc(myDp) + '" alt="">';
  else profAvatar.textContent = initials(u.name);
  $("#rememberMe").checked = u.remember !== false;
  renderThemeControl();
  renderNotify();
  /* The escrow desk is the professional's own — a client has no directory record
     to accept jobs under, so the entrance is not shown to them at all. The role
     and the trade are set once, at sign-up, and are not switchable afterwards. */
  const proEntry = $("#proEntry");
  if (proEntry) proEntry.style.display = u.role === "pro" ? "" : "none";
  const note = $("#proEntryNote");
  if (note) {
    const pro = myProviderRecord();
    const waiting = pro ? proJobs(pro.id).requests.length : 0;
    note.textContent = waiting
      ? waiting + " request" + (waiting === 1 ? "" : "s") + " waiting on you"
      : "Accept jobs, track escrow and withdraw earnings";
  }
  /* The queue is the server's when there is one: the note counts the cached
     answer rather than the device's own bookings, which for a mediator are
     none of the disputes they are being asked to settle. */
  const deskNote = $("#deskEntryNote");
  if (deskNote) {
    const open = dbDeskOpenCache || deskDisputes();
    deskNote.textContent = open.length
      ? open.length + " dispute" + (open.length === 1 ? "" : "s") + " holding " + naira(deskFrozenTotal(open)) + " in escrow"
      : "Settle disputes held in escrow";
  }
  /* Whether the desk exists for this account is the server's answer. Until it
     has one — no database, or the flags have not arrived yet — the device's
     own role answers, which is how this screen behaved before the cloud. */
  const deskEntry = $("#deskEntry");
  if (deskEntry) {
    const cloud = typeof dbConfigured === "function" && dbConfigured() && dbSignedIn();
    const flagged = state.deskFlags ? !!(state.deskFlags.desk || state.deskFlags.admin) : null;
    const allowed = cloud && flagged !== null ? flagged : u.role === "pro";
    deskEntry.style.display = allowed ? "" : "none";
  }
}

/* Loads the device directory, re-seeds it if it is missing, and repairs older
   saves: records used to be keyed "self", and a directory key now follows the
   phone the account was registered with. */
function migrateProviders() {
  loadDirectory();
  const before = state.providers.length;
  ensureProviderSeed();
  if (state.providers.length !== before) saveDirectory();
  /* a status that has aged out is dropped here, so the stored record keeps no
     tail of dead stories and the rail never counts one twice */
  pruneStatuses();
  /* bookings and pro-mode state saved under the old "self" key still belong to
     whoever is signed in now */
  const key = selfKey();
  let moved = false;
  state.bookings.forEach(function (b) {
    if (b.stylistId === "self") { b.stylistId = key; moved = true; }
  });
  /* A record written before the account had a phone is keyed p:guest. It can
     never be signed into again, booked or paid, so it must not sit in the
     directory. If it is this account's own — same person, number added later —
     it is adopted onto the real key; otherwise it is unattributable and goes. */
  if (key !== GUEST_KEY) {
    const ghostAt = state.providers.findIndex(function (p) { return p.id === GUEST_KEY; });
    if (ghostAt !== -1) {
      const ghost = state.providers[ghostAt];
      const mine = (ghost.name || "") === ((state.user || {}).name || "");
      if (mine) {
        const real = state.providers.find(function (p) { return p.id === key; });
        if (!real) {
          ghost.id = key;
          ghost.owner = (state.user || {}).phone || ghost.owner;
        } else {
          /* keep the picture and portfolio the ghost was carrying, then drop it */
          if (!real.dp && ghost.dp) real.dp = ghost.dp;
          if (!(real.works || []).length && Array.isArray(ghost.works)) real.works = ghost.works;
          state.providers.splice(ghostAt, 1);
        }
        state.bookings.forEach(function (b) { if (b.stylistId === GUEST_KEY) b.stylistId = key; });
      } else {
        state.providers.splice(ghostAt, 1);
      }
      moved = true;
    }
  }
  if (proStore.proId === "self") { proStore.proId = key; moved = true; }
  ["destinations", "payouts"].forEach(function (bag) {
    if (proStore[bag] && proStore[bag].self) {
      proStore[bag][key] = proStore[bag].self;
      delete proStore[bag].self;
      moved = true;
    }
  });
  if (moved) { save(); saveDirectory(); proSave(); }
  if (state.user && state.user.trade) registerProviderSelf();
}

/* ---------- App views ---------- */
/* The professional's Home card: their profession, their numbers, their recent
   booking events and a refresh affordance. One function, so arriving at Home
   and tapping Refresh draw the exact same picture from the same ledger. */
function renderProHomeCard() {
  const proStats = $("#homeProStats");
  if (!proStats) return;
  const u = state.user || {};
  const me = myProviderRecord();
  const s = me ? ratingStats(me) : null;
  const t = tradeById(u.trade);
  /* their own face leads the card, with the trade badged onto it — and the
     trade glyph alone stands in until a picture is uploaded */
  const face = '<button class="proHomeFace" data-opendp="1" aria-label="Your profile photo">' +
    (dpOf(me)
      ? avatarHtml(me, "huge") + '<i class="proHomeTrade">' + icon(t ? t.ico : "briefcase") + "</i>"
      : '<span class="proTradeIco">' + icon(t ? t.ico : "briefcase") + "</span>") +
    "</button>";
  proStats.innerHTML =
    '<div class="card workHero proHomeCard">' +
      '<div class="workHeroTop">' +
        face +
        '<div class="workHeroMeta">' +
          "<b>" + esc(me && me.name ? me.name : u.name || "") + "</b>" +
          "<small>" + esc(t ? t.name + " · professional" : "Professional") + "</small>" +
          "<small>" + esc(t ? t.note : "") + "</small>" +
          '<small class="proAvailTag ' + (providerBookable(me) ? "on" : providerInSession(me) ? "busy" : "off") + '">' +
            icon(providerBookable(me) ? "check" : "clock") +
            (providerBookable(me) ? "Taking bookings" : providerInSession(me) ? "In session" : "Not taking bookings") + "</small>" +
        "</div>" +
        '<button class="linkBtn" data-goto-work="1">My work</button>' +
      "</div>" +
      '<div class="proHomeRates">' +
        '<div class="phRate"><b>' + (s && s.avg ? s.avg.toFixed(1) : "—") + "</b><small>" +
          (s && s.avg ? "average rating" : "no ratings yet") + "</small></div>" +
        '<div class="phRate"><b>' + (me ? me.jobs || 0 : 0) + "</b><small>job" + ((me ? me.jobs || 0 : 0) === 1 ? "" : "s") + " done</small></div>" +
        '<div class="phRate"><b>' + (s && s.reviews ? s.reviews : 0) + "</b><small>review" + ((s && s.reviews ? s.reviews : 0) === 1 ? "" : "s") + "</small></div>" +
      "</div>" +
      (s && s.reviews
        ? '<div class="proHomeReviews">' + providerRatingsHtml(me) + "</div>"
        : '<p class="finePrint">Ratings arrive when clients release escrow.</p>') +
      proActivityHtml(me) +
    "</div>";
  /* the feed is rebuilt on every render, so it is bound fresh each time */
  bindActPull(proStats.querySelector(".actFeed"));
}

/* Recent booking events for this professional, from the escrow money trail
   each booking already journals. Newest first, five at rest, the rest behind
   one tap — and the whole list can be pulled down to re-read the ledger. */
let actExpanded = false;

function proActivityHtml(me) {
  const earnId = me ? me.id : selfKey();
  const events = [];
  state.bookings.forEach(function (b) {
    if (b.stylistId !== earnId) return;
    (b.history || []).forEach(function (e) {
      events.push({ at: e.at, label: e.label, service: b.serviceId, booking: b.id });
    });
  });
  /* what people did with the clips, read from the same store the rail writes
     to: a like or a comment is news beside a booking, not a separate room */
  clipNews().forEach(function (n) {
    events.push({ at: n.at, social: n });
  });
  events.sort(function (a, b2) { return String(b2.at).localeCompare(String(a.at)); });
  const head = '<p class="journalHead">Recent activity' +
    '<button class="actRefresh" data-act-refresh="1" aria-label="Refresh activity">' +
      icon("refresh") + "</button></p>";
  if (!events.length) {
    return '<div class="actFeed">' + head +
      '<p class="finePrint">Bookings, payments, payouts — and likes or comments on your clips — appear here as they happen.</p></div>';
  }
  const shown = actExpanded ? events : events.slice(0, 5);
  const rest = events.length - 5;
  const sv = id => { const s = SERVICES.find(x => x.id === id) || {}; return s.name || ""; };
  const rows = shown.map(function (e) {
    if (e.social) {
      return '<button class="actRow actSocial" data-actclip="' + esc(e.social.clipId) + '">' +
        '<span class="actAt">' + esc(fmtWhen(e.at)) + "</span>" +
        '<span class="actWhat"><span class="actIco">' + icon(e.social.icon) + "</span>" +
          "<b>" + esc(e.social.title) + "</b> " + esc(e.social.detail) + "</span>" +
        "</button>";
    }
    return '<div class="actRow">' +
      '<span class="actAt">' + esc(fmtWhen(e.at)) + "</span>" +
      '<span class="actWhat"><b>' + esc(sv(e.service)) + "</b> " + esc(e.label) + "</span>" +
      "</div>";
  }).join("");
  const more = rest > 0
    ? '<button class="actMore" data-act-more="1">' +
        (actExpanded ? "Show less" : "+" + rest + " earlier") + "</button>"
    : "";
  return '<div class="actFeed">' + head + rows + more + "</div>";
}

/* Pull-to-refresh on the activity feed. The drag only arms while the feed sits
   at the top of its scroller, so it never fights a normal scroll; past the
   threshold the release re-reads the ledger. Pointer devices have no pull, so
   the refresh button beside the heading does the same job. */
let actPull = { el: null, y0: null, dy: 0 };

function actPullReset() {
  const el = actPull.el;
  if (el) {
    el.style.transform = "";
    el.classList.remove("pulling", "ready");
  }
  actPull.el = null;
  actPull.y0 = null;
  actPull.dy = 0;
}

function actPullStart(e) {
  const el = e.currentTarget;
  const t = e.touches && e.touches[0];
  if (!el || !t) return;
  const scroller = el.closest(".view") || document.scrollingElement || document.documentElement;
  if (scroller && scroller.scrollTop > 2) return;
  actPull.el = el;
  actPull.y0 = t.clientY;
  actPull.dy = 0;
}

function actPullMove(e) {
  if (actPull.y0 === null || !actPull.el) return;
  const t = e.touches && e.touches[0];
  if (!t) return;
  const dy = t.clientY - actPull.y0;
  if (dy <= 0) { actPullReset(); return; }
  if (e.cancelable) e.preventDefault();
  /* damped, and capped: the list leans away from the finger, it does not follow it */
  actPull.dy = Math.min(64, dy * 0.5);
  actPull.el.style.transform = "translateY(" + actPull.dy.toFixed(1) + "px)";
  actPull.el.classList.add("pulling");
  actPull.el.classList.toggle("ready", actPull.dy >= 40);
}

function actPullEnd() {
  if (actPull.y0 === null) return;
  const fired = actPull.dy >= 40;
  actPullReset();
  if (!fired) return;
  renderProHomeCard();
  toast("Activity refreshed");
}

function bindActPull(feed) {
  if (!feed) return;
  feed.addEventListener("touchstart", actPullStart, { passive: true });
  feed.addEventListener("touchmove", actPullMove, { passive: false });
  feed.addEventListener("touchend", actPullEnd);
  feed.addEventListener("touchcancel", actPullEnd);
}

let viewInTimer = 0;

function switchView(name) {
  const changed = state.view !== name;
  state.view = name;
  $$(".view").forEach(function (v) { v.style.display = "none"; });
  const view = $("#view-" + name);
  if (!view) return;
  view.style.display = "block";
  /* Re-toggling .active on the tabs with a reflow between, so the ring's
     bloom replays on every change — a class that never left cannot restart
     an animation, and this is the same dance viewIn uses below. */
  $$(".tab").forEach(function (t) { t.classList.remove("active"); });
  $$(".tab").forEach(function (t) {
    if (t.dataset.view === name) {
      void t.offsetWidth;
      t.classList.add("active");
    }
  });
  /* Arriving at a dashboard starts at its top. Without this, revealing the app
     after onboarding lands you partway down the home list, because the browser
     scrolls the container to whatever last held focus before it was hidden. */
  if (changed && view.scrollTop) view.scrollTop = 0;
  /* The arrival animation is replayed by dropping the class, forcing a reflow,
     then re-adding it — otherwise a second visit to the same tab is silent.
     The class is also dropped on a timer: if the page's compositor stalls the
     animation can sit at its first frame forever, and a dashboard frozen
     mid-fade is far worse than no fade at all. */
  view.classList.remove("viewIn");
  void view.offsetWidth;
  view.classList.add("viewIn");
  clearTimeout(viewInTimer);
  viewInTimer = setTimeout(function () { view.classList.remove("viewIn"); }, 420);
  /* the arriving view has a box now, so its scrollers can finally be measured */
  remeasureCues(view);
  /* visibility for the work tab (clients have no work dashboard) — the active
     class itself was settled above, with the reflow that replays the ring */
  $$("#bottomNav .tab").forEach(function (t) {
    t.style.display = (t.dataset.view === "work" && (state.user || {}).role !== "pro") ? "none" : "";
  });
  renderNotify();
  renderNavAvatar();
  if (name === "bookings") renderBookings();
  if (name === "profile") renderProfile();
  if (name === "work") renderWork();
  if (name === "home") {
    /* A professional's Home is their profession, not the market: their trade
       and their ratings. No service grid, no professionals strip, no slider —
       all of it lives inside #homeMarket and is for people looking to book. */
    const u = state.user || {};
    const proStats = $("#homeProStats");
    const market = $("#homeMarket");
    if (u.role === "pro" && u.trade) {
      renderProHomeCard();
      if (market) market.style.display = "none";
      if (proStats) proStats.style.display = "";
      /* the stories rail is for people looking to book: a professional's Home
         hides it with the market, their own ring lives on their dashboard */
      const storyHead = $(".storyHead");
      if (storyHead) storyHead.style.display = "none";
      const storyStrip2 = $("#storyStrip");
      if (storyStrip2) storyStrip2.style.display = "none";
      /* chips and search narrow the market; with the market hidden they are
         dead controls, so a professional does not see them */
      const chipsRow = $("#homeChips");
      if (chipsRow) chipsRow.style.display = "none";
      const searchBox = $("#searchField");
      if (searchBox) searchBox.style.display = "none";
      /* trade lock stays in step for the chips, for when the trade changes */
      if (state.catFilter !== u.trade) {
        state.catFilter = u.trade;
        $$(".chip[data-filter]").forEach(function (c) {
          c.classList.toggle("active", c.dataset.filter === u.trade);
        });
      }
    } else {
      if (proStats) { proStats.innerHTML = ""; proStats.style.display = "none"; }
      if (market) market.style.display = "";
      const chipsRow2 = $("#homeChips");
      if (chipsRow2) chipsRow2.style.display = "";
      const storyHead2 = $(".storyHead");
      if (storyHead2) storyHead2.style.display = "";
      const storyStrip3 = $("#storyStrip");
      if (storyStrip3) storyStrip3.style.display = "";
      const searchBox2 = $("#searchField");
      if (searchBox2) searchBox2.style.display = "";
      if (state.catFilter === "all") {
        $$(".chip[data-filter]").forEach(function (c) {
          c.classList.toggle("active", c.dataset.filter === "all");
        });
      }
      renderStories(); renderHero(); renderStylists();
    }
    bindHomeChips();
  }
}

/* ---------- Pro dashboard ---------- */
/* The work tab is the professional's home: what moved since they last looked,
   what is worth money right now, and what is next on the book. It reads the
   same ledger the client's booking list does — never a second copy of the
   truth. */
function renderWork() {
  const wrap = $("#workBody");
  const u = state.user || {};
  const t = tradeById(u.trade);
  $("#workWho").textContent = t ? t.name + " · pro dashboard" : "Pro dashboard";

  /* whose identity earns here: a seeded stylist being demonstrated, or the
     signed-in pro themselves */
  const isSeed = STYLISTS.some(function (s) { return s.id === proStore.proId; });
  const earnId = isSeed ? proStore.proId : selfKey();

  const mine = state.bookings.filter(function (b) { return b.stylistId === earnId; });
  /* the money states the escrow lifecycle actually uses: escrowed = waiting on
     the pro, everything between escrowed and released is in progress */
  const waiting = mine.filter(function (b) { return statusOf(b) === "escrowed"; });
  const active = mine.filter(function (b) { const s = statusOf(b); return s === "confirmed"; });
  const needsMe = waiting.concat(active);

  const bal = proBalances(earnId);

  /* --- the business card: identity, profession, place, gallery --- */
  const me = myProviderRecord();
  const heroName = $("#workName");
  if (heroName) heroName.textContent = me ? me.name : (u.name || "You");
  const heroTrade = $("#workTrade");
  if (heroTrade) heroTrade.textContent = t ? t.name + " · professional" : "Professional";
  const heroLoc = $("#workLoc");
  if (heroLoc) heroLoc.textContent = hasLocation()
    ? (areaById(u.area) || {}).name + (u.address ? " · " + u.address : "")
    : "Set your location";
  const heroDp = $("#workDp");
  if (heroDp) {
    heroDp.innerHTML = me
      ? '<button class="workDpBtn" data-opendp="1" aria-label="Change your profile photo">' +
          avatarHtml(me, "huge") + '<span class="workDpEdit">' + icon("camera") + "</span></button>"
      : "";
  }
  const avail = providerAvailable(me);
  /* the switch is the pro's intent; a session is what is actually happening.
     When the two disagree the chip and the note below state the session. */
  const withClient = providerInSession(me);
  const open = avail && !withClient;
  /* The badges are state, not a report: availability, where they work, how much
     work is on the page. Reputation belongs beside their name instead — as a
     fourth chip it never fitted the row, so the row wrapped and left the rating
     sitting alone on a line of its own. */
  const heroChips = $("#workChips");
  if (heroChips) {
    const works = worksOf(me);
    heroChips.innerHTML =
      '<span class="provChip ' + (open ? "on" : withClient ? "busy" : "off") + '">' + icon(open ? "check" : "clock") +
        (open ? "Taking bookings" : withClient ? "In session" : "Books paused") + "</span>" +
      '<span class="provChip">' + icon("pin") + esc(hasLocation() ? (areaById(u.area) || {}).name || "—" : "No area") + "</span>" +
      '<span class="provChip">' + icon("gallery") + works.length + " work" + (works.length === 1 ? "" : "s") + "</span>";
    /* the row is one line at every width, so it can be a scroller on the
       narrowest phones — the same cue every other strip in the app uses */
    bindStripScroll(heroChips);
  }

  /* the reputation line, under the place: one line, always, and it says which
     half of the ledger it is reading whether or not there is a review yet */
  const heroRating = $("#workRating");
  if (heroRating) {
    const st = me ? ratingStats(me) : null;
    const jobs = me ? me.jobs || 0 : 0;
    heroRating.innerHTML = st && st.reviews
      ? icon("star") + st.avg.toFixed(1) + " \u00b7 " + st.reviews + " review" + (st.reviews === 1 ? "" : "s") +
        " \u00b7 " + jobs + " job" + (jobs === 1 ? "" : "s") + " done"
      : icon("star") + "No ratings yet \u00b7 " + jobs + " job" + (jobs === 1 ? "" : "s") + " done";
  }

  /* the gallery lives directly on the dashboard: a pro's pictures are their
     strongest sales tool, so they are one tap from sign-in, not buried */
  const gal = $("#workGallery");
  if (gal) {
    gal.innerHTML = me && worksOf(me).length
      ? providerWorkHtml(me)
      : '<div class="card provCard"><div class="provCardHead">' + icon("camera") + "<h4>Show your work</h4></div>" +
        '<p class="provBio">Photos of finished cuts, braids and sets are the fastest way to be booked.</p>' +
        '<div class="provCtas"><button class="ghostBtn wide" data-openfolio="1">' + icon("plus") + "Add work photos &amp; videos</button></div></div>";
  }

  /* --- the availability switch. The one control a professional reaches for
     daily, so it sits above the money and the paperwork rather than inside a
     settings sheet. Pausing closes *new* bookings only: a job already paid into
     escrow still runs, which is what the copy beside the switch says. --- */
  const availWrap = $("#workAvail");
  if (availWrap) {
    availWrap.innerHTML =
      '<div class="card availCard">' +
        '<div class="availRow">' +
          '<span class="availIco' + (open ? " on" : "") + '">' + icon(open ? "check" : "clock") + "</span>" +
          /* three states, three headlines: on, on-but-with-a-client, off. The
             switch keeps its own meaning either way, so a pro reading "the
             switch is on" next to "Not taking bookings" never sees the two
             halves of the card contradict each other. */
          '<span class="rowInfo"><b>' + (open ? "Taking bookings" : avail ? "With a client right now" : "Not taking bookings") + "</b>" +
            "<small>" + (open
              ? "Clients can book you and pay into escrow as usual."
              : avail
                ? "Your switch is on and it stays on — new bookings are held shut only until this session is settled. The work you are doing is unaffected."
                : "Your page stays up and your prices are still visible, but no one can start a booking with you until you switch this back on. Jobs already paid for still run.") + "</small></span>" +
          '<input type="checkbox" class="switch" id="availSwitch" data-avail="1"' + (avail ? " checked" : "") +
            ' role="switch" aria-label="Taking new bookings" aria-checked="' + avail + '">' +
        "</div>" +
        /* The one thing the switch cannot say, said where the pro will look for
           it: which client is holding the chair, and what hands it back. */
        (withClient
          ? '<p class="availSession">' + icon("clock") +
            '<span><b>In session with ' + esc(sessionHoldNote(withClient)) + '</b>' +
            '<small>New bookings open again the moment this job is settled — mark it done and your client releases, or the resolution desk settles it. Your page, prices and work stay up meanwhile.</small></span></p>'
          : "") +
      "</div>";
  }

  /* --- today's status: what clients see as this professional's ring on the
     spotlight rail, and the one thing here that expires by itself --- */
  renderWorkStatus();

  /* --- the rates card: what each of their services costs, as a floor and a
     ceiling. The client picks the number inside it, so this is the only place
     a professional controls the price a booking can start at. --- */
  const ratesWrap = $("#workRates");
  if (ratesWrap) {
    const offered = me ? servicesForProvider(me) : [];
    ratesWrap.innerHTML = !offered.length
      ? ""
      : '<div class="card rateCard">' +
          '<div class="provCardHead">' + icon("coin") + "<h4>Your rates</h4></div>" +
          '<p class="finePrint">Each service has a low and a high. Clients pick a price inside the range \u2014 you accept it or counter with one of your own.</p>' +
          offered.map(function (sv) {
            const r = rangeFor(me, sv.id);
            /* The pair of fields is one object, so the row can break between
               the service and its prices on a narrow phone instead of drawing
               the name over the first field */
            return '<div class="rateRow">' +
              '<span class="rateIco">' + icon(sv.ico) + "</span>" +
              '<span class="rateName"><b>' + esc(sv.name) + "</b><small>" + sv.dur + " min</small></span>" +
              '<span class="ratePair">' +
                '<input class="rateIn" type="number" inputmode="numeric" min="0" step="50"' +
                  ' data-rate-min="' + esc(sv.id) + '" value="' + r.min + '" aria-label="' + esc(sv.name) + ' lowest price">' +
                '<span class="rateDash">\u2013</span>' +
                '<input class="rateIn" type="number" inputmode="numeric" min="0" step="50"' +
                  ' data-rate-max="' + esc(sv.id) + '" value="' + r.max + '" aria-label="' + esc(sv.name) + ' highest price">' +
              "</span>" +
              "</div>";
          }).join("") +
          '<button class="nextbtn tight" id="saveRates">Save my rates</button>' +
        "</div>";
  }

  /* legacy body container: kept for any residual styles, now empty */
  if (wrap) wrap.innerHTML = "";

  /* The note names the halves of the queue rather than counting it: "needs you"
     is the Home card's job now, and repeating it here would put two numbers on
     the same list. What the page cannot say anywhere else is which half a row
     is in — a request to answer or a job in progress. */
  const count = $("#workCount");
  if (count) {
    const bits = [];
    if (waiting.length) bits.push(waiting.length + " to accept");
    if (active.length) bits.push(active.length + " in progress");
    count.textContent = bits.join(" · ");
  }
  /* The queue leads the page, and it says so out loud only when somebody is
     actually waiting: the gold hairline and the live dot are the same
     language the Home card speaks, so the two surfaces read as one app. */
  const desk = $("#deskQueue");
  if (desk) desk.classList.toggle("live", waiting.length > 0);

  let list = "";
  if (!needsMe.length) {
    list = emptyState("bookings_empty", "No requests yet", "Paid bookings for " + (t ? t.name.toLowerCase() : "your trade") + " land here the moment escrow holds them.");
  } else {
    list = needsMe.sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); }).map(function (b) {
      const sv = SERVICES.find(function (s) { return s.id === b.serviceId; }) || {};
      const net = b.pay ? b.pay.netToPro : (b.total || b.price || 0);
      return '<button class="card workCard" data-bookcard="' + esc(b.id) + '">' +
        '<span class="rowInfo"><b>' + esc(sv.name || "Booking") + " · " + esc(b.clientName || "Client") + "</b>" +
        "<small>" + esc(b.date) + " · " + esc(b.time) + " · " +
          (b.loc === "home"
            ? "Home visit" + (b.km != null
              ? " · " + (b.kmPrecise === false ? "~" : "") + fmtKm(b.km) +
                (b.km >= PRECISE_EPS ? " · ~" + driveMins(b.km) + " min" : "") +
                (b.travelFee ? " · " + naira(b.travelFee) + " travel" : "")
              : "")
            : "Walk-in at your studio") + " · you keep " + naira(net || 0) + "</small></span>" +
        '<span class="money">' + naira(b.total || b.price || 0) + "</span></button>";
    }).join("");
  }

  const reqs = $("#workRequests");
  if (reqs) reqs.innerHTML = list;
}

function enterApp() {
  AUTH_PAGES.forEach(function (p) {
    const el = document.getElementById(p);
    if (el) el.style.display = "none";
  });
  const app = $("#app");
  app.style.removeProperty("display");
  const u = state.user;
  if (u) {
    $("#homeName").textContent = u.name;
    /* Both header faces — Home's and Work's — are drawn by this one call, which
       already knows the difference between a picture and a fallback initial.
       A `#workAvatar.textContent = initials(...)` used to follow it and clobber
       the picture the line above had just drawn, so a professional signed in to
       their own dashboard looking at an initial they no longer had. */
    renderNavAvatar();
  }
  /* each role lands on its own dashboard; a pro who still has no trade goes to
     the trade step first, since their dashboard is meaningless without one */
  if (u && u.role === "pro" && !u.trade) {
    openTrade("update");
    return;
  }
  if (u && u.role === "pro") state.view = "work";
  else if (state.view === "work") state.view = "home";
  /* news starts watching from the moment there is somebody to tell */
  startNewsWatch();
  /* and the session clock starts with it: a professional coming free when an
     escrow settles is the one change nobody taps for */
  startSessionWatch();
  renderInstall();
  renderNotifyPermit();
  renderPushStatus();
  /* the push registration was last bound to whichever account used this
     device: re-bind it to the one signing in now */
  bindPushToAccount();
  switchView(state.view || "home");
  /* the dashboard opens at its top, whether or not the tab itself changed */
  const landing = $("#view-" + (state.view || "home"));
  if (landing) landing.scrollTop = 0;
  refreshLocationUI();
  /* a notification tap lands here on a cold start: route the hash before the
     user has scrolled anywhere, then scrub it */
  setTimeout(function () { consumeRoute(); }, 80);
  /* The world outside this device is read on the way in: bookings, the
     directory the database holds, and whether this account works the desk.
     Each lands async and re-paints what it feeds, so the dashboard appears
     immediately from its cache and is corrected a moment later. */
  if (typeof dbCloudSync === "function") dbCloudSync();
  if (!hasLocation()) openLocation("app");
}

