/* =========================================================
 * Pampa — wallet — all the money, in one place
 *
 * Escrow is where money *rests*; this is where it is *read*. A professional
 * opens the wallet to see what has been earned, what is still held on jobs that
 * have not settled, where the payouts land, and to withdraw. A client opens it
 * to see what is held for them, what has come back as a refund, and how they
 * pay. Both are the same ledger the bookings list already draws from — this is
 * the money view of it, not a second copy.
 *
 * The wallet tab used to live only inside the escrow desk, two taps behind
 * "Open the escrow desk", so the money a professional works for had no
 * front door. It has one now: its own tab, for both roles, and the desk's own
 * Wallet tab renders through the same function, so the two can never disagree.
 * ========================================================= */

/* ---------- Whose wallet this is ----------
   The signed-in account's own identity — the id their bookings, their payouts
   and their provider record are all filed under. Not proStore.proId: that
   belongs to the escrow desk, which a client can never enter. */
function walletOwnerId() {
  return selfKey();
}

/* ---------- The server's side of it ----------
   Destinations, payouts and what is still held are the database's facts when
   there is one: the same account read from another phone must see the same
   saved bank account. The cache is memory-only — it is somebody's account
   details, refreshed on every entry, never written to the device. */
let dbWalletCache = null;

function dbWalletData() {
  return dbWalletCache;
}

/* A destination as the server stores it, in the shape every renderer here
   already reads: kind → type, details spread out flat. */
function destinationFromCloud(d) {
  const det = d.details || {};
  const type = d.kind === "crypto" ? "crypto" : "bank";
  const out = {
    id: d.id,
    type: type,
    kind: d.kind || type,
    label: d.label || "",
    default: !!d.default,
    cloud: true,
  };
  if (type === "bank") {
    out.bank = det.bank || d.label || "";
    out.account = det.account || "";
  } else {
    out.network = det.network || "";
    out.address = det.address || "";
  }
  return out;
}

/* The wallet JSON's payout rows, in the shape both the wallet renders and the
   device's own ledger records: one mapper, so a payout read on entry and a
   payout just routed to a destination are described the same way. */
function walletPayoutRows(list, byId) {
  return (list || []).map(function (p) {
    const destId = p.destination || p.destinationId || null;
    return {
      id: p.id,
      gross: Number(p.gross) || 0,
      fee: Number(p.fee) || 0,
      net: Number(p.net) || 0,
      status: p.status || "sent",
      ref: p.ref || "",
      at: p.at || "",
      bookingId: p.bookingId || null,
      destinationId: destId,
      to: byId && byId[destId] ? destinationLine(byId[destId]) : "No destination on file",
    };
  });
}

/* Take the server's answer and make it the device's answer: the cache the wallet
   draws from, and the local ledger the balance is computed from. Every read and
   every write comes back here, so there is one place that decides what a wallet
   response means. */
function dbWalletAdopt(w) {
  const dests = ((w && w.destinations) || []).map(destinationFromCloud);
  const byId = {};
  dests.forEach(function (d) { byId[d.id] = d; });
  const payouts = walletPayoutRows(w && w.payouts, byId);
  dbWalletCache = { destinations: dests, payouts: payouts, held: Number((w && w.held) || 0) };
  /* Money the server has already sent is money this device must stop offering,
     and a payout that was waiting for a destination is sent the moment one
     exists: the rows go into the same ledger the Withdraw figure is read from. */
  const changed = recordServerPayouts(walletOwnerId(), payouts);
  return { changed: changed, cache: dbWalletCache };
}

/* Read the wallet back. Called on entering the app and on entering a view, the
   same way the bookings and the directory are. Silent on failure: a wallet that
   cannot reach the server still has the device's own ledger to draw. */
async function dbWalletSync() {
  if (typeof dbConfigured !== "function" || !dbConfigured() || !dbSignedIn()) return false;
  if (typeof db.wallet !== "function") return false;
  try {
    const w = await db.wallet();
    const adopted = dbWalletAdopt(w);
    if (adopted.changed) renderWalletSurface();
    return true;
  } catch (e) {
    console.warn("Pampa: wallet read failed", e);
    return false;
  }
}

