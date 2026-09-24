/* =========================================================
 * Pampa — escrow payments, booking lifecycle & pro payouts
 * Loaded before the js/ modules; all of them share the global lexical scope.
 * ========================================================= */

/* Booking lifecycle
 *   unpaid    client created the booking, nothing paid yet
 *   escrowed  client paid, Pampa holds the money, stylist can accept
 *   confirmed stylist accepted the job, money still held
 *   released  client confirmed the job was done and satisfactory, stylist paid
 *   cancelled cancelled, client refunded (in full, or less a fee if accepted)
 *   declined  stylist refused the job, client refunded in full
 *   disputed  client reported a problem, money stays held for review
 */
const STATUS = {
  unpaid: { label: "Awaiting payment", tone: "warn" },
  /* Labels stay short: the line under the card explains the detail, and a
     pill that never wraps past two lines keeps every card the same height. */
  escrowed: { label: "In escrow", tone: "info" },
  confirmed: { label: "Confirmed", tone: "ok" },
  released: { label: "Paid out", tone: "done" },
  cancelled: { label: "Cancelled", tone: "past" },
  declined: { label: "Declined", tone: "past" },
  disputed: { label: "Disputed", tone: "bad" },
  settled: { label: "Settled by desk", tone: "done" },
};

const DISPUTE_REASONS = [
  "Stylist never showed up",
  "The job wasn't finished",
  "Quality wasn't what I paid for",
  "Stylist asked for more money",
  "Something else",
];

/* Pampa's cut of the stylist's payout (not added to the client's total). */
const FEE_RATE = 0.1;
/* Charged to the client only if they cancel after the stylist accepted. */
const CANCEL_FEE_RATE = 0.1;

const PAY_METHODS = [
  { id: "card", name: "Debit card", note: "Instant · Visa, Mastercard, Verve", ico: "card" },
  { id: "transfer", name: "Bank transfer", note: "Instant confirmation", ico: "bank" },
  { id: "crypto", name: "Crypto (USDT)", note: "TRC20 or ERC20 wallet", ico: "coin" },
];

const PRO_KEY = "pampa.pro.v1";
const proStore = { proId: null, destinations: {}, payouts: {} };

function proLoad() {
  try {
    const raw = localStorage.getItem(PRO_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && typeof d === "object") {
        proStore.proId = d.proId || null;
        proStore.destinations = d.destinations || {};
        proStore.payouts = d.payouts || {};
      }
    }
  } catch (e) {
    console.warn("Pampa: pro data unreadable", e);
  }
  proStore.destinations = proStore.destinations || {};
  proStore.payouts = proStore.payouts || {};
}

function proSave() {
  try {
    localStorage.setItem(PRO_KEY, JSON.stringify(proStore));
  } catch (e) {
    console.warn("Pampa: pro storage unavailable", e);
  }
}

/* ---------- Money ---------- */
function escrowFee(amount) {
  return Math.round(amount * FEE_RATE / 50) * 50;
}

function escrowNet(amount) {
  return amount - escrowFee(amount);
}

function cancelFee(amount) {
  return Math.round(amount * CANCEL_FEE_RATE / 50) * 50;
}

function statusOf(b) {
  return STATUS[b.status] ? b.status : "confirmed";
}

function statusMeta(b) {
  return STATUS[statusOf(b)];
}

/* Desk settlements get a label that names the outcome. */
function statusLabelFor(b) {
  const s = statusOf(b);
  const r = b.resolution;
  if (s === "settled" && r) {
    if (r.type === "split") return "Settled · " + r.percent + "% to stylist";
    if (r.type === "refund") return "Settled · refunded to client";
    if (r.type === "release") return "Settled · paid to stylist";
  }
  return STATUS[s].label;
}

function findBooking(id) {
  return state.bookings.find(function (b) { return b.id === id; }) || null;
}

function byWhen(a, b) {
  return (a.date + a.time).localeCompare(b.date + b.time);
}

function byWhenDesc(a, b) {
  return -byWhen(a, b);
}

function ledgerNote(b, label) {
  if (!b.history) b.history = [];
  b.history.push({ at: new Date().toISOString(), label: label });
}

/* ---------- Transitions (each returns { ok, msg }) ---------- */
function payBookingLocal(id, method) {
  const b = findBooking(id);
  if (!b) return { ok: false, msg: "Booking not found" };
  if (statusOf(b) !== "unpaid") return { ok: false, msg: "This booking is already paid" };
  const amount = b.total || b.price || 0;
  if (amount <= 0) return { ok: false, msg: "Nothing to pay" };
  const fee = escrowFee(amount);
  b.pay = {
    method: method,
    ref: "ESC-" + String(Date.now()).slice(-8),
    amount: amount,
    fee: fee,
    netToPro: amount - fee,
    paidAt: new Date().toISOString(),
  };
  b.status = "escrowed";
  ledgerNote(b, "Client paid " + naira(amount) + " into escrow via " + method);
  save();
  return { ok: true, ref: b.pay.ref };
}

function acceptBookingLocal(id) {
  const b = findBooking(id);
  if (!b) return { ok: false, msg: "Booking not found" };
  if (statusOf(b) === "unpaid") return { ok: false, msg: "Payment hasn't reached escrow yet" };
  if (statusOf(b) !== "escrowed") return { ok: false, msg: "This request is already " + statusMeta(b).label.toLowerCase() };
  if (counterOf(b) != null) return { ok: false, msg: "Your counter is with the client — wait for their answer" };
  const price = offerOf(b);
  if (!b.negotiation) b.negotiation = { status: "open", rounds: [] };
  b.negotiation.status = "agreed";
  b.negotiation.agreed = price;
  b.status = "confirmed";
  b.acceptedAt = new Date().toISOString();
  ledgerNote(b, "Stylist accepted the job at the client's price of " + naira(price));
  save();
  return { ok: true, price: price };
}

/* ---------- Price negotiation ----------
   The client names the price — inside the professional's own range for that
   service — and the professional either takes it or answers with one of their
   own. Only one counter can be on the table at a time. Whatever they finally
   agree on is what the escrow holds: a higher counter collects the difference
   from the client, a lower one refunds it. The client's yes is what confirms
   the booking, which is the same event a plain acceptance is. */
function offerOf(b) {
  if (!b) return 0;
  return b.offer && b.offer.price ? b.offer.price : (b.price || 0);
}

/* The price the professional is waiting on the client to answer, or null. */
function counterOf(b) {
  const n = b && b.negotiation;
  return n && n.status === "countered" ? n.price : null;
}

/* Whether money was haggled over at all: a professional's number on the table
   at some point is what makes a booking a negotiated one. */
function wasNegotiated(b) {
  const rounds = b && b.negotiation && b.negotiation.rounds;
  return !!(rounds && rounds.some(function (r) { return r.by === "pro"; }));
}

/* The price the two of them settled on: the counter when one was accepted, the
   client's own offer when it was taken as it stood. */
function agreedPriceOf(b) {
  const n = b && b.negotiation;
  return n && n.agreed ? n.agreed : offerOf(b);
}

/* The last price the professional put on the table. Read from the rounds rather
   than the live field, because a counter that has been answered or closed is no
   longer "the current one" — but it is still the number the news is about. */
function lastCounterOf(b) {
  const rounds = b && b.negotiation && b.negotiation.rounds;
  if (!rounds) return 0;
  for (let i = rounds.length - 1; i >= 0; i--) {
    if (rounds[i].by === "pro" && rounds[i].price) return rounds[i].price;
  }
  return 0;
}

/* A request still open to a price answer. An old booking with no negotiation
   record counts as open — nothing has been said yet either way. */
function negotiationOpen(b) {
  const n = b && b.negotiation;
  return statusOf(b) === "escrowed" && (!n || n.status === "open");
}

function addNegotiationRound(b, by, price, note) {
  if (!b.negotiation) b.negotiation = { status: "open", rounds: [] };
  if (!b.negotiation.rounds) b.negotiation.rounds = [];
  b.negotiation.rounds.push({ by: by, price: price, note: note || "", at: new Date().toISOString() });
}

/* The whole booking at a service price: the same arithmetic the sheet used, so
   travel is never lost between the offer and the agreement. */
function counterTotal(b, price) {
  return price + (b.travelFee || 0);
}

/* The professional's answer: a price of their own, inside the range they
   publish. Outside it is refused rather than silently clamped — the range is
   the promise their card makes. */
function counterBookingLocal(id, price, note) {
  const b = findBooking(id);
  if (!b) return { ok: false, msg: "Booking not found" };
  if (statusOf(b) !== "escrowed") return { ok: false, msg: "This request is already " + statusMeta(b).label.toLowerCase() };
  if (counterOf(b) != null) return { ok: false, msg: "Your price is already with the client" };
  const range = rangeFor(myProviderRecord() || {}, b.serviceId);
  const p = roundTo50(price);
  if (!(p > 0)) return { ok: false, msg: "Enter the price you want for this job" };
  if (p < range.min || p > range.max) {
    return { ok: false, msg: "Your published range for this service is " + rangeText(range) };
  }
  b.negotiation = b.negotiation || { status: "open", rounds: [] };
  b.negotiation.status = "countered";
  b.negotiation.price = p;
  addNegotiationRound(b, "pro", p, note);
  ledgerNote(b, "Stylist countered " + naira(p) + " for this job — waiting on the client's answer");
  save();
  return { ok: true, price: p };
}

/* The client accepts the counter. A higher price means they owe the
   difference, and nothing moves until it reaches escrow — so this stops short
   and reports what is owed. A lower one settles immediately and returns the
   difference. */
function acceptCounterLocal(id) {
  const b = findBooking(id);
  if (!b) return { ok: false, msg: "Booking not found" };
  const p = counterOf(b);
  if (p == null) return { ok: false, msg: "There is no price to accept on this booking" };
  if (statusOf(b) !== "escrowed") return { ok: false, msg: "This booking is already " + statusMeta(b).label.toLowerCase() };
  const target = counterTotal(b, p);
  const held = b.pay ? b.pay.amount : 0;
  const extra = Math.max(0, target - held);
  if (extra > 0) {
    b.negotiation.topUp = extra;
    save();
    return { ok: true, price: p, topUp: extra };
  }
  settleCounter(b, p, Math.max(0, held - target), 0);
  return { ok: true, price: p, refunded: Math.max(0, held - target) };
}

/* Agreed: the escrow is repriced to the agreed total, whatever moved is
   journaled, and the client's yes is what confirms the job. */
