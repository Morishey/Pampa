/* =========================================================
 * Pampa — home — the client home page
 * The art on Home: the spotlight strip, the stories rail, the hero slider, the service and stylist grids.
 * ========================================================= */

/* The spotlight strip: professionals with real work on display, closest
   first. Seeded stylists carry curated portfolio images; a signed-in pro's
   own work rides along on their record. */
/* One helper, both axes: every scroller in the app announces what is past its
   edge the same way, and the stylesheet draws a cue for a side only when this
   says there is something on it.

     hasOverflowX + moreL/moreR   a row that runs sideways
     hasOverflowY + moreT/moreB   a list that runs down

   `hasOverflowX` / `hasOverflowY` mean "this box can scroll at all" — the
   fact is measured, never assumed, so a row that fits and a list that fits
   both show nothing. The
   two axes stay separate classes because the mask that draws each one is
   different, and neither is applied where it is not needed. */
function updateScrollCue(el) {
  if (!el || !el.classList) return;
  const maxX = el.scrollWidth - el.clientWidth;
  const maxY = el.scrollHeight - el.clientHeight;
  const ox = maxX > 4;
  const oy = maxY > 4;
  el.classList.toggle("hasOverflowX", ox);
  el.classList.toggle("moreL", ox && el.scrollLeft > 4);
  el.classList.toggle("moreR", ox && el.scrollLeft < maxX - 4);
  el.classList.toggle("hasOverflowY", oy);
  el.classList.toggle("moreT", oy && el.scrollTop > 4);
  el.classList.toggle("moreB", oy && el.scrollTop < maxY - 4);
}

/* Declaring a scroller: the class is what the delegated listener looks for,
   and the measure happens here and now because nothing has scrolled yet, so
   no scroll event is coming. */
function bindScrollCue(el) {
  if (!el) return;
  el.classList.add("cueScroll");
  updateScrollCue(el);
  /* A box measured while it is hidden reports "fits" — it has no height yet,
     so nothing is past its edge — and no scroll event will ever come to
     correct it, because nobody can scroll a list they cannot see. A
     ResizeObserver is the honest fix: it fires when the box appears, when it
     is re-laid out, and when the window resizes, which is every case where
     the measurement taken above could go stale without a scroll. */
  if (window.ResizeObserver && !el.__cueObserver) {
    el.__cueObserver = new ResizeObserver(function () { updateScrollCue(el); });
    el.__cueObserver.observe(el);
  }
}

/* What the horizontal strips call from their render paths — a re-render can
   change the width without any scroll happening. */
function bindStripScroll(box) {
  bindScrollCue(box);
}

/* The scrollers that are not reachable from one of the render paths above
   still have to answer "is there more?" — a row inside a sheet is rebuilt
   every time the sheet opens, which is exactly when nobody remembers to bind
   it. */
function bindStripIn(root, selector) {
  const row = root && root.querySelector ? root.querySelector(selector) : null;
  bindScrollCue(row);
}

/* The spotlight drifts sideways on its own — a slow stories-rail crawl — and
   stops the moment a reader touches it, resuming only after they have left it
   alone for a while. Disabled when the strip has nothing to scroll to or when
   the device asks for reduced motion. */
let spotAuto = { timer: null, pausedUntil: 0, dir: 1, carry: 0 };

function spotAutoTick() {
  const strip = $("#storyStrip");
  if (!strip) return;
  if (document.hidden || Date.now() < spotAuto.pausedUntil) return;
  if (strip.scrollWidth - strip.clientWidth < 8) return;
  const max = strip.scrollWidth - strip.clientWidth;
  /* ~20px/s: sub-pixel steps are truncated by the browser and the strip
     never moves, so fractional progress is carried between ticks */
  spotAuto.carry += spotAuto.dir * 1;
  const step = Math.trunc(spotAuto.carry);
  if (!step) return;
  spotAuto.carry -= step;
  let next = strip.scrollLeft + step;
  if (next >= max) { next = max; spotAuto.dir = -1; }
  if (next <= 0) { next = 0; spotAuto.dir = 1; }
  strip.scrollLeft = next;
}

function spotAutoStart() {
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (spotAuto.timer) return;
  spotAuto.timer = setInterval(spotAutoTick, 50);
}

function spotAutoPause(ms) {
  spotAuto.pausedUntil = Date.now() + (ms || 8000);
}