/* The saved destinations the wallet shows: the server's list when there is one,
   the device's own otherwise. One function, so the two never mix. */
function walletDestinations(id) {
  if (dbWalletCache && dbWalletCache.destinations && dbWalletCache.destinations.length) {
    return dbWalletCache.destinations;
  }
  return destinationsFor(id);
}

/* Where the money actually goes: the default row, wherever it came from. */
function walletDefaultDestination(id) {
  const all = walletDestinations(id);
  return all.filter(function (d) { return d.default; })[0] || all[0] || null;
}

/* ---------- Writing: one destination, on both roads ----------
   The device learns it immediately and the server is told about it, so the
   account's other phones see the same bank account. A refused push is not a
   lost save — the local row stands and the next save retries — but the caller
   is told, because a payout destination that only exists on this phone is
   worth knowing about. */
function saveWalletDestination(id) {
  const owner = id || walletOwnerId();
  const res = saveDestination(owner);
  if (!res.ok) return res;
  res.pushed = false;
  if (typeof dbConfigured === "function" && dbConfigured() && dbSignedIn() && typeof db.addDestination === "function") {
    db.addDestination(res.kind, res.label, res.details, true).then(function (w) {
      dbWalletAdopt(w);
      renderWalletSurface();
    }).catch(function (e) {
      console.warn("Pampa: destination not pushed", e);
      toast(dbText(e, "Saved on this phone — it did not reach your account yet"));
      renderWalletSurface();
    });
  }
  renderWalletSurface();
  return res;
}

function pickDefaultDestination(id, destId) {
  const owner = id || walletOwnerId();
  const cloud = !!(dbWalletCache && dbWalletCache.destinations && dbWalletCache.destinations.length);
  if (!cloud) {
    const ok = setDefaultDestination(owner, destId);
    renderWalletSurface();
    return { ok: ok, msg: ok ? "Payouts will land there" : "That destination is gone" };
  }
  /* The default lives on the server for a cloud account — it is the row a real
     payout is written against — so the choice is made there and the local list
     is re-read from the answer. The device's copy is optimistic so the tap
     lands instantly, then corrected by whatever the server says. */
  dbWalletCache.destinations.forEach(function (d) { d.default = d.id === destId; });
  renderWalletSurface();
  db.setDefaultDestination(destId).then(function (w) {
    dbWalletAdopt(w);
    renderWalletSurface();
    toast("Payouts will go there");
  }).catch(function (e) {
    /* put the choice back the way the server still has it */
    dbWalletSync().then(renderWalletSurface);
    toast(dbText(e, "Could not change your payout destination"));
  });
  return { ok: true, msg: "" };
}

function dropDestination(id, destId) {
  const owner = id || walletOwnerId();
  const cloud = !!(dbWalletCache && dbWalletCache.destinations && dbWalletCache.destinations.some(function (d) { return d.id === destId; }));
  if (!cloud) {
    const ok = removeDestination(owner, destId);
    renderWalletSurface();
    return { ok: ok, msg: ok ? "Destination removed" : "That destination is gone" };
  }
  db.removeDestination(destId).then(function (w) {
    dbWalletAdopt(w);
    renderWalletSurface();
    toast("Destination removed — payouts keep landing in the one that is left");
  }).catch(function (e) {
    toast(dbText(e, "Could not remove that destination"));
  });
  return { ok: true, msg: "" };
}

/* ---------- The balances a pro reads ----------
   proBalances already answers "what is mine" from the same ledger the bookings
   list draws. What the wallet adds is the server's answer about what is still
   held, because a job taken on another phone is money this device cannot see. */
function walletServerHolds(id) {
  if (!dbWalletCache || dbWalletCache.held == null) return null;
  return dbWalletCache.held;
}

/* What can actually be moved right now. Two things can be waiting: credit this
   device has not sent yet, and payouts the server wrote at release with no
   destination to send them to — money that has left escrow and is going
   nowhere until somebody says where. Both are the professional's, so the
   wallet offers them as one figure and sends them together. */
