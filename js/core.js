/* =========================================================
 * Pampa — core — data, state, themes and helpers
 * The trades, services and areas the app knows, the two themes, the persisted store and the small helpers every other module leans on.
 * ========================================================= */

/* ---------- Data ---------- */
const SERVICES = [
  { id: "braids", cat: "hair", name: "Knotless braids", dur: 180, price: 15000, ico: "braids" },
  { id: "weave", cat: "hair", name: "Weave install", dur: 120, price: 12000, ico: "weave" },
  /* Named for the work, not the venue: the where is now an explicit choice on
     every booking, so a service called "Home haircut" read as a contradiction
     the moment a client picked the studio walk-in. */
  { id: "cut", cat: "barb", name: "Full haircut", dur: 45, price: 3500, ico: "scissors" },
  { id: "beard", cat: "barb", name: "Beard trim", dur: 30, price: 2000, ico: "beard" },
  /* The touch-up between cuts, named the way a client asks for it. */
  { id: "touch", cat: "barb", name: "Maintenance", dur: 20, price: 1500, ico: "comb" },
  { id: "mani", cat: "nails", name: "Manicure", dur: 60, price: 5000, ico: "polish" },
  { id: "pedi", cat: "nails", name: "Pedicure", dur: 75, price: 6000, ico: "foot" },
  { id: "facial", cat: "spa", name: "Facial", dur: 60, price: 10000, ico: "facial" },
  { id: "massage", cat: "spa", name: "Massage", dur: 90, price: 12000, ico: "hands" },
];

/* The trades someone can register under. Barbing leads the list. */
const TRADES = [
  { id: "barb", ico: "scissors", name: "Barbing", note: "Fades, line-ups, beard work" },
  { id: "hair", ico: "braids", name: "Hair", note: "Braids, weaving, styling" },
  { id: "nails", ico: "polish", name: "Nails", note: "Manicure, pedicure, gel" },
  { id: "spa", ico: "sparkle", name: "Spa", note: "Facials, massage, skin" },
];

/* Service areas with approximate coordinates, used for distance + coverage. */
const AREAS = [
  { id: "vi", name: "Victoria Island", city: "Lagos", lat: 6.4281, lng: 3.4219 },
  { id: "ikoyi", name: "Ikoyi", city: "Lagos", lat: 6.4520, lng: 3.4350 },
  { id: "lekki1", name: "Lekki Phase 1", city: "Lagos", lat: 6.4410, lng: 3.4750 },
  { id: "ajah", name: "Ajah", city: "Lagos", lat: 6.4667, lng: 3.5667 },
  { id: "yaba", name: "Yaba", city: "Lagos", lat: 6.5095, lng: 3.3711 },
  { id: "surulere", name: "Surulere", city: "Lagos", lat: 6.5000, lng: 3.3500 },
  { id: "gbagada", name: "Gbagada", city: "Lagos", lat: 6.5550, lng: 3.3900 },
  { id: "oshodi", name: "Oshodi", city: "Lagos", lat: 6.5550, lng: 3.3400 },
  { id: "maryland", name: "Maryland", city: "Lagos", lat: 6.5700, lng: 3.3667 },
  { id: "ikeja", name: "Ikeja GRA", city: "Lagos", lat: 6.5833, lng: 3.3500 },
];

/* ---------- Price ranges ----------
   A professional does not charge one number for a haircut: a touch-up and a
   full restyle are different jobs at different prices. So every service a
   professional offers carries a range of their own — the floor they will work
   for and the most they charge — and a client names the price they can afford
   inside it. The catalogue price is only the middle the range is built around,
   which is why a record that has never set rates still answers with a sensible
   pair instead of nothing. */
const RANGE_LOW = 0.7;
const RANGE_HIGH = 1.4;

function roundTo50(n) {
  return Math.round(Number(n) / 50) * 50;
}

function defaultRange(price) {
  const base = Number(price) || 0;
  return { min: Math.max(500, roundTo50(base * RANGE_LOW)), max: Math.max(1000, roundTo50(base * RANGE_HIGH)) };
}

/* The range a professional actually answers with: their own settings when they
   have made them, the default band around the catalogue price when they have
   not. Always a real pair, min never above max, so a picker built from it can
   never be empty or inverted. */
function rangeFor(p, serviceId) {
  const sv = SERVICES.find(function (s) { return s.id === serviceId; });
  const set = p && p.ranges ? p.ranges[serviceId] : null;
  if (set && Number(set.min) > 0 && Number(set.max) >= Number(set.min)) {
    return { min: roundTo50(set.min), max: roundTo50(set.max) };
  }
  return defaultRange(sv ? sv.price : 0);
}