function spotAutoWire() {
  const strip = $("#storyStrip");
  if (!strip || strip.__spotAutoWired) return;
  strip.__spotAutoWired = true;
  const pause = () => spotAutoPause();
  strip.addEventListener("pointerdown", pause, { passive: true });
  strip.addEventListener("touchstart", pause, { passive: true });
  strip.addEventListener("wheel", function () { spotAutoPause(12000); }, { passive: true });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) spotAutoPause(4000);
  });
}

/* renderStories — the spotlight rail — lives in js/status.js: it is the stories
   rail now, one ephemeral ring per professional, and the auto-drift helpers just
   above are what it crawls with. */

/* ---------- Featured slider ----------
   Real photography, one slide per trade. Images are sized by srcset so a phone
   never fetches more pixels than it can show, are lazily loaded after the
   first, and arrive as AVIF/WebP (auto=format) at q60. Each slide keeps its
   trade's vector scene behind the photo: that is the placeholder while the
   photo is in flight, and the whole slide if the photo never arrives, so a
   slow or offline device shows composed art rather than an empty grey box. */
const PHOTO_CDN = "https://images.unsplash.com/";

const HERO_SLIDES = [
  { cat: "barb", photo: "photo-1503951914875-452162b0f3f1", eyebrow: "Barbing",
    title: "Fresh fades, walk-in ready", sub: "Home or studio · from " + naira(1500) },
  { cat: "hair", photo: "photo-1519699047748-de8e457a634e", eyebrow: "Hair",
    title: "Braids, weaves & styling", sub: "Knotless braids from " + naira(15000) },
  { cat: "nails", photo: "photo-1604654894610-df63bc536371", eyebrow: "Nails",
    title: "Sets that hold up", sub: "Manicure & pedicure from " + naira(5000) },
  { cat: "spa", photo: "photo-1600334089648-b0d9d3028eb2", eyebrow: "Spa",
    title: "Wind down at home", sub: "Massage & facials from " + naira(10000) }
];

/* 16:9 crops at three widths — 420 covers a phone, 760 and 1100 cover the
   same slide on a wide screen at 1x and on a retina phone at 2x. */
const HERO_WIDTHS = [[420, 236], [760, 428], [1100, 619]];

function photoSrc(id, w, h) {
  return PHOTO_CDN + id + "?auto=format&fit=crop&q=60&w=" + w + "&h=" + h;
}

function photoSrcset(id) {
  return HERO_WIDTHS.map(function (d) { return photoSrc(id, d[0], d[1]) + " " + d[0] + "w"; }).join(", ");
}

function heroSlides() {
  const a = (state.user && state.user.area) ? areaById(state.user.area) : null;
  const area = a ? a.name : null;
  const last = {
    cat: "all", photo: "photo-1562322140-8baeececf3df", eyebrow: "Near you",
    title: area ? "Stylists around " + area : "Stylists near you",
    sub: "Sorted by distance from your area"
  };
  /* a professional's Home carries only their own trade's slide; a client
     sees the whole market */
  const u = state.user || {};
  const mine = (u.role === "pro" && u.trade)
    ? HERO_SLIDES.filter(function (s) { return s.cat === u.trade; })
    : HERO_SLIDES;
  return mine.concat([last]);
}

function renderHero() {
  const slider = $("#heroSlider");
  if (!slider) return;
  bindStripScroll(slider);
  const slides = heroSlides();
  /* rebuild only when the area behind the last caption changed */
  const stamp = slides.length + "|" + slides[slides.length - 1].title;
  if (slider.dataset.stamp === stamp) return;
  slider.dataset.stamp = stamp;

  slider.innerHTML = slides.map(function (s, i) {
    return '<article class="heroSlide" data-hero="' + s.cat + '" aria-label="' + (i + 1) + ' of ' + slides.length + '">' +
        '<span class="heroStill" aria-hidden="true">' + scene(s.cat === "all" ? "hair" : s.cat, "still") + "</span>" +
        '<img class="heroImg" alt="" decoding="async"' +
          (i === 0 ? ' loading="eager" fetchpriority="high"' : ' loading="lazy"') +
          ' sizes="(max-width: 460px) 100vw, 420px" srcset="' + photoSrcset(s.photo) + '"' +
          ' src="' + photoSrc(s.photo, 760, 428) + '">' +
        '<span class="heroScrim" aria-hidden="true"></span>' +
        '<div class="heroCap">' +
          '<small>' + esc(s.eyebrow) + "</small>" +
          "<b>" + esc(s.title) + "</b>" +
          "<span>" + esc(s.sub) + "</span>" +
        "</div>" +
      "</article>";
  }).join("");

  const dots = $("#heroDots");
  if (dots) {
    dots.innerHTML = slides.map(function (_, j) {
      /* These are buttons that move a carousel, not tabs over panels, so they
         are announced as buttons — the current one carrying aria-current. */
      return '<button class="heroDot' + (j === 0 ? " on" : "") + '" data-hero-dot="' + j +
        '" type="button" aria-label="Slide ' + (j + 1) + ' of ' + slides.length + '"' +
        ' aria-current="' + (j === 0) + '"></button>';
    }).join("");
  }

  /* a photo that never arrives leaves the vector scene showing */
  $$("#heroSlider .heroImg").forEach(function (img) {
    const show = function () { img.classList.add("isLoaded"); };
    if (img.complete && img.naturalWidth) show();
    img.addEventListener("load", show);
    img.addEventListener("error", function () { img.style.display = "none"; });
  });

  slider.scrollLeft = 0;
  heroSync();
  heroAutoplay();
}

