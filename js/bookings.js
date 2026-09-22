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

function renderBookings() {
  const list = $("#bookingList");
  /* the ledger holds everyone's bookings on this device — show the signed-in
     client theirs */
  const mine = (state.user || {}).phone || "";
  const items = state.bookings
    .filter(function (b) { return (b.clientPhone || "") === mine; })
    .filter(function (b) {
      return state.statusFilter === "upcoming" ? bookingIsUpcoming(b) : !bookingIsUpcoming(b);
    })
    .sort(function (a, b) {
      const cmp = (a.date + a.time).localeCompare(b.date + b.time);
      return state.statusFilter === "upcoming" ? cmp : -cmp;
    });
  if (!items.length) {
    list.innerHTML = state.statusFilter === "upcoming"
      ? emptyState("bookings_empty", "Nothing booked yet", "Pick a trade on Home and hold a slot with a stylist near you.")
      : emptyState("bookings_empty", "No past bookings", "Finished and settled jobs collect here with their money trail.");
    return;
  }
  list.innerHTML = items.map(function (b) {
    const sv = SERVICES.find(function (s) { return s.id === b.serviceId; }) || {};
    const st = statusOf(b);
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
      money = naira(b.pay.amount) + " in escrow · " + naira(net) + " to stylist";
    }

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
        actions = '<p class="proStep">' + icon("coin") + " Paid \u00b7 you offered " + naira(offerOf(b)) +
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
      '<div class="bookingItem">' +
        '<button class="card bookingCard" data-bookcard="' + esc(b.id) + '">' +
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
  /* every booking transition lands in the activity feed */
  renderNotify();
}