function clampToRange(price, range) {
  if (!range) return price;
  return Math.min(range.max, Math.max(range.min, roundTo50(price)));
}

/* "₦3,000 – ₦5,000", the one way a range is written anywhere in the app. */
function rangeText(range) {
  if (!range) return "";
  return naira(range.min) + " – " + naira(range.max);
}

/* Travel pricing for home visits: base covers the first 3 km. */
const TRAVEL = { base: 1000, freeKm: 3, perKm: 250 };

/* Beyond this radius from the nearest supported area we ask the user to pick manually. */
const COVERAGE_KM = 25;

const STYLISTS = [
  { id: "amara", name: "Amara", skill: "Braids & weaves", rating: 4.9, jobs: 210, cats: ["hair"], studio: "lekki1", coords: { lat: 6.4385, lng: 3.4680 }, covers: ["lekki1", "vi", "ikoyi", "ajah"] },
  { id: "tunde", name: "Tunde", skill: "Barbing", rating: 4.8, jobs: 164, cats: ["barb", "hair"], studio: "yaba", coords: { lat: 6.5122, lng: 3.3770 }, covers: ["yaba", "surulere", "gbagada", "oshodi", "maryland", "ikeja"] },
  { id: "zainab", name: "Zainab", skill: "Nails", rating: 4.7, jobs: 98, cats: ["nails"], studio: "ikeja", coords: { lat: 6.5860, lng: 3.3550 }, covers: ["ikeja", "maryland", "oshodi", "gbagada"] },
  { id: "sofia", name: "Sofia", skill: "Spa & facials", rating: 5.0, jobs: 77, cats: ["spa", "nails"], studio: "ikoyi", coords: { lat: 6.4548, lng: 3.4390 }, covers: ["ikoyi", "vi", "lekki1", "yaba"] },
];

/* Seed portfolios: real photography from the same lightweight CDN the hero
   slider uses, so a fresh install opens with a lived-in spotlight strip and
   every professional's page shows something of their craft. */
/* The four demo professionals each carry one clip as well, so the rail has
   something in it on a device that has never uploaded anything. These are the
   CC0 sample videos MDN publishes (a few hundred kilobytes each, streamed not
   stored) — the rail loads a clip only when it arrives on screen. */
const SEED_CLIP_CDN = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/";

const SEED_WORKS = {
  amara: [
    { id: "am1", kind: "photo", src: "photo-1605980776566-0486c3ac7617", note: "Knotless braids" },
    { id: "am2", kind: "photo", src: "photo-1595476108010-b4d1f102b1b1", note: "Passion twists" },
    { id: "am3", kind: "video", src: SEED_CLIP_CDN + "flower.webm", note: "Knotless braids, start to finish" },
  ],
  tunde: [
    { id: "tu1", kind: "photo", src: "photo-1503951914875-452162b0f3f1", note: "Skin fade" },
    { id: "tu2", kind: "photo", src: "photo-1622286342621-4bd786c2447c", note: "Classic cut" },
    { id: "tu3", kind: "video", src: SEED_CLIP_CDN + "friday.mp4", note: "Line-up and beard shape" },
  ],
  zainab: [
    { id: "za1", kind: "photo", src: "photo-1604654894610-df63bc536371", note: "Gel set" },
    { id: "za2", kind: "photo", src: "photo-1610992015732-2449b76344bc", note: "French tips" },
    { id: "za3", kind: "video", src: SEED_CLIP_CDN + "flower.mp4", note: "Gel overlay, one hand" },
  ],
  sofia: [
    { id: "so1", kind: "photo", src: "photo-1544161515-4ab6ce6db874", note: "Deep tissue" },
    { id: "so2", kind: "photo", src: "photo-1519823551278-64ac92734fb1", note: "Facial bar" },
    { id: "so3", kind: "video", src: SEED_CLIP_CDN + "flower.webm", note: "Pressure work, shoulders" },
  ],
};

function seedWorksFor(id) {
  const list = SEED_WORKS[id] || [];
  return list.map(function (w) {
    if (w.kind === "video") {
      return { id: w.id, kind: "video", src: w.src, note: w.note };
    }
    return { id: w.id, kind: "photo", src: photoSrc(w.src, 420, 420), note: w.note };
  });
}

/* What each trade is called in a client's own words, so one search box can
   find both the service and the person who performs it. */
const CAT_WORDS = {
  hair: ["hair", "braid", "braids", "weave", "weaving", "style", "styling"],
  barb: ["barb", "barbing", "barber", "fade", "cut", "haircut", "beard", "shave"],
  nails: ["nail", "nails", "mani", "manicure", "pedi", "pedicure", "gel", "polish"],
  spa: ["spa", "facial", "massage", "skin", "stone"],
};

