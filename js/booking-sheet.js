/* =========================================================
 * Pampa — booking-sheet — service, slot, professional
 * Choosing what is wanted, when, and who does it — nearest first.
 * ========================================================= */

/* ---------- Booking sheet ---------- */
const SLOTS = ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30"];

function todayIso() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function stylistById(id) {
  if (id === selfKey()) return providerSelf();
  return allProviders().find(function (s) { return s.id === id; }) || null;
}

function byNearestStudio(a, b) {
  const ka = kmToStudio(a);
  const kb = kmToStudio(b);
  if (ka == null) return 1;
  if (kb == null) return -1;
  return ka - kb;
}

function slotInPast(date, time) {
  return new Date(date + "T" + time + ":00").getTime() < Date.now();
}

function openSheet(serviceId, presetStylistId) {
  const sv = SERVICES.find(function (s) { return s.id === serviceId; });
  if (!sv) return;
  if (!hasLocation()) {
    toast("Set your location first");
    openLocation("app");
    return;
  }
  const candidates = stylistsForService(serviceId);
  /* whoever can actually take the booking opens the sheet on themselves:
     opening on a paused professional, or one who is with a client, would ask
     the client to fill in a form they cannot submit */
  const open = candidates.filter(providerBookable);
  const visiting = open.filter(coversClient).sort(byNearestStudio);
  const anyStudio = open.slice().sort(byNearestStudio);
  let stylistId = presetStylistId || (visiting[0] || anyStudio[0] || candidates[0] || {}).id || null;
  const st = stylistById(stylistId);
  state.draft = {
    serviceId: sv.id,
    stylistId: stylistId,
    /* A named professional means the client has already made the choice: this
       sheet shows that one person, not the market they came from. A sheet
       opened without a name (a service tapped from the bookings list) is still
       a question, and still shows the list. */
    locked: !!presetStylistId,
    loc: st && coversClient(st) ? "home" : "studio",
    date: todayIso(),
    time: null,
    /* the price the client names, inside whatever range this professional
       publishes for this service — settled in renderSheet, which is the only
       place that knows both */
    offer: null,
  };
  renderSheet();
  const sheet = $("#bookingSheet");
  $("#sheetOverlay").style.display = "block";
  sheet.style.display = "block";
  // Force a reflow so the slide-up transition runs even when rAF is throttled.
  void sheet.offsetHeight;
  sheet.classList.add("show");
}

/* Why a slot cannot be taken: somebody already holds that exact time, or it
   falls inside a session already running — a 90-minute braid booked at 12:00
   cannot sit inside one that started at 10:30. One function, so the grid and
   the final guard cannot disagree about the same slot. */
function slotBlockedBy(stylistId, date, time, serviceId) {
  if (slotTaken(stylistId, date, time)) return "booked";
  if (sessionClash(stylistId, date, time, serviceId)) return "session";
  return null;
}

function slotButtons(d) {
  const rows = SLOTS.map(function (t) {
    const why = slotBlockedBy(d.stylistId, d.date, t, d.serviceId);
    const past = slotInPast(d.date, t);
    const off = !!why || past;
    const cls = "slot" + (off ? (why ? " taken" : " past") : "") + (d.time === t && !off ? " active" : "");
    const title = why === "booked" ? ' title="Already booked"'
      : why === "session" ? ' title="Inside a session already booked that day"'
      : past ? ' title="Time has passed"' : "";
    return '<button class="' + cls + '" data-slot="' + t + '"' + (off ? " disabled" : "") + title + ">" + t + "</button>";
  }).join("");
  /* A row of nothing-but-disabled slots reads as a broken screen. Six dead
     pills on today's date is the usual case late in the day, so the grid says
     why and points at the date field above it. */
  const days = SLOTS.filter(function (t) { return !slotInPast(d.date, t); });
  let hint = "";
  if (!days.length) hint = "Every slot on " + fmtDayShort(d.date) + " has passed — pick another date above.";
  else if (days.every(function (t) { return slotBlockedBy(d.stylistId, d.date, t, d.serviceId); })) {
    hint = days.every(function (t) { return slotBlockedBy(d.stylistId, d.date, t, d.serviceId) === "session"; })
      ? fmtDayShort(d.date) + " is taken up by a session already booked — try another date."
      : "Fully booked on " + fmtDayShort(d.date) + " — try another date.";
  }
  return rows + (hint ? '<p class="slotHint">' + esc(hint) + "</p>" : "");
}