function settleCounter(b, price, refunded, toppedUp) {
  const target = counterTotal(b, price);
  b.price = price;
  b.total = target;
  if (b.pay) {
    b.pay.amount = target;
    b.pay.fee = escrowFee(target);
    b.pay.netToPro = target - b.pay.fee;
  }
  if (refunded > 0) b.priceAdjust = { refunded: refunded, at: new Date().toISOString() };
  b.negotiation.status = "agreed";
  b.negotiation.agreed = price;
  if (b.negotiation.topUp) delete b.negotiation.topUp;
  b.status = "confirmed";
  b.acceptedAt = new Date().toISOString();
  ledgerNote(b, "Client accepted the counter — price agreed at " + naira(price) +
    (toppedUp > 0 ? " · topped up " + naira(toppedUp) + " into escrow" : "") +
    (refunded > 0 ? " · " + naira(refunded) + " came back from escrow" : ""));
  save();
}

/* The client pays the difference a higher counter created. The escrow keeps
   one reference and one fee, recomputed from the agreed total, so the job is
   never split across two payments. */
function completeCounterTopUpLocal(id, method) {
  const b = findBooking(id);
  if (!b) return { ok: false, msg: "Booking not found" };
  const p = counterOf(b);
  if (p == null) return { ok: false, msg: "There is nothing to top up on this booking" };
  const target = counterTotal(b, p);
  const held = b.pay ? b.pay.amount : 0;
  const extra = Math.max(0, target - held);
  if (b.pay) b.pay.method = method;
  settleCounter(b, p, 0, extra);
  return { ok: true, price: p, topUp: extra };
}

/* The client says no: the counter dies with the booking. Money that never
   bought anything goes back in full — the professional has done no work. */
function declineCounterLocal(id) {
  const b = findBooking(id);
  if (!b) return { ok: false, msg: "Booking not found" };
  const p = counterOf(b);
  if (p == null) return { ok: false, msg: "There is no price to decline on this booking" };
  b.negotiation.status = "declined";
  addNegotiationRound(b, "client", p, "declined");
  ledgerNote(b, "Client declined the counter of " + naira(p) + " — refunding in full");
  const res = refundBooking(b, "declined");
  return { ok: true, refunded: res.refunded };
}

function refundBooking(b, reason) {
  const amount = b.pay ? b.pay.amount : 0;
  // The cancellation fee only applies once the stylist has accepted the job.
  const fee = reason === "cancelled" ? cancelFee(amount) : 0;
  const refunded = Math.max(0, amount - fee);
  b.status = reason === "declined" ? "declined" : "cancelled";
  if (amount > 0) b.refund = { amount: refunded, fee: fee, at: new Date().toISOString(), reason: reason };
  ledgerNote(b, fee > 0
    ? "Refunded " + naira(refunded) + " to client (" + naira(fee) + " cancellation fee)"
    : "Refunded " + naira(refunded) + " to client in full");
  save();
  return { ok: true, refunded: refunded, fee: fee };
}

function declineBookingLocal(id) {
  const b = findBooking(id);
  if (!b) return { ok: false, msg: "Booking not found" };
  if (statusOf(b) !== "escrowed") return { ok: false, msg: "Only a request awaiting you can be declined" };
  return refundBooking(b, "declined");
}

function cancelJobLocal(id) {
  const b = findBooking(id);
  if (!b) return { ok: false, msg: "Booking not found" };
  const s = statusOf(b);
  if (s === "released") return { ok: false, msg: "This job is completed and paid" };
  if (s === "cancelled" || s === "declined") return { ok: false, msg: "This booking is already cancelled" };
  if (s === "unpaid") {
    b.status = "cancelled";
    ledgerNote(b, "Cancelled before payment");
    save();
    return { ok: true, refunded: 0, fee: 0 };
  }
  if (s === "disputed") return { ok: false, msg: "This booking is under review" };
  if (s === "settled") return { ok: false, msg: "The resolution desk already settled this booking" };
  return refundBooking(b, s === "escrowed" ? "cancelled-early" : "cancelled");
}

function markJobDoneLocal(id) {
  const b = findBooking(id);
  if (!b) return { ok: false, msg: "Booking not found" };
  if (statusOf(b) !== "confirmed") return { ok: false, msg: "Only a confirmed job can be marked done" };
  if (b.proMarkedDone) return { ok: false, msg: "Already marked done — waiting for the client" };
  b.proMarkedDone = true;
  b.doneAt = new Date().toISOString();
  ledgerNote(b, "Stylist marked the job done");
  save();
  return { ok: true };
}

function appointmentPassed(b) {
  return new Date(b.date + "T" + b.time + ":00").getTime() <= Date.now();
}

function canRelease(b) {
  return statusOf(b) === "confirmed" && (b.proMarkedDone || appointmentPassed(b));
}

/* ---------- Sessions ----------
   The time a professional is actually with a client, which is the one thing
   that makes them unbookable no matter what their switch says.

   A session begins at the booked time and runs as long as the work does — the
   service's own duration, plus the walk to the next job — and it is not over
   until the money it was booked with is settled. That last half is the point:
   a professional still waiting to be released for a chair they have already
   left is still holding somebody's job, so they are not free for the next
   client either. Settlement is what hands the chair back, whether the client
   releases it, the desk settles it, or it is cancelled or declined outright. */
const SESSION_BUFFER_MIN = 15;

function sessionMinutes(b) {
  const sv = SERVICES.find(function (s) { return s.id === b.serviceId; });
  return (sv && sv.dur ? sv.dur : 60) + SESSION_BUFFER_MIN;
}

function sessionStart(b) {
  return new Date(b.date + "T" + b.time + ":00").getTime();
}

function sessionEnd(b) {
  return sessionStart(b) + sessionMinutes(b) * 60000;
}

/* The states in which money is held and the job is not settled yet: exactly
   when a professional is committed to somebody. An unpaid booking holds
   nothing, and a released, cancelled or desk-settled one holds nothing either. */
function sessionLive(b) {
  const s = statusOf(b);
  return s === "escrowed" || s === "confirmed" || s === "disputed";
}

/* The session a professional is inside right now, or null. It runs to
   settlement rather than to a clock, so the chair window only ever says when
   the work is expected to be done — never that they are free again. */
function activeSession(providerId, now) {
  if (!providerId) return null;
  const t = now || Date.now();
  const open = state.bookings.filter(function (b) {
    return b.stylistId === providerId && sessionLive(b) && sessionStart(b) <= t;
  });
  return open.sort(byWhen)[0] || null;
}

/* Two jobs clash when their chair windows overlap: a 90-minute service booked
   at 12:00 cannot sit inside a session that started at 10:30. This is the
   slot-level half of the same rule, so a client cannot book the middle of a
   session even when the exact slot itself is free. */
function sessionClash(stylistId, date, time, serviceId, ignoreId) {
  const sv = SERVICES.find(function (s) { return s.id === serviceId; });
  const len = ((sv && sv.dur ? sv.dur : 60) + SESSION_BUFFER_MIN) * 60000;
  const start = new Date(date + "T" + time + ":00").getTime();
  const end = start + len;
  return state.bookings.some(function (b) {
    if (b.id === ignoreId) return false;
    if (b.stylistId !== stylistId || !sessionLive(b)) return false;
    return start < sessionEnd(b) && sessionStart(b) < end;
  });
}

/* "since 11:30", or "since 21 Sep at 11:30" once a session has outlived its
   own day — a pro holding an unsettled job from last week should be told when
   it started, not just what time. */
function sessionSinceLabel(b) {
  if (!b) return "";
  return b.date === todayIso()
    ? "since " + b.time
    : "since " + fmtDayShort(b.date) + " at " + b.time;
}

/* Why the next booking is shut, in one line, for a professional and for the
   client reading their card — the same sentence either way, because it is the
   same fact. */
function sessionHoldNote(b) {
  if (!b) return "";
  return (b.clientName || "a client") + " · " + sessionSinceLabel(b);
}

function releasePaymentLocal(id) {
  const b = findBooking(id);
  if (!b) return { ok: false, msg: "Booking not found" };
  const s = statusOf(b);
  if (s === "released") return { ok: false, msg: "Payment has already been released" };
  if (s === "disputed") return { ok: false, msg: "Funds stay held while this is under review" };
  if (s !== "confirmed") return { ok: false, msg: "Only a confirmed job can be released" };
  if (!b.pay) return { ok: false, msg: "No escrowed payment on this booking" };
  if (!canRelease(b)) {
    return { ok: false, msg: "Wait until the stylist marks the job done, or the appointment time passes" };
  }
  b.status = "released";
  b.releasedAt = new Date().toISOString();
  ledgerNote(b, "Client released " + naira(b.pay.netToPro) + " to " + (b.stylistName || "the stylist"));
  save();
  /* a released job is the provider's first bit of public history */
  bumpProviderJobs(b.stylistId);
  return { ok: true, net: b.pay.netToPro };
}

/* Journal the event, then persist. If the device is full the record is kept
   and the attachments are dropped, so the booking never saves half-written. */
function commitEvidence(b, holder, labelFor) {
  const asked = (holder.photos || []).length;
  ledgerNote(b, labelFor(asked));
  if (!asked) {
    save();
    return false;
  }
  if (save() !== false) return false;
  holder.photos = [];
  const last = b.history[b.history.length - 1];
  last.label = labelFor(0) + " (attachments did not fit on this device)";
  save();
  return true;
}

function disputeBookingLocal(id, reason, photos) {
  const b = findBooking(id);
  if (!b) return { ok: false, msg: "Booking not found" };
  if (statusOf(b) !== "confirmed") return { ok: false, msg: "Only a confirmed job can be reported" };
  const pics = photos || [];
  b.status = "disputed";
  b.dispute = {
    reason: reason || "Something else",
    at: new Date().toISOString(),
    by: (state.user || {}).name || "Client",
    photos: pics,
  };
  const dropped = commitEvidence(b, b.dispute, function (n) {
    return "Client reported a problem: " + b.dispute.reason +
      (n ? " with " + n + " photo" + (n === 1 ? "" : "s") : "") + " — funds held for review";
  });
  return { ok: true, photosDropped: dropped };
}

/* ---------- The stylist's side ---------- */
function respondToDisputeLocal(bookingId, note, photos) {
  const b = findBooking(bookingId);
  if (!b) return { ok: false, msg: "Booking not found" };
  if (statusOf(b) !== "disputed") return { ok: false, msg: "This booking is not under review" };
  /* Pro mode can switch between stylist accounts — a response must come from
     the stylist the job was booked with. */
  if (proStore.proId && b.stylistId && proStore.proId !== b.stylistId) {
    return { ok: false, msg: "That dispute is on " + (b.stylistName || "another stylist") + "'s job" };
  }
  if (!b.dispute) b.dispute = {};
  if (b.dispute.response) return { ok: false, msg: "You have already responded to this dispute" };
  const pics = photos || [];
  const text = String(note || "").trim();
  if (!text && !pics.length) return { ok: false, msg: "Add a statement or a photo to your response" };
  const st = stylistById(proStore.proId);
  b.dispute.response = {
    note: text,
    photos: pics,
    at: new Date().toISOString(),
    by: st ? st.name : "Stylist",
  };
  const dropped = commitEvidence(b, b.dispute.response, function (n) {
    return "Stylist responded" + (n ? " with " + n + " photo" + (n === 1 ? "" : "s") : "") +
      (text ? ": \"" + clip(text, 70) + "\"" : "");
  });
  return { ok: true, droppedPhotos: dropped };
}