function walletMoney(id, bal) {
  const pending = ((dbWalletCache && dbWalletCache.payouts) || []).filter(function (p) { return p.status === "pending"; });
  const pendingTotal = pending.reduce(function (s, p) { return s + (Number(p.net) || 0); }, 0);
  return { pending: pending, pendingTotal: pendingTotal, available: Math.max(0, bal.available) + pendingTotal };
}

function walletHeroHtml(id, bal) {
  const heldCloud = walletServerHolds(id);
  const held = heldCloud == null ? bal.inEscrow : heldCloud;
  const dest = walletDefaultDestination(id);
  const money = walletMoney(id, bal);
  const canWithdraw = money.available >= 1000;
  return '<div class="walletCard">' +
      '<p class="walletLabel">Available to withdraw</p>' +
      '<p class="walletBig">' + naira(money.available) + "</p>" +
      '<div class="walletSplit">' +
        "<div><span>" + naira(held) + "</span><small>held in escrow</small></div>" +
        "<div><span>" + naira(bal.lifetime) + "</span><small>earned</small></div>" +
        "<div><span>" + bal.completed + "</span><small>jobs paid</small></div>" +
      "</div>" +
      '<div class="walletCta">' +
        (canWithdraw
          ? '<div class="proActions"><button class="bookBtn wide" id="withdrawBtn">Withdraw ' + naira(money.available) + "</button></div>"
          /* An empty wallet does not need a dead button filling its foot: it
             needs to say when money will arrive. The minimum is stated in the
             fine print either way, so nothing is hidden by the swap. */
          : '<p class="walletLand">' + icon("clock") + " Nothing to withdraw right now — a released payment lands here the moment a client confirms a job." + "</p>") +
        (money.pendingTotal
          ? '<p class="walletLand">' + icon("clock") + " " + naira(money.pendingTotal) +
            (money.pending.length === 1 ? " was released before you had a destination" : " was released before you had a destination") +
            " — this sends it to the one below." + "</p>"
          : "") +
        '<p class="walletLand">' + icon(dest && dest.type === "crypto" ? "coin" : "bank") + " " +
          (dest ? "Payouts land in " + esc(destinationLine(dest)) : "Add a destination below and payouts will land there") + "</p>" +
      "</div>" +
      '<p class="finePrint">Pampa has taken ' + naira(bal.fees) + " in platform fees from your payouts so far. Minimum withdrawal ₦1,000.</p>" +
    "</div>";
}

/* ---------- Taking the money out ----------
   One action, because "withdraw" is one decision from where the professional
   is standing: send what is waiting to my destination. What is waiting can be
   two different things — payouts the server recorded with nowhere to send them,
   and credit this device has not sent — so both are collected for the same
   destination in the same breath, and the wallet is re-read from the server
   afterwards rather than guessed at. */
async function withdrawAll(id) {
  const owner = id || walletOwnerId();
  const dest = walletDefaultDestination(owner);
  if (!dest) return { ok: false, msg: "Add a payout destination first" };
  const money = walletMoney(owner, proBalances(owner));
  if (money.available < 1000) {
    return { ok: false, msg: "Minimum withdrawal is ₦1,000 — you have " + naira(money.available) };
  }
  const cloud = !!(dbWalletCache && dbWalletCache.payouts);
  if (cloud && money.pending.length && typeof db.assignPayout === "function") {
    try {
      let last = null;
      for (const p of money.pending) {
        last = await db.assignPayout(p.id, dest.id);
      }
      /* the answer is the wallet as it now stands, adopted exactly as a read
         would be — so the row stops saying "awaiting destination" in the same
         breath as the money starts moving */
      if (last && last.destinations) dbWalletAdopt(last);
    } catch (e) {
      return { ok: false, msg: dbText(e, "Could not send that payout — try again") };
    }
  }
  /* Whatever this device is still holding goes through the local road, which
     is the same simulated payout the app has always made. */
  const left = proBalances(owner).available;
  let sent = 0;
  if (left >= 1000) {
    const res = requestPayout(owner, dest.id);
    if (!res.ok) return res;
    sent = res.payout.amount;
  }
  renderWalletSurface();
  if (typeof dbWalletSync === "function") dbWalletSync().then(renderWalletSurface);
  return { ok: true, amount: money.available, sent: sent, to: destinationLine(dest) };
}