/* ---------- The price a client names ----------
   A professional does not charge one number for a haircut, so their card
   publishes a range per service and the client picks inside it: the exact
   amount they can afford, which is the offer the booking is paid at and the
   number the professional accepts or answers. The midpoint is where the field
   opens — never above the range, never below it. */
function offerFor(d, st, sv) {
  const range = rangeFor(st, sv.id);
  const mid = roundTo50((range.min + range.max) / 2);
  const offer = clampToRange(d.offer || mid, range);
  d.offer = offer;
  return { range: range, offer: offer, mid: mid };
}

/* Distance, travel and the running total for whatever the sheet currently has
   selected. One function, so the slider, the where toggle and the foot can
   never disagree about the same booking. */
function sheetMoney(d, st) {
  const km = kmToStudio(st);
  const travel = d.loc === "home" ? travelFeeFor(km) : 0;
  const total = (d.offer || 0) + travel;
  return { km: km, travel: travel, total: total };
}

function sheetFeeRows(sv, d, m) {
  const r = rangeFor(stylistById(d.stylistId), sv.id);
  return '<p class="feeRow"><span>' + esc(sv.name) + " \u00b7 your price</span><b>" + naira(d.offer || 0) + "</b></p>" +
    (m.travel ? '<p class="feeRow"><span>Travel \u00b7 ' + fmtKm(m.km) + "</span><b>" + naira(m.travel) + "</b></p>" : "") +
    '<p class="feeRow total"><span>Total into escrow</span><b>' + naira(m.total) + "</b></p>" +
    '<p class="finePrint">Their range for ' + esc(sv.name) + " is " + esc(rangeText(r)) + ".</p>";
}

/* Live, because a range is dragged rather than clicked: the number, the total
   and the foot all follow the thumb without the sheet being rebuilt. */
function bindSheetPrice() {
  const el = $("#priceRange");
  if (!el) return;
  const paint = function () {
    state.draft.offer = roundTo50(Number(el.value) || 0);
    const now = $("#priceNow");
    if (now) now.textContent = naira(state.draft.offer);
    paintSheetFee();
  };
  el.addEventListener("input", paint);
  paint();
}

function paintSheetFee() {
  const d = state.draft;
  const sv = SERVICES.find(function (s) { return s.id === d.serviceId; });
  const st = stylistById(d.stylistId);
  const box = $("#sheetFee");
  if (!sv || !st || !box) return;
  const m = sheetMoney(d, st);
  box.innerHTML = sheetFeeRows(sv, d, m);
  const price = $("#sheetPrice");
  if (price) price.textContent = naira(m.total);
}