function submitDisputeResponse(bookingId) {
  const draft = responseDraftFor(bookingId);
  const el = document.querySelector('[data-responsenote="' + bookingId + '"]');
  const note = el ? el.value.trim() : draft.text;
  respondToDispute(bookingId, note, draft.photos.slice()).then(function (res) {
    if (!res.ok) {
      toast(res.msg);
      return;
    }
    delete responseDrafts[bookingId];
    toast(res.droppedPhotos
      ? "Response filed — photos were too large to save on this device"
      : "Response filed with the resolution desk");
    renderPro();
    if (deskOpen()) renderDesk();
  });
}

function deskOpen() {
  const el = $("#deskMode");
  return !!el && el.style.display !== "none";
}

/* ---------- Settlement (resolution desk) ---------- */
/* The stylist's share carries Pampa's fee; the client gets whatever is left. */
function settleMath(amount, percent) {
  const p = Math.max(1, Math.min(99, Math.round(percent) || 0));
  const proGross = Math.round(amount * p / 100 / 50) * 50;
  const fee = escrowFee(proGross);
  return {
    percent: p,
    amount: amount,
    proGross: proGross,
    fee: fee,
    toPro: proGross - fee,
    toClient: amount - proGross,
  };
}

function settleDisputeLocal(id, outcome, percent) {
  const b = findBooking(id);
  if (!b) return { ok: false, msg: "Booking not found" };
  if (statusOf(b) !== "disputed") return { ok: false, msg: "Only a disputed booking can be settled" };
  if (!b.pay || !b.pay.amount) return { ok: false, msg: "There is no escrowed money on this booking" };
  const amount = b.pay.amount;
  const at = new Date().toISOString();
  const by = "Resolution desk";

  if (outcome === "refund") {
    b.status = "settled";
    b.refund = { amount: amount, fee: 0, at: at, reason: "dispute-refund" };
    b.resolution = { type: "refund", toClient: amount, toPro: 0, fee: 0, at: at, by: by };
    ledgerNote(b, "Desk refunded " + naira(amount) + " to the client in full");
    save();
    return { ok: true, resolution: b.resolution };
  }

  if (outcome === "release") {
    b.status = "settled";
    b.releasedAt = at;
    b.resolution = { type: "release", toClient: 0, toPro: b.pay.netToPro, fee: b.pay.fee, at: at, by: by };
    ledgerNote(b, "Desk released " + naira(b.pay.netToPro) + " to " + (b.stylistName || "the stylist"));
    save();
    return { ok: true, resolution: b.resolution };
  }

  if (outcome === "split") {
    const m = settleMath(amount, percent);
    b.status = "settled";
    b.resolution = {
      type: "split", percent: m.percent, proGross: m.proGross, fee: m.fee,
      toClient: m.toClient, toPro: m.toPro, at: at, by: by,
    };
    if (m.toClient > 0) b.refund = { amount: m.toClient, fee: 0, at: at, reason: "dispute-split" };
    ledgerNote(b, "Desk split escrow " + m.percent + "/" + (100 - m.percent) + ": " +
      naira(m.toClient) + " back to the client, " + naira(m.toPro) + " to " + (b.stylistName || "the stylist"));
    save();
    return { ok: true, resolution: b.resolution };
  }

  return { ok: false, msg: "Unknown settlement outcome" };
}

function deskDisputes() {
  return state.bookings.filter(function (b) { return statusOf(b) === "disputed"; }).sort(byWhen);
}

function deskSettled() {
  return state.bookings.filter(function (b) {
    return b.resolution && statusOf(b) !== "disputed";
  }).sort(byWhenDesc);
}

/* ---------- Pro ledger ---------- */
function isHeld(b) {
  const s = statusOf(b);
  return s === "escrowed" || s === "confirmed" || s === "disputed";
}

/* Money the stylist is owed: client releases plus desk splits in their favour. */
function creditedTo(b, stylistId) {
  if (b.stylistId !== stylistId) return 0;
  const s = statusOf(b);
  if (s === "released") return b.pay ? b.pay.netToPro : 0;
  if (s === "settled" && b.resolution && b.resolution.toPro) return b.resolution.toPro;
  return 0;
}

function proBalances(stylistId) {
  const mine = state.bookings.filter(function (b) { return b.stylistId === stylistId; });
  const credited = mine.filter(function (b) { return creditedTo(b, stylistId) > 0; });
  const gross = credited.reduce(function (s, b) { return s + creditedTo(b, stylistId); }, 0);
  const paidOut = (proStore.payouts[stylistId] || []).reduce(function (s, p) { return s + p.amount; }, 0);
  const fees = mine.reduce(function (s, b) {
    if (statusOf(b) === "settled" && b.resolution) return s + (b.resolution.fee || 0);
    return s + (b.pay ? b.pay.fee : 0);
  }, 0);
  const held = mine.filter(isHeld).reduce(function (s, b) {
    return s + (b.pay ? b.pay.netToPro : 0);
  }, 0);
  return {
    available: Math.max(0, gross - paidOut),
    inEscrow: held,
    lifetime: gross,
    paidOut: paidOut,
    fees: fees,
    completed: credited.length,
  };
}

function proJobs(stylistId) {
  const mine = state.bookings.filter(function (b) { return b.stylistId === stylistId; });
  return {
    requests: mine.filter(function (b) { return statusOf(b) === "escrowed"; }).sort(byWhen),
    /* Placed, not funded. Kept apart from `requests` because the two ask for
       different things: a request is a decision, an unfunded booking is only
       news. Nothing here is accept-or-counter — the money is not in escrow, so
       there is nothing to answer — but it is the professional's desk and the
       client has named them, which is why it is counted and drawn rather than
       filtered away. */
    unfunded: mine.filter(function (b) { return statusOf(b) === "unpaid"; }).sort(byWhen),
    accepted: mine.filter(function (b) { return statusOf(b) === "confirmed"; }).sort(byWhen),
    disputes: mine.filter(function (b) { return statusOf(b) === "disputed"; }).sort(byWhen),
    closed: mine.filter(function (b) {
      const s = statusOf(b);
      return s === "released" || s === "disputed" || s === "declined" || s === "cancelled" || s === "settled";
    }).sort(byWhenDesc),
  };
}

/* ---------- Payouts ---------- */
function destinationFor(stylistId) {
  return proStore.destinations[stylistId] || null;
}

function setDestination(stylistId, dest) {
  proStore.destinations[stylistId] = dest;
  proSave();
}

function requestPayout(stylistId) {
  const bal = proBalances(stylistId);
  const dest = destinationFor(stylistId);
  if (!dest) return { ok: false, msg: "Add a payout destination first" };
  if (bal.available < 1000) {
    return { ok: false, msg: "Minimum withdrawal is ₦1,000 — you have " + naira(bal.available) };
  }
  const payout = {
    id: "p" + Date.now(),
    amount: bal.available,
    method: dest.type,
    to: dest.type === "bank" ? dest.bank + " · " + dest.account : dest.network + " · " + dest.address,
    at: new Date().toISOString(),
    status: "Sent",
  };
  if (!proStore.payouts[stylistId]) proStore.payouts[stylistId] = [];
  proStore.payouts[stylistId].push(payout);
  proSave();
  return { ok: true, payout: payout };
}

/* Keep the half-typed payout form when the tab re-renders. */
function captureDestInputs() {
  const bank = $("#destBank");
  const acct = $("#destAcct");
  const network = $("#destNetwork");
  const addr = $("#destAddr");
  if (bank) destDraft.bank = bank.value;
  if (acct) destDraft.account = acct.value;
  if (network) destDraft.network = network.value;
  if (addr) destDraft.address = addr.value;
}

/* Journalled bookings created before escrow existed. */
function migrateBookings() {
  let changed = false;
  state.bookings.forEach(function (b) {
    if (!b.history) b.history = [];
    if (b.proMarkedDone === undefined) b.proMarkedDone = false;
    if (!b.status) {
      const amount = b.total || b.price || 0;
      const fee = escrowFee(amount);
      b.status = "confirmed";
      b.pay = {
        method: "legacy",
        ref: "ESC-legacy",
        amount: amount,
        fee: fee,
        netToPro: amount - fee,
        paidAt: b.date,
      };
      b.history.push({ at: b.date, label: "Imported booking (paid before escrow was added)" });
      changed = true;
    }
  });
  if (changed) save();
  return changed;
}

/* ---------- Sheet helpers (shared by booking + payment sheets) ---------- */
function showSheetEl(sel) {
  const el = $(sel);
  $("#sheetOverlay").style.display = "block";
  el.style.display = "block";
  void el.offsetHeight; // force reflow so the transition runs even without rAF
  el.classList.add("show");
}

function hideSheetEl(sel) {
  const el = $(sel);
  el.classList.remove("show");
  setTimeout(function () {
    el.style.display = "none";
    if (!document.querySelector(".sheet.show")) $("#sheetOverlay").style.display = "none";
  }, 350);
}

function closeAllSheets() {
  $$(".sheet").forEach(function (s) { s.classList.remove("show"); });
  setTimeout(function () {
    $$(".sheet").forEach(function (s) { s.style.display = "none"; });
    $("#sheetOverlay").style.display = "none";
  }, 350);
}

/* ---------- Payment into escrow ----------
   Two ways in, one sheet. "pay" is the first payment on a booking; "topup" is
   the difference a counter created when the client accepted a higher price —
   the same escrow, repriced, never a second one. */
const payDraft = { bookingId: null, method: "card", stage: "choose", mode: "pay" };

function openPaySheet(bookingId) {
  const b = findBooking(bookingId);
  if (!b) return;
  if (statusOf(b) !== "unpaid") {
    toast("This booking is already paid");
    return;
  }
  payDraft.bookingId = bookingId;
  payDraft.method = (state.user && state.user.payMethod) || "card";
  payDraft.stage = "choose";
  payDraft.mode = "pay";
  renderPaySheet();
  showSheetEl("#paySheet");
}

/* The difference between what the escrow holds and the price the client just
   agreed to. Zero when they agreed to pay less (that settles with a refund). */
function topUpAmountFor(b) {
  const p = counterOf(b);
  if (p == null || !b) return 0;
  return Math.max(0, counterTotal(b, p) - (b.pay ? b.pay.amount : 0));
}

