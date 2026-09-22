/* =========================================================
 * Pampa — location — where the client is
 * Placing a person on the map: a device fix, or an address.
 * ========================================================= */

/* ---------- Placing a person ----------
   Two ways in, and no list to scroll: read this device, or read the address
   they typed. An address is placed by what it names — the area inside it, or a
   street that belongs to one — and the street itself is kept whole, because it
   is the door a home visit is priced and routed to.

   An address that names neither is *not* guessed at. Dropping somebody into an
   area they are not in would price their travel off a place they have never
   been, so the screen says it could not place the address and asks for the
   area by name — the one thing the person in front of it can always supply. */
const AREA_ALIASES = {
  vi: ["victoria island", "v i", "vi"],
  ikoyi: ["ikoyi", "banana island", "parkview estate"],
  lekki1: ["lekki phase 1", "lekki"],
  ajah: ["ajah", "sangotedo", "badore", "victoria garden city"],
  yaba: ["yaba", "sabo", "igbobi", "ebute metta"],
  surulere: ["surulere", "ojuelegba", "itire", "idi oro", "apapa"],
  gbagada: ["gbagada", "anthony village", "anthony"],
  oshodi: ["oshodi", "isolo", "ijora", "iponri"],
  maryland: ["maryland", "onigbongbo"],
  ikeja: ["ikeja gra", "ikeja", "alausa", "oregun", "agidingbi", "ogba"],
};

/* Streets that name their area. Tested before the area aliases, most specific
   first, so "Lekki-Epe Expressway" lands in Ajah rather than Lekki Phase 1. */
const STREET_HINTS = [
  { re: /lekki epe|sangotedo|badore|victoria garden|abraham adisa/, area: "ajah" },
  { re: /admiralty|fola osibo|freedom way|osapa|ikate|chevron|nike art/, area: "lekki1" },
  { re: /adeola odeku|ozumba|ahmadu bello|ligali|water corporation|adeyemo alakija|ajose adeogun|oniru/, area: "vi" },
  { re: /awolowo|bourdillon|glover|kingsway|queens drive|alagbon|milverton|gerrard/, area: "ikoyi" },
  { re: /bode thomas|adeniran|ogunsanya|ogunlana|lawanson|bajulaiye|itire|ojuelegba|apapa/, area: "surulere" },
  { re: /herbert macaulay|alagomeji|igbobi|sabo|onike|jibowu/, area: "yaba" },
  { re: /allen avenue|acme|odemuyiwa|alausa|agidingbi|airport road|oregun|ogba/, area: "ikeja" },
  { re: /diya|charity|ifako|anthony|gbagada|eko bridge/, area: "gbagada" },
  { re: /onigbongbo|maryland/, area: "maryland" },
  { re: /oshodi|papa ajao|ijora|iponri|isolo/, area: "oshodi" },
];

/* One normal form for matching and one for reading: punctuation out, single
   spaces, padded so " vi " can never match inside another word. */
function locText(v) {
  return " " + String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim() + " ";
}

function matchArea(text) {
  const s = locText(text);
  if (!s.trim()) return null;
  const hint = STREET_HINTS.find(function (h) { return h.re.test(s); });
  if (hint) return areaById(hint.area);
  let hit = null;
  AREAS.forEach(function (a) {
    if (hit) return;
    (AREA_ALIASES[a.id] || [a.name.toLowerCase()]).forEach(function (n) {
      if (!hit && s.indexOf(" " + n + " ") !== -1) hit = a;
    });
  });
  return hit;
}

/* The place, and where the answer came from. Whichever of the two inputs was
   used last is the one that decides — a fix taken after typing beats the text,
   and text typed after a fix beats the fix — so the person can see, in the line
   under the field, exactly what is about to be saved and why. */
function placeOf(addr, fix, last) {
  const named = matchArea(addr);
  if (last === "device" && fix) {
    const near = nearestAreaTo(fix);
    return { areaId: near.area.id, point: fix, source: "device", away: near.km, named: !!(named && named.id === near.area.id) };
  }
  if (named) return { areaId: named.id, point: null, source: "address", away: null, named: true };
  if (fix) {
    const near = nearestAreaTo(fix);
    return { areaId: near.area.id, point: fix, source: "device", away: near.km, named: false };
  }
  return { areaId: null, point: null, source: "none", away: null, named: false };
}

