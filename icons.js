/* =========================================================
 * Pampa — inline icon + illustration set
 * Loaded before escrow.js and the js/ modules; all of them share
 * the global scope. Every glyph is a few inline SVG paths on a
 * 24x24 grid, stroked with currentColor: no icon font, no
 * image request, sharp at any size and theme-aware.
 * ========================================================= */

const ICONS = {
  /* --- navigation --- */
  home: '<path d="M3.2 10.6 12 3.6l8.8 7"/><path d="M5.6 9.7v10.7h12.8V9.7"/><path d="M9.9 20.4v-5.1h4.2v5.1"/>',
  calendar: '<rect x="3.8" y="5.6" width="16.4" height="14.4" rx="3"/><path d="M3.8 10.2h16.4"/><path d="M8.6 3.4v4.2M15.4 3.4v4.2"/>',
  user: '<circle cx="12" cy="8.4" r="3.7"/><path d="M4.6 20.6c1.2-3.6 4-5.4 7.4-5.4s6.2 1.8 7.4 5.4"/>',
  /* a handset, for the one field that only ever wants a phone number */
  phone: '<path d="M6.4 3.8h3l1.6 3.9-2 1.4a11 11 0 0 0 5.9 5.9l1.4-2 3.9 1.6v3a1.9 1.9 0 0 1-2.1 1.9A15.6 15.6 0 0 1 4.5 5.9 1.9 1.9 0 0 1 6.4 3.8Z"/>',
  /* nav glyphs: a shopfront, a dated calendar, a person in a ring */
  market: '<path d="M3.6 9.4 5.6 4.6h12.8l2 4.8z"/><path d="M4.8 9.4v9.8h14.4V9.4"/><path d="M9.6 19.2v-5.2h4.8v5.2"/>',
  calendarDot: '<rect x="3.8" y="5.6" width="16.4" height="14.4" rx="3"/><path d="M3.8 10.2h16.4"/><path d="M8.6 3.4v4.2M15.4 3.4v4.2"/><circle cx="12" cy="15.4" r="1.5" fill="currentColor" stroke="none"/>',
  userRing: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="9.8" r="2.9"/><path d="M6.6 18.8c1.1-2.3 3.1-3.5 5.4-3.5s4.3 1.2 5.4 3.5"/>',
  search: '<circle cx="11" cy="11" r="6.4"/><path d="M15.6 15.6 20 20"/>',
  sliders: '<path d="M4.6 8.2h8.2M17 8.2h2.4M4.6 15.8h2.4M10.6 15.8h8.8"/><circle cx="15.2" cy="8.2" r="1.9"/><circle cx="8.4" cy="15.8" r="1.9"/>',
  bag: '<path d="M5 8.4h14l-1.2 11.2H6.2z"/><path d="M9 8.4V6.6a3 3 0 0 1 6 0v1.8"/>',

  /* --- trades and services --- */
  scissors: '<circle cx="6.6" cy="17.6" r="2.6"/><circle cx="17.4" cy="17.6" r="2.6"/><path d="M8.5 15.8 17.6 4.4M15.5 15.8 6.4 4.4"/>',
  braids: '<path d="M7.2 4.2c1.7 3-1.7 5 0 8s-1.7 5 0 7.6M12 4.2c1.7 3-1.7 5 0 8s-1.7 5 0 7.6M16.8 4.2c1.7 3-1.7 5 0 8s-1.7 5 0 7.6"/>',
  weave: '<path d="M6.2 4.6h11.6v3.2H6.2z"/><path d="M8 10.4v8.8M12 10.4v8.8M16 10.4v8.8"/><path d="M6.4 19.6h11.2"/>',
  beard: '<path d="M6.4 6.2c0 5.6 2.4 12.2 5.6 12.2s5.6-6.6 5.6-12.2c0-2-1.3-3.1-2.9-3.1-.9 0-1.8.5-2.7 1.6-.9-1.1-1.8-1.6-2.7-1.6-1.6 0-2.9 1.1-2.9 3.1z"/><path d="M9.6 11.4c1.4.9 3.4.9 4.8 0"/>',
  clipper: '<rect x="6.8" y="8.4" width="10.4" height="11.4" rx="2.2"/><path d="M9.4 4.4h5.2v4H9.4z"/><path d="M9.8 12.6h4.4M9.8 16h4.4"/>',
  polish: '<path d="M9.6 9.2h4.8v11.4H9.6z"/><path d="M10.6 4.4h2.8v4.8h-2.8z"/><path d="M11 15.4h2"/>',
  foot: '<path d="M10.4 4.6c1.9 0 2.8 1.3 2.8 3.4v5.6c0 1.6.8 2.4 2.3 2.9l1.2.4c1.4.5 2.1 1.3 2.1 2.6 0 1.6-1.3 2.4-3.3 2.4-3.3 0-6.3-2.1-6.3-6V7.4c0-1.8.7-2.8 1.2-2.8z"/><path d="M6.6 20.4h8.8"/>',
  facial: '<circle cx="12" cy="13" r="5.2"/><path d="M10.2 12.4h.01M13.8 12.4h.01"/><path d="M10.6 15.4c.9.6 1.9.6 2.8 0"/><path d="M17.6 3.6l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z"/>',
  hands: '<path d="M4.4 13.4c2.4-2.6 4.4-2.6 7.6-.6 3.2-2 5.2-2 7.6.6"/><path d="M4.4 13.4c1.8 3.6 4.4 5.4 7.6 5.4s5.8-1.8 7.6-5.4"/><path d="M12 4.4v3.6"/>',
  sparkle: '<path d="M12 3.6l1.5 4.3 4.3 1.5-4.3 1.5L12 15.2l-1.5-4.3L6.2 9.4l4.3-1.5z"/><path d="M18.6 15.4l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z"/>',

  /* --- money --- */
  card: '<rect x="2.8" y="5.4" width="18.4" height="13.2" rx="3"/><path d="M2.8 10h18.4"/><path d="M6.4 14.6h3.4"/>',
  bank: '<path d="M3.4 9.4 12 4.2l8.6 5.2"/><path d="M5.6 9.8v8.4M9.8 9.8v8.4M14.2 9.8v8.4M18.4 9.8v8.4"/><path d="M3.4 20.4h17.2"/>',
  coin: '<circle cx="12" cy="12" r="8.4"/><path d="M14.6 9.2c-.6-.8-1.5-1.2-2.6-1.2-1.4 0-2.4.8-2.4 1.9 0 2.6 5.2 1.3 5.2 4 0 1.3-1.1 2.1-2.6 2.1-1.2 0-2.2-.5-2.8-1.3"/><path d="M12 6.6v10.8"/>',
  refund: '<path d="M4.6 12a7.4 7.4 0 1 0 2.4-5.5"/><path d="M4.2 5.4v3.6h3.6"/>',

  /* --- places --- */
  pin: '<path d="M12 21c4-4.4 6-7.5 6-10.2A6 6 0 0 0 6 10.8C6 13.5 8 16.6 12 21z"/><circle cx="12" cy="10.6" r="2.4"/>',
  house: '<path d="M4 10.4 12 4.4l8 6"/><path d="M6.2 9.6v10.2h11.6V9.6"/>',
  store: '<path d="M4.2 9.6 6 4.4h12l1.8 5.2"/><path d="M4.2 9.6v10.2h15.6V9.6"/><path d="M9.4 19.8v-5.4h5.2v5.4"/>',

  /* --- status and actions --- */
  check: '<path d="M5 12.6l4.6 4.6L19 6.6"/>',
  close: '<path d="M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6"/>',
  chevron: '<path d="M9.6 5.6 16.4 12l-6.8 6.4"/>',
  arrowLeft: '<path d="M14.4 5.6 7.6 12l6.8 6.4"/>',
  star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>',
  alert: '<path d="M12 4.2 3.4 19.4h17.2z"/><path d="M12 9.6v4.6"/><path d="M12 17.1h.01"/>',
  shield: '<path d="M12 3.6 5.2 6.2v5.6c0 4 2.7 7.2 6.8 8.6 4.1-1.4 6.8-4.6 6.8-8.6V6.2z"/><path d="M9.2 12.2l2 2 3.6-3.8"/>',
  lock: '<rect x="4.8" y="10.4" width="14.4" height="9.4" rx="2.6"/><path d="M8.4 10.4V7.8a3.6 3.6 0 0 1 7.2 0v2.6"/>',
  camera: '<path d="M4.4 8.4h3l1.6-2.2h6l1.6 2.2h3v10.2H4.4z"/><circle cx="12" cy="13.2" r="3.2"/>',
  scale: '<path d="M12 4.6v15.8"/><path d="M8.4 20.4h7.2"/><path d="M5 7.6h14"/><path d="M5 7.6 2.8 13a2.6 2.6 0 0 0 4.4 0z"/><path d="M19 7.6 16.8 13a2.6 2.6 0 0 0 4.4 0z"/>',
  clock: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.4V12l3 1.8"/>',
  wrench: '<path d="M15.4 4.4a4.6 4.6 0 0 0-4 6.9l-7 7 1.9 1.9 7-7a4.6 4.6 0 0 0 6.9-4l-2.6 2.6-2.2-2.2z"/>',
  wallet: '<path d="M3.6 7.4A2.4 2.4 0 0 1 6 5h11.4v2.4"/><rect x="3.6" y="7.4" width="16.8" height="11.2" rx="2.6"/><path d="M16.4 13h.01"/>',
  briefcase: '<rect x="3.6" y="7.6" width="16.8" height="11.8" rx="2.6"/><path d="M8.8 7.6V5.8A1.8 1.8 0 0 1 10.6 4h2.8a1.8 1.8 0 0 1 1.8 1.8v1.8"/><path d="M3.6 12.6h16.8"/>',
  moon: '<path d="M19.2 14.6A7.8 7.8 0 0 1 9.4 4.8a7.8 7.8 0 1 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"/>',
  plus: '<path d="M12 5.6v12.8M5.6 12h12.8"/>',
  trash: '<path d="M5.4 7.4h13.2"/><path d="M9.2 7.4V5.6h5.6v1.8"/><path d="M7.4 7.4l.9 11.6h7.4l.9-11.6"/><path d="M10.6 10.8v5M13.4 10.8v5"/>',
  play: '<circle cx="12" cy="12" r="8.6"/><path d="M10.4 8.8 15.4 12l-5 3.2z"/>',
  /* a stack of frames: the portfolio */
  gallery: '<rect x="3.8" y="5.4" width="16.4" height="13.2" rx="2.4"/><path d="M6.6 15.6l3.4-3.6 2.6 2.6 2-2.2 2.8 3.2"/><circle cx="9.2" cy="9.8" r="1.3"/>',
  arrowRight: '<path d="M4.6 12h14M13.4 6.6 18.8 12l-5.4 5.4"/>',
  info: '<circle cx="12" cy="12" r="8.4"/><path d="M12 11v5.4"/><path d="M12 8.2h.01"/>',
  send: '<path d="M4.4 12 20 4.4 12.4 20l-1.8-6.2z"/><path d="M10.6 13.8 20 4.4"/>',
  /* a curved arrow back up to the comment it answers */
  reply: '<path d="M9.6 6.4 4.6 11.4l5 5"/><path d="M4.6 11.4h8.8a5.4 5.4 0 0 1 5.4 5.4v1.8"/>',
  /* an arrow dropping into a tray: the app going onto the home screen */
  download: '<path d="M12 4.4v10.2"/><path d="M8.2 10.8 12 14.6l3.8-3.8"/><path d="M5 16.4v2.2h14v-2.2"/>',
  brush: '<path d="M5 19.4c0-2.6 1-3.6 3.6-3.6h5.2"/><path d="M8.6 15.8V6.2a2.6 2.6 0 0 1 5.2 0v9.6"/><path d="M11.2 3.6v3"/>',
  comb: '<path d="M4.4 4.6h3v14.8h-3z"/><path d="M7.4 7h12.2M7.4 10.4h9.2M7.4 13.8h12.2M7.4 17.2h9.2"/>',

  /* --- profiles, ratings and notices --- */
  bell: '<path d="M8.2 18.4V11a3.8 3.8 0 0 1 7.6 0v7.4"/><path d="M5.6 18.4h12.8"/><path d="M10.4 21.2a1.9 1.9 0 0 0 3.2 0"/>',
  bellRing: '<path d="M8.2 18.4V11a3.8 3.8 0 0 1 7.6 0v7.4"/><path d="M5.6 18.4h12.8"/><path d="M10.4 21.2a1.9 1.9 0 0 0 3.2 0"/><path d="M3.6 9.4 2 8M20.4 9.4 22 8"/>',
  map: '<path d="M3.6 6.4 9.2 4.4l5.6 2 5.6-2v13.2l-5.6 2-5.6-2-5.6 2z"/><path d="M9.2 4.4v13.2M14.8 6.4v13.2"/>',
  quote: '<path d="M9.6 6.6c-2.6 1-4 3-4 5.6h3.2v5.2H4.4v-4.6"/><path d="M19.6 6.6c-2.6 1-4 3-4 5.6h3.2v5.2H14.4v-4.6"/>',
  award: '<circle cx="12" cy="9.6" r="5.6"/><path d="M8.4 14.4 7 21l5-2.4L17 21l-1.4-6.6"/>',
  trend: '<path d="M4 16.4 9.4 11l3.4 3.4L20 7.4"/><path d="M14.8 7.4H20v5.2"/>',
  /* a circular arrow: re-read the ledger */
  refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20.6 4.4v4h-4"/>',
  /* eyes: reveal and hide a password */
  eye: '<path d="M2.6 12S6.4 5.8 12 5.8 21.4 12 21.4 12 17.6 18.2 12 18.2 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="3.2"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M9.6 5.9A9.6 9.6 0 0 1 12 5.8c5.6 0 9.4 6.2 9.4 6.2a17 17 0 0 1-2.9 3.6"/><path d="M6.5 7.9A16.4 16.4 0 0 0 2.6 12S6.4 18.2 12 18.2c1 0 1.9-.2 2.7-.5"/><path d="M10.3 10.3a2.4 2.4 0 0 0 3.4 3.4"/>',
  /* a key: the new password, where a lock is the current one */
  key: '<circle cx="8.4" cy="8.4" r="3.6"/><path d="M11 10.9 20.4 20.3"/><path d="M17.6 17.5l1.9-1.9M14.8 14.7l1.7-1.7"/>',
  /* --- the clip rail: like, comment, sound --- */
  heart: '<path d="M12 20.2S4.2 15.4 4.2 10.2A4.1 4.1 0 0 1 12 7.9a4.1 4.1 0 0 1 7.8 2.3c0 5.2-7.8 10-7.8 10z"/>',
  chat: '<path d="M4.4 12.2c0-3.9 3.4-6.8 7.6-6.8s7.6 2.9 7.6 6.8-3.4 6.8-7.6 6.8c-.9 0-1.8-.1-2.6-.4L5 20.4l1.3-3.4a6.5 6.5 0 0 1-1.9-4.8z"/>',
  sound: '<path d="M4.6 9.6h3l4.2-3.4v11.6L7.6 14.4h-3z"/><path d="M15.4 9.2a4.2 4.2 0 0 1 0 5.6M17.8 6.6a7.6 7.6 0 0 1 0 10.8"/>',
  soundOff: '<path d="M4.6 9.6h3l4.2-3.4v11.6L7.6 14.4h-3z"/><path d="M15.4 9.8l5 4.4M20.4 9.8l-5 4.4"/>',
};