/* ---------- The destination list ----------
   Several cards, one of them the default. Every row says which it is, what it
   is for, and — where it can be acted on — the two verbs a list needs: make it
   the default, and take it back. */
function destinationRowHtml(d, i) {
  const isBank = d.type !== "crypto";
  return '<div class="destCard' + (d.default ? " isDefault" : "") + '" style="--i:' + i + '">' +
      '<span class="destIco">' + icon(isBank ? "bank" : "coin") + "</span>" +
      '<span class="destInfo"><b>' + esc(destinationLine(d)) + "</b>" +
        "<small>" + (isBank ? "Bank account" : "Crypto wallet") +
          (d.cloud === false ? " · this phone" : "") + "</small></span>" +
      (d.default
        ? '<span class="badge ok">Default</span>'
        : '<button class="linkBtn" data-dest-default="' + esc(d.id) + '">Make default</button>') +
      '<button class="destX" data-dest-remove="' + esc(d.id) + '" aria-label="Remove this destination">' + icon("trash") + "</button>" +
    "</div>";
}

function destinationFormHtml() {
  return '<div class="destForm" id="destForm">' +
      '<div class="whereRow">' +
        '<button class="where' + (destDraft.type === "bank" ? " active" : "") + '" data-desttype="bank">' + icon("bank") + " Bank account</button>" +
        '<button class="where' + (destDraft.type === "crypto" ? " active" : "") + '" data-desttype="crypto">' + icon("coin") + " Crypto wallet</button>" +
      "</div>" +
      (destDraft.type === "bank"
        ? '<input id="destBank" class="addrInput" placeholder="Bank name (e.g. GTBank)" value="' + esc(destDraft.bank) + '">' +
          '<input id="destAcct" class="addrInput" inputmode="numeric" maxlength="10" placeholder="10-digit account number" value="' + esc(destDraft.account) + '">'
        : '<input id="destNetwork" class="addrInput" placeholder="Network (TRC20, ERC20, BTC)" value="' + esc(destDraft.network) + '">' +
          '<input id="destAddr" class="addrInput" placeholder="Wallet address" value="' + esc(destDraft.address) + '">') +
      '<button class="nextbtn tight" id="saveDest">Save destination</button>' +
    "</div>";
}

function destinationsBlockHtml(id, openForm) {
  const all = walletDestinations(id);
  return '<div class="sectionHead"><h2>Payout destinations</h2>' +
      '<span class="headNote">' + (all.length ? all.length + (all.length === 1 ? " card" : " cards") : "none yet") + "</span></div>" +
    (all.length
      ? '<div class="destList">' + all.map(destinationRowHtml).join("") + "</div>"
      : '<p class="walletEmpty">' + icon("bank") +
        " No destination yet. Add a bank account or a crypto wallet and money released from escrow is sent there.</p>") +
    (openForm
      ? '<div class="card proCard"><div class="proTop"><h4>Add a destination</h4>' +
        '<span class="badge past">' + (destDraft.type === "bank" ? "Bank" : "Crypto") + "</span></div>" + destinationFormHtml() + "</div>"
      : '<button class="nextbtn ghost icoBtn" data-dest-open="1">' + icon("plus") + " Add a destination</button>");
}

/* ---------- The professional's wallet ----------
   Drawn twice — as the Wallet tab and as the escrow desk's Wallet tab — from
   this one function, so the balance a pro reads on their desk and the balance
   they read on the tab are the same sentence. */
let walletFormOpen = false;

