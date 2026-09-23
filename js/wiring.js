/* =========================================================
 * Pampa — wiring — the last file
 * Every listener the app installs, and boot. Nothing else may be loaded after it.
 * ========================================================= */

/* ---------- Wiring ---------- */
/* Scroll events do not bubble, but they do capture — one listener keeps every
   declared scroller honest about which of its four sides still has content,
   on both axes. Rows that are rebuilt by a render are re-measured by that
   render's own bindScrollCue() call; this is for the ones that move because
   somebody scrolled them. */
function wireScrollCues() {
  document.addEventListener("scroll", function (e) {
    const el = e.target;
    if (el && el.classList && el.classList.contains("cueScroll")) updateScrollCue(el);
  }, true);
  /* a wider window can fit more rows, or fewer — either way the cues change */
  window.addEventListener("resize", function () {
    document.querySelectorAll(".cueScroll").forEach(updateScrollCue);
  });
}

/* The category strip is a horizontal scroller too, so it uses the same helper
   and the same two tokens as every other strip — one vocabulary for "there is
   more this way", everywhere. Its chips are re-labelled by re-render rather
   than by a call from each render path, so the row watches itself. */
function wireChipFade() {
  const rows = document.querySelectorAll(".chips");
  if (!rows.length) return;
  let raf = 0;
  const soon = function () {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      rows.forEach(function (el) { if (el.__stripUpdate) el.__stripUpdate(); });
    });
  };
  rows.forEach(function (el) {
    bindStripScroll(el);
    el.addEventListener("scroll", soon, { passive: true });
    if (window.MutationObserver) new MutationObserver(soon).observe(el, { childList: true, subtree: true });
  });
  window.addEventListener("resize", soon);
  soon();
}

/* One path for "show me this category": the chips, the trade strip and the
   featured slider all land here, so the grid, the chips and the scroll
   position can never disagree about which category is showing. Scrolling is
   left to the caller — tapping a chip should not jump the page. */
function applyCat(cat, scroll) {
  /* A professional browses their own trade only: a chip or a slider slide
     outside it never re-filters their Home. */
  const u = state.user || {};
  if (u.role === "pro" && u.trade && cat !== u.trade) {
    const mine = tradeById(u.trade);
    toast("Your Home shows " + (mine ? mine.name.toLowerCase() : "your trade") + " only");
    cat = u.trade;
  }
  state.catFilter = cat;
  $$(".chip[data-filter]").forEach(function (c) {
    c.classList.toggle("active", c.dataset.filter === cat);
  });
  /* A chip narrows the whole page: the professionals list and the spotlight
     rail read the same filter, so both are re-rendered here or they keep
     showing technicians of a trade the reader just ruled out. */
  renderStylists();
  renderStories();
  if (!scroll) return;
  const list = $("#providerList");
  if (list && list.scrollIntoView) list.scrollIntoView({ behavior: "smooth", block: "start" });
}

function wireHero() {
  const slider = $("#heroSlider");
  if (!slider || slider.dataset.wired === "1") return;
  slider.dataset.wired = "1";
  let queued = false;
  slider.addEventListener("scroll", function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; heroSync(); });
  }, { passive: true });
  /* a swipe means the reader is driving: hold the autoplay down for a while */
  const hold = function () { heroHold = Date.now() + 12000; };
  slider.addEventListener("pointerdown", hold, { passive: true });
  slider.addEventListener("wheel", hold, { passive: true });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) heroAutoplay();
  });
}