/* Larger, multi-element drawings for empty states. Kept to a
   handful of shapes each so they stay cheap to paint. */
const ILLUSTRATIONS = {
  /* Motion art. Only transform and opacity are animated downstream, so these
     hold 60fps on cheap phones — and being inline SVG they cost no requests. */
  welcome:
    '<circle class="spoke" cx="80" cy="58" r="32"/>' +
    '<circle class="spoke spin" cx="80" cy="58" r="43"/>' +
    '<path class="spoke" d="M80 90v20M62 112h36"/>' +
    '<path class="float" d="M112 28l3.4 8.6L124 40l-8.6 3.4L112 52l-3.4-8.6L100 40l8.6-3.4z"/>' +
    '<path class="float f2" d="M44 24l2.4 6.2 6.2 2.4-6.2 2.4-2.4 6.2-2.4-6.2-6.2-2.4 6.2-2.4z"/>',
  radar:
    '<g class="sweep"><path d="M80 66 80 13A53 53 0 0 1 126 39z" fill="currentColor" stroke="none" opacity="0.13"/>' +
    '<path d="M80 66 80 13"/></g>' +
    '<circle class="ring" cx="80" cy="66" r="20"/>' +
    '<circle class="ring r2" cx="80" cy="66" r="35"/>' +
    '<circle class="ring r3" cx="80" cy="66" r="50"/>' +
    '<circle cx="80" cy="66" r="3" fill="currentColor" stroke="none"/>' +
    '<circle cx="118" cy="93" r="4" fill="currentColor" stroke="none"/>' +
    '<circle cx="45" cy="38" r="3" fill="currentColor" stroke="none"/>' +
    '<circle cx="106" cy="46" r="2.6" fill="currentColor" stroke="none"/>',
  vault:
    '<rect x="42" y="32" width="76" height="68" rx="13"/>' +
    '<circle cx="80" cy="66" r="17"/><circle cx="80" cy="66" r="4"/>' +
    '<path d="M80 49v-5M80 88v-5M63 66h-5M102 66h-5"/>' +
    '<path d="M54 32v-7M106 32v-7"/>' +
    '<path class="float" d="M124 92l2.6 6.6 6.6 2.6-6.6 2.6-2.6 6.6-2.6-6.6-6.6-2.6 6.6-2.6z"/>',
  bookings:
    '<rect x="26" y="30" width="108" height="76" rx="14"/><path d="M26 52h108"/><path d="M52 20v20M108 20v20"/>' +
    '<path d="M50 72h34M50 88h22"/><circle cx="115" cy="84" r="15"/><path d="M109 84l4 4 8-8"/>',
  search:
    '<circle cx="68" cy="66" r="32"/><path d="M92 90l24 24"/>' +
    '<path d="M52 58c2-8 8-13 16-14"/><path d="M56 76h20M62 86h12"/>',
  bookings_empty:
    '<rect x="30" y="26" width="100" height="80" rx="14"/><path d="M30 50h100"/><path d="M56 16v20M104 16v20"/><path d="M56 72h48M70 88h20"/>',
  disputes:
    '<path d="M80 22v86"/><path d="M36 40h88"/><path d="M36 40 22 74a17 17 0 0 0 28 0z"/><path d="M124 40l-14 34a17 17 0 0 0 28 0z"/><path d="M60 111h40"/>',
  requests:
    '<rect x="30" y="30" width="100" height="74" rx="14"/><path d="M48 56h44M48 72h30"/>' +
    '<path d="M104 88l10 10 18-20"/>',
  money:
    '<circle cx="80" cy="66" r="34"/><path d="M92 54c-2.6-3.4-6.6-5.2-11.4-5.2-6.2 0-10.6 3.4-10.6 8.4 0 11.4 22.8 5.6 22.8 17.4 0 5.6-4.8 9.2-11.4 9.2-5.2 0-9.6-2.2-12.2-5.6"/><path d="M80 38v56"/>',
};