function catLabel(cat) {
  const t = TRADES.find(function (x) { return x.id === cat; });
  return t ? t.name.toLowerCase() : cat;
}

/* One box searches both halves of the app: the services a client can book and
   the professionals who deliver them. "braids" finds the braids service and
   anyone who does braids; a person's name finds the person. */
function wordsMatch(words, q) {
  for (let i = 0; i < words.length; i++) {
    if (words[i].indexOf(q) === 0 || q.indexOf(words[i]) === 0) return true;
  }
  return false;
}

/* One search, one list: the professionals. "fade" has to find the barbers, so a
   person is matched on their name, their trade's name and the words a client
   would use for the work — matching only on the name leaves a search that half
   works. */
function providerMatches(p, q) {
  if (!q) return true;
  const hay = ((p.name || "") + " " + (p.skill || "") + " " + tradeNameFor(p)).toLowerCase();
  if (hay.indexOf(q) !== -1) return true;
  const cats = p.cats || [];
  for (let i = 0; i < cats.length; i++) {
    if (wordsMatch(CAT_WORDS[cats[i]] || [], q)) return true;
  }
  return false;
}

/* ---------- Appearance ---------- */
/* The attribute is set by an inline script in index.html before first paint;
   these keep it in step with the toggle and remember the choice. */
const THEME_KEY = "pampa.theme.v1";

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function setTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (e) {
    console.warn("Pampa: theme preference not saved", e);
  }
  renderThemeControl();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", next === "light" ? "#f3f5f8" : "#0b0d11");
  toast(next === "light" ? "Light appearance" : "Dark appearance");
}

function renderThemeControl() {
  const current = currentTheme();
  $$("[data-theme-set]").forEach(function (b) {
    b.classList.toggle("active", b.dataset.themeSet === current);
    b.setAttribute("aria-pressed", b.dataset.themeSet === current ? "true" : "false");
  });
}

/* ---------- State + storage ---------- */
const KEY = "pampa.data.v1";
const state = {
  user: null,
  bookings: [],
  view: "home",
  statusFilter: "upcoming",
  catFilter: "all",
  query: "",
  draft: {},
  /* which provider's public page is open, if any */
  providerView: null,
};

/* Returns false when the write was refused (e.g. the device is full) so
   callers can drop bulky evidence instead of losing the change silently.
   The booking ledger is persisted here too: it belongs to the marketplace on
   this device, not to whoever happens to be signed in, so a client's escrow
   payment is still waiting for its stylist after either of them logs out. */
const LEDGER_KEY = "pampa.bookings.v1";

function loadLedger() {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.bookings)) state.bookings = d.bookings;
    }
  } catch (e) {
    console.warn("Pampa: ledger unreadable", e);
  }
  if (!Array.isArray(state.bookings)) state.bookings = [];
}

function saveLedger() {
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify({ bookings: state.bookings }));
    return true;
  } catch (e) {
    console.warn("Pampa: ledger not saved", e);
    return false;
  }
}

function save() {
  const ledgerOk = saveLedger();
  try {
    if (!state.user || state.user.remember === false) return ledgerOk;
    localStorage.setItem(KEY, JSON.stringify({
      user: state.user,
    }));
    return ledgerOk;
  } catch (e) {
    console.warn("Pampa: storage unavailable", e);
    return false;
  }
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;      const data = JSON.parse(raw);
      if (data && typeof data === "object") {
        state.user = data.user || null;
      }
  } catch (e) {
    console.warn("Pampa: unreadable saved data", e);
  }
}

/* ---------- Helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function naira(n) {
  return "₦" + Number(n).toLocaleString("en-NG");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* ---------- Location helpers ---------- */
