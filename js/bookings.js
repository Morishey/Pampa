/* =========================================================
 * Pampa — bookings — the client's ledger of jobs
 * Every booking the account has made, with the escrow state it sits in.
 * ========================================================= */

/* ---------- Rendering: bookings ---------- */
/* Anything still actionable lives in Upcoming; settled money lives in Past. */
const ACTIVE_STATUSES = ["unpaid", "escrowed", "confirmed", "disputed"];

function bookingIsUpcoming(b) {
  return ACTIVE_STATUSES.indexOf(statusOf(b)) !== -1;
}

/* Money is holding or moving — worth a pulse on the badge. */
function bookingIsLive(b) {
  const st = statusOf(b);
  return st === "escrowed" || st === "confirmed" || st === "disputed";
}

/* Which side of a booking the signed-in account is on. A booking can be both
   — a professional who books someone else — and the client's reading of it is
   the fuller one, so a client row stays a client row. */
function bookingSide(b) {
  const u = state.user || {};
  const phone = u.phone || "";
  /* The empty string is not an identity: a username account has no phone, and
     comparing "" to "" would hand it every other phoneless account's jobs. */
  const asClient = (!!phone && (b.clientPhone || "") === phone) ||
    (!!u.serverId && b.clientId === u.serverId);
  const asPro = u.role === "pro" &&
    (b.stylistId === selfKey() || b.stylistId === "p:" + (u.phone || "guest"));
  if (asPro && !asClient) return "pro";
  return asClient ? "client" : null;
}

/* The tab's badge: what is still open on this account's side of the ledger.
   Lives here because the count and the list have to agree — a badge saying 2
   over a list showing one job would be a bug with a number on it. */
function bookingOpenCount() {
  return state.bookings.filter(function (b) {
    return bookingSide(b) && bookingIsUpcoming(b);
  }).length;
}