/* =========================================================
 * Scenes — the larger drawings: the home trade strip, the
 * service cards and the empty states. Vector art, so it is
 * sharp on any screen and a few hundred bytes rather than a
 * photograph; each animates with transform and opacity only.
 * ========================================================= */
let __sid = 0;
function uid(prefix) {
  __sid += 1;
  return prefix + __sid;
}

/* Drop an existing 24x24 glyph into a scene at any size. */
function glyph(name, x, y, size, cls) {
  return '<g transform="translate(' + x + " " + y + ") scale(" + size + ')" stroke-width="1.9"' +
    (cls ? ' class="' + cls + '"' : "") + ">" + ICONS[name] + "</g>";
}

const SCENES = {
  /* Barbing: a barber pole whose stripes travel, scissors and a comb. */
  barb: function () {
    const clip = uid("pole");
    let bands = "";
    for (let k = 0; k < 9; k++) {
      const y = -20 + k * 22;
      bands += '<path d="M78 ' + y + " L122 " + (y - 34) + " L122 " + (y - 18) + " L78 " + (y + 16) + ' Z"/>';
    }
    return '<defs><clipPath id="' + clip + '"><rect x="78" y="24" width="44" height="92" rx="22"/></clipPath></defs>' +
      '<g clip-path="url(#' + clip + ')"><g class="pole" fill="currentColor" fill-opacity="0.18" stroke="none">' +
      bands + "</g></g>" +
      '<rect x="78" y="24" width="44" height="92" rx="22"/>' +
      '<path d="M78 43h44M78 97h44" opacity="0.45"/>' +
      glyph("scissors", 22, 60, 1.65, "snip") +
      '<path d="M148 32v80M148 45h21M148 61h21M148 77h21M148 93h21" opacity="0.8"/>' +
      '<path class="spark f2" d="M40 24l2.4 6 6 2.4-6 2.4-2.4 6-2.4-6-6-2.4 6-2.4z"/>' +
      '<path class="spark" d="M166 104l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>';
  },

  /* Hair: a swatch of flowing strands, a comb through them and a shine that
     travels the length of the hair. */
  hair: function () {
    const xs = [62, 76, 90, 104, 118, 132];
    let strands = "";
    xs.forEach(function (x, i) {
      const d = "M" + x + " 24c9 18 -9 30 0 48 9 18 -9 30 0 46";
      strands += i % 2
        ? '<path class="soft" d="' + d + '"/>'
        : '<path d="' + d + '"/>';
    });
    return strands +
      '<path d="M54 34c-6 20 4 34-2 52" opacity="0.4"/><path d="M142 30c8 22-2 34 4 52" opacity="0.4"/>' +
      '<path d="M46 30h104" opacity="0.3"/>' +
      '<path class="shine" d="M118 20c8 14-8 24 0 38" stroke-width="5"/>' +
      glyph("comb", 30, 34, 1.7, "sway") +
      '<path class="spark" d="M56 118l2.4 6 6 2.4-6 2.4-2.4 6-2.4-6-6-2.4 6-2.4z"/>' +
      '<path class="spark f2" d="M158 96l2.2 5.4 5.4 2.2-5.4 2.2-2.2 5.4-2.2-5.4-5.4-2.2 5.4-2.2z"/>';
  },

  /* Nails: an open hand with painted tips and a bottle of polish. */
  nails: function () {
    const fingers = [[66, 56], [90, 44], [114, 50], [138, 64]];
    let hand = '<path d="M58 122v-16a12 12 0 0 1 12-12h76a12 12 0 0 1 12 12v16z"/>';
    let tips = "";
    fingers.forEach(function (f) {
      hand += '<rect x="' + f[0] + '" y="' + f[1] + '" width="18" height="' + (94 - f[1]) + '" rx="9"/>';
      tips += '<rect x="' + (f[0] + 3) + '" y="' + (f[1] + 3) + '" width="12" height="16" rx="6"/>';
    });
    return '<g class="glint" fill="currentColor" fill-opacity="0.32" stroke="none">' + tips + "</g>" +
      '<rect x="158" y="62" width="18" height="38" rx="9" transform="rotate(22 167 100)"/>' +
      hand +
      '<rect x="18" y="66" width="30" height="48" rx="7"/>' +
      '<path d="M28 66V54a6 6 0 0 1 12 0v12" opacity="0.75"/>' +
      '<rect x="32" y="42" width="12" height="14" rx="3"/>' +
      '<path d="M27 82h12v18H27z" fill="currentColor" fill-opacity="0.2" stroke="none"/>' +
      glyph("brush", 84, 14, 1.4, "sway") +
      '<path class="spark" d="M32 112l2.2 5.6 5.6 2.2-5.6 2.2-2.2 5.6-2.2-5.6-5.6-2.2 5.6-2.2z"/>';
  },

  /* Spa: a bowl of steam, a candle and a sprig. */
  spa: function () {
    return '<path d="M58 74h56a28 28 0 0 1-28 28 28 28 0 0 1-28-28z"/>' +
      '<path d="M64 106h44l-6 10H70z"/>' +
      '<path d="M58 74h56"/>' +
      '<g class="steam"><path d="M70 62c-6-8 6-12 0-20"/></g>' +
      '<g class="steam s2"><path d="M86 58c-6-8 6-12 0-20"/></g>' +
      '<g class="steam s3"><path d="M102 62c-6-8 6-12 0-20"/></g>' +
      '<path d="M140 44h20v62h-20z"/>' +
      '<path d="M150 44v-6" opacity="0.6"/>' +
      '<path class="flame" d="M150 20c5 6 7 9 7 13a7 7 0 0 1-14 0c0-4 2-7 7-13z"/>' +
      '<path class="soft" d="M36 104c-6-10 2-22 12-24 2 10-2 20-12 24z"/>' +
      '<path class="soft" d="M36 104c-10 2-18-4-20-14 10-2 18 4 20 14z"/>' +
      '<path class="spark" d="M172 30l2.2 5.6 5.6 2.2-5.6 2.2-2.2 5.6-2.2-5.6-5.6-2.2 5.6-2.2z"/>';
  },
};