function renderSheet() {
  const d = state.draft;
  const sv = SERVICES.find(function (s) { return s.id === d.serviceId; });
  const st = stylistById(d.stylistId);
  if (!sv || !st) return;

  /* Only what this provider can actually do — their trade, priced. */
  const offered = servicesForProvider(st);
  /* Nearest first, strictly by distance from the client. Visiting pros come
     ahead of studio-only ones at the same remove, because a studio-only pro at
     2 km is less useful than one at your door at 4. */
  const candidates = stylistsForService(sv.id).slice().sort(function (a, b) {
    const av = coversClient(a) ? 0 : 1;
    const bv = coversClient(b) ? 0 : 1;
    if (av !== bv) return av - bv;
    return byNearestStudio(a, b);
  });
  const studioKm = kmToStudio(st);
  const canVisit = coversClient(st);
  /* two different reasons a professional cannot be booked now: their own
     switch, and somebody else's job. Each says its own thing. */
  const withClient = providerInSession(st);
  const avail = providerAvailable(st);
  const open = avail && !withClient;
  if (!canVisit && d.loc === "home") d.loc = "studio";

  /* the client's own price, clamped into this professional's range for this
     service, recomputed here because both of those can change */
  const pr = offerFor(d, st, sv);
  const money = sheetMoney(d, st);
  const travelFee = money.travel;
  const total = money.total;
  const myArea = areaById((state.user || {}).area);

  $("#sheetService").textContent = sv.name;
  $("#sheetStylist").textContent = st.name + " · " + st.skill;

  /* One card, drawn the same whether it is the only professional the sheet is
     about or one of a list, because it is the same object either way. */
  function pickCardHtml(cand, active) {
    const km = kmToStudio(cand);
    const covers = coversClient(cand);
    const busy = providerInSession(cand);
    const open = providerBookable(cand);
    /* "0 m away" is not a distance, it is the app measuring between two areas
       and finding the same one: the same wording the discovery cards use. */
    const where = km == null ? "distance unknown" : km < 0.05 ? "in your area" : fmtKm(km) + " away";
    const note = !open
      ? (busy ? "With a client right now · free once that job is settled" : "Not taking bookings right now")
      : (covers ? "Visits you · " : "Studio only · ") + where;
    return '<button class="pickCard' + (active ? " active" : "") + (open ? "" : " paused") + '" data-pick-stylist="' + cand.id + '"' +
      (open ? "" : " disabled") + '>' +
      '<span class="pickAvatar">' + esc(initials(cand.name)) + "</span>" +
      '<span class="pickInfo"><b>' + esc(cand.name) + youTag(cand) + '</b>' +
      '<small>' + esc(cand.skill) + " · " + ratingHtml(cand) + "</small>" +
      '<small class="pickNote' + (open && covers ? "" : " off") + '">' + esc(note) + "</small></span>" +
      (active ? '<span class="pickCheck">' + icon("check") + "</span>" : "") +
      "</button>";
  }

  /* Who the sheet is about. A client who tapped Book on somebody, or opened
     their page and tapped Book there, has already answered the question: a
     list of every other professional under the name they chose is the app
     asking it again. So a sheet opened *for* a named professional shows that
     one, with a quiet way back to the list for the client who has changed
     their mind. */
  const locked = !!d.locked;
  const pickBlock = locked
    ? '<div class="sheetBlock"><div class="sheetLabelRow"><label>Your professional</label>' +
        '<button class="pickChange" data-pick-change="1">Choose someone else</button></div>' +
        '<div class="pickList chosenOne">' + pickCardHtml(st, true) + "</div></div>"
    : '<div class="sheetBlock"><label>Stylist</label><div class="pickList">' +
        candidates.map(function (cand) { return pickCardHtml(cand, cand.id === d.stylistId); }).join("") +
        "</div></div>";

  const studioArea = areaById(st.studio);
  const studioAddr = studioAddressFor(st);
  /* The walk-in half says where to come to, how far it is and that nothing is
     charged for travel: a client choosing the studio is choosing a journey, so
     the journey has to be on the card. */
  const locInfo = d.loc === "home"
    ? icon("house") + " " + esc(placeLine(state.user.address, clientAreaName()))
    : icon("store") + " " + (studioArea
        ? "Walk in to " + esc(studioAddr || studioArea.name) + " · " + fmtKm(studioKm) + " away · ~" +
          driveMins(studioKm) + " min drive · no travel fee"
        : "Studio area not set — ask them where they work from");

  const warn = canVisit ? "" : '<p class="locWarn">' + esc(st.name) + " doesn't visit " +
    esc(myArea ? myArea.name : "your area") + " yet — you can book their studio instead.</p>";
  /* A paused professional chosen from an older list still has to say so, rather
     than let the client fill the whole sheet in and be refused at the end — and
     a professional who is with a client says that instead, because it is the
     job holding them, not their switch. */
  const pauseWarn = open ? ""
    : withClient
      ? '<p class="locWarn">' + esc(st.name) + " is with a client " + esc(sessionSinceLabel(withClient)) +
        " and that job's money is still in escrow. They open again the moment it settles — pick someone else above to book now.</p>"
      : '<p class="locWarn">' + esc(st.name) + " isn't taking new bookings at the moment — pick someone else above.</p>";

  const svcChips = offered.length > 1
    ? '<div class="sheetBlock"><label>Service</label><div class="sheetChips">' +
      offered.map(function (o) {
        const or2 = rangeFor(st, o.id);
        return '<button class="chip' + (o.id === d.serviceId ? " active" : "") + '" data-sheet-svc="' + o.id + '">' +
          esc(o.name) + " · " + naira(or2.min) + "\u2013" + naira(or2.max) + "</button>";
      }).join("") + "</div></div>"
    : "";

  /* The price picker: a slider across their range with the three prices worth
     one tap, because "what I can afford" is a position on the range, not a
     number a client should have to type. */
  const pricePick = pr.range.max > pr.range.min
    ? '<div class="sheetBlock"><label>Your price</label><div class="pricePick">' +
        '<div class="priceNow"><b id="priceNow">' + naira(pr.offer) + "</b>" +
          '<small>' + esc(st.name) + " takes " + esc(rangeText(pr.range)) + " for " + esc(sv.name) + "</small></div>" +
        '<input class="priceRange" type="range" id="priceRange" min="' + pr.range.min + '" max="' + pr.range.max +
          '" step="50" value="' + pr.offer + '" aria-label="Your price for ' + esc(sv.name) + '">' +
        '<div class="priceChips">' +
          '<button class="chip' + (pr.offer === pr.range.min ? " active" : "") + '" data-offer="min">Lowest ' + naira(pr.range.min) + "</button>" +
          '<button class="chip' + (pr.offer === pr.mid ? " active" : "") + '" data-offer="mid">Middle ' + naira(pr.mid) + "</button>" +
          '<button class="chip' + (pr.offer === pr.range.max ? " active" : "") + '" data-offer="max">Top ' + naira(pr.range.max) + "</button>" +
        "</div>" +
        '<p class="finePrint">They accept this or answer with a price of their own \u2014 and you can still say no.</p>' +
      "</div></div>"
    : "";

  $("#sheetBody").innerHTML =
    pickBlock +
    svcChips +
    pricePick +
    '<div class="sheetBlock"><label>Home visit or walk-in</label><div class="whereRow">' +
      '<button class="where' + (d.loc === "home" ? " active" : "") + '" data-loc="home"' +
        (canVisit ? "" : ' disabled title="They don\'t visit your area yet"') + ">" + icon("house") + " Home visit</button>" +
      '<button class="where' + (d.loc === "studio" ? " active" : "") + '" data-loc="studio">' + icon("store") + " Studio walk-in</button>" +
    "</div><p class=\"locInfo\">" + locInfo + "</p>" + pauseWarn + warn + "</div>" +
    '<div class="sheetBlock"><label>Date</label><input type="date" id="bookDate" min="' + todayIso() + '" value="' + d.date + '"></div>' +
    '<div class="sheetBlock"><label>Time</label><div class="slots" id="slotGrid">' + slotButtons(d) + "</div></div>" +
    '<div class="feeBox" id="sheetFee">' + sheetFeeRows(sv, d, money) + "</div>";

  $("#sheetPrice").textContent = naira(total);
  /* the service row is a horizontal scroller inside a sheet: bound here,
     because this is the only moment it exists */
  bindStripIn($("#sheetBody"), ".sheetChips");
  bindStripIn($("#sheetBody"), ".priceChips");
  /* and the price slider is live for as long as the sheet is open */
  bindSheetPrice();
}