function renderBookings() {
  const list = $("#bookingList");
  /* Both sides of the ledger land here now: the client's own bookings, and —
     for a professional — the jobs they took, because this tab is where either
     side checks what is happening. A pro's job is drawn with its own card and
     one door into the desk, where the money actions live. */
  const u = state.user || {};
  const items = state.bookings
    .filter(function (b) { return !!bookingSide(b); })
    .filter(function (b) {
      return state.statusFilter === "upcoming" ? bookingIsUpcoming(b) : !bookingIsUpcoming(b);
    })
    .sort(function (a, b) {
      const cmp = (a.date + a.time).localeCompare(b.date + b.time);
      return state.statusFilter === "upcoming" ? cmp : -cmp;
    });
  if (!items.length) {
    list.innerHTML = state.statusFilter === "upcoming"
      ? emptyState("bookings_empty", "Nothing booked yet", u.role === "pro"
          ? "Jobs clients book with you land here the moment escrow holds the money."
          : "Pick a trade on Home and hold a slot with a stylist near you.")
      : emptyState("bookings_empty", "No past bookings", "Finished and settled jobs collect here with their money trail.");
    renderNavCounts();
    return;
  }
  list.innerHTML = items.map(function (b) {
    const sv = SERVICES.find(function (s) { return s.id === b.serviceId; }) || {};
    const st = statusOf(b);
    if (bookingSide(b) === "pro") return proBookingItem(b, sv);
    const meta = statusMeta(b);
    const net = b.pay ? b.pay.netToPro : 0;
    /* Which of the two ways this job happens, and where it happens: a walk-in
       carries the studio's door, a home visit carries the client's own. */
    const where = b.loc === "studio"
      ? icon("store") + " Walk-in · " + esc(b.studioAddress || b.studioAreaName || b.areaName || "their studio")
      : icon("house") + " Home visit · " + esc(placeLine(b.address, b.areaName || b.areaId || "your area"));
    let money;
    if (!b.pay) {
      money = "Your price " + naira(b.price || 0) +
        (b.travelFee ? " + " + naira(b.travelFee) + " travel = " + naira(b.total || 0) : "") +
        " \u00b7 nothing paid yet";
    } else if (st === "cancelled" || st === "declined") {
      money = b.refund && b.refund.amount
        ? "Refunded " + naira(b.refund.amount) + (b.refund.fee ? " after a " + naira(b.refund.fee) + " fee" : " in full")
        : "No payment taken";
    } else if (st === "released") {
      money = naira(b.pay.amount) + " paid · " + naira(net) + " to stylist after a " + naira(b.pay.fee) + " fee";
    } else if (st === "settled" && b.resolution) {
      money = esc(resolutionText(b));
    } else {
      /* A price that was settled above what escrow holds makes the plain line
         wrong twice over: the money in escrow is no longer the job's price,
         and the payout the old price promised is not the one that will be
         paid. So the line states both halves — what is in, what is coming. */
      const owed = typeof topUpOwedFor === "function" ? topUpOwedFor(b) : 0;
      money = owed > 0
        ? naira(b.pay.amount) + " of " + naira(counterTotal(b, agreedPriceOf(b))) + " in escrow · " +
          naira(escrowNet(counterTotal(b, agreedPriceOf(b)))) + " to stylist once the top-up lands"
        : naira(b.pay.amount) + " in escrow · " + naira(net) + " to stylist";
    }
    /* The escrow reference belongs on the booking and not only on the receipt
       card that used to sit over it: this is the row somebody comes back to
       when they need to quote what they paid. */
    if (b.pay && b.pay.ref) money += " · " + esc(b.pay.ref);

    let actions = "";
    if (st === "unpaid") {
      actions = '<div class="cardActions">' +
        '<button class="bookBtn wide" data-pay="' + b.id + '">Pay ' + naira(b.total || 0) + ' into escrow</button>' +
        '<button class="cancelBtn" data-canceljob="' + b.id + '">Cancel</button></div>';
    } else if (st === "escrowed") {
      /* The price is the one thing still open until the professional answers:
         they can take the client's number or put their own on the table, and a
         counter is the client's turn to decide. */
      const counter = counterOf(b);
      if (counter != null) {
        const extra = topUpAmountFor(b);
        actions = '<p class="proStep warn">' + icon("coin") + " " + esc(b.stylistName || "The stylist") +
            " sent a price of " + naira(counter) + " for this job</p>" +
          (extra
            ? '<p class="finePrint">Accepting adds ' + naira(extra) + " to the escrow you already paid \u2014 one payment, one reference.</p>"
            : '<p class="finePrint">That is less than you offered \u2014 the difference comes straight back from escrow.</p>') +
          '<div class="cardActions">' +
            '<button class="bookBtn wide" data-acceptcounter="' + b.id + '">Accept ' + naira(counter) + "</button>" +
            '<button class="cancelBtn" data-declinecounter="' + b.id + '">Decline \u00b7 full refund</button>' +
          "</div>";
      } else {
        /* No counter is open, which leaves two very different states behind the
           same words: the professional has not answered yet, or a price was
           agreed and the money in escrow has not caught up with it. The second
           one used to draw the same "waiting" line and nothing to do about it,
           so the only button on the card was the one the *counter* draws \u2014
           tap Accept again, agree the same number again, and write the same
           line into the money trail. What is actually left to do there is the
           difference, so that is what the card offers. */
        const owed = typeof topUpOwedFor === "function" ? topUpOwedFor(b) : 0;
        actions = owed > 0
          ? '<p class="proStep warn">' + icon("coin") + " Price agreed at " + naira(agreedPriceOf(b)) +
              " \u2014 " + naira(owed) + " more has to reach escrow before " + esc(b.stylistName || "they") + " is confirmed</p>" +
            '<div class="cardActions">' +
              '<button class="bookBtn wide" data-topup="' + b.id + '">Pay ' + naira(owed) + " into escrow</button>" +
              /* escrowed and unaccepted, so a change of mind costs nothing — the
                 same full refund the open-counter state offers */
              '<button class="cancelBtn" data-canceljob="' + b.id + '">Cancel \u00b7 full refund</button>' +
            "</div>"
          : '<p class="proStep">' + icon("coin") + " Paid \u00b7 you offered " + naira(offerOf(b)) +
              " \u00b7 waiting for " + esc(b.stylistName || "the stylist") + " to accept or counter</p>" +
            '<div class="cardActions"><button class="cancelBtn" data-canceljob="' + b.id + '">Cancel \u00b7 full refund</button></div>';
      }
    } else if (st === "confirmed") {
      const releasable = canRelease(b);
      /* A job whose price was negotiated says so: "accepted" alone would hide
         the number the two of them actually settled on. */
      actions = '<p class="proStep">' + (b.proMarkedDone
        ? icon("wrench") + " " + esc(b.stylistName || "Stylist") + " marked the job done"
        : wasNegotiated(b)
          ? icon("check") + " " + esc(b.stylistName || "Stylist") + " agreed " + naira(agreedPriceOf(b)) +
            " · " + esc(b.date) + " at " + esc(b.time)
          : icon("calendar") + " " + esc(b.stylistName || "Stylist") + " accepted · " + esc(b.date) + " at " + esc(b.time)) + "</p>" +
        /* Reporting a problem is available the whole time the money is in
           escrow and a pro has taken the job — not only once the release
           window opens. Gating it behind canRelease left a client whose job
           went wrong with nothing but a cancellation that costs them 10%. */
        '<div class="cardActions">' +
          (releasable
            ? '<button class="bookBtn wide" data-release="' + b.id + '">Job done &amp; satisfied · release ' + naira(net) + '</button>'
            : '<button class="cancelBtn" data-canceljob="' + b.id + '">Cancel · 10% fee applies</button>') +
          '<button class="cancelBtn" data-dispute="' + b.id + '">Report a problem</button>' +
        "</div>";
    } else if (st === "released") {
      actions = '<p class="proStep ok">' + icon("check") + " " + naira(net) + " released to " + esc(b.stylistName || "the stylist") + "</p>" +
        (b.rated
          ? '<p class="yourReview">' + starRow(b.rated.stars) + "You rated " + esc(b.stylistName || "your stylist") +
            (b.rated.comment ? ' — "' + esc(b.rated.comment) + '"' : "") + "</p>"
          : "");
    } else if (st === "disputed") {
      const d = b.dispute || {};
      const resp = d.response;
      actions = '<p class="proStep warn">' + icon("alert") + " You reported a problem — funds stay held while the resolution desk reviews it</p>" +
        '<div class="eviSide"><p class="eviHead">Your evidence · ' + esc(fmtWhen(d.at)) + "</p>" +
          '<p class="eviNote"><b>' + esc(d.reason || "Something else") + "</b>" +
            (d.note ? "<br>" + esc(d.note) : "") + "</p>" +
          galleryHtml(d.photos, b.id, "client") +
          (d.photos && d.photos.length ? "" : '<p class="finePrint">No photos attached.</p>') +
        "</div>" +
        (resp
          ? '<div class="eviSide proSide"><p class="eviHead">' + esc(b.stylistName || "Stylist") +
            " responded · " + esc(fmtWhen(resp.at)) + "</p>" +
            (resp.note ? '<p class="eviNote">' + esc(resp.note) + "</p>" : "") +
            galleryHtml(resp.photos, b.id, "pro") +
            (resp.photos && resp.photos.length ? "" : '<p class="finePrint">No photos attached.</p>') + "</div>"
          : '<p class="finePrint">Waiting for ' + esc(b.stylistName || "the stylist") + " to file their side.</p>");
    } else if (st === "settled" && b.resolution) {
      actions = '<p class="proStep ok">' + icon("scale") + " Settled by the resolution desk" +
        (b.resolution.at ? " on " + esc(fmtWhen(b.resolution.at)) : "") + "</p>";
    } else {
      actions = b.refund && b.refund.amount
        ? '<p class="proStep">Refunded ' + naira(b.refund.amount) + (b.refund.fee ? " after a " + naira(b.refund.fee) + " fee" : " in full") + "</p>"
        : '<p class="proStep">Cancelled before payment</p>';
    }

    /* One booking, wrapped: the card and its controls are *siblings* on purpose.
       They used to be nested inside the card's <button>, which HTML does not
       allow — a button's start tag closes an open button — so the parser hoisted
       Pay, Release, Report a problem, the money trail and the evidence gallery
       out of the card and left them as loose siblings. It looked the same, but
       the markup said something no one had written: the controls were not part
       of the booking they belonged to, and a client's own evidence sat outside
       their own card. Now the wrapper says it outright. */
    return (
      '<div class="card bookingItem">' +
        '<button class="bookingCard" data-bookcard="' + esc(b.id) + '">' +
        '<div class="bookingTop">' +
          '<div class="svc-ico">' + icon(sv.ico) + "</div>" +
          '<div class="b-info"><h4>' + esc(sv.name || b.serviceId) + (b.stylistName ? " · " + esc(b.stylistName) : "") + "</h4>" +
          "<p>" + esc(b.date) + " · " + esc(b.time) + "</p>" +
          '<p class="bLoc">' + where + "</p></div>" +
          '<span class="badge ' + meta.tone + (bookingIsLive(b) ? " live" : "") + '">' + esc(statusLabelFor(b)) + "</span>" +
        "</div>" +
        '<p class="bMoney">' + money + "</p>" +
        "</button>" +
        actions +
        (b.history && b.history.length
          ? '<div class="journalWrap"><button class="journalToggle" data-journal="' + b.id + '">Money trail</button>' +
            '<div class="journalBody" data-journalbody="' + b.id + '" style="display: none;">' + journalHtml(b, false) + "</div></div>"
          : "") +
      "</div>"
    );
  }).join("");
  renderNavCounts();
  /* the Home card reads the same list this page just did, so a job paid for or
     released here stops being "needing attention" there at the same moment */
  if (typeof renderHomeAttention === "function") renderHomeAttention();
  /* every booking transition lands in the activity feed */
  renderNotify();
}