function heroIndex() {
  const slider = $("#heroSlider");
  if (!slider || !slider.clientWidth) return 0;
  return Math.round(slider.scrollLeft / slider.clientWidth);
}

function heroSync() {
  const slider = $("#heroSlider");
  if (!slider) return;
  const i = heroIndex();
  $$("#heroSlider .heroSlide").forEach(function (s, j) { s.classList.toggle("isActive", j === i); });
  $$("#heroDots .heroDot").forEach(function (d, j) {
    d.classList.toggle("on", j === i);
    d.setAttribute("aria-current", j === i ? "true" : "false");
  });
}

function heroTo(i) {
  const slider = $("#heroSlider");
  if (!slider) return;
  const n = $$("#heroSlider .heroSlide").length;
  if (n < 2) return;
  const target = ((i % n) + n) % n;
  slider.scrollTo({ left: target * slider.clientWidth, behavior: "smooth" });
}

/* Autoplay stops the moment someone touches the slider, and stays stopped for a
   while afterwards: nothing is more annoying than a carousel that fights the
   hand that is trying to read it. */
let heroTimer = null;
let heroHold = 0;

function heroAutoplay() {
  if (heroTimer) { clearInterval(heroTimer); heroTimer = null; }
  /* html.anim is set only while the tab is visible; the CSS motion gate uses
     the same switch, and reduced motion is dropped in the stylesheet. */
  if (!document.documentElement.classList.contains("anim")) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if ($$("#heroSlider .heroSlide").length < 2) return;
  heroTimer = setInterval(function () {
    if (document.hidden) return;
    if (Date.now() < heroHold) return;
    heroTo(heroIndex() + 1);
  }, 5200);
}

/* A provider with no history should not read as "0.0 · 0 jobs", and one who
   has just been reviewed should show it. */
function ratingHtml(p) {
  const s = ratingStats(p);
  if (s.avg) {
    const bits = [icon("star") + s.avg.toFixed(1)];
    if (p.jobs) bits.push(p.jobs + " job" + (p.jobs === 1 ? "" : "s"));
    if (s.reviews) bits.push(s.reviews + " review" + (s.reviews === 1 ? "" : "s"));
    return bits.join(" · ");
  }
  if (p.jobs) return p.jobs + " job" + (p.jobs === 1 ? "" : "s") + " · no ratings yet";
  return "New on Pampa";
}

/* Only a completed job builds a provider's record — a released escrow is the
   one event that means the work was actually done. */
function bumpProviderJobs(providerId) {
  const p = state.providers.find(function (x) { return x.id === providerId; });
  if (!p) return;
  p.jobs = (p.jobs || 0) + 1;
  saveDirectory();
}

function youTag(p) {
  return p && p.id === selfKey() ? ' <span class="youTag">You</span>' : "";
}

/* The three closest professionals, in the same group as the place they are
   measured from. Deliberately not the filtered list: the chips answer "who is
   nearest to me?", which a search for "nails" does not change, and they are
   deliberately not a second grid — three first names, a distance each, tapping
   through to the person. A professional's own Home gets nothing here: their
   trade is not a market to shop in. */
const NEAR_CHIP_COUNT = 3;

/* One chip. A professional who cannot take the work right now is still drawn
   as a chip — the row is answering "who is near me?", and a closer one who has
   quietly vanished from it reads as if he were not there at all — but the
   chip stops advertising a distance it cannot act on and says the reason
   instead. */