function closeSheet() {
  $("#bookingSheet").classList.remove("show");
  setTimeout(function () {
    $("#bookingSheet").style.display = "none";
    $("#sheetOverlay").style.display = "none";
  }, 350);
}

function confirmBooking() {
  const d = state.draft;
  const sv = SERVICES.find(function (s) { return s.id === d.serviceId; });
  const st = stylistById(d.stylistId);
  if (!sv || !st) {
    toast("Pick a service and a stylist");
    return;
  }
  if (!d.date) {
    toast("Pick a date");
    return;
  }
  if (!d.time) {
    toast("Pick a time slot");
    return;
  }
  if (slotInPast(d.date, d.time)) {
    toast("That time has already passed");
    renderSheet();
    return;
  }
  const blocked = slotBlockedBy(st.id, d.date, d.time, d.serviceId);
  if (blocked) {
    toast(blocked === "session"
      ? st.name + " is in a session that runs through that time — pick another slot"
      : st.name + " is already booked then — pick another slot");
    renderSheet();
    return;
  }
  /* The switch is worth nothing if it can be walked around, and neither is a
     session: the last word on whether a booking may start belongs here, not to
     whichever card was tapped or how stale the list behind it is. */
  const busy = providerInSession(st);
  if (busy) {
    toast(st.name + " is with a client right now — they open again once that job is settled");
    renderSheet();
    return;
  }
  if (!providerAvailable(st)) {
    toast(st.name + " isn't taking new bookings right now — pick another professional");
    renderSheet();
    return;
  }
  const km = kmToStudio(st);
  const travelFee = d.loc === "home" ? travelFeeFor(km) : 0;
  const area = d.loc === "home" ? (state.user || {}).area : st.studio;
  const u = state.user || {};
  /* The price the client named, bounded by the professional's own range one
     last time: the slider's limits can be out of date if this sheet has been
     open while the professional changed their rates. */
  const priced = offerFor(d, st, sv);
  const now = new Date().toISOString();
  const booking = {
    id: "b" + Date.now(),
    serviceId: sv.id,
    stylistId: st.id,
    stylistName: st.name,
    clientName: u.name || "Client",
    clientPhone: u.phone || "",
    date: d.date,
    time: d.time,
    loc: d.loc,
    areaId: area || null,
    areaName: (areaById(area) || {}).name || "",
    address: d.loc === "home" ? u.address || "" : "",
    /* a walk-in needs somewhere to walk in to, recorded on the booking so the
       client still has the door to knock on after the sheet is gone */
    studioAddress: d.loc === "studio" ? studioAddressFor(st) : "",
    studioAreaName: d.loc === "studio" ? (areaById(st.studio) || {}).name || "" : "",
    km: km == null ? null : Math.round(km * 10) / 10,
    travelFee: travelFee,
    price: priced.offer,
    total: priced.offer + travelFee,
    /* What the client put on the table, and the conversation it starts. The
       professional accepts this price or answers with another; the range it was
       chosen from is theirs, recorded here so the offer can be read back
       against it later. */
    offer: { price: priced.offer, at: now, by: u.name || "Client" },
    priceRange: priced.range,
    negotiation: { status: "open", rounds: [{ by: "client", price: priced.offer, note: "", at: now }] },
    status: "unpaid",
    proMarkedDone: false,
    createdAt: now,
    history: [{ at: now, label: "Booking placed for " + d.date + " at " + d.time +
      " · client offers " + naira(priced.offer) }],
  };
  state.bookings.push(booking);
  save();
  closeSheet();
  toast("Slot held at " + naira(priced.offer) + " — pay into escrow to lock it in");
  openPaySheet(booking.id);
}