function openTopUpSheet(bookingId) {
  const b = findBooking(bookingId);
  if (!b) return;
  payDraft.bookingId = bookingId;
  payDraft.method = (state.user && state.user.payMethod) || "card";
  payDraft.stage = "choose";
  payDraft.mode = "topup";
  renderPaySheet();
  showSheetEl("#paySheet");
}

/* The escrow journey in one glance: your money leaves you, rests with Pampa,
   and reaches the stylist only when you say the job was done. */
function flowArtHtml(serviceIco) {
  return '<div class="flowArt">' +
    '<span class="flowNode"><span class="flowIco">' + icon("user") + "</span><small>You</small></span>" +
    '<span class="flowLink"></span>' +
    '<span class="flowNode gold"><span class="flowIco">' + icon("lock") + "</span><small>Escrow</small></span>" +
    '<span class="flowLink"></span>' +
    '<span class="flowNode"><span class="flowIco">' + icon(serviceIco || "scissors") + "</span><small>Stylist</small></span>" +
    "</div>";
}

function renderPaySheet() {
  const b = findBooking(payDraft.bookingId);
  if (!b) return;
  const sv = SERVICES.find(function (s) { return s.id === b.serviceId; }) || {};
  const isTopUp = payDraft.mode === "topup";
  /* On a top-up the money that moves is only the difference: the escrow is one
     pot being brought up to the agreed total, not a second payment. */
  const amount = isTopUp ? topUpAmountFor(b) : (b.total || b.price || 0);
  const fee = escrowFee(amount);
  const net = amount - fee;

  $("#payTitle").textContent = isTopUp ? "Top up to confirm" : (sv.name || "Booking");
  $("#paySub").textContent = isTopUp
    ? naira(counterOf(b) || 0) + " agreed with " + (b.stylistName || "your stylist")
    : (b.stylistName || "Stylist") + " · " + b.date + " at " + b.time;

  if (payDraft.stage === "done") {
    $("#payBody").innerHTML =
      '<div class="paidDone"><div class="artVault">' + illus("vault") + "</div>" +
      '<div class="tickBig">' + icon("check") + "</div>" +
      "<h3>" + naira(b.total || b.price || 0) + " held in escrow</h3>" +
      '<p class="sub">' + (isTopUp
        ? "Price agreed at " + naira(counterOf(b) || b.price || 0) + " — " + esc(b.stylistName || "the stylist") + " is now on the job."
        : esc(b.stylistName || "The stylist") + " can now accept your booking.") +
      " The money is released only after you confirm the job was done and you're satisfied.</p>" +
      '<p class="escrowRef">Escrow ref ' + esc((b.pay || {}).ref || "") + "</p></div>";
    $("#payFoot").style.display = "none";
    return;
  }

  const methods = PAY_METHODS.map(function (m) {
    const active = m.id === payDraft.method;
    return '<button class="methodCard' + (active ? " active" : "") + '" data-paymethod="' + m.id + '">' +
      '<span class="methodIco">' + icon(m.ico) + "</span>" +
      '<span class="pickInfo"><b>' + esc(m.name) + "</b><small>" + esc(m.note) + "</small></span>" +
      (active ? '<span class="pickCheck">' + icon("check") + "</span>" : "") +
      "</button>";
  }).join("");

  const travel = b.travelFee || 0;
  const target = counterTotal(b, counterOf(b) || b.price || 0);
  const held = b.pay ? b.pay.amount : 0;
  const feeBox = isTopUp
    ? '<div class="feeBox">' +
        '<p class="feeRow"><span>Agreed price</span><b>' + naira(target) + "</b></p>" +
        '<p class="feeRow"><span>Already in escrow</span><b>\u2212' + naira(held) + "</b></p>" +
        '<p class="feeRow total"><span>Pay now</span><b>' + naira(amount) + "</b></p>" +
      "</div>"
    : '<div class="feeBox">' +
        '<p class="feeRow"><span>' + esc(sv.name || "Service") + " \u00b7 your price</span><b>" + naira(b.price || 0) + "</b></p>" +
        (travel ? '<p class="feeRow"><span>Travel</span><b>' + naira(travel) + "</b></p>" : "") +
        '<p class="feeRow total"><span>Held in escrow</span><b>' + naira(amount) + "</b></p>" +
      "</div>";

  $("#payBody").innerHTML =
    flowArtHtml(sv.ico) +
    '<div class="sheetBlock"><label>How do you want to pay?</label><div class="pickList">' + methods + "</div></div>" +
    feeBox +
    '<p class="escrowNote">' + icon("lock") + " Pampa holds " + naira(isTopUp ? target : amount) + " in escrow. " +
      esc(b.stylistName || "The stylist") + " receives " +
      naira(escrowNet(isTopUp ? target : amount)) + " after a " +
      naira(escrowFee(isTopUp ? target : amount)) +
      " platform fee, once you confirm the job is done and you're satisfied.</p>" +
    /* fee and net are shown above for the money that moves; the escrow total is
       what the job is worth */
    (isTopUp ? '<p class="finePrint">This is the same escrow topped up — one reference, one fee on the agreed total.</p>' : "");

  $("#payFoot").style.display = "flex";
  $("#payPrice").textContent = naira(amount);
  /* textContent, so the ampersand is a character here and not an entity the
     parser would have decoded in innerHTML */
  $("#payNow").textContent = isTopUp ? "Pay " + naira(amount) + " & confirm" : "Pay " + naira(amount) + " into escrow";
}

function confirmPayment() {
  const b = findBooking(payDraft.bookingId);
  if (!b) {
    toast("This booking is no longer awaiting payment");
    return;
  }
  const btn = $("#payNow");
  if (payDraft.mode === "topup") {
    setBusy(btn, true);
    completeCounterTopUp(b.id, payDraft.method).then(function (res) {
      setBusy(btn, false);
      if (!res.ok) {
        toast(res.msg);
        return;
      }
      if (state.user) {
        state.user.payMethod = payDraft.method;
        save();
      }
      payDraft.stage = "done";
      renderPaySheet();
      renderBookings();
      toast("Top-up paid — booking confirmed at " + naira(res.price));
    }).catch(function (e) {
      setBusy(btn, false);
      toast(dbText(e, "Payment did not go through — try again"));
    });
    return;
  }
  if (statusOf(b) !== "unpaid") {
    toast("This booking is no longer awaiting payment");
    return;
  }
  setBusy(btn, true);
  payBooking(b.id, payDraft.method).then(function (res) {
    setBusy(btn, false);
    if (!res.ok) {
      toast(res.msg);
      return;
    }
    if (state.user) {
      state.user.payMethod = payDraft.method;
      save();
    }
    payDraft.stage = "done";
    renderPaySheet();
    renderBookings();
    toast(naira(b.total || b.price) + " held in escrow");
  }).catch(function (e) {
    setBusy(btn, false);
    toast(dbText(e, "Payment did not go through — try again"));
  });
}

/* ---------- Negotiation sheet (the professional's counter) ---------- */
const negoDraft = { bookingId: null, price: 0 };

function openNegoSheet(bookingId) {
  const b = findBooking(bookingId);
  if (!b) return;
  if (!negotiationOpen(b)) {
    toast(counterOf(b) != null
      ? "Your price is already with the client"
      : "This request can no longer be negotiated");
    return;
  }
  const range = rangeFor(myProviderRecord() || {}, b.serviceId);
  negoDraft.bookingId = bookingId;
  /* Start from the client's offer, brought up to the floor: a professional
     answering a lowball should not have to type their own minimum in. */
  negoDraft.price = clampToRange(offerOf(b), range);
  renderNegoSheet();
  showSheetEl("#negoSheet");
}

function renderNegoSheet() {
  const b = findBooking(negoDraft.bookingId);
  if (!b) return;
  const sv = SERVICES.find(function (s) { return s.id === b.serviceId; }) || {};
  const range = rangeFor(myProviderRecord() || {}, b.serviceId);
  $("#negoSub").textContent = esc(sv.name || "Service") + " \u00b7 your range " + rangeText(range);
  $("#negoBody").innerHTML =
    '<div class="sheetBlock"><label>What the client offered</label>' +
      '<p class="negoOffer">' + icon("coin") + " " + naira(offerOf(b)) + " for " + esc(sv.name || "this job") +
        (b.travelFee ? " + " + naira(b.travelFee) + " travel" : "") + "</p></div>" +
    '<div class="sheetBlock"><label>Your price</label>' +
      '<input class="rateIn wide" type="number" id="negoPrice" inputmode="numeric" step="50" min="' + range.min +
        '" max="' + range.max + '" value="' + negoDraft.price + '">' +
      '<div class="priceChips">' +
        negoPresets(b, range).map(function (o) {
          return '<button class="chip" data-nego-set="' + o.set + '">' + esc(o.label) + "</button>";
        }).join("") +
      "</div>" +
      '<p class="finePrint">Anything inside ' + rangeText(range) + " is what your card already promises. " +
        "Outside it the client is asked to pick again instead." +
      "</p></div>" +
    '<div class="sheetBlock"><label>Note (optional)</label>' +
      '<input class="rateIn wide" type="text" id="negoNote" maxlength="120" placeholder="e.g. this one is a full restyle"></div>' +
    negoFeeHtml(b);
  bindNegoPrice();
}

/* The three prices worth one tap: the floor, the ceiling, and the client's own
   number when it sits between them. */
function negoPresets(b, range) {
  const their = clampToRange(offerOf(b), range);
  const out = [{ set: "min", label: "Lowest " + naira(range.min), price: range.min }];
  if (their !== range.min && their !== range.max) {
    out.push({ set: "offer", label: "Their offer " + naira(their), price: their });
  }
  out.push({ set: "max", label: "Top " + naira(range.max), price: range.max });
  return out;
}

/* Its own painter so typing a price moves the numbers without rebuilding — and
   losing focus of — the field being typed into. */
function negoFeeHtml(b) {
  const target = counterTotal(b, negoDraft.price);
  return '<div class="feeBox" id="negoFee">' +
    '<p class="feeRow"><span>Your price</span><b>' + naira(negoDraft.price) + "</b></p>" +
    (b.travelFee ? '<p class="feeRow"><span>Travel</span><b>' + naira(b.travelFee) + "</b></p>" : "") +
    '<p class="feeRow"><span>You keep, after the ' + Math.round(FEE_RATE * 100) + "% fee</span><b>" + naira(escrowNet(target)) + "</b></p>" +
    '<p class="feeRow total"><span>Client would pay</span><b>' + naira(target) + "</b></p>" +
    "</div>";
}

function paintNegoFee() {
  const b = findBooking(negoDraft.bookingId);
  const box = $("#negoFee");
  if (b && box) box.outerHTML = negoFeeHtml(b);
}

