/* =========================================================
 * Pampa — cloud — the local ledger steps aside
 *
 * The escrow module still decides what the screens do: it owns the state
 * machine vocabulary, the sheet flows, the money trail. What changes here is
 * *who holds the truth*. Each transition this file declares is the same name
 * escrow.js declared, declared later — so it wins — and its body is one
 * server call. The server's answer is the booking as Postgres now stores it;
 * the local row is replaced with it, so every renderer on the page reads the
 * server's word without knowing anything changed.
 *
 * When there is no database configured the app behaves exactly as before:
 * these overrides check dbConfigured() first and fall through to the local
 * implementations. That is what makes this switch survivable — the deployed
 * site never sits half-wired.
 * ========================================================= */

/* ---------- The booking, back and forth ---------- */

/* Postgres answers with the same field names the local ledger uses. One
   adapter: nothing in the renderers has to know which world a booking came
   from. The events journal is the server's; the local history array is left
   for the offline bookings a device may still carry. */
function dbBookingIn(row) {
  if (!row || typeof row !== "object") return row;
  const b = Object.assign({}, row);
  if (row.negotiation && typeof row.negotiation === "object") {
    b.negotiation = Object.assign({}, row.negotiation);
    if (b.negotiation.rounds && !Array.isArray(b.negotiation.rounds)) b.negotiation.rounds = [];
  }
  return b;
}

/* Replace or add the server's word in the local ledger, then persist. The
   ledger is the cache now, not the truth — but the renderers read it, so it
   is kept honest. */
function dbBookingStore(row) {
  const b = dbBookingIn(row);
  if (!b || !b.id) return null;
  const at = state.bookings.findIndex(function (x) { return x.id === b.id; });
  if (at === -1) state.bookings.push(b);
  else state.bookings[at] = Object.assign({}, state.bookings[at], b);
  save();
  return state.bookings[at];
}

/* One call, one store, one re-render of everything that reads bookings. The
   transitions all look alike from the screens' side: toast the message, or
   redraw the lists. The args array is spread into the db.* call — every one
   of those takes positional parameters and builds its own named body, so
   handing it the array itself would leave every argument after the first
   undefined (and PostgREST would resolve the RPC against the shortened
   overload it saw). */
async function dbTransition(fn, args) {
  const row = await fn.apply(null, args || []);
  return dbBookingStore(row);
}

/* ---------- Creating: the server mints the id ---------- */
/* The sheet builds nothing: it validates locally for a fast answer, then the
   server re-prices the fee, re-checks the range, the slot, the session and
   the switch, and returns the booking it actually stored. The local shape is
   only ever the server's. */

/* ---------- The transitions ---------- */

payBooking = async function (id, method) {
  if (!dbConfigured()) return payBookingLocal(id, method);
  try {
    await dbTransition(db.payBooking, [id, method]);
    return { ok: true };
  } catch (e) {
    if (e.code === "no_database") return payBookingLocal(id, method);
    return { ok: false, msg: dbText(e) };
  }
};

acceptBooking = async function (id) {
  if (!dbConfigured()) return acceptBookingLocal(id);
  try {
    const b = await dbTransition(db.acceptBooking, [id]);
    return { ok: true, price: offerOf(b) };
  } catch (e) {
    if (e.code === "no_database") return acceptBookingLocal(id);
    return { ok: false, msg: dbText(e) };
  }
};

declineBooking = async function (id) {
  if (!dbConfigured()) return declineBookingLocal(id);
  try {
    const b = await dbTransition(db.declineBooking, [id]);
    const held = b.refund ? b.refund.amount : 0;
    return { ok: true, refunded: held };
  } catch (e) {
    if (e.code === "no_database") return declineBookingLocal(id);
    return { ok: false, msg: dbText(e) };
  }
};

cancelJob = async function (id) {
  if (!dbConfigured()) return cancelJobLocal(id);
  try {
    const b = await dbTransition(db.cancelBooking, [id]);
    return { ok: true, refunded: b.refund ? b.refund.amount : 0 };
  } catch (e) {
    if (e.code === "no_database") return cancelJobLocal(id);
    return { ok: false, msg: dbText(e) };
  }
};

counterBooking = async function (id, price, note) {
  if (!dbConfigured()) return counterBookingLocal(id, price, note);
  try {
    const b = await dbTransition(db.counterBooking, [id, price, note]);
    return { ok: true, price: counterOf(b), booking: b };
  } catch (e) {
    if (e.code === "no_database") return counterBookingLocal(id, price, note);
    return { ok: false, msg: dbText(e) };
  }
};

acceptCounter = async function (id) {
  if (!dbConfigured()) return acceptCounterLocal(id);
  try {
    const b = await dbTransition(db.agreeBooking, [id]);
    /* The server decides which side of the line this landed on: an agreement
       that needs more money answers still escrowed with the top-up recorded,
       one that is covered confirms outright. */
    const topUp = b.negotiation && b.negotiation.topUp ? b.negotiation.topUp : 0;
    if (topUp > 0) {
      return { ok: true, price: counterOf(b), topUp: topUp, msg: "Price agreed — " + naira(topUp) + " more must reach escrow" };
    }
    return { ok: true, price: b.price, topUp: 0, refunded: 0 };
  } catch (e) {
    if (e.code === "no_database") return acceptCounterLocal(id);
    return { ok: false, msg: dbText(e) };
  }
};