/* `opts.hero: false` is for the one place that already has the balance above it:
   the escrow desk draws its own wallet card as the head of every tab, and two
   "Available to withdraw" figures stacked on each other is the same fact told
   twice — the second one looks like a second amount. */
function proWalletHtml(id, bal, closed, opts) {
  const o = opts || {};
  const held = state.bookings.filter(function (b) { return b.stylistId === id && isHeld(b); });
  const payouts = (proStore.payouts[id] || []).slice().reverse();
  const all = walletDestinations(id);
  return (o.hero === false ? "" : walletHeroHtml(id, bal)) +
    destinationsBlockHtml(id, walletFormOpen || !all.length) +
    (held.length
      ? '<div class="sectionHead"><h2>Held in escrow</h2><span class="headNote">' + naira(bal.inEscrow) + "</span></div>" +
        held.map(function (b) {
          const sv = SERVICES.find(function (s) { return s.id === b.serviceId; }) || {};
          const st = statusOf(b);
          return '<div class="card proRow"><span>' + esc(sv.name || "Job") + " · " + esc(b.clientName || "Client") +
            " · " + esc(b.date) + "</span><b>" + naira(b.pay ? b.pay.netToPro : 0) + "</b>" +
            '<span class="badge ' + (st === "disputed" ? "bad" : "info") + '">' + esc(statusLabelFor(b)) + "</span></div>";
        }).join("")
      : "") +
    (payouts.length
      ? '<div class="sectionHead"><h2>Payouts</h2></div>' + payouts.map(function (p) {
          return '<div class="card proRow"><span>' + esc(p.to || "Destination") + " · " + esc(String(p.at).slice(0, 10)) +
            (p.ref ? " · " + esc(p.ref) : "") + '</span><b>' + naira(p.amount || p.net || 0) + "</b>" +
            '<span class="badge ' + (p.status === "pending" ? "warn" : "ok") + '">' + esc(p.status === "pending" ? "Awaiting destination" : "Sent") + "</span></div>";
        }).join("")
      : "") +
    '<div class="sectionHead"><h2>Money trail</h2></div>' +
    (closed.length
      ? closed.map(function (b) {
          const sv = SERVICES.find(function (s) { return s.id === b.serviceId; }) || {};
          const frozen = statusOf(b) === "disputed";
          const got = creditedTo(b, id) || (b.pay ? b.pay.netToPro : 0);
          return '<div class="card proRow"><span>' + esc(sv.name || "Job") + " · " + esc(statusLabelFor(b)) +
            '</span><b>' + (frozen ? naira(got) + " held" : naira(got)) + "</b></div>";
        }).join("")
      : '<p class="walletEmpty">' + icon("tray") + " Nothing settled yet — jobs collect here once a client releases the payment.</p>");
}

/* ---------- The client's wallet ----------
   A client's money is in escrow, not in a balance: what is held for them now,
   what has come back, and what they have paid for. Same ledger, other end. */
function clientMoney() {
  const out = { escrow: 0, paid: 0, released: 0, refunded: 0, open: [], refunds: [] };
  state.bookings.forEach(function (b) {
    if (bookingSide(b) !== "client") return;
    const st = statusOf(b);
    const amount = b.pay ? b.pay.amount : 0;
    if (amount) out.paid += amount;
    if (st === "escrowed" || st === "confirmed" || st === "disputed") {
      out.escrow += amount;
      out.open.push(b);
    } else if (st === "unpaid") {
      out.open.push(b);
    }
    if (st === "released") out.released += b.pay ? b.pay.netToPro : 0;
    const back = (b.refund && b.refund.amount) || (b.resolution && b.resolution.toClient) || 0;
    if (back) {
      out.refunded += back;
      out.refunds.push({ at: (b.refund && b.refund.at) || (b.resolution && b.resolution.at) || b.date, amount: back, booking: b });
    }
  });
  return out;
}