function bindNegoPrice() {
  const el = $("#negoPrice");
  if (!el || el.dataset.wired === "1") return;
  el.dataset.wired = "1";
  el.addEventListener("input", function () {
    negoDraft.price = roundTo50(Number(el.value) || 0);
    paintNegoFee();
  });
}

function setNegoPrice(pick) {
  const b = findBooking(negoDraft.bookingId);
  if (!b) return;
  const range = rangeFor(myProviderRecord() || {}, b.serviceId);
  const found = negoPresets(b, range).filter(function (o) { return o.set === pick; })[0];
  if (found) negoDraft.price = found.price;
  const el = $("#negoPrice");
  if (el) el.value = String(negoDraft.price);
  paintNegoFee();
}

function sendCounter() {
  const b = findBooking(negoDraft.bookingId);
  if (!b) return;
  const priceEl = $("#negoPrice");
  const noteEl = $("#negoNote");
  const btn = $("#negoSend");
  setBusy(btn, true);
  counterBooking(b.id, Number(priceEl ? priceEl.value : 0), noteEl ? noteEl.value.trim() : "").then(function (res) {
    setBusy(btn, false);
    if (!res.ok) {
      toast(res.msg);
      return;
    }
    hideSheetEl("#negoSheet");
    toast("Price sent — " + naira(res.price) + " is with the client");
    renderPro();
    renderBookings();
  }).catch(function (e) {
    setBusy(btn, false);
    toast(dbText(e, "Could not send that price — try again"));
  });
}

/* ---------- Pro mode ---------- */
let proTab = "requests";
const destDraft = { type: "bank", bank: "", account: "", network: "TRC20", address: "" };

/* The escrow desk belongs to the signed-in professional and nobody else: a
   client has no record in the directory, so there is nobody for them to accept
   jobs as. A pro works as themselves — the identity cannot be swapped. */
function enterProMode() {
  const u = state.user || {};
  if (u.role !== "pro" || !u.trade) {
    toast("Only a professional account can take bookings");
    return;
  }
  if (proStore.proId !== selfKey()) {
    proStore.proId = selfKey();
    proSave();
  }
  proTab = "requests";
  $("#proMode").style.display = "flex";
  renderPro();
}

function exitProMode() {
  $("#proMode").style.display = "none";
  if (state.user) renderProfile();
}

/* The full-screen surfaces that belong to a signed-in account. Logout closes
   them the way it already closes the clip rail and any open sheet — without
   this, signing out of the escrow desk left it standing, and the next person to
   sign in on this device opened the app looking at the previous account's
   requests, their takings and a live Decline button. The acting identity goes
   with it: the desk is whoever signed in now, and proId is set again the moment
   a professional enters it. */
function closeAccountSurfaces() {
  ["#proMode", "#deskMode", "#providerProfile"].forEach(function (sel) {
    const el = $(sel);
    if (el) el.style.display = "none";
  });
  state.providerView = null;
  /* And every sheet, because they are the same kind of surface: a negotiate or
     pay sheet left open belongs to the booking of whoever signed out, and it
     was still sitting over the next account's app. */
  closeAllSheets();
  if (proStore.proId) {
    proStore.proId = null;
    proSave();
  }
}

function renderPro() {
  const id = proStore.proId;
  const st = stylistById(id);

  /* The desk is the signed-in professional's own. The only way to get here
     without a record is a half-finished sign-up, so it says that rather than
     offering somebody else's identity. */
  if (!st) {
    const u = state.user || {};
    $("#proWho").textContent = "Your work profile";
    $("#proReqCount").textContent = "0";
    $("#proBody").innerHTML =
      emptyState("briefcase", "Your work profile is not ready",
        u.trade ? "Set your area on the Profile tab so clients can find you."
                : "Finish your trade step so clients can book you.");
    const dest = destinationFor(selfKey());
    if (dest) Object.assign(destDraft, dest);
    return;
  }

  const bal = proBalances(id);
  const jobs = proJobs(id);
  $("#proWho").textContent = st.name + " · " + st.skill;
  /* the tab's badge counts what the tab holds: the requests to answer and the
     bookings that are only news so far */
  $("#proReqCount").textContent = String(jobs.requests.length + jobs.unfunded.length);
  /* The Jobs tab carries every accepted booking — confirmed work in progress
     plus any dispute on it — so its count says what the tab actually holds,
     and an accepted job is visible as a number the moment it is accepted. */
  const jobCount = $("#proJobCount");
  const heldJobs = jobs.accepted.length + jobs.disputes.length;
  if (jobCount) {
    jobCount.textContent = heldJobs ? String(heldJobs) : "";
    jobCount.style.display = heldJobs ? "inline-block" : "none";
  }
  $$(".proTab").forEach(function (t) {
    t.classList.toggle("active", t.dataset.protab === proTab);
  });

  const head =
    '<div class="walletCard">' +
      '<p class="walletLabel">Available to withdraw</p>' +
      '<p class="walletBig">' + naira(bal.available) + "</p>" +
      '<div class="walletSplit">' +
        "<div><span>" + naira(bal.inEscrow) + "</span><small>in escrow</small></div>" +
        "<div><span>" + naira(bal.lifetime) + "</span><small>earned</small></div>" +
        "<div><span>" + bal.completed + "</span><small>jobs paid</small></div>" +
      "</div>" +
    "</div>";

  let body = "";
  /* the unfunded ones lead: nothing can be done about them yet, and putting
     them under the requests the pro can actually answer would bury the one
     thing on the page that has a button on it */
  if (proTab === "requests") body = proRequestsHtml(jobs.unfunded.concat(jobs.requests));
  if (proTab === "jobs") body = proJobsHtml(jobs.accepted) + proDisputesHtml(jobs.disputes);
  if (proTab === "wallet") body = proWalletHtml(id, bal, jobs.closed);

  $("#proBody").innerHTML = head + body;
}

/* The trip, from the professional's side of it: where they are going, how far
   it is, and what the client is paying for the journey. A home visit is a
   promise of travel, so the travel belongs on the card as its own fact — not
   folded into a price line where it reads like a surcharge the client chose.

   The distance is marked the way every distance in the app is: plain when the
   booking was priced fix-to-fix, tilde when it was measured to the centre of
   the client's area because no device fix existed. The booking carries which
   one it was (kmPrecise, a snapshot from the sheet), so a card the professional
   reads three days later says what it knew at pricing time — not what the
   client's device happens to say now. */
function tripTextFor(b) {
  if (b.loc === "studio") {
    return icon("store") + " Client comes to your studio" + (b.areaName ? " · " + esc(b.areaName) : "") +
      " · no travel fee";
  }
  const approx = b.kmPrecise === false;
  const km = b.km;
  /* Kilometres are geography; minutes are the decision. A pro weighing a job
     thinks "can I be there for 10:30?", and the app already has the answer's
     arithmetic — driveMins is the same estimate the walk-in line uses. The
     tilde rides along: an approximate distance can only produce an
     approximate time. */
  const dist = km == null ? "distance unknown"
    : km < PRECISE_EPS ? "in your area"
      : (approx ? "~" : "") + fmtKm(km) + " from your studio";
  const mins = km == null || km < PRECISE_EPS ? "" : " · ~" + driveMins(km) + " min drive" + (approx ? "" : "");
  const fee = b.travelFee ? naira(b.travelFee) : "no travel fee";
  return icon("house") + " " + esc(placeLine(b.address, b.areaName || "client address")) +
    (km != null ? " · " + dist + mins : "") +
    " · travel " + fee +
    (approx && km != null && km >= PRECISE_EPS
      ? " · measured to the centre of " + esc(b.areaName || "their area")
      : "");
}

/* The same line from the mediator's point of view, where "your studio" means nothing. */
function whereTextNeutral(b) {
  if (b.loc === "studio") return icon("store") + " Studio visit" + (b.areaName ? " · " + esc(b.areaName) : "");
  const approx = b.kmPrecise === false;
  const mins = b.km == null || b.km < PRECISE_EPS ? "" : " · ~" + driveMins(b.km) + " min drive";
  return icon("house") + " " + esc(placeLine(b.address, b.areaName || "client address")) +
    (b.km != null ? " · " + (approx ? "~" : "") + fmtKm(b.km) + " from the stylist's studio" + mins : "") +
    (b.travelFee ? " · travel " + naira(b.travelFee) : "");
}

function proRequestsHtml(list) {
  if (!list.length) {
    return emptyState("requests", "No requests right now", "A booking appears here the moment a client places one — funded or not.");
  }
  return list.map(function (b, i) {
    const sv = SERVICES.find(function (s) { return s.id === b.serviceId; }) || {};
    /* Two kinds of row share this list: a request the money has reached, and a
       booking that exists but has not been paid for. They are not the same
       thing and must not read as one — an unfunded booking has no Accept on
       it, because accepting a promise is how a professional works for free. */
    const funded = statusOf(b) === "escrowed";
    const net = b.pay ? b.pay.netToPro : 0;
    const paid = b.pay ? b.pay.amount : 0;
    /* The price this request is sitting at, and the range this professional
       published for the service: a client's offer inside it is a booking to
       take, one below it is a conversation. */
    const counter = counterOf(b);
    const range = rangeFor(myProviderRecord() || {}, b.serviceId);
    const offer = offerOf(b);
    const inRange = offer >= range.min && offer <= range.max;
    const priceLine = !funded
      ? '<p class="proOffer">' + icon("clock") + " Client offers <b>" + naira(offer) +
        "</b> · your range " + esc(rangeText(range)) + "</p>"
      : counter != null
        ? '<p class="proOffer countered">' + icon("coin") + " You countered <b>" + naira(counter) +
          "</b> · waiting on the client's answer</p>"
        : '<p class="proOffer' + (inRange ? "" : " low") + '">' + icon("coin") + " Client offers <b>" + naira(offer) + "</b>" +
          " · your range " + esc(rangeText(range)) + "</p>";
    /* What can be done about it right now. An unfunded booking is one line and
       no controls: the only thing standing between this client and an answer is
       their own payment, and a Decline button here would be a way to turn down a
       job that was never actually offered. */
    const actions = !funded
      ? '<p class="proStep">' + icon("clock") + " Waiting on " + esc(b.clientName || "the client") +
        " to pay " + naira(b.total || b.price || 0) + " into escrow — accept or counter the moment it lands.</p>"
      : counter != null
        ? '<div class="proActions stacked">' +
            '<button class="cancelBtn" data-declinejob="' + b.id + '">Decline · refund the client</button>' +
          "</div>"
        : '<div class="proActions stacked">' +
            '<button class="bookBtn wide" data-acceptjob="' + b.id + '">Accept ' + naira(offer) + "</button>" +
            '<button class="ghostBtn wide" data-negotiate="' + b.id + '">' + icon("sliders") + " Negotiate price</button>" +
            '<button class="cancelBtn" data-declinejob="' + b.id + '">Decline</button>' +
          "</div>";
    return '<div class="card proCard" style="--i:' + i + '">' +
      '<div class="proTop"><h4>' + esc(sv.name || "Service") + '</h4>' +
        (funded
          ? '<span class="badge info">' + naira(paid) + " in escrow</span>"
          : '<span class="badge">Not funded yet</span>') + "</div>" +
      '<p class="proMeta">' + esc(b.clientName || "Client") + " · " + esc(b.date) + " at " + esc(b.time) + "</p>" +
      '<p class="proMeta">' + tripTextFor(b) + "</p>" +
      priceLine +
      /* With a counter on the table these are the numbers the client would be
         accepting, not the ones in escrow \u2014 so the label says which. An
         unfunded booking is a conditional too: the number is what the job pays
         once the money arrives. */
      '<p class="proEarn">' + (counter != null || !funded ? "You'd receive" : "You receive") +
        " <b>" + naira(funded
          ? (counter != null ? escrowNet(counterTotal(b, counter)) : net)
          : escrowNet(b.total || b.price || 0)) + "</b>" +
        (b.pay ? ' <small>(after ' + naira(b.pay.fee) + " platform fee)</small>" : "") + "</p>" +
      actions + "</div>";
  }).join("");
}