declineCounter = async function (id) {
  if (!dbConfigured()) return declineCounterLocal(id);
  try {
    const b = await dbTransition(db.declineCounter, [id]);
    return { ok: true, refunded: b.refund ? b.refund.amount : 0 };
  } catch (e) {
    if (e.code === "no_database") return declineCounterLocal(id);
    return { ok: false, msg: dbText(e) };
  }
};

completeCounterTopUp = async function (id, method) {
  if (!dbConfigured()) return completeCounterTopUpLocal(id, method);
  try {
    const b = await dbTransition(db.payBooking, [id, method]);
    const price = b.negotiation && b.negotiation.agreed ? b.negotiation.agreed : b.price;
    return { ok: true, price: price, topUp: b.pay && b.pay.topUp ? b.pay.topUp : 0 };
  } catch (e) {
    if (e.code === "no_database") return completeCounterTopUpLocal(id, method);
    return { ok: false, msg: dbText(e) };
  }
};

markJobDone = async function (id) {
  if (!dbConfigured()) return markJobDoneLocal(id);
  try {
    await dbTransition(db.completeBooking, [id]);
    return { ok: true };
  } catch (e) {
    if (e.code === "no_database") return markJobDoneLocal(id);
    return { ok: false, msg: dbText(e) };
  }
};

releasePayment = async function (id) {
  if (!dbConfigured()) return releasePaymentLocal(id);
  /* The rating rides the same call: releasePayment here keeps its old shape —
     the review is added by finishRelease after this returns — so the release
     happens first with no rating, and the server call from submitReleaseWithRating
     carries it when there is one. */
  try {
    const b = await dbTransition(db.releaseBooking, [id, null, ""]);
    return { ok: true, net: b.pay ? b.pay.netToPro : 0, booking: b };
  } catch (e) {
    if (e.code === "no_database") return releasePaymentLocal(id);
    return { ok: false, msg: dbText(e) };
  }
};

/* Release with the review in one breath: the server writes both the payout and
   the rating to the provider's public record, so the number a client sees on a
   card is the database's, not a device's. */
async function dbReleaseRated(id, stars, note) {
  const b = await dbTransition(db.releaseBooking, [id, stars, note]);
  return { ok: true, net: b.pay ? b.pay.netToPro : 0, booking: b };
}

disputeBooking = async function (id, reason, photos, note) {
  if (!dbConfigured()) return disputeBookingLocal(id, reason, photos);
  try {
    await dbTransition(db.disputeBooking, [id, reason, photos || [], note || ""]);
    return { ok: true, photosDropped: false };
  } catch (e) {
    if (e.code === "no_database") return disputeBookingLocal(id, reason, photos);
    return { ok: false, msg: dbText(e) };
  }
};

respondToDispute = async function (bookingId, note, photos) {
  if (!dbConfigured()) return respondToDisputeLocal(bookingId, note, photos);
  try {
    await dbTransition(db.replyToDispute, [bookingId, note, photos || []]);
    return { ok: true, droppedPhotos: false };
  } catch (e) {
    if (e.code === "no_database") return respondToDisputeLocal(bookingId, note, photos);
    return { ok: false, msg: dbText(e) };
  }
};

/* ---------- The desk ---------- */

settleDispute = async function (id, outcome, percent) {
  if (!dbConfigured()) return settleDisputeLocal(id, outcome, percent);
  try {
    const b = await dbTransition(db.settleDispute, [id, outcome, percent]);
    return { ok: true, resolution: b.resolution };
  } catch (e) {
    if (e.code === "no_database") return settleDisputeLocal(id, outcome, percent);
    return { ok: false, msg: dbText(e) };
  }
};

/* ---------- Reading: the lists come from the server ---------- */

/* Pull the signed-in account's bookings. Called on boot, on enter, and after
   any transition, so the ledger cache is never the only copy. */
async function dbSyncBookings() {
  if (!dbConfigured() || !dbSignedIn()) return false;
  try {
    const rows = await db.bookings();
    if (!Array.isArray(rows)) return false;
    const byId = {};
    state.bookings.forEach(function (b) { byId[b.id] = b; });
    state.bookings = rows.map(function (r) {
      const local = byId[r.id];
      return local ? Object.assign({}, local, dbBookingIn(r)) : dbBookingIn(r);
    });
    /* Local-only bookings (created while offline) survive the sync. */
    rows.forEach(function (r) { delete byId[r.id]; });
    Object.keys(byId).forEach(function (id) {
      const local = byId[id];
      if (local && local.serverId !== true) state.bookings.push(local);
    });
    save();
    return true;
  } catch (e) {
    console.warn("Pampa: booking sync failed", e);
    return false;
  }
}

/* ---------- The desk's reads ---------- */

/* The queue comes from the server when there is one: open disputes plus the
   settled history. With no database, the local ledger answers, as always. */
async function dbDeskLists() {
  if (!dbConfigured() || !dbSignedIn()) return null;
  try {
    const q = await db.deskQueue();
    return {
      open: (q.open || []).map(dbBookingIn),
      settled: (q.settled || []).map(dbBookingIn),
    };
  } catch (e) {
    console.warn("Pampa: desk queue failed", e);
    return null;
  }
}