function nearChipHtml(p, first) {
  const km = kmToStudio(p);
  const busy = providerInSession(p);
  const open = providerBookable(p);
  /* One word on the chip, the whole sentence in its label: a chip is 100px wide
     and "busy" / "paused" are what a reader needs from it, while the title and
     the screen reader get the reason in full. */
  const why = busy ? "busy" : "paused";
  const full = busy ? "with a client right now" : "books paused";
  const noted = open ? nearText(km, p) : why;
  return '<button class="nearChip' + (first ? " first" : "") + (open ? "" : " blocked") +
    '" data-goto-pro="' + esc(p.id) +
    '" aria-label="' + esc(p.name + ", " + p.skill + ", " + (open ? noted : nearText(km) + ", " + full + " — cannot take a booking right now")) +
    '" title="' + esc(open ? p.name + " \u00b7 " + noted : p.name + " \u00b7 " + full) + '">' +
    avatarHtml(p, "chipAvatar") +
    "<b>" + esc(p.name.split(" ")[0]) + "</b>" +
    '<small' + (open ? "" : ' class="nearWhy"') + ">" + esc(noted) + "</small></button>";
}

function renderNearChips() {
  const strip = $("#nearChips");
  if (!strip) return;
  const mine = (state.user || {}).role === "pro";
  /* empty means gone, not an empty row: .nearChips:empty is display:none, so
     the group closes up instead of leaving a grid gap where the chips were */
  if (mine || !hasLocation()) {
    strip.innerHTML = "";
    return;
  }
  const all = allProviders().slice().sort(byNearestStudio)
    .filter(function (p) { return p.id !== selfKey(); });
  /* Nearest and free-now are two different questions, and this row answers the
     useful one: the closest professionals a client can actually book today,
     nearest first. A professional 0.3 km away who is holding somebody else's
     job is no answer at all, however close he is. */
  const open = all.filter(providerBookable);
  /* ...and the ones skipped for it are named rather than silently dropped,
     because "nobody nearer" and "the nearest one is busy" are very different
     things to be told. The one that earns a place on the row is the nearest
     professional who cannot take work and is closer than the furthest
     professional the row would otherwise show — a busier market further out
     is not a reason to say anything. */
  const edge = open.length
    ? kmToStudio(open[Math.min(open.length, NEAR_CHIP_COUNT) - 1])
    : null;
  const blocked = open.length
    ? all.filter(function (p) {
        if (providerBookable(p)) return false;
        const k = kmToStudio(p);
        if (k == null) return false;
        return edge == null || k < edge;
      }).slice(0, 1)
    : [];
  /* The named one takes the row's last seat rather than extending the row past
     what a phone shows: a chip that cannot be booked is worth seeing, but not
     worth pushing the swipe further for, so the row stays three wide and gives
     up its furthest bookable chip to say it. */
  const list = open.length
    ? open.slice(0, NEAR_CHIP_COUNT - blocked.length)
    : all.slice(0, NEAR_CHIP_COUNT); /* nobody free: who is near, and why not */
  if (!list.length && !blocked.length) {
    strip.innerHTML = "";
    return;
  }
  strip.innerHTML = list.map(function (p, i) { return nearChipHtml(p, i === 0); }).join("") +
    blocked.map(function (p) { return nearChipHtml(p, false); }).join("");
  bindStripScroll(strip);
}