/* Disputed jobs the stylist still has to answer for. */
function proDisputesHtml(list) {
  if (!list.length) return "";
  return '<div class="sectionHead"><h2>Under review</h2></div>' + list.map(function (b) {
    const sv = SERVICES.find(function (s) { return s.id === b.serviceId; }) || {};
    const d = b.dispute || {};
    const resp = d.response;
    const frozen = b.pay ? b.pay.amount : 0;
    const head = '<div class="proTop"><h4>' + esc(sv.name || "Service") + " · " + esc(statusLabelFor(b)) + "</h4>" +
      '<span class="badge bad">' + naira(frozen) + " frozen</span></div>" +
      '<p class="proMeta">' + esc(b.clientName || "Client") + " · " + esc(b.date) + " at " + esc(b.time) + "</p>" +
      '<p class="proMeta">' + tripTextFor(b) + "</p>";

    if (resp) {
      return '<div class="card proCard" data-prodispute="' + b.id + '">' + head +
        '<div class="eviSide proSide"><p class="eviHead">Your response · ' + esc(fmtWhen(resp.at)) + "</p>" +
          (resp.note ? '<p class="eviNote">' + esc(resp.note) + "</p>" : "") +
          galleryHtml(resp.photos, b.id, "pro") +
        "</div>" +
        '<p class="proStep">' + icon("clock") + " Filed. The resolution desk decides whether " + naira(frozen) + " is released or refunded.</p>" +
        "</div>";
    }

    const draft = responseDraftFor(b.id);
    return '<div class="card proCard" data-prodispute="' + b.id + '">' + head +
      '<div class="eviSide"><p class="eviHead">Client evidence · ' + esc(fmtWhen(d.at)) + "</p>" +
        '<p class="eviNote"><b>' + esc(d.reason || "Something else") + "</b>" +
          (d.note ? "<br>" + esc(d.note) : "") + "</p>" +
        (d.photos && d.photos.length ? galleryHtml(d.photos, b.id, "client")
          : '<p class="finePrint">The client attached no photos.</p>') +
      "</div>" +
      '<p class="deskAsk">Your side</p>' +
      '<textarea class="noteInput" rows="3" data-responsenote="' + b.id + '" ' +
        'placeholder="Where you were, what you delivered, anything the desk should know">' + esc(draft.text) + "</textarea>" +
      galleryHtml(draft.photos, b.id, "draftpro") +
      '<button class="eviAdd" data-evifile="response" data-evibooking="' + b.id + '">' + icon("camera") + " " +
        (draft.photos.length ? "Add another photo" : "Add a photo") + "</button>" +
      '<button class="bookBtn wide" data-respond="' + b.id + '">Send response to the desk</button>' +
      '<p class="finePrint">Up to ' + EVIDENCE_MAX_PHOTOS +
        " photos. Your statement and photos appear on the desk card beside the client evidence.</p>" +
      "</div>";
  }).join("");
}

function proJobsHtml(list) {
  if (!list.length) {
    return emptyState("money", "No accepted jobs yet", "Accept a request and it lands here with the money held in escrow.");
  }
  return list.map(function (b) {
    const sv = SERVICES.find(function (s) { return s.id === b.serviceId; }) || {};
    const net = b.pay ? b.pay.netToPro : 0;
    const step = b.proMarkedDone
      ? '<p class="proStep ok">' + icon("check") + " Job marked done — waiting for the client to release " + naira(net) + "</p>"
      : '<p class="proStep">Finished the job? Mark it done so the client can release your payment.</p>';
    return '<div class="card proCard">' +
      '<div class="proTop"><h4>' + esc(sv.name || "Service") + '</h4>' +
        '<span class="badge ok">' + naira(net) + " held</span></div>" +
      '<p class="proMeta">' + esc(b.clientName || "Client") + " · " + esc(b.date) + " at " + esc(b.time) + "</p>" +
      '<p class="proMeta">' + tripTextFor(b) + "</p>" +
      step +
      (b.proMarkedDone ? "" :
        '<div class="proActions"><button class="bookBtn wide" data-jobdone="' + b.id + '">Mark job done</button></div>') +
      "</div>";
  }).join("");
}

function proWalletHtml(id, bal, closed) {
  const dest = destinationFor(id);
  const payouts = proStore.payouts[id] || [];
  const held = state.bookings.filter(function (b) { return b.stylistId === id && isHeld(b); });
  const destText = dest
    ? (dest.type === "bank" ? icon("bank") + " " + esc(dest.bank) + " · " + esc(dest.account) : icon("coin") + " " + esc(dest.network))
    : "Not set";

  const form = '<div class="destForm">' +
    '<div class="whereRow">' +
      '<button class="where' + (destDraft.type === "bank" ? " active" : "") + '" data-desttype="bank">Bank account</button>' +
      '<button class="where' + (destDraft.type === "crypto" ? " active" : "") + '" data-desttype="crypto">Crypto wallet</button>' +
    "</div>" +
    (destDraft.type === "bank"
      ? '<input id="destBank" class="addrInput" placeholder="Bank name (e.g. GTBank)" value="' + esc(destDraft.bank) + '">' +
        '<input id="destAcct" class="addrInput" inputmode="numeric" maxlength="10" placeholder="10-digit account number" value="' + esc(destDraft.account) + '">'
      : '<input id="destNetwork" class="addrInput" placeholder="Network (TRC20, ERC20, BTC)" value="' + esc(destDraft.network) + '">' +
        '<input id="destAddr" class="addrInput" placeholder="Wallet address" value="' + esc(destDraft.address) + '">') +
    '<button class="nextbtn tight" id="saveDest">Save destination</button></div>';

  return '<div class="card proCard"><div class="proTop"><h4>Payout destination</h4>' +
      '<span class="badge past">' + destText + "</span></div>" + form + "</div>" +
    '<div class="card proCard"><div class="proTop"><h4>Withdraw earnings</h4>' +
      '<span class="badge ok">' + naira(bal.available) + " ready</span></div>" +
      '<p class="proMeta">' + naira(bal.inEscrow) + " still held in escrow across " + held.length +
        " active job" + (held.length === 1 ? "" : "s") + "</p>" +
      '<div class="proActions"><button class="bookBtn wide" id="withdrawBtn">Withdraw ' + naira(bal.available) + "</button></div>" +
      '<p class="finePrint">Minimum ₦1,000 · payouts are simulated in this demo</p></div>' +
    (held.length
      ? '<div class="sectionHead"><h2>Held in escrow</h2></div>' + held.map(function (b) {
          return '<div class="card proRow"><span>' + esc(b.clientName || "Client") + " · " + esc(b.date) +
            '</span><b>' + naira(b.pay ? b.pay.netToPro : 0) + "</b></div>";
        }).join("")
      : "") +
    (payouts.length
      ? '<div class="sectionHead"><h2>Payouts</h2></div>' + payouts.slice().reverse().map(function (p) {
          return '<div class="card proRow"><span>' + esc(p.to) + " · " + esc(String(p.at).slice(0, 10)) +
            '</span><b>' + naira(p.amount) + "</b></div>";
        }).join("")
      : "") +
    '<div class="sectionHead"><h2>Activity</h2></div>' +
    (closed.length
      ? closed.map(function (b) {
          const sv = SERVICES.find(function (s) { return s.id === b.serviceId; }) || {};
          const held = statusOf(b) === "disputed";
          const got = creditedTo(b, id) || (b.pay ? b.pay.netToPro : 0);
          return '<div class="card proRow"><span>' + esc(sv.name || "Job") + " · " + esc(statusLabelFor(b)) +
            '</span><b>' + (held ? naira(got) + " held" : naira(got)) + "</b></div>";
        }).join("")
      : '<p class="empty">Nothing settled yet.</p>') +
    '<p class="finePrint">Pampa has taken ' + naira(bal.fees) + " in platform fees from your payouts so far.</p>";
}

function saveDestination(id) {
  if (destDraft.type === "bank") {
    const bankEl = $("#destBank");
    const acctEl = $("#destAcct");
    const bank = (bankEl ? bankEl.value.trim() : destDraft.bank) || "";
    const acct = ((acctEl ? acctEl.value : destDraft.account) || "").replace(/\D/g, "");
    if (!bank) return { ok: false, msg: "Enter your bank name" };
    if (acct.length !== 10) return { ok: false, msg: "Account number must be 10 digits" };
    setDestination(id, { type: "bank", bank: bank, account: acct });
  } else {
    const netEl = $("#destNetwork");
    const addrEl = $("#destAddr");
    const network = (netEl ? netEl.value.trim() : destDraft.network) || "";
    const address = (addrEl ? addrEl.value.trim() : destDraft.address) || "";
    if (!network) return { ok: false, msg: "Enter the network" };
    if (address.length < 8) return { ok: false, msg: "That wallet address looks too short" };
    setDestination(id, { type: "crypto", network: network, address: address });
  }
  Object.assign(destDraft, destinationFor(id));
  return { ok: true };
}

/* ---------- Journal (every money event, newest last) ---------- */
function fmtWhen(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = function (n) { return (n < 10 ? "0" : "") + n; };
  return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

/* A date the reader can name at a glance: "today", "tomorrow", otherwise
   "Sat 26 Sep". Used wherever a message has to point at the date field. */
function fmtDayShort(iso) {
  const s = String(iso || "").slice(0, 10);
  const d = new Date(s + "T00:00:00");
  if (!s || isNaN(d.getTime())) return String(iso || "");
  const pad = function (n) { return (n < 10 ? "0" : "") + n; };
  const key = function (x) { return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate()); };
  const now = new Date();
  if (s === key(now)) return "today";
  if (s === key(new Date(now.getTime() + 86400000))) return "tomorrow";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  return wd + " " + d.getDate() + " " + mo;
}