function clientWalletHtml() {
  const m = clientMoney();
  const u = state.user || {};
  const chosen = u.payMethod || "card";
  const methods = PAY_METHODS.map(function (pm) {
    const active = pm.id === chosen;
    return '<button class="methodCard' + (active ? " active" : "") + '" data-wallet-pay="' + pm.id + '">' +
      '<span class="methodIco">' + icon(pm.ico) + "</span>" +
      '<span class="pickInfo"><b>' + esc(pm.name) + "</b><small>" + esc(pm.note) + "</small></span>" +
      (active ? '<span class="pickCheck">' + icon("check") + "</span>" : "") +
      "</button>";
  }).join("");

  return '<div class="walletCard">' +
      '<p class="walletLabel">Held in escrow for you</p>' +
      '<p class="walletBig">' + naira(m.escrow) + "</p>" +
      '<div class="walletSplit">' +
        "<div><span>" + naira(m.paid) + "</span><small>paid in all time</small></div>" +
        "<div><span>" + naira(m.refunded) + "</span><small>refunded</small></div>" +
        "<div><span>" + naira(m.released) + "</span><small>to your professionals</small></div>" +
      "</div>" +
      '<p class="finePrint">Pampa holds your money until you say the job was done. Nothing is released to a professional without your tap.</p>' +
    "</div>" +
    '<div class="sectionHead"><h2>How you pay</h2><span class="headNote">saved</span></div>' +
    '<div class="pickList">' + methods + "</div>" +
    '<p class="finePrint">This is the method the pay sheet opens on. Nothing is charged until you pay a booking into escrow.</p>' +
    '<div class="sectionHead"><h2>Your bookings</h2></div>' +
    (m.open.length
      ? m.open.map(function (b) {
          const sv = SERVICES.find(function (s) { return s.id === b.serviceId; }) || {};
          const st = statusOf(b);
          const amount = st === "unpaid" ? (b.total || b.price || 0) : (b.pay ? b.pay.amount : 0);
          return '<div class="card proRow"><span>' + esc(sv.name || "Booking") + " · " + esc(b.stylistName || "Professional") +
            " · " + esc(b.date) + '</span><b>' + naira(amount) + "</b>" +
            '<span class="badge ' + (st === "unpaid" ? "warn" : st === "disputed" ? "bad" : "info") + '">' +
              esc(st === "unpaid" ? "Not paid yet" : statusLabelFor(b)) + "</span></div>";
        }).join("")
      : '<p class="walletEmpty">' + icon("calendarDot") + " Nothing open right now. Hold a slot with a professional and it shows up here.</p>") +
    (m.refunds.length
      ? '<div class="sectionHead"><h2>Refunds</h2></div>' + m.refunds.map(function (r) {
          return '<div class="card proRow"><span>' + esc(String(r.at).slice(0, 10)) + " · " +
            esc((SERVICES.find(function (s) { return s.id === r.booking.serviceId; }) || {}).name || "Booking") +
            '</span><b>' + naira(r.amount) + "</b>" + '<span class="badge done">Refunded</span></div>';
        }).join("")
      : "");
}

/* ---------- The view ---------- */
/* Redraw whichever wallet is on screen. The escrow desk can be open over the
   Wallet tab, and each action below changes a list both of them draw, so they
   are re-rendered by one call rather than by each caller remembering the
   other. */
function renderWalletSurface() {
  renderWallet();
  const desk = $("#proMode");
  if (desk && desk.style.display !== "none" && typeof renderPro === "function") renderPro();
}

function renderWallet() {
  const body = $("#walletBody");
  const u = state.user || {};
  const pro = u.role === "pro" && u.trade;
  const who = $("#walletWho");
  if (who) who.textContent = pro ? "Earnings, escrow and payouts" : "Your escrow, refunds and how you pay";
  if (!body) return;
  if (!state.user) {
    body.innerHTML = emptyState("money", "Sign in to see your money", "Escrow, refunds and payouts live with your account.");
    return;
  }
  if (pro) {
    const id = walletOwnerId();
    body.innerHTML = proWalletHtml(id, proBalances(id), proJobs(id).closed);
  } else {
    body.innerHTML = clientWalletHtml();
  }
  if (typeof renderNavCounts === "function") renderNavCounts();
}