/* The professional's reading of the same row: who is coming, when, and what
   the money is doing — with one button, because the actions that move money
   belong on the desk where the client's details and the payout sit beside
   them, not duplicated in a list. */
function proBookingItem(b, sv) {
  const st = statusOf(b);
  const meta = statusMeta(b);
  const net = b.pay ? b.pay.netToPro : 0;
  const where = b.loc === "studio"
    ? icon("store") + " Walk-in · " + esc(b.studioAddress || b.studioAreaName || "your studio")
    : icon("house") + " Home visit · " + esc(placeLine(b.address, b.areaName || b.areaId || "their area"));
  const money = st === "released"
    ? naira(net) + " paid out"
    : st === "settled" && b.resolution
      ? esc(resolutionText(b))
      : b.pay ? naira(net) + " of " + naira(b.pay.amount) + " in escrow" : "Nothing in escrow yet";
  const ref = b.pay && b.pay.ref ? " · " + esc(b.pay.ref) : "";
  const step = st === "escrowed"
    ? "Waiting on you to accept or counter " + naira(offerOf(b))
    : st === "confirmed"
      ? (b.proMarkedDone ? "You marked it done — waiting on the client to release" : "Accepted · " + esc(b.date) + " at " + esc(b.time))
      : st === "disputed" ? "A problem was reported — the desk holds the money"
        : "";
  return '<div class="card bookingItem">' +
      '<button class="bookingCard" data-bookcard="' + esc(b.id) + '">' +
      '<div class="bookingTop">' +
        '<div class="svc-ico">' + icon(sv.ico) + "</div>" +
        '<div class="b-info"><h4>' + esc(sv.name || b.serviceId) + " · " + esc(b.clientName || "Client") + "</h4>" +
        "<p>" + esc(b.date) + " · " + esc(b.time) + "</p>" +
        '<p class="bLoc">' + where + "</p></div>" +
        '<span class="badge ' + meta.tone + (bookingIsLive(b) ? " live" : "") + '">' + esc(statusLabelFor(b)) + "</span>" +
      "</div>" +
      '<p class="bMoney">' + money + ref + "</p>" +
      "</button>" +
      (step ? '<p class="proStep' + (st === "disputed" ? " warn" : st === "confirmed" ? " ok" : "") + '">' + step + "</p>" : "") +
      /* The trail chip is the card's second control, so it rides the row the
         first one is on instead of claiming a line of its own. */
      '<div class="cardActions"><button class="bookBtn wide" data-gotowork="' + esc(b.id) + '">Open in Work</button>' +
        (b.history && b.history.length
          ? '<button class="journalToggle" data-journal="' + b.id + '">Money trail</button>'
          : "") +
      "</div>" +
      (b.history && b.history.length
        ? '<div class="journalBody" data-journalbody="' + b.id + '" style="display: none;">' + journalHtml(b, false) + "</div>"
        : "") +
    "</div>";
}

/* The two counts on the bottom nav. Work shows what is waiting on the pro;
   Bookings shows what is still open on either side. Drawn from the same
   functions the lists render from, so the badge can never contradict the
   page behind it. */
function renderNavCounts() {
  const u = state.user || {};
  const open = bookingOpenCount();
  const bDot = $("#bookingsDot");
  if (bDot) {
    bDot.textContent = open > 9 ? "9+" : String(open);
    bDot.style.display = open ? "flex" : "none";
  }
  const wDot = $("#workDot");
  if (wDot) {
    let waiting = 0;
    if (u.role === "pro") {
      const me = myProviderRecord();
      /* the badge counts what the desk lists, or it contradicts the page behind
         it: requests to answer, plus the bookings placed but not yet funded */
      const jobs = me ? proJobs(me.id) : null;
      waiting = jobs ? jobs.requests.length + jobs.unfunded.length : 0;
    }
    wDot.textContent = waiting > 9 ? "9+" : String(waiting);
    wDot.style.display = waiting ? "flex" : "none";
  }
}