function journalHtml(b, withHead) {
  const h = b.history || [];
  if (!h.length) return "";
  return '<div class="journal">' + (withHead === false ? "" : '<p class="journalHead">Money trail</p>') +
    h.map(function (e) {
      return '<p class="journalRow"><span>' + esc(fmtWhen(e.at)) + "</span>" + esc(e.label) + "</p>";
    }).join("") + "</div>";
}

/* One line describing how a settlement ended. */
function resolutionText(b) {
  const r = b.resolution;
  if (!r) return "";
  if (r.type === "refund") return "Desk refunded " + naira(r.toClient) + " to the client in full";
  if (r.type === "release") return "Desk released " + naira(r.toPro) + " to " + esc(b.stylistName || "the stylist");
  return "Split " + r.percent + "/" + (100 - r.percent) + " — " + naira(r.toClient) + " back to the client, " +
    naira(r.toPro) + " to " + esc(b.stylistName || "the stylist");
}

/* ---------- Reporting a problem (client) ---------- */
const disputeDraft = { bookingId: null, reason: DISPUTE_REASONS[0], note: "", photos: [] };

/* =========================================================
 * Evidence — photos and statements from both sides
 * Photos are downscaled on-device and kept in the booking,
 * so they are never uploaded anywhere.
 * ========================================================= */
const EVIDENCE_MAX_PHOTOS = 4;         /* per side, per booking */
const EVIDENCE_MAX_BYTES = 700 * 1024; /* one photo, after compression */
const EVIDENCE_TOTAL_BYTES = 2000000;  /* everything this device keeps */
const EVIDENCE_MAX_EDGE = 900;         /* longest side, px */

function approxBytes(dataUrl) {
  const s = String(dataUrl || "");
  const i = s.indexOf(",");
  return i < 0 ? 0 : Math.round((s.length - i - 1) * 3 / 4);
}

function evidenceBytes(photos) {
  return (photos || []).reduce(function (s, p) { return s + approxBytes(p && p.data); }, 0);
}

function storedEvidenceBytes() {
  return state.bookings.reduce(function (s, b) {
    const d = b.dispute || {};
    return s + evidenceBytes(d.photos) + evidenceBytes((d.response || {}).photos);
  }, 0);
}