function areaById(id) {
  return AREAS.find(function (a) { return a.id === id; }) || null;
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180;
  const la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function nearestAreaTo(point) {
  let best = null;
  let bestKm = Infinity;
  AREAS.forEach(function (a) {
    const d = haversineKm(point, a);
    if (d < bestKm) { bestKm = d; best = a; }
  });
  return { area: best, km: bestKm };
}

/* Where the client is: GPS coords when granted, otherwise their chosen area. */
function clientPoint() {
  const u = state.user || {};
  if (u.coords) return { lat: u.coords.lat, lng: u.coords.lng };
  const a = areaById(u.area);
  return a ? { lat: a.lat, lng: a.lng } : null;
}

function clientAreaName() {
  const u = state.user || {};
  const a = areaById(u.area);
  if (a) return a.name + ", " + a.city;
  if (u.coords) return "Current location";
  return "Set your location";
}

function hasLocation() {
  const u = state.user || {};
  return Boolean(u.area || u.coords);
}

/* Distance from the client to any point of interest (area id). */
function kmFromClient(areaId) {
  const p = clientPoint();
  const a = areaById(areaId);
  if (!p || !a) return null;
  return haversineKm(p, a);
}

/* The studio distance, now at the precision both sides allow: this is what the
   sixteen call sites (cards, chips, the booking sheet, clips, profiles) read,
   and every one of them gets the fix-to-fix number when it exists. */
function kmToStudio(st) {
  return kmToProvider(st);
}

/* ---------- Precise distances ----------
   The area centre was the only thing the app could measure from when nobody
   had given it a fix, and it answered every distance with a small lie: two
   barbers a street apart both read "your area", and "1.2 km" was impossible.
   The device fix is the honest answer, so it is now the first thing measured
   from — the client's own fix against the professional's, falling back to the
   area centre only for whichever side never gave one.

   Two rules keep it truthful. Below PRECISE_EPS two points are the same place
   at this display resolution, so the answer is 0 rather than a decimal that
   implies precision the GPS does not have. And every caller can ask
   kmPrecision() which kind of number it is showing, so "~" can mark a distance
   measured to a centre rather than to a door. */
const PRECISE_EPS = 0.05;

function providerPoint(st) {
  const c = st && st.coords;
  if (c && Number.isFinite(c.lat) && Number.isFinite(c.lng)) return { lat: c.lat, lng: c.lng };
  const a = areaById(st && st.studio);
  return a ? { lat: a.lat, lng: a.lng } : null;
}

/* How far a professional is from this client, as exactly as both sides allow:
   fix-to-fix when both devices gave a position, otherwise to the best point
   that exists — a centre, not a door. */
function kmToProvider(st) {
  const from = clientPoint();
  const to = providerPoint(st);
  if (!from || !to) return null;
  const d = haversineKm(from, to);
  return d < PRECISE_EPS ? 0 : d;
}

/* Which kind of distance a card is showing: "fix" means both devices gave a
   position and the number is door-to-door; "approx" means one side is only
   known to its area, and the UI marks it so the reader is never lied to by
   the absence of a decimal. */
function kmPrecision(st) {
  const u = state.user || {};
  return (u.coords && st && st.coords) ? "fix" : "approx";
}

function travelFeeFor(km) {
  if (km == null) return 0;
  const extra = Math.max(0, km - TRAVEL.freeKm);
  return Math.round((TRAVEL.base + extra * TRAVEL.perKm) / 50) * 50;
}

function driveMins(km) {
  if (km == null) return null;
  return Math.max(5, Math.round(km * 3));
}

function fmtKm(km) {
  if (km == null) return "distance unknown";
  return km < 1 ? Math.round(km * 1000) + " m" : km.toFixed(1) + " km";
}

/* The compact form of the same fact, for the places a whole sentence will not
   fit — the chips under the location pill, a tag on a card. A provider whose
   studio is the client's own area is not "0 m away": the app knows their area,
   not their doorstep, so it says the true thing, which is also the thing that
   makes two professionals a street apart distinguishable on a list sorted by
   distance.

   Both take an optional `st`: with it, the distance is measured fix-to-fix
   where both sides gave a position, and an approximate one — measured to an
   area centre because one side never gave a fix — is marked with "~". A
   tilde is the honest difference between 1.2 km to a door and 1.2 km to the
   middle of a district. */
function nearText(km, st) {
  if (km == null) return "\u2014";
  if (km < PRECISE_EPS) return "your area";
  return (kmPrecision(st) === "approx" ? "~" : "") + fmtKm(km);
}

/* Reads as a sentence even when a provider has no studio area on file. */
function awayText(km, st) {
  if (km == null) return "Distance unknown";
  if (km < PRECISE_EPS) return "In your area";
  return (kmPrecision(st) === "approx" ? "~" : "") + fmtKm(km) + " away";
}

/* A place, written once: an address that already names its area does not get
   the area repeated after it, because "12 Bode Thomas, Surulere, Surulere"
   reads like a bug in every place a booking states where it happens.

   The comparison is on the area's own name — its first part — and on a word
   boundary, because an area is written "Surulere, Lagos" while the address
   usually names only the neighbourhood: matching whole strings never fired
   here, and matching the city would have dropped the area from an address
   that merely happens to be in Lagos. */
function placeLine(address, area) {
  const a = String(address || "").trim();
  const r = String(area || "").trim();
  if (!a) return r;
  if (!r) return a;
  const name = (r.split(",")[0] || "").trim().toLowerCase();
  if (name) {
    const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp("(^|[^a-z])" + safe + "([^a-z]|$)").test(a.toLowerCase())) return a;
  }
  return a + ", " + r;
}

/* Home visits only for stylists whose coverage includes the client's area. */