function wire() {
  wireScrollCues();
  wireChipFade();
  wireHero();
  document.addEventListener("click", function (e) {
    const t = e.target;
    const themePick = t.closest("[data-theme-set]");
    if (themePick) {
      if (themePick.dataset.themeSet !== currentTheme()) setTheme(themePick.dataset.themeSet);
      return;
    }
    const goto = t.closest("[data-goto]");
    if (goto) { showPage(goto.dataset.goto); return; }
    const tab = t.closest(".tab");
    if (tab) { switchView(tab.dataset.view); return; }
    const chipF = t.closest(".chip[data-filter]");
    if (chipF) { applyCat(chipF.dataset.filter, false); return; }
    const chipS = t.closest(".chip[data-status]");
    if (chipS) {
      $$(".chip[data-status]").forEach(function (c) { c.classList.remove("active"); });
      chipS.classList.add("active");
      state.statusFilter = chipS.dataset.status;
      renderBookings();
      return;
    }
    const book = t.closest("[data-book]");
    if (book) { openSheet(book.dataset.book); return; }
    const gotoWork = t.closest("[data-goto-work]");
    if (gotoWork) { switchView("work"); return; }
    /* a job row in the Bookings tab is the pro's door back to the desk, where
       the money actions and the client's details actually live */
    const proJob = t.closest("[data-gotowork]");
    if (proJob) { switchView("work"); return; }
    /* the Home card's "more" line opens the full activity sheet */
    const openAttn = t.closest("[data-opennotify]");
    if (openAttn) { openNotifySheet(); return; }
    const actMore = t.closest("[data-act-more]");
    if (actMore) { actExpanded = !actExpanded; renderProHomeCard(); return; }
    /* a clip event in the activity feed opens the clip itself */
    const actClip = t.closest("[data-actclip]");
    if (actClip) { openClipFeed({ clipId: actClip.dataset.actclip }); return; }
    /* a status event in the bell plays the story it is about */
    const notifyStatus = t.closest("[data-notifystatus]");
    if (notifyStatus) {
      hideSheetEl("#notifySheet");
      const sid = notifyStatus.getAttribute("data-notifystatus");
      /* The news is about a status, and the reader is the status's owner only
         half the time now that a client is told when a professional answers
         them: a client has no provider record to open the story *as*, so the
         owner is found from the status id instead. */
      const owner = myProviderRecord() || providerForStatusId(sid);
      if (owner) openStory(owner.id, sid);
      return;
    }
    /* the professional answering a client's status message without leaving the
       desk: the composer opens under the row, and the toggle keeps the list
       exactly where it was rather than jumping back to the top */
    const statusReply = t.closest("[data-statusreply]");
    if (statusReply) {
      const key = statusReply.getAttribute("data-statusreply");
      statusReplyTarget = statusReplyTarget === key ? "" : key;
      const body = $("#notifyBody");
      const keep = body ? body.scrollTop : 0;
      renderNotifySheet();
      if (body) body.scrollTop = keep;
      return;
    }
    const statusReplySend = t.closest("[data-statusreplysend]");
    if (statusReplySend) {
      sendReplyFromBell(statusReplySend.getAttribute("data-statusreplysend"));
      return;
    }
    const actRefresh = t.closest("[data-act-refresh]");
    if (actRefresh) {
      renderProHomeCard();
      /* spin the new button, since a re-render replaces the one that was clicked */
      const host = $("#homeProStats");
      const fresh = host ? host.querySelector(".actRefresh") : null;
      if (fresh) {
        fresh.classList.add("spin");
        setTimeout(function () { fresh.classList.remove("spin"); }, 600);
      }
      toast("Activity refreshed");
      return;
    }
    /* spotlight cards open the professional's public profile */
    const gotoPro = t.closest("[data-goto-pro]");
    if (gotoPro) {
      /* a profile opened from the rail sits on top of it, so the rail closes */
      if (t.closest("#clipFeed")) closeClipFeed();
      openProviderProfile(gotoPro.dataset.gotoPro);
      return;
    }
    /* dots move the slider; anywhere else on a slide filters the grid */
    const dot = t.closest("[data-hero-dot]");
    if (dot) {
      heroHold = Date.now() + 12000;
      heroTo(Number(dot.dataset.heroDot));
      return;
    }
    /* ---- status: the ring, the viewer, the composer ----
       Order matters in this block. A delete lives inside a tile that itself
       opens a story, so it is read first; the viewer's own controls are read
       before the rail's rings, because the rail is on screen underneath it. */
    const statusDel = t.closest("[data-status-del]");
    if (statusDel) { deleteStatus(statusDel.getAttribute("data-status-del")); return; }
    /* a client's answer to a story: one emoji, in place, or a short message
       that lands in the professional's bell */
    const reactBtn = t.closest("[data-react]");
    if (reactBtn) { statusReactTap(reactBtn.getAttribute("data-react")); return; }
    const svMsgGo = t.closest("[data-svmsg]");
    if (svMsgGo) { statusSendTap(); return; }
    const pickStatusPhoto = t.closest("#statusPickPhoto");
    if (pickStatusPhoto) {
      const input = $("#statusPhotoIn");
      if (input) { input.value = ""; input.click(); }
      return;
    }
    const pickStatusClip = t.closest("#statusPickClip");
    if (pickStatusClip) {
      const input = $("#statusClipIn");
      if (input) { input.value = ""; input.click(); }
      return;
    }
    if (t.closest("#statusPickWork")) {
      statusDraft.workPick = !statusDraft.workPick;
      renderStatusSheet();
      return;
    }
    const statusKind = t.closest("[data-status-kind]");
    if (statusKind) { statusSetKind(statusKind.getAttribute("data-status-kind")); return; }
    const statusBg = t.closest("[data-status-bg]");
    if (statusBg) { statusSetBg(statusBg.getAttribute("data-status-bg")); return; }
    const statusWork = t.closest("[data-status-usework]");
    if (statusWork) { statusUseWork(statusWork.getAttribute("data-status-usework")); return; }
    if (t.closest("[data-status-addlink]")) { statusUseLink(); return; }
    if (t.closest("[data-status-open]")) {
      /* the composer is a sheet, and a sheet lives under the story viewer — so
         posting from inside a story closes the story it was opened from */
      if (t.closest("#storyView")) closeStory();
      openStatusSheet();
      return;
    }
    if (t.closest("#storyView")) {
      if (t.closest("#svClose")) { closeStory(); return; }
      if (t.closest("#svPrev")) { storyStep(-1); return; }
      if (t.closest("#svNext")) { storyStep(1); return; }
      const svProfile = t.closest("[data-svprofile]");
      if (svProfile) {
        const id = svProfile.getAttribute("data-svprofile");
        closeStory();
        openProviderProfile(id);
        return;
      }
      const svBook = t.closest("[data-svbook]");
      if (svBook) {
        const id = svBook.getAttribute("data-svbook");
        const st = stylistById(id);
        closeStory();
        if (st && providerInSession(st)) toast(st.name + " is with a client right now");
        else if (st && !providerAvailable(st)) toast(st.name + " isn't taking new bookings right now");
        else {
          const sv = st ? servicesForProvider(st)[0] : null;
          if (sv) openSheet(sv.id, id);
        }
        return;
      }
    }
    const ring = t.closest("[data-story]");
    if (ring) { openStory(ring.getAttribute("data-story")); return; }

    const hero = t.closest("[data-hero]");
    if (hero) { heroHold = Date.now() + 12000; applyCat(hero.dataset.hero, true); return; }
    const bookStylist = t.closest("[data-book-stylist]");
    if (bookStylist) {
      const st = stylistById(bookStylist.dataset.bookStylist);
      /* One door onto a booking, so both reasons are read here as well as in
         the sheet: tapping Book on a paused professional — or one who is with
         a client — answers where the tap happened, in its own words. */
      const busy = providerInSession(st);
      if (busy) {
        toast(st.name + " is with a client " + sessionSinceLabel(busy) + " — they open again once that job is settled");
        return;
      }
      if (st && !providerAvailable(st)) {
        toast(st.name + " isn't taking new bookings right now");
        return;
      }
      // open on their headline service; the sheet lets the client switch to
      // any other service their trade covers
      const sv = servicesForProvider(st)[0];
      if (sv) openSheet(sv.id, st.id);
      else toast("That provider has no services yet");
      return;
    }
    const sheetSvc = t.closest("[data-sheet-svc]");
    if (sheetSvc) {
      state.draft.serviceId = sheetSvc.dataset.sheetSvc;
      renderSheet();
      return;
    }
    const pickStylist = t.closest("[data-pick-stylist]");
    if (pickStylist) {
      state.draft.stylistId = pickStylist.dataset.pickStylist;
      state.draft.time = null;
      renderSheet();
      return;
    }
    /* "Choose someone else" on a sheet that was opened for one professional:
       the list comes back, and the sheet stays a question from then on. */
    const pickChange = t.closest("[data-pick-change]");
    if (pickChange) {
      state.draft.locked = false;
      renderSheet();
      return;
    }
    const areaBtn = t.closest("[data-area]");
    if (areaBtn) {
      locDraft.area = areaBtn.dataset.area;
      renderAreaList();
      return;
    }
    /* ---- trade picker ---- */
    const tradeCard = t.closest("[data-trade]");
    if (tradeCard) {
      tradeDraft.trade = tradeCard.dataset.trade || null;
      renderTrades();
      return;
    }
    if (t.closest("#editTrade")) {
      openTrade("update");
      return;
    }
    /* ---- the price a client names, inside the pro's own range ---- */
    const offer = t.closest("[data-offer]");
    if (offer) {
      const sv = SERVICES.find(function (s) { return s.id === state.draft.serviceId; });
      if (sv && state.draft.stylistId) {
        const range = rangeFor(stylistById(state.draft.stylistId), sv.id);
        const pick = offer.dataset.offer;
        const mid = roundTo50((range.min + range.max) / 2);
        state.draft.offer = pick === "min" ? range.min : pick === "max" ? range.max : mid;
        renderSheet();
      }
      return;
    }
    /* the professional's one-tap prices inside the negotiate sheet */
    const negoSet = t.closest("[data-nego-set]");
    if (negoSet) {
      setNegoPrice(negoSet.dataset.negoSet);
      return;
    }
    /* ---- client escrow actions ---- */
    const pay = t.closest("[data-pay]");
    if (pay) {
      openPaySheet(pay.dataset.pay);
      return;
    }
    /* a counter the professional sent: accepting it is the client's half, and
       it can move money either way — a higher price needs a top-up, a lower
       one refunds the difference */
    const accCounter = t.closest("[data-acceptcounter]");
    if (accCounter) {
      acceptCounter(accCounter.dataset.acceptcounter).then(function (res) {
        if (res.ok) {
          toast("Price agreed at " + naira(res.price) + (res.topUp ? " — pay the " + naira(res.topUp) + " top-up to confirm" : " — booking confirmed"));
          if (res.topUp) openTopUpSheet(accCounter.dataset.acceptcounter);
        } else {
          toast(res.msg);
        }
        renderBookings();
      });
      return;
    }
    const decCounter = t.closest("[data-declinecounter]");
    if (decCounter) {
      pampaConfirm({
        title: "Decline " + naira(offerOf(findBooking(decCounter.dataset.declinecounter) || {})) + "?",
        body: "The booking ends and everything in escrow comes straight back to you.",
        confirmLabel: "Decline · refund",
        danger: true,
      }).then(function (yes) {
        if (!yes) return;
        declineCounter(decCounter.dataset.declinecounter).then(function (res) {
          toast(res.ok ? "Counter declined · " + naira(res.refunded) + " refunded" : res.msg);
          renderBookings();
        });
      });
      return;
    }
    const method = t.closest("[data-paymethod]");
    if (method) {
      payDraft.method = method.dataset.paymethod;
      renderPaySheet();
      return;
    }
    /* releasing is the moment a client can rate the job, so the button opens
       the review sheet and the release happens from there */
    const release = t.closest("[data-release]");
    if (release) {
      openRateSheet(release.dataset.release);
      return;
    }
    const stars = t.closest("[data-rate]");
    if (stars) {
      rateDraft.stars = Math.min(5, Math.max(1, Number(stars.dataset.rate) || 5));
      paintRateStars();
      return;
    }
    const notifyGo = t.closest("[data-notifygo]");
    if (notifyGo) {
      openBookingDesk(notifyGo.dataset.notifygo);
      return;
    }
    /* the booking card itself is a jump target: news deep links land here */
    const bookCard = t.closest("[data-bookcard]");
    if (bookCard) { openBookingDesk(bookCard.dataset.bookcard); return; }
    const notifyClip = t.closest("[data-notifyclip]");
    if (notifyClip) {
      openClipFromNotify(notifyClip.dataset.notifyclip, notifyClip.dataset.notifykind);
      return;
    }
    /* the owner answering a comment: the composer aims at that one thread */
    const replyTo = t.closest("[data-replyto]");
    if (replyTo) { setReplyTarget(replyTo.dataset.replyto); return; }
    const provBook = t.closest("[data-providerbook]");
    if (provBook) {
      const of = state.providerView;
      if (of) {
        exitProviderProfile();
        openSheet(provBook.dataset.providerbook, of);
      }
      return;
    }
    const editBio = t.closest("[data-editbio]");
    if (editBio) {
      openBioSheet();
      return;
    }
    /* ---- the provider's own public face: picture and portfolio ---- */
    const openFolio = t.closest("[data-openfolio]");
    if (openFolio) {
      openFolioSheet();
      return;
    }
    /* the video link's own button: a pasted link must not depend on the reader
       knowing that Enter submits it */
    const addLink = t.closest("[data-addlink]");
    if (addLink) {
      addWorkLink();
      return;
    }
    /* the face itself is the way in to changing it, on both dashboards */
    /* ---- the clip rail ---- */
    const openClips = t.closest("[data-openclips]");
    if (openClips) {
      openClipFeed({ scope: openClips.dataset.openclips });
      return;
    }
    const clipOpen = t.closest("[data-clipopen]");
    if (clipOpen) {
      openClipFeed({ clipId: clipOpen.dataset.clipopen });
      return;
    }
    const clipTab = t.closest("[data-clipscope]");
    if (clipTab) {
      clipFeedState.scope = clipTab.dataset.clipscope;
      clipFeedState.items = clipItems(clipFeedState.scope);
      clipFeedState.index = 0;
      renderClipFeed();
      return;
    }
    if (t.closest("#clipClose")) { closeClipFeed(); return; }
    if (t.closest("#clipSound")) { toggleClipSound(t.closest("#clipSound")); return; }
    const clipLike = t.closest("[data-cliplike]");
    if (clipLike) {
      const id = clipLike.dataset.cliplike;
      const liked = toggleLike(id);
      clipLike.classList.toggle("on", liked);
      refreshClipCounts(id);
      if (liked) burstHeart(clipLike.closest(".clipSlide") || clipLike);
      return;
    }
    const clipComments = t.closest("[data-clipcomments]");
    if (clipComments) {
      openComments(clipComments.dataset.clipcomments);
      return;
    }
    const clipTap = t.closest("[data-cliptap]");
    if (clipTap && !t.closest(".clipRail") && !t.closest(".clipMeta")) {
      clipStageTap(clipTap.closest(".clipSlide") || clipTap);
      return;
    }
    /* the face in the Work header goes to the page that owns it */
    if (t.closest("#workAvatar")) { switchView("profile"); return; }
    const openDp = t.closest("[data-opendp]");
    if (openDp) {
      if (myProviderRecord()) openDpSheet();
      return;
    }
    /* a share link swaps its poster for the player only on this tap */
    const ytPlay = t.closest("[data-ytplay]");
    if (ytPlay) {
      const id = ytPlay.dataset.ytplay;
      const frame = '<iframe class="wvFrame" src="https://www.youtube.com/embed/' + esc(id) +
        '" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
      if (t.closest("#clipFeed")) {
        /* inside the rail the player takes over that one slide, not the viewer */
        const stage = ytPlay.closest(".clipStage");
        if (stage) stage.innerHTML = frame;
        return;
      }
      const stage = $("#workViewStage");
      const label = $("#workViewLabel");
      if (stage) {
        stage.innerHTML = '<iframe class="wvFrame" src="https://www.youtube.com/embed/' + esc(id) +
          '" title="' + esc(label ? label.textContent : "Clip") +
          '" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
      }
      return;
    }
    const rmWork = t.closest("[data-work-rm]");
    if (rmWork) {
      removeWork(rmWork.dataset.workRm);
      return;
    }
    const viewWork = t.closest("[data-work-view]");
    if (viewWork) {
      const owner = stylistById(viewWork.dataset.workProvider);
      const work = owner ? worksOf(owner).find(function (w) { return w.id === viewWork.dataset.workView; }) : null;
      if (work) openWorkView(work.src, work.note || (owner ? owner.name : ""), isVideoWork(work));
      return;
    }
    const prov = t.closest("[data-provider]");
    if (prov) {
      openProviderProfile(prov.dataset.provider);
      return;
    }
    const dispute = t.closest("[data-dispute]");
    if (dispute) {
      openDisputeSheet(dispute.dataset.dispute);
      return;
    }
    /* ---- dispute evidence ---- */
    const eviRemove = t.closest("[data-eviremove]");
    if (eviRemove) {
      removeEvidence(eviRemove.dataset.eviremove);
      return;
    }
    const eviFile = t.closest("[data-evifile]");
    if (eviFile) {
      evidenceTarget = { kind: eviFile.dataset.evifile, bookingId: eviFile.dataset.evibooking || null };
      const input = $("#evidenceInput");
      if (input) {
        input.value = "";
        input.click();
      }
      return;
    }
    const eviPhoto = t.closest("[data-eviphoto]");
    if (eviPhoto) {
      const side = eviPhoto.dataset.eviphoto;
      openPhotoViewer(eviPhoto.dataset.evibooking || null, side, Number(eviPhoto.dataset.eviindex) || 0, evidenceLabel(side));
      return;
    }
    const respond = t.closest("[data-respond]");
    if (respond) {
      submitDisputeResponse(respond.dataset.respond);
      return;
    }
    const reason = t.closest("[data-reason]");
    if (reason) {
      disputeDraft.reason = reason.dataset.reason;
      const noteEl = $("#disputeNote");
      if (noteEl) disputeDraft.note = noteEl.value;
      renderDisputeSheet();
      return;
    }
    const journalBtn = t.closest("[data-journal]");
    if (journalBtn) {
      const body = document.querySelector('[data-journalbody="' + journalBtn.dataset.journal + '"]');
      if (body) {
        const open = body.style.display !== "block";
        body.style.display = open ? "block" : "none";
        journalBtn.textContent = open ? "Hide money trail" : "Money trail";
      }
      return;
    }

    /* ---- resolution desk ---- */
    const outcome = t.closest("[data-outcome]");
    if (outcome) {
      const p = pickFor(outcome.dataset.outcomeFor);
      p.outcome = outcome.dataset.outcome;
      renderDesk();
      return;
    }
    const settle = t.closest("[data-settle]");
    if (settle) {
      settleFromDesk(settle.dataset.settle);
      return;
    }    const cancelJobBtn = t.closest("[data-canceljob]");
    if (cancelJobBtn) {
      /* Cancelling moves real money and can cost a fee — the tap that asked
         for it is never the tap that does it. */
      const id = cancelJobBtn.dataset.canceljob;
      const b = findBooking(id);
      const feeNote = b && b.pay ? "A 10% fee applies to cancelling a confirmed job." : "The escrow comes back to you in full.";
      pampaConfirm({
        title: "Cancel this booking?",
        body: (b ? (b.stylistName || "The professional") + " loses the slot, and " + feeNote : feeNote),
        confirmLabel: "Cancel booking",
        danger: true,
      }).then(function (yes) {
        if (!yes) return;
        cancelJob(id).then(function (res) {
          if (res.ok) {
            toast(res.refunded > 0 ? "Cancelled · " + naira(res.refunded) + " refunded" : "Booking cancelled");
          } else {
            toast(res.msg);
          }
          renderBookings();
        });
      });
      return;
    }

    /* ---- pro mode ---- */
    const proTabBtn = t.closest("[data-protab]");
    if (proTabBtn) {
      proTab = proTabBtn.dataset.protab;
      renderPro();
      return;
    }
    const acceptBtn = t.closest("[data-acceptjob]");
    if (acceptBtn) {
      acceptBooking(acceptBtn.dataset.acceptjob).then(function (res) {
        toast(res.ok ? "Job accepted at the client's price — they have been notified" : res.msg);
        renderPro();
        renderBookings();
      });
      return;
    }
    /* negotiating: the pro answers a request with a price of their own */
    const negoBtn = t.closest("[data-negotiate]");
    if (negoBtn) {
      openNegoSheet(negoBtn.dataset.negotiate);
      return;
    }
    /* the rates card: one floor and ceiling per service */
    if (t.closest("#saveRates")) {
      const res = saveRates();
      toast(res.msg);
      return;
    }
    const declineBtn = t.closest("[data-declinejob]");
    if (declineBtn) {
      pampaConfirm({
        title: "Decline this job?",
        body: "The client's escrow is refunded in full, and the slot goes back on the market.",
        confirmLabel: "Decline job",
        danger: true,
      }).then(function (yes) {
        if (!yes) return;
        declineBooking(declineBtn.dataset.declinejob).then(function (res) {
          toast(res.ok ? "Declined — client refunded " + naira(res.refunded) : res.msg);
          renderPro();
          renderBookings();
        });
      });
      return;
    }
    const doneBtn = t.closest("[data-jobdone]");
    if (doneBtn) {
      markJobDone(doneBtn.dataset.jobdone).then(function (res) {
        toast(res.ok ? "Marked done — waiting for the client to release payment" : res.msg);
        renderPro();
        renderBookings();
      });
      return;
    }
    const destType = t.closest("[data-desttype]");
    if (destType) {
      captureDestInputs();
      destDraft.type = destType.dataset.desttype;
      renderPro();
      return;
    }
    if (t.closest("#saveDest")) {
      const res = saveDestination(proStore.proId);
      toast(res.ok ? "Payout destination saved" : res.msg);
      renderPro();
      return;
    }
    if (t.closest("#withdrawBtn")) {
      const res = requestPayout(proStore.proId);
      toast(res.ok ? naira(res.payout.amount) + " sent to " + res.payout.to : res.msg);
      renderPro();
      return;
    }
    const slot = t.closest(".slot");
    if (slot) {
      if (slot.disabled) return;
      $$(".slot").forEach(function (s) { s.classList.remove("active"); });
      slot.classList.add("active");
      state.draft.time = slot.dataset.slot;
      return;
    }
    const where = t.closest(".where");
    if (where) {
      if (where.disabled) return;
      state.draft.loc = where.dataset.loc;
      renderSheet();
      return;
    }
    /* "Use my location for the exact fee", on the fee box itself: the client's
       own tap, so the only one allowed to speak about it. The fresh fix
       re-prices the sheet when it lands. */
    if (t.closest("[data-freshen-gps]")) {
      freshenClientFix({ announce: true });
      return;
    }
  });

  $$(".signIn").forEach(function (btn) {
    btn.addEventListener("click", function () { setAuthMode("signin"); });
  });
  $$(".createAccount").forEach(function (btn) {
    btn.addEventListener("click", function () { setAuthMode("signup"); });
  });

  $("#sendOtp").addEventListener("click", sendOtp);
  /* Enter with the field, not just the button: three fields, one act each */
  ["#signinId", "#signinPassword", "#telephone"].forEach(function (sel) {
    const el = $(sel);
    if (!el) return;
    el.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      $("#sendOtp").click();
    });
  });
  $("#verifyOtp").addEventListener("click", verifyOtp);
  $("#saveName").addEventListener("click", saveName);
  $("#pwSave").addEventListener("click", savePassword);
  $("#passwordBack").addEventListener("click", function () {
    if (passwordContext === "change") { enterApp(); return; }
    if (passwordContext === "setup") { pendingAccount = null; showPage("number"); return; }
    showPage("name");
  });
  $("#changePassword").addEventListener("click", function () {
    if (!state.user) return;
    openPassword("change");
  });
  /* reveal toggles: one eye, two states, on every password field */
  [["#signinPwEye", "#signinPassword"], ["#pwCurrentEye", "#pwCurrent"], ["#pwNewEye", "#pwNew"]]
    .forEach(function (pair) {
      const btn = $(pair[0]);
      const input = $(pair[1]);
      if (!btn || !input) return;
      btn.addEventListener("click", function () {
        const shown = input.type === "text";
        input.type = shown ? "password" : "text";
        btn.innerHTML = '<span data-icon="' + (shown ? "eye" : "eyeOff") + '"></span>';
        hydrateIcons(btn);
        btn.setAttribute("aria-label", shown ? "Show password" : "Hide password");
        input.focus();
      });
    });
  /* Enter submits the password screens, like the code screen before them */
  ["#signinPassword", "#telephone"].forEach(function (sel) {
    const el = $(sel);
    if (el) el.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      sendOtp();
    });
  });
  ["#pwNew", "#pwCurrent"].forEach(function (sel) {
    const el = $(sel);
    if (el) el.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      savePassword();
    });
  });
  $("#saveTrade").addEventListener("click", saveTrade);
  $("#logoutBtn").addEventListener("click", logout);
  $("#useGps").addEventListener("click", useGps);
  $("#saveLocation").addEventListener("click", saveLocation);
  $("#locationBack").addEventListener("click", closeLocation);
  $("#editLocation").addEventListener("click", function () { openLocation("app"); });
  $("#saveRole").addEventListener("click", saveRole);
  $("#roleBack").addEventListener("click", function () { showPage("name"); });
  $("#homeAddress").addEventListener("keydown", function (e) {
    if (e.key === "Enter") saveLocation();
  });
  /* The address places as it is typed, and typing is what makes the text — not
     an earlier device fix — the thing that decides. The line under the field
     then answers before Continue is pressed rather than after it is refused. */
  $("#homeAddress").addEventListener("input", function () {
    locDraft.last = "address";
    renderLocState();
  });
  /* Home's address block: the area button opens the location screen, the field
     writes the street address home visits are sent to. */
  $("#homeAreaBtn").addEventListener("click", function () { openLocation("app"); });
  /* the face in the corner goes to the page that owns it */
  $("#homeAvatar").addEventListener("click", function () { switchView("profile"); });
  document.addEventListener("change", function (e) {
    if (e.target && e.target.id === "bookDate") {
      state.draft.date = e.target.value || todayIso();
      state.draft.time = null;
      renderSheet();
      return;
    }
    /* the availability switch. If there is no provider record to write to, the
       switch is put back where it was rather than lying about the state. */
    const avail = e.target && e.target.closest ? e.target.closest("[data-avail]") : null;
    if (avail) {
      const on = !!avail.checked;
      if (!setProviderAvailable(on)) {
        avail.checked = !on;
        toast("Register your trade first — that is what clients book");
        return;
      }
      toast(on ? "You're taking bookings again" : "New bookings are paused");
    }
  });
  /* role cards select; the work dashboard's cards open the escrow desk */
  document.addEventListener("click", function (e) {
    const rc = e.target.closest("[data-role]");
    if (rc) {
      roleDraft = rc.dataset.role;
      renderRoles();
      renderAuthKicker();
      return;
    }
    const wc = e.target.closest(".workCard, #workOpenPro");
    if (wc) { enterProMode(); return; }
  });

  $("#payNow").addEventListener("click", confirmPayment);
  $("#closePay").addEventListener("click", closeAllSheets);
  $("#proEntry").addEventListener("click", enterProMode);
  $("#proExit").addEventListener("click", exitProMode);
  $("#providerExit").addEventListener("click", exitProviderProfile);
  /* One bell per dashboard head — Home, Work, Bookings, Profile — all opening
     the same sheet, so the news is one tap away wherever the reader is. */
  $$(".notifyBtn").forEach(function (b) {
    b.addEventListener("click", openNotifySheet);
  });

  $("#notifyPermitBtn").addEventListener("click", askNotifyPermission);
  $("#notifyEntry").addEventListener("click", function () {
    /* the Profile row asks when it can be asked, and explains when it cannot */
    if (notifyPermission() === "default") askNotifyPermission();
    else if (notifyPermission() === "granted") toast("Notifications are on");
    else if (notifyPermission() === "denied") toast("Blocked in your browser settings");
    else toast("This browser cannot show notifications");
  });
  $("#installEntry").addEventListener("click", doInstall);
  renderInstall();
  renderNotifyPermit();
  $("#closeNotify").addEventListener("click", function () { hideSheetEl("#notifySheet"); });
  $("#notifyDone").addEventListener("click", function () { hideSheetEl("#notifySheet"); });
  $("#closeRate").addEventListener("click", function () { hideSheetEl("#rateSheet"); });
  $("#rateSkip").addEventListener("click", function () { finishRelease(false); });
  $("#rateSubmit").addEventListener("click", function () { finishRelease(true); });
  $("#closeBio").addEventListener("click", function () { hideSheetEl("#bioSheet"); });
  $("#closeContact").addEventListener("click", function () { hideSheetEl("#contactSheet"); });
  $("#contactSave").addEventListener("click", saveContact);
  $("#editContact").addEventListener("click", openContactSheet);
  $("#workEditContact").addEventListener("click", openContactSheet);
  $("#bioSave").addEventListener("click", saveBio);
  $("#editBio").addEventListener("click", openBioSheet);
  $("#deskEntry").addEventListener("click", enterDeskMode);
  $("#deskExit").addEventListener("click", exitDeskMode);
  $("#closeDispute").addEventListener("click", closeAllSheets);
  $("#disputeSubmit").addEventListener("click", submitDispute);
  $("#evidenceInput").addEventListener("change", function (e) {
    const target = evidenceTarget;
    /* Copy first: clearing the input empties the live FileList. */
    const files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = "";
    if (!target || !files.length) return;
    const draft = target.kind === "response" ? responseDraftFor(target.bookingId) : disputeDraft;
    addEvidence(draft, files).then(function (r) {
      if (r.msg) toast(r.msg);
      if (target.kind === "response") renderPro();
      else renderDisputeSheet();
    });
  });
  $("#pvClose").addEventListener("click", closePhotoViewer);
  $("#photoViewer").addEventListener("click", closePhotoViewer);

  /* ---- profile photo + portfolio: the provider's public face ---- */
  $("#editPhoto").addEventListener("click", openDpSheet);
  $("#editPortfolio").addEventListener("click", openFolioSheet);
  $("#closeDp").addEventListener("click", function () { hideSheetEl("#dpSheet"); });
  $("#closeFolio").addEventListener("click", function () { hideSheetEl("#folioSheet"); });
  /* ---- status: the pickers and the viewer's own gestures ---- */
  $("#closeStatus").addEventListener("click", function () { hideSheetEl("#statusSheet"); });
  $("#statusPost").addEventListener("click", publishStatus);
  $("#statusPhotoIn").addEventListener("change", function (e) {
    const file = (e.target.files || [])[0];
    e.target.value = "";
    if (file) statusAddPhoto(file);
  });
  $("#statusClipIn").addEventListener("change", function (e) {
    const file = (e.target.files || [])[0];
    e.target.value = "";
    if (file) statusAddClip(file);
  });
  $("#svClose").addEventListener("click", closeStory);
  /* A story is watched with one hand: hold anywhere on the picture to stop it,
     lift to carry on. The two tap zones sit over the picture as their own
     buttons, so the stage underneath is free for this. */
  const svStage = $("#storyStage");
  svStage.addEventListener("pointerdown", function () { storyHoldOn("finger"); });
  svStage.addEventListener("pointerup", function () { storyHoldOff("finger"); });
  svStage.addEventListener("pointercancel", function () { storyHoldOff("finger"); });
  svStage.addEventListener("pointerleave", function () { storyHoldOff("finger"); });
  /* A client writing to a professional is not watching the next one: the story
     stands still while the message field has the focus, and the reaction row
     belongs to the professional on screen for as long as it takes to write. */
  const svMsgDoc = document;
  svMsgDoc.addEventListener("focusin", function (e) {
    if (e.target && e.target.id === "svMsg") storyHoldOn("typing");
  });
  svMsgDoc.addEventListener("focusout", function (e) {
    if (e.target && e.target.id === "svMsg") storyHoldOff("typing");
  });
  /* Swipe the card down to dismiss, the way a story closes everywhere else. */
  let svDrag = null;
  const svFrame = $("#storyView");
  svFrame.addEventListener("pointerdown", function (e) {
    if (e.target.closest("button, a")) return;
    svDrag = { y: e.clientY, dy: 0, id: e.pointerId };
  });
  svFrame.addEventListener("pointermove", function (e) {
    if (!svDrag || e.pointerId !== svDrag.id) return;
    svDrag.dy = Math.max(0, e.clientY - svDrag.y);
    const card = $("#svCard");
    if (!card) return;
    card.style.transform = "translateY(" + svDrag.dy + "px)";
    card.style.opacity = String(Math.max(0.35, 1 - svDrag.dy / 420));
  });
  const svDrop = function () {
    if (!svDrag) return;
    const dy = svDrag.dy;
    svDrag = null;
    const card = $("#svCard");
    if (card) { card.style.transform = ""; card.style.opacity = ""; }
    if (dy > 90) closeStory();
  };
  svFrame.addEventListener("pointerup", svDrop);
  svFrame.addEventListener("pointercancel", svDrop);
  document.addEventListener("keydown", function (e) {
    const el = $("#storyView");
    if (!el || el.style.display === "none") return;
    /* a field inside the viewer owns its own keys — an arrow, a space or an
       Escape belongs to the sentence being written, not to the story */
    const inField = /input|textarea|select/i.test(((e.target || {}).tagName) || "");
    if (e.key === "Escape") {
      if (inField) { e.target.blur(); return; }
      closeStory();
      return;
    }
    if (e.key === "ArrowRight") {
      if (inField) return;
      e.preventDefault();
      storyStep(1);
      return;
    }
    if (e.key === "ArrowLeft") {
      if (inField) return;
      e.preventDefault();
      storyStep(-1);
      return;
    }
    if (e.key === " " && !inField) {
      e.preventDefault();
      if (story.paused) storyResume();
      else storyPause();
      return;
    }
    if (e.key === "Enter" && e.target && e.target.id === "statusText") { e.preventDefault(); publishStatus(); }
    if (e.key === "Enter" && e.target && e.target.id === "svMsg") { e.preventDefault(); statusSendTap(); }
  });
  /* a half-written status survives a re-render, the way a half-written review
     does: the draft is the source of truth, not the field */
  document.addEventListener("input", function (e) {
    if (!e.target) return;
    if (e.target.id === "statusText" || e.target.id === "statusNote") statusDraft.note = e.target.value;
  });

  $("#dpPick").addEventListener("click", function () {
    const input = $("#dpInput");
    if (input) { input.value = ""; input.click(); }
  });
  $("#dpClear").addEventListener("click", clearDp);
  $("#dpInput").addEventListener("change", function (e) {
    const file = (e.target.files || [])[0];
    e.target.value = "";
    if (file) pickDpFile(file);
  });
  $("#folioPick").addEventListener("click", function () {
    const input = $("#workInput");
    if (input) { input.value = ""; input.click(); }
  });
  $("#workInput").addEventListener("change", function (e) {
    const files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = "";
    if (files.length) addWorkFiles(files);
  });
  $("#videoPick").addEventListener("click", function () {
    const input = $("#videoInput");
    if (input) { input.value = ""; input.click(); }
  });
  $("#videoInput").addEventListener("change", function (e) {
    const file = (e.target.files || [])[0];
    e.target.value = "";
    if (file) addWorkVideoFile(file);
  });
  /* the video link is added on Enter as well as on the button, so a pasted
     link does not have to be chased with the mouse */
  document.addEventListener("keydown", function (e) {
    if (e.target && e.target.id === "workLink" && e.key === "Enter") {
      e.preventDefault();
      addWorkLink();
    }
  });
  $("#workViewClose").addEventListener("click", closeWorkView);
  $("#closeComments").addEventListener("click", function () {
    hideSheetEl("#commentSheet");
    clearReplyTarget();
  });
  $("#replyCancel").addEventListener("click", clearReplyTarget);
  $("#commentSend").addEventListener("click", postComment);
  /* a rail left open in a background tab should not keep playing — or keep the
     connection busy */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && document.getElementById("clipFeed").style.display !== "none") {
      $$("#clipScroller .clipVideo").forEach(function (v) { v.pause(); });
    } else if (!document.hidden && clipFeedState.items.length && document.getElementById("clipFeed").style.display !== "none") {
      clipPlayIndex(clipFeedState.index);
    }
  });
  $("#commentInput").addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    postComment();
  });
  /* Tapping the backdrop closes the viewer, but tapping the clip itself must not:
     a link has to be followable and a video has its own controls. */
  $("#workView").addEventListener("click", function (e) {
    if (e.target.closest(".wvLink, .wvVideo, iframe")) return;
    closeWorkView();
  });
  document.addEventListener("input", function (e) {
    if (e.target && /^dest(Bank|Acct|Network|Addr)$/.test(e.target.id)) captureDestInputs();
    /* Keep half-written statements when a card or sheet re-renders. */
    if (e.target && e.target.dataset && e.target.dataset.responsenote) {
      responseDraftFor(e.target.dataset.responsenote).text = e.target.value;
    }
    if (e.target && e.target.id === "disputeNote") disputeDraft.note = e.target.value;
    const range = e.target && e.target.closest ? e.target.closest("[data-splitrange]") : null;
    if (range) {
      /* Update the figures in place so the slider keeps its drag position. */
      const p = pickFor(range.dataset.splitrange);
      p.percent = Number(range.value) || 50;
      const card = document.querySelector('[data-deskcard="' + range.dataset.splitrange + '"]');
      const box = card && card.querySelector(".splitBox");
      if (box) box.outerHTML = splitBoxHtml(findBooking(range.dataset.splitrange), p);
    }
  });

  $("#closeSheet").addEventListener("click", closeSheet);
  $("#sheetOverlay").addEventListener("click", closeAllSheets);
  $("#confirmBook").addEventListener("click", confirmBooking);
  $("#closeNego").addEventListener("click", function () { hideSheetEl("#negoSheet"); });
  $("#negoSend").addEventListener("click", sendCounter);
  /* one field, one list: a search finds a person by name or by trade, because
     the professionals who do the work are the page */
  $("#search").addEventListener("input", function (e) {
    state.query = e.target.value;
    renderStylists();
    renderStories();
  });
  /* The budget and distance rows are written by renderHomeFilters, so their
     taps are delegated here — one listener for both rows, same shape as the
     trade chips. */
  document.addEventListener("click", function (e) {
    const b = e.target.closest("[data-budget]");
    if (b) {
      state.budget = state.budget === b.dataset.budget ? null : b.dataset.budget;
      renderStylists();
      return;
    }
    const d = e.target.closest("[data-distance]");
    if (d) {
      state.distFilter = state.distFilter === d.dataset.distance ? null : d.dataset.distance;
      renderStylists();
      return;
    }
    /* The sort chip cycles nearest → cheapest → highest → nearest. It lives in
       the filters block so the market's order is a control, not a hidden
       default. */
    const srt = e.target.closest("[data-pricesort]");
    if (srt) {
      state.priceSort = state.priceSort === "low" ? "high"
        : state.priceSort === "high" ? null : "low";
      renderStylists();
    }
  });
  $("#rememberMe").addEventListener("change", function (e) {
    if (state.user) {
      state.user.remember = e.target.checked;
      save();
    }
  });
  $$(".otp-input").forEach(function (inp, idx, all) {
    inp.addEventListener("input", function () {
      inp.value = inp.value.replace(/\D/g, "").slice(0, 1);
      if (inp.value && all[idx + 1]) all[idx + 1].focus();
    });
    inp.addEventListener("keydown", function (ev) {
      if (ev.key === "Backspace" && !inp.value && all[idx - 1]) all[idx - 1].focus();
    });
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    closeWorkView();
    closeAllSheets();
  });
}