/* ---------- Location screen ---------- */
let locContext = "app";
let locDraft = { fix: null, accuracy: null, last: null, placed: null };

function openLocation(context) {
  locContext = context || "app";
  const u = state.user || {};
  locDraft = {
    fix: u.coords || null,
    accuracy: null,
    last: u.coords ? "device" : (u.area ? "address" : null),
    placed: null,
  };
  $("#homeAddress").value = u.address || "";
  $("#locationHint").textContent = locContext === "onboarding"
    ? (authMode === "signup" && (state.user || {}).role === "pro"
      ? "Where you work from — clients see how far you are from them."
      : "Use your current location or type your address — we show the pros nearest you.")
    : "We match you with pros who cover where you are.";
  $("#saveLocation").textContent = locContext === "onboarding" ? "Continue" : "Save location";
  renderLocState();
  renderAuthKicker();
  showPage("location");
}

/* What the two inputs add up to, said back in one line: the area you were
   placed in and where that came from, or the reason the address could not be
   placed and what to add to it. */
function renderLocState() {
  const box = $("#locFix");
  if (!box) return;
  const addr = ($("#homeAddress") || {}).value || "";
  const placed = placeOf(addr, locDraft.fix, locDraft.last);
  locDraft.placed = placed;
  const named = matchArea(addr);

  if (!placed.areaId) {
    box.innerHTML = locRow("idle",
      addr.trim() ? "We can't place that address" : "Where are you?",
      addr.trim()
        ? (named ? "Give us the area as well — e.g. \"12 Bode Thomas, Surulere\"." : "Add the area to it — e.g. \"12 Bode Thomas, Surulere\" — or use your current location.")
        : "Use your current location, or type your address with the area in it (e.g. Surulere).");
    return;
  }

  const a = areaById(placed.areaId);
  const where = a.name + ", " + a.city;
  const outside = placed.source === "device" && placed.away > COVERAGE_KM;
  /* Said at the precision the fix actually has: 20 m of GPS drift is a real
     answer, 2 km of area-centre guessing is not, and the sentence says which
     one it is so the reader is never promised precision that isn't there. */
  const precise = locDraft.accuracy != null;
  const metres = precise && locDraft.accuracy < 1000
    ? " · accurate to about " + Math.round(locDraft.accuracy) + " m"
    : "";
  box.innerHTML = locRow(outside ? "warn" : "on", where,
    outside
      ? "You're " + fmtKm(placed.away) + " from the areas we cover — " + a.name + " is the closest, so we'd match you from there. Your address is kept as typed."
      : placed.source === "device"
        ? "From this device's location" + metres + " · " + fmtKm(placed.away) + " from the centre of " + a.name + "."
        : (named
          ? "From your address · home visits route here."
          : "From your address · we matched it to " + a.name + "."));
}

function locRow(state, title, sub) {
  const ico = state === "on" ? "check" : state === "warn" ? "alert" : "pin";
  return '<div class="locFixRow ' + state + '">' +
    '<span class="locFixIco">' + icon(ico) + "</span>" +
    '<span class="locFixTxt"><b>' + esc(title) + "</b><small>" + esc(sub) + "</small></span></div>";
}