/* Downscale and re-encode so a phone photo fits in localStorage. */
function shrinkImage(file) {
  return new Promise(function (resolve, reject) {
    if (!file || !/^image\//.test(file.type || "")) {
      reject(new Error("Only images can be attached"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = function () { reject(new Error("That file could not be read")); };
    reader.onload = function () {
      const img = new Image();
      img.onerror = function () { reject(new Error("That image could not be opened")); };
      img.onload = function () {
        const w0 = img.width || 1;
        const h0 = img.height || 1;
        const scale = Math.min(1, EVIDENCE_MAX_EDGE / Math.max(w0, h0));
        const w = Math.max(1, Math.round(w0 * scale));
        const h = Math.max(1, Math.round(h0 * scale));
        try {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL("image/jpeg", 0.72));
        } catch (e) {
          reject(new Error("That image could not be processed"));
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* Why a photo could not be taken. The reader above speaks in product copy
   ("Only images can be attached", "That file could not be read") — the app's
   own sentences, never a database refusal, so they are shown as they stand.
   It has a name so that this read is visibly a different thing from the
   raw-message bug tools/toast-guard.mjs exists to catch. */
function photoWhy(e) {
  return (e && e.message) || "That image could not be read";
}

/* Add picked files to a draft's photo list, honouring both caps. */
async function addEvidence(draft, files) {
  const picked = Array.prototype.slice.call(files || []);
  if (!picked.length) return { added: 0, msg: "" };
  const room = EVIDENCE_MAX_PHOTOS - draft.photos.length;
  const queue = picked.slice(0, Math.max(0, room));
  let skipped = picked.length - queue.length;
  let tooBig = 0;
  let full = false;
  let added = 0;

  for (let i = 0; i < queue.length; i++) {
    let data;
    try {
      data = await shrinkImage(queue[i]);
    } catch (e) {
      return { added: added, msg: photoWhy(e) };
    }
    const bytes = approxBytes(data);
    if (bytes > EVIDENCE_MAX_BYTES) { tooBig++; continue; }
    if (storedEvidenceBytes() + evidenceBytes(draft.photos) + bytes > EVIDENCE_TOTAL_BYTES) {
      full = true;
      skipped += queue.length - i;
      break;
    }
    draft.photos.push({
      id: "ph" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      at: new Date().toISOString(),
      data: data,
    });
    added++;
  }

  const why = [];
  if (skipped && !full) why.push("up to " + EVIDENCE_MAX_PHOTOS + " photos per side");
  if (tooBig) why.push(tooBig + " photo" + (tooBig === 1 ? " was" : "s were") + " too large");
  if (full) why.push("no room left for evidence on this device");
  return {
    added: added,
    msg: why.length
      ? (added ? "Added " + added + " — " : "") + "skipped: " + why.join(", ")
      : added + " photo" + (added === 1 ? "" : "s") + " attached",
  };
}

const responseDrafts = {};
/* Which evidence button the shared file picker is filling: { kind, bookingId }. */
let evidenceTarget = null;

function evidenceLabel(side) {
  return side === "pro" || side === "draftpro" ? "Stylist evidence" : "Client evidence";
}

function responseDraftFor(bookingId) {
  if (!responseDrafts[bookingId]) responseDrafts[bookingId] = { photos: [], text: "" };
  return responseDrafts[bookingId];
}

/* Photos behind a reference: a draft pick, the client's, or the stylist's. */
function evidencePhotos(bookingId, side) {
  if (side === "draft") return disputeDraft.photos || [];
  if (side === "draftpro") return responseDraftFor(bookingId).photos || [];
  const b = findBooking(bookingId);
  if (!b || !b.dispute) return [];
  if (side === "pro") return (b.dispute.response || {}).photos || [];
  return b.dispute.photos || [];
}

function galleryHtml(photos, bookingId, side) {
  const list = photos || [];
  if (!list.length) return "";
  const closable = side === "draft" || side === "draftpro";
  return '<div class="eviRow">' + list.map(function (p, i) {
    return '<span class="eviThumb" data-eviphoto="' + side + '" data-evibooking="' + esc(bookingId || "") +
      '" data-eviindex="' + i + '" role="button" tabindex="0">' +
      '<img src="' + esc(p.data) + '" alt="evidence photo ' + (i + 1) + '">' +
      (closable ? '<button class="eviX" data-eviremove="' + esc(p.id) + '" aria-label="Remove photo">' + icon("close") + "</button>" : "") +
      "</span>";
  }).join("") + "</div>";
}

function openPhotoViewer(bookingId, side, index, label) {
  const box = $("#photoViewer");
  const list = evidencePhotos(bookingId, side);
  const p = list[index];
  if (!box || !p) return;
  $("#pvImg").src = p.data;
  $("#pvLabel").textContent = (label || "Evidence") + " · " + (index + 1) + " of " + list.length +
    (p.at ? " · " + fmtWhen(p.at) : "");
  box.style.display = "flex";
}

function closePhotoViewer() {
  const box = $("#photoViewer");
  if (!box) return;
  box.style.display = "none";
  $("#pvImg").src = "";
}

/* Remove a draft photo wherever it lives, and repaint that side. */
function removeEvidence(photoId) {
  const strip = function (draft) {
    const i = (draft.photos || []).findIndex(function (p) { return p.id === photoId; });
    if (i < 0) return false;
    draft.photos.splice(i, 1);
    return true;
  };
  if (strip(disputeDraft)) {
    if ($("#disputeSheet").classList.contains("show")) renderDisputeSheet();
    return;
  }
  const ids = Object.keys(responseDrafts);
  for (let i = 0; i < ids.length; i++) {
    if (strip(responseDrafts[ids[i]])) {
      renderPro();
      if ($("#deskMode").style.display !== "none") renderDesk();
      return;
    }
  }
}

/* Keep the money trail readable when a statement is long. */
function clip(text, n) {
  const s = String(text || "").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function openDisputeSheet(bookingId) {
  const b = findBooking(bookingId);
  if (!b) return;
  if (statusOf(b) !== "confirmed") {
    toast("Only a confirmed job can be reported");
    return;
  }
  disputeDraft.bookingId = bookingId;
  disputeDraft.reason = DISPUTE_REASONS[0];
  disputeDraft.note = "";
  renderDisputeSheet();
  showSheetEl("#disputeSheet");
}

function renderDisputeSheet() {
  const b = findBooking(disputeDraft.bookingId);
  if (!b) return;
  const held = b.pay ? b.pay.amount : 0;
  $("#disputeSub").textContent = naira(held) + " stays in escrow until the desk decides";

  const picks = DISPUTE_REASONS.map(function (r) {
    const active = r === disputeDraft.reason;
    return '<button class="pickCard' + (active ? " active" : "") + '" data-reason="' + esc(r) + '">' +
      '<span class="pickInfo"><b>' + esc(r) + "</b></span>" +
      (active ? '<span class="pickCheck">' + icon("check") + "</span>" : "") + "</button>";
  }).join("");

  $("#disputeBody").innerHTML =
    '<div class="sheetBlock"><label>What went wrong?</label><div class="pickList">' + picks + "</div></div>" +
    '<div class="sheetBlock"><label>Anything to add? (optional)</label>' +
      '<textarea id="disputeNote" class="noteInput" rows="3" placeholder="Tell the desk what happened">' +
      esc(disputeDraft.note) + "</textarea></div>" +
    '<div class="sheetBlock"><label>Photos of the problem (optional)</label>' +
      galleryHtml(disputeDraft.photos, null, "draft") +
      '<button class="eviAdd" data-evifile="dispute">' + icon("camera") + " " +
        (disputeDraft.photos.length ? "Add another photo" : "Add a photo") + "</button>" +
      '<p class="finePrint">Up to ' + EVIDENCE_MAX_PHOTOS +
        " photos, kept on your device. The resolution desk sees them; a photo of the finished work helps your case.</p></div>" +
    '<p class="escrowNote">' + icon("shield") + " Reporting a problem freezes the money. " + esc(b.stylistName || "The stylist") +
      " isn't paid and you aren't refunded until the resolution desk settles it.</p>";
}

function submitDispute() {
  const noteEl = $("#disputeNote");
  if (noteEl) disputeDraft.note = noteEl.value.trim();
  /* Reporting a problem freezes the money for both sides until the desk
     settles it — worth one confirmation, since it cannot be undone from
     here. */
  pampaConfirm({
    title: "Report this problem?",
    body: "The money stays frozen and " + ((findBooking(disputeDraft.bookingId) || {}).stylistName || "the stylist") + " isn't paid until the resolution desk settles it.",
    confirmLabel: "Report & freeze escrow",
    danger: true,
  }).then(function (yes) {
    if (!yes) return;
    disputeBooking(disputeDraft.bookingId, disputeDraft.reason, disputeDraft.photos.slice(), disputeDraft.note).then(function (res) {
      if (!res.ok) {
        toast(res.msg);
        return;
      }
      closeAllSheets();
      disputeDraft.photos = [];
      renderBookings();
      renderProfile();
      const went = res.photosDropped ? " (photos were too large to save on this device)" : "";
      toast("Reported — funds held while the desk reviews" + went);
    });
  });
}

/* ---------- Resolution desk (mediator) ---------- */
/* Each dispute keeps its own draft outcome so several can be worked at once. */
const deskDraft = { picks: {} };

function pickFor(id) {
  if (!deskDraft.picks[id]) deskDraft.picks[id] = { outcome: "split", percent: 50 };
  return deskDraft.picks[id];
}

function enterDeskMode() {
  $("#deskMode").style.display = "flex";
  renderDesk();
}

function exitDeskMode() {
  $("#deskMode").style.display = "none";
  renderBookings();
  renderProfile();
}

function deskFrozenTotal(list) {
  return list.reduce(function (s, b) { return s + (b.pay ? b.pay.amount : 0); }, 0);
}

function outcomeButtons(b, p) {
  const opts = [
    { id: "refund", label: "Refund client", ico: "refund" },
    { id: "release", label: "Pay stylist", ico: "check" },
    { id: "split", label: "Split", ico: "scale" },
  ];
  return '<div class="outcomeRow">' + opts.map(function (o) {
    return '<button class="outcome' + (p.outcome === o.id ? " active" : "") + '" data-outcome="' + o.id +
      '" data-outcome-for="' + b.id + '"><span class="outcomeIco">' + icon(o.ico) + "</span>" + esc(o.label) + "</button>";
  }).join("") + "</div>";
}

function splitBoxHtml(b, p) {
  if (p.outcome !== "split") return "";
  const amount = b.pay ? b.pay.amount : 0;
  const m = settleMath(amount, p.percent);
  return '<div class="splitBox">' +
    '<div class="splitTop">' +
      "<span>Client gets <b>" + naira(m.toClient) + "</b></span>" +
      "<span>Stylist gets <b>" + naira(m.toPro) + "</b></span>" +
    "</div>" +
    '<input type="range" class="splitRange" min="10" max="90" step="5" value="' + m.percent + '" data-splitrange="' + b.id + '">' +
    '<p class="finePrint">' + m.percent + "% to the stylist · " + (100 - m.percent) + "% back to the client · Pampa takes " +
      naira(m.fee) + " from the stylist's share</p>" +
  "</div>";
}

function settleButton(b, p) {
  const amount = b.pay ? b.pay.amount : 0;
  let label = "Settle · refund " + naira(amount) + " to client";
  if (p.outcome === "release") label = "Settle · release " + naira(b.pay ? b.pay.netToPro : 0) + " to stylist";
  if (p.outcome === "split") label = "Settle · split escrow";
  return '<button class="bookBtn wide" data-settle="' + b.id + '">' + label + "</button>";
}

/* Both sides' evidence, side by side, so the desk decides on the record. */
function evidenceHtml(b, d) {
  const resp = d.response;
  const clientPhotos = d.photos || [];
  const proPhotos = (resp || {}).photos || [];
  return '<div class="eviSide"><p class="eviHead">Client evidence · ' + esc(fmtWhen(d.at)) + "</p>" +
      '<p class="eviNote"><b>' + esc(d.reason || "Not stated") + "</b>" +
        (d.note ? "<br>" + esc(d.note) : "") + "</p>" +
      (clientPhotos.length
        ? galleryHtml(clientPhotos, b.id, "client") + '<p class="finePrint">' + clientPhotos.length +
          " photo" + (clientPhotos.length === 1 ? "" : "s") + " attached</p>"
        : '<p class="finePrint">No photos attached.</p>') +
    "</div>" +
    '<div class="eviSide proSide"><p class="eviHead">Stylist response' +
      (resp ? " · " + esc(fmtWhen(resp.at)) : " · not filed") + "</p>" +
      (resp
        ? (resp.note ? '<p class="eviNote">' + esc(resp.note) + "</p>" : "") +
          (proPhotos.length ? galleryHtml(proPhotos, b.id, "pro")
            : '<p class="finePrint">No photos attached.</p>') +
          '<p class="finePrint">Filed by ' + esc(resp.by || "the stylist") + "</p>"
        : '<p class="eviNote">' + esc(b.stylistName || "The stylist") +
          " has not filed a response — decide on the client evidence alone, or wait for their side.</p>") +
    "</div>";
}

function deskCardHtml(b) {
  const p = pickFor(b.id);
  const sv = SERVICES.find(function (s) { return s.id === b.serviceId; }) || {};
  const amount = b.pay ? b.pay.amount : 0;
  const d = b.dispute || {};
  return '<div class="card deskCard" data-deskcard="' + b.id + '">' +
    '<div class="proTop"><h4>' + esc(sv.name || "Service") + '</h4>' +
      '<span class="badge bad">' + naira(amount) + " frozen</span></div>" +
    '<p class="proMeta">' + esc(b.clientName || "Client") + " vs " + esc(b.stylistName || "Stylist") +
      " · " + esc(b.date) + " at " + esc(b.time) + "</p>" +
    '<p class="proMeta">' + whereTextNeutral(b) + "</p>" +
    evidenceHtml(b, d) +
    journalHtml(b) +
    '<p class="deskAsk">How should this settle?</p>' +
    outcomeButtons(b, p) +
    splitBoxHtml(b, p) +
    settleButton(b, p) +
  "</div>";
}

function deskSettledHtml(list) {
  if (!list.length) return '<p class="empty">Nothing settled yet.</p>';
  return list.map(function (b) {
    const sv = SERVICES.find(function (s) { return s.id === b.serviceId; }) || {};
    return '<div class="card deskCard settledCard">' +
      '<div class="proTop"><h4>' + esc(sv.name || "Service") + '</h4>' +
        '<span class="badge done">' + esc(statusLabelFor(b)) + "</span></div>" +
      '<p class="proMeta">' + esc(b.clientName || "Client") + " vs " + esc(b.stylistName || "Stylist") + "</p>" +
      '<p class="resolutionLine">' + resolutionText(b) +
        (b.resolution ? ' <small>· ' + esc(fmtWhen(b.resolution.at)) + " by " + esc(b.resolution.by || "desk") + "</small>" : "") + "</p>" +
      journalHtml(b) +
    "</div>";
  }).join("");
}

function renderDesk() {
  /* Cloud first: when the database is on, the queue — open disputes and the
     settled history — is the server's, and the lists here are what the desk
     RPC answered. It lands async, so the local view paints first and is
     replaced when the answer arrives. */
  dbDeskLists().then(function (q) {
    if (!q || !deskOpen()) return;
    dbDeskOpenCache = q.open;
    dbDeskSettledCache = q.settled;
    if (deskOpen()) paintDesk(q.open, q.settled);
  });
  paintDesk(deskDisputes(), deskSettled());
}

/* The cached server answers, used between syncs. They start null and are only
   read once a queue call has actually answered. */
let dbDeskOpenCache = null;
let dbDeskSettledCache = null;

function paintDesk(open, done) {
  const frozen = deskFrozenTotal(open);
  const waiting = open.filter(function (b) { return !(b.dispute || {}).response; }).length;
  const waitingLine = waiting
    ? " " + waiting + " of " + open.length + " still waiting on the stylist's side."
    : "";

  const head =
    '<div class="deskStats">' +
      "<div><span>" + open.length + "</span><small>open dispute" + (open.length === 1 ? "" : "s") + "</small></div>" +
      "<div><span>" + naira(frozen) + "</span><small>frozen in escrow</small></div>" +
      "<div><span>" + done.length + "</span><small>settled</small></div>" +
    "</div>" +
    '<p class="deskNote">Neither side is paid or refunded while a booking sits here. Both sides\' evidence is on the card — choose an outcome, then settle it, and the decision is written to the booking\'s money trail.' +
      waitingLine + "</p>";

  const body = open.length
    ? '<div class="sectionHead"><h2>Needs a decision</h2></div>' + open.map(deskCardHtml).join("")
    : emptyState("disputes", "Nothing disputed", "When a client reports a problem on a confirmed job, it lands here with the money frozen.");

  const past = '<div class="sectionHead"><h2>Settled</h2></div>' + deskSettledHtml(done);

  $("#deskBody").innerHTML = head + body + past;
}

function outcomeToast(r) {
  if (r.type === "refund") return "Refunded " + naira(r.toClient) + " to the client";
  if (r.type === "release") return "Released " + naira(r.toPro) + " to the stylist";
  return "Settled · " + naira(r.toClient) + " to client, " + naira(r.toPro) + " to stylist";
}

function settleFromDesk(id) {
  const p = pickFor(id);
  const b = findBooking(id) || {};
  const amount = b.pay ? b.pay.amount : 0;
  const m = p.outcome === "split" ? settleMath(amount, p.percent) : null;
  const words = p.outcome === "refund"
    ? "Refund " + naira(amount) + " to " + (b.clientName || "the client") + " in full."
    : p.outcome === "release"
      ? "Release " + naira(b.pay ? b.pay.netToPro : 0) + " to " + (b.stylistName || "the stylist") + "."
      : "Split it " + p.percent + "/" + (100 - p.percent) + " — " + naira(m.toClient) + " to the client, " + naira(m.toPro) + " to " + (b.stylistName || "the stylist") + ".";
  pampaConfirm({
    title: "Settle this dispute?",
    body: words + " The decision is written to the booking's money trail and cannot be undone.",
    confirmLabel: "Settle it",
    danger: true,
  }).then(function (yes) {
    if (!yes) return;
    setBusy(document.querySelector('[data-settle="' + id + '"]'), true);
    settleDispute(id, p.outcome, p.percent).then(function (res) {
      setBusy(document.querySelector('[data-settle="' + id + '"]'), false);
      if (!res.ok) {
        toast(res.msg);
        return;
      }
      delete deskDraft.picks[id];
      toast(outcomeToast(res.resolution));
      renderDesk();
      renderBookings();
      renderProfile();
    }).catch(function (e) {
      setBusy(document.querySelector('[data-settle="' + id + '"]'), false);
      toast(dbText(e, "Could not settle — try again"));
    });
  });
}