/* ---------- Boot ---------- */
/* Entrance animations only ever run while the tab is actually visible, so a
   throttled or backgrounded tab can never be left holding a half-painted list. */
function motionGate() {
  const root = document.documentElement;
  const sync = function () { root.classList.toggle("anim", !document.hidden); };
  sync();
  document.addEventListener("visibilitychange", sync);
}

function boot() {
  load();
  /* The keyboard problem, solved once: Android (and iOS in some positions)
     squeezes the visible space when a keyboard opens, but the fixed auth
     screens keep their old height — so a button centered in "the viewport"
     ends up half behind the keyboard on tall phones. The visual viewport's
     real height is published as a CSS variable, and the auth screens size
     themselves with it, so what is centered is centered in what a thumb can
     actually reach. Keyboard closed, the variable equals the full height and
     nothing changes. */
  if (window.visualViewport) {
    const setVvh = function () {
      document.documentElement.style.setProperty("--vvh", window.visualViewport.height + "px");
    };
    setVvh();
    window.visualViewport.addEventListener("resize", setVvh);
  }
  loadLedger();
  loadRatings();
  loadNotify();
  /* what this account has already watched on the stories rail */
  loadStatusSeen();
  loadStatusSocial();
  loadAccounts();
  loadSocial();
  proLoad();
  migrateBookings();
  migrateProviders();
  wire();
  observeIcons();
  motionGate();
  renderThemeControl();
  /* keep the browser chrome in step with the theme restored from storage */
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", currentTheme() === "light" ? "#f3f5f8" : "#0b0d11");
  renderStories();
  renderHero();
  renderStylists();
  renderNotify();
  const intro = $(".intro");
  const welcome = $(".welcomePage");
  /* A session token outlives the page: the server is asked who it belongs to
     before the welcome screen is shown, and a live one walks straight back in
     — including on a device whose local profile was cleared. The ask is
     async, so the intro plays meanwhile and is replaced the moment it
     answers. */
  if (typeof dbCloudRestore === "function") dbCloudRestore();
  if (state.user) {
    intro.style.display = "none";
    enterApp();
    return;
  }
  setTimeout(function () {
    /* a session restored from the server while the splash played has already
       opened the app — the welcome screen must not slide back over it */
    if (dbSessionLanded) return;
    intro.classList.add("slide-up");
    setTimeout(function () {
      if (dbSessionLanded) return;
      intro.style.display = "none";
      welcome.style.removeProperty("display");
      welcome.style.opacity = "1";
      welcome.classList.add("entered");
    }, 1000);
  }, 1800);
}

document.addEventListener("DOMContentLoaded", boot);