function useGps() {
  const btn = $("#useGps");
  if (!navigator.geolocation) {
    toast("This device can't read a location — type your address instead");
    return;
  }
  btn.disabled = true;
  btn.innerHTML = gpsBtnHtml(icon("pin"), "Finding you…", "Asking this device");
  navigator.geolocation.getCurrentPosition(function (pos) {
    btn.disabled = false;
    btn.innerHTML = gpsBtnHtml();
    const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    locDraft.fix = point;
    locDraft.accuracy = pos.coords.accuracy || null;
    locDraft.last = "device";
    renderLocState();
    const near = nearestAreaTo(point);
    toast(near.km > COVERAGE_KM
      ? "You're " + fmtKm(near.km) + " from the areas we cover — we'd match you from " + near.area.name
      : "Read from this device — " + near.area.name + ", " + fmtKm(near.km) + " from its centre");
  }, function (err) {
    btn.disabled = false;
    btn.innerHTML = gpsBtnHtml();
    /* The three failures deserve three messages, because they have three
       different ways out: a denied prompt is the device's settings; an
       unavailable fix is often a phone with Location services off; a timeout
       indoors can pass by a window. Each says the honest reason and the way
       around it — the address field is always the door that works. */
    toast(err && err.code === 1
      ? "Location permission is off for this app — allow it in your browser settings, or type your address"
      : err && err.code === 2
        ? "This device can't get a fix right now — is Location turned on? Or type your address"
        : err && err.code === 3
          ? "Couldn't get a fix in time — try again near a window, or type your address"
          : "Couldn't read this device's location — type your address instead");
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}

/* The GPS button's two-line face — one place, so the loading and resting
   states can never drift apart. */
function gpsBtnHtml(ico, title, sub) {
  return '<span class="gpsIco">' + (ico || icon("pin")) + "</span>" +
    '<span class="gpsTxt"><b>' + esc(title || "Use my current location") + "</b>" +
    "<small>" + esc(sub || "One tap — read from this device") + "</small></span>";
}

function saveLocation() {
  const u = state.user || (state.user = { name: "Guest", phone: "", remember: true });
  const text = ($("#homeAddress") || {}).value.trim();
  const placed = placeOf(text, locDraft.fix, locDraft.last);
  if (!placed.areaId) {
    hintNoPlace(text
      ? "Add the area to that address — e.g. \"12 Bode Thomas, Surulere\""
      : "Use your current location, or type your address");
    return;
  }
  u.address = text;
  u.area = placed.areaId;  /* A device fix is kept as the point distances are measured from — but only
     when it is inside the areas we cover. A fix 500 km away is not a distance
     to price travel off; the nearest area we do cover stands in for it, which
     is also what keeps signing up possible from anywhere. An address that named
     its area leaves the point to the area in the same way. */
  const usable = placed.source === "device" && placed.point && placed.away <= COVERAGE_KM;
  if (usable) u.coords = placed.point;
  else delete u.coords;
  /* How well the device could see the sky, kept with the fix: it is what the
     app's precision labels are honest about, and what the directory publishes
     beside the point itself. */
  u.coordsAccuracy = usable ? (locDraft.accuracy || null) : null;
  /* your studio is your area, so a registration follows you when you move */
  registerProviderSelf();
  save();
  rememberAccount();
  if (locContext === "onboarding") {
    enterApp();
    toast(((state.user || {}).role === "pro" ? "Studio set — you're live near " : "You're set — showing pros near ") + clientAreaName());
  } else {
    $("#location").style.display = "none";
    $("#app").style.removeProperty("display");
    refreshLocationUI();
    toast("Location updated");
  }
}

/* Nothing placeable: shake the address field rather than fail silently, since
   the way out is either that field or the button above it. */
function hintNoPlace(msg) {
  toast(msg);
  const field = document.querySelector("#location .locField");
  if (field) {
    field.classList.remove("locNudge");
    void field.offsetWidth;
    field.classList.add("locNudge");
    field.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function closeLocation() {
  if (locContext === "onboarding") {
    /* a client's onboarding came straight from the role screen */
    openRole();
    return;
  }
  $("#location").style.display = "none";
  $("#app").style.removeProperty("display");
  refreshLocationUI();
}

function refreshLocationUI() {
  const u = state.user || {};
  const t = $("#homeLocText");
  if (t) t.textContent = clientAreaName();

  /* The location pill is kept in step with the saved profile: the area on the
     first line, the street a home visit goes to under it. Editing happens on
     the location screen, where the device's own GPS and the address field live
     together — this row only ever reports. */
  const areaName = $("#homeAreaName");
  if (areaName) areaName.textContent = hasLocation() ? clientAreaName() : "Set your location";
  const areaNote = $("#homeAreaNote");
  if (areaNote) {
    areaNote.textContent = !hasLocation()
      ? "Use your location or add your address"
      : (u.address
        ? u.address + (u.role === "pro" ? " \u00b7 your studio" : " \u00b7 home visits come here")
        : (u.role === "pro" ? "Tap to set your studio address" : "Tap to add your street address"));
  }
  const hint = $("#homeTradeHint");
  if (hint) {
    /* one line, always: the greeting names the account, this line names what the
       tab bar will do with it */
    const t = tradeById(u.trade);
    hint.textContent = u.role === "pro"
      ? (t ? t.name + " \u00b7 taking bookings" : "Taking bookings")
      : "Beauty and barbing, closest first";
  }

  renderStylists();
  renderProfile();
}