/* 200x140 artboard, stroked in currentColor. */
function scene(name, cls) {
  const build = SCENES[name];
  if (!build) return "";
  return '<svg class="scene' + (cls ? " " + cls : "") + '" viewBox="0 0 200 140" fill="none" stroke="currentColor" ' +
    'stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    build() + "</svg>";
}

function icon(name, cls) {
  const d = ICONS[name];
  if (!d) return "";
  return '<svg class="icon' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + d + "</svg>";
}

/* Icon + label in one unit — used wherever a button needs a glyph. */
function iconLabel(name, text, cls) {
  return icon(name, cls) + (text ? '<span>' + esc(text) + "</span>" : "");
}

function illus(name, cls) {
  const d = ILLUSTRATIONS[name];
  if (!d) return "";
  return '<svg class="illus' + (cls ? " " + cls : "") + '" viewBox="0 0 160 132" fill="none" stroke="currentColor" ' +
    'stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + d + "</svg>";
}

/* Static markup declares icons as placeholders (<span data-icon="pin">)
   so the glyph paths live in exactly one place. */
function hydrateIcons(root) {
  const scope = root && root.querySelectorAll ? root : document;
  scope.querySelectorAll("[data-icon]").forEach(function (el) {
    if (el.dataset.hydrated === "1") return;
    el.innerHTML = icon(el.dataset.icon);
    el.dataset.hydrated = "1";
  });
  scope.querySelectorAll("[data-illus]").forEach(function (el) {
    if (el.dataset.hydrated === "1") return;
    el.innerHTML = illus(el.dataset.illus);
    el.dataset.hydrated = "1";
  });
}

/* Every screen renders itself by writing innerHTML, so instead of calling
   hydrateIcons by hand after each render, watch the DOM and fill in any new
   placeholder. One observer, no per-render bookkeeping. */
function observeIcons() {
  if (typeof MutationObserver !== "function") return;
  const obs = new MutationObserver(function (records) {
    for (let i = 0; i < records.length; i++) {
      const added = records[i].addedNodes;
      for (let j = 0; j < added.length; j++) {
        const node = added[j];
        if (node.nodeType !== 1) continue;
        if (node.dataset && (node.dataset.icon || node.dataset.illus)) hydrateIcons(node.parentNode || document);
        else if (node.querySelector && node.querySelector("[data-icon],[data-illus]")) hydrateIcons(node);
      }
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
  hydrateIcons(document);
}

/* An empty state: one drawing, a line of copy, and an optional hint. */
function emptyState(illustration, title, hint) {
  return '<div class="emptyState">' + illus(illustration) +
    "<p>" + esc(title) + "</p>" +
    (hint ? "<small>" + esc(hint) + "</small>" : "") + "</div>";
}