function renderStylists() {
  const grid = $("#providerList");
  bindStripScroll(grid);
  /* the nearest three are rewritten with the list they sit above, so an area
     change or a new registration shows up in the chips too */
  renderNearChips();
  /* Everyone, nearest first — the whole point of the list — narrowed by the
     same chips and search that narrow the rest of the page, so "nails" shows
     the nail technicians and nothing else. */
  const q = (state.query || "").trim().toLowerCase();
  const matched = allProviders().slice().sort(byNearestStudio).filter(function (s) {
    const catOk = state.catFilter === "all" || (s.cats || []).indexOf(state.catFilter) !== -1;
    return catOk && providerMatches(s, q);
  });
  /* A professional who is live right now comes up the list: their tier sits
     above the rest, nearest-first within it, because a ring on the rail means
     there is something fresh to see and a booker will want them first. The
     badge on the card says which tier a card is in without a second read. */
  const live = matched.filter(function (s) { return statusItems(s).length; });
  const list = live.concat(matched.filter(function (s) { return !statusItems(s).length; }));
  /* the nearest badge follows the nearest professional, not the top slot: a
     live professional can hold the first card without being the closest */
  const nearestId = matched.length ? matched[0].id : null;

  const count = $("#proCount");
  if (count) {
    count.textContent = !hasLocation()
      ? "Set your area to sort by distance"
      : (list.length === 1
        ? "1 professional" + (live.length ? " · live now" : "")
        : list.length + " professionals \u00b7 nearest first" + (live.length ? " \u00b7 " + live.length + " live now" : ""));
  }
  renderStylistsHead();

  if (!list.length) {
    grid.innerHTML = '<div class="searchEmpty">' +
      emptyState("search", q ? "No one matches \u201c" + esc(q) + "\u201d" : "No professionals yet",
        q ? "Try a trade \u2014 barbing, braids, nails, spa \u2014 or clear the chips above."
          : "Professionals who register on Pampa appear here, nearest first.") + "</div>";
    return;
  }

  grid.innerHTML = list.map(function (s, i) {
    const km = kmToStudio(s);
    const covers = coversClient(s);
    const works = worksOf(s);
    /* What they do, and what they charge for it: the headline service's range
       is the number a client reads before they even open a booking. */
    const head = headlineServiceFor(s);
    const range = head ? rangeFor(s, head.id) : null;
    /* A professional who is not bookable right now stays in the list — their
       page, their prices and their work are still worth seeing — but the card
       says which of the two reasons it is: their own switch, or a client they
       are with. A session is not a pause, so it neither reads nor looks like
       one: they are working, and the card says who with. */
    const on = providerAvailable(s);
    const withClient = on ? providerInSession(s) : null;
    const open = on && !withClient;
    return (
      /* the card itself opens the profile on a tap; the Profile button is the
         accessible path, so the card is not given a button role */
      '<div class="stylistCard' + (s.id === selfKey() ? " mine" : "") + (open ? "" : on ? " busy" : " paused") +
        '" style="--i:' + i + '"' + ' data-provider="' + esc(s.id) + '">' +
      (hasLocation() && s.id === nearestId && s.id !== selfKey() ? '<span class="nearBadge">' + icon("pin") + "Nearest</span>" : "") +
      '<div class="provTop">' + avatarHtml(s) +
        '<div class="provInfo">' +
          "<h4>" + esc(s.name) + youTag(s) +
            (statusItems(s).length
              ? ' <span class="liveBadge" title="Live on the spotlight rail \u2014 tap their ring to watch"><i></i>Live</span>'
              : "") + "</h4>" +
          "<p>" + esc(s.skill) + "</p>" +
          /* the class has to agree with the words beside it: a provider whose
             only rating was earned on this device is not "new" any more */
          '<div class="stars' + (ratingStats(s).avg ? "" : " new") + '">' + ratingHtml(s) + "</div>" +
        "</div>" +
      "</div>" +
      '<div class="dist">' +
        (hasLocation()
          ? '<span class="distKm">' + icon("pin") + awayText(km, s) + "</span>" +
            '<span class="distMode' + (covers ? " on" : "") + '">' + (covers ? "Visits you" : "Studio only") + "</span>"
          : '<span class="distKm">' + icon("pin") + "Set location</span>") +
      (range && head
        ? '<span class="priceTag" title="' + esc(head.name + " — what they charge") + '">' +
            "<b>" + esc(rangeText(range)) + "</b><small>" + esc(head.name) + "</small></span>"
        : "") +
      (works.length ? '<span class="workTag">' + icon("gallery") + works.length + " work" + (works.length === 1 ? "" : "s") + "</span>" : "") +
      (open ? ""
        : withClient
          ? '<span class="distBusy">' + icon("clock") + "With a client</span>"
          : '<span class="distPaused">' + icon("clock") + "Not taking bookings</span>") +
      "</div>" +
      '<div class="cardActions">' +
        '<button class="bookBtn" data-book-stylist="' + s.id + '"' +
          (open ? ">Book</button>"
            : withClient
              ? ' disabled title="With a client right now">' + icon("clock") + " In session</button>"
              : ' disabled title="Not taking bookings right now">' + icon("clock") + " Paused</button>") +
        '<button class="ghostBtn" data-provider="' + esc(s.id) + '">Profile</button>' +
      "</div>" +
      "</div>"
    );
  }).join("");
}

/* The section head answers the search, so the page says what was found rather
   than what the section normally holds. */
/* the home chips strip gets the same more-to-a-side fades */
function bindHomeChips() {
  const chips = $("#homeChips");
  if (chips) bindStripScroll(chips);
}

function renderStylistsHead() {
  const h = $("#proHead");
  if (!h) return;
  const q = (state.query || "").trim();
  h.textContent = q ? "Professionals matching \u201c" + q + "\u201d" : "Closest to you";
}

/* The service catalogue is no longer a grid on Home — a client picks a person
   and the person's own services (priced by that person) are what the booking
   sheet opens on. `SERVICES` itself is untouched: the sheet, the escrow ledger
   and every booking already refer to it. */

