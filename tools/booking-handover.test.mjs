/* =============================================================================
 * Pampa — the booking handover, guarded where it happens
 *
 * The bug this exists for: a booking confirmed from the booking sheet was
 * filed, and then the sheet simply stood there. No slide, no toast, no card —
 * and only ever for a booking this device had never seen before, which is
 * every booking the **server** mints, because the id arrives with the row.
 *
 * The cause was one line. `dbBookingStore` pushed the new row at `at === -1`
 * and then returned `state.bookings[at]`; `-1` is not an index, so it returned
 * `undefined`, and the sheet's handover — `if (stored) finish(stored.id)` —
 * never ran for exactly the bookings it was written for.
 *
 * So this drives the real thing, on the road that always took it: a client
 * standing on a professional's page that lives on the server, a slot chosen,
 * the confirm dialog answered. Then it asks what a person would see:
 *
 *   1. the handover ran, found the new card and flashed it
 *   2. the sheet has slid back down, and is really gone
 *   3. the overlay behind it went with it
 *   4. the professional's page it was booked from is out of the way
 *   5. the app has landed on the bookings list with the card in it
 *
 * and then it plants the old store back into the page and drives it again, to
 * prove the check still bites: with the bug restored the handover does not run
 * at all — no flash, no card, and the professional's page still standing. A
 * guard that cannot fail is decoration, which is why the render audit plants a
 * trap for the same reason.
 *
 * Two things this had to get right, both found by writing it:
 *
 *   · The flash is judged **at the moment the handover places it**, not a tick
 *     later. `openBookingDesk` renders the list, flashes the card it finds —
 *     and anything that re-renders the list afterwards (a `dbCloudSync`
 *     landing, which the drive's own `enterApp` sets off) throws that element
 *     away and takes the class with it. That race is the app's, not this
 *     guard's: here the app is given a moment to settle before the drive
 *     starts, so what is judged is the handover rather than a sync.
 *   · The two legs must start from the same place — home, nothing open —
 *     because the second one is the same drive with one thing broken.
 *
 *   node tools/booking-handover.test.mjs
 * ========================================================================== */

import { bootApp } from "./render-audit.mjs";

const same = (got, want) => JSON.stringify(got) === JSON.stringify(want);

/* ---------- What runs in the page -----------------------------------------
   The whole drive happens inside the page, in one expression, because the
   interesting moment is a single tick: `finish` closes the sheet and flashes
   the card together, and the flash is gone about a second later. Sampling it
   from outside would be a race; recording it from inside is an observation. */
const PAGE = `(function () {
  var waitFor = function (fn, ms) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        var ok = false;
        try { ok = !!fn(); } catch (e) {}
        if (ok || Date.now() - t0 > ms) return resolve(ok);
        setTimeout(poll, 20);
      })();
    });
  };

  /* A booking as the server hands it back — the shape pampa_booking_create
     returns, with an id this device has never seen, which is the only kind of
     row the bug ever missed. */
  var rowFor = function (id) {
    var at = new Date().toISOString();
    var day = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    return {
      id: id,
      serviceId: "cut", stylistId: "p:08000000111", stylistName: "Renda Pro",
      clientName: "Renda Client", clientPhone: "08000000222",
      date: day, time: "10:00",
      loc: "home", areaId: "surulere", areaName: "Surulere",
      address: "9 Renda Street, Surulere", studioAddress: "", studioAreaName: "",
      km: 1.2, kmPrecise: true, travelFee: 1200,
      price: 3500, total: 4700,
      offer: { price: 3500, at: at, by: "Renda Client" },
      priceRange: { min: 3000, max: 5000 },
      negotiation: { status: "open", rounds: [{ by: "client", price: 3500, note: "", at: at }] },
      status: "unpaid", proMarkedDone: false, pay: null,
      createdAt: at,
      history: [{ at: at, label: "Booking placed" }]
    };
  };

  window.__handover = async function (broken) {
    /* A signed-in client. The token is never used — the one call this flow
       makes is stubbed below — but holding one is what puts the sheet on the
       server road instead of the "sign in to book them" road, which is the
       branch the bug lived behind. */
    dbSessionSet({ token: "handover-guard".repeat(5), account: { id: "client-guard" } });
    state.user = { name: "Renda Client", phone: "08000000222", role: "client",
      area: "surulere", address: "9 Renda Street, Surulere",
      coords: { lat: 6.5, lng: 3.35 }, coordsAccuracy: 12 };
    save();
    if (document.getElementById("app").style.display === "none") enterApp();
    /* Entering the app starts its own cloud sync, which re-renders the lists
       when it lands. Waiting it out means what follows is judged against a
       settled app rather than against a sync arriving mid-drive. */
    await new Promise(function (r) { setTimeout(r, 1200); });

    /* The professional's page lives on the server: providerAccountId is what
       sends the booking down the road the server mints rows on. */
    state.providers.forEach(function (p) {
      if (p.id === "p:08000000111") p.providerAccountId = "p:08000000111";
    });

    /* Both legs start from the same place: home, nothing open. */
    if (typeof closeAllSheets === "function") closeAllSheets();
    else closeSheet();
    exitProviderProfile();
    await waitFor(function () { return !document.querySelector(".sheet.show"); }, 1500);
    state.view = "home";
    switchView("home");

    var id = "11111111-2222-4333-8444-" + String(Date.now()).slice(-12);
    db.createBooking = function () { return Promise.resolve(rowFor(id)); };

    /* The self-proof: the store exactly as it was — the row pushed, the wrong
       thing returned. */
    if (broken) {
      dbBookingStore = function (row) {
        var b = dbBookingIn(row);
        if (!b || !b.id) return null;
        var at = state.bookings.findIndex(function (x) { return x.id === b.id; });
        if (at === -1) state.bookings.push(b);
        else state.bookings[at] = Object.assign({}, state.bookings[at], b);
        save();
        return state.bookings[at];
      };
    }

    /* The handover itself is watched from inside, at the one moment it happens:
       whether it ran at all, whether the new card was there for it to find, and
       whether the card carried the flash when it left. */
    var handover = { ran: false, foundCard: false, flashed: false };
    var realOpen = openBookingDesk;
    openBookingDesk = function (arg) {
      handover.ran = true;
      var r = realOpen.apply(null, arguments);
      var card = document.querySelector('[data-bookcard="' + arg + '"]');
      var frame = card && card.closest(".bookingItem");
      handover.foundCard = !!card;
      handover.flashed = !!(frame && frame.classList.contains("cardFlash"));
      return r;
    };

    /* From the professional's page, which is where the report came from. */
    openProviderProfile("p:08000000111");
    var book = document.querySelector("#providerProfile [data-book-stylist]");
    if (!book) return { error: "no Book button rendered on the professional's page" };
    book.click();

    var sheet = document.getElementById("bookingSheet");
    if (!sheet.classList.contains("show")) return { error: "the booking sheet did not open" };

    var day = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    var free = SLOTS.filter(function (t) {
      return !slotBlockedBy(state.draft.stylistId, day, t, state.draft.serviceId);
    });
    if (!free.length) return { error: "no free slot to book" };
    state.draft.date = day;
    state.draft.time = free[0];
    renderSheet();
    confirmBooking();

    var main = document.querySelector(".confirmVeil .confirmBtn.main");
    if (!main) return { error: "the confirm dialog never opened" };
    main.click();

    /* The handover is the sheet sliding down, so that is what is waited on. */
    var closed = await waitFor(function () { return !sheet.classList.contains("show"); }, 4000);
    await waitFor(function () { return sheet.style.display === "none"; }, 2000);

    return {
      error: "",
      stored: state.bookings.filter(function (b) { return b.id === id; }).length,
      handover: handover,
      closed: closed,
      sheetDisplay: sheet.style.display,
      overlay: document.getElementById("sheetOverlay").style.display,
      profileDisplay: document.getElementById("providerProfile").style.display,
      providerView: state.providerView === undefined ? null : state.providerView,
      view: state.view,
      card: !!document.querySelector('[data-bookcard="' + id + '"]')
    };
  };

  return "armed";
})()`;

/* ---------- The run --------------------------------------------------------
   Exported so verify-db.mjs can carry it as a leg of the same sweep, and
   printing itself when run directly. */
export async function runHandoverGuard() {
  const app = await bootApp();
  if (app.skipped) return { skipped: true, why: app.why };

  const checks = [];
  const check = (section, name, got, want) => {
    checks.push({ section, name, got, want, ok: same(got, want) });
  };

  let armed = null, good = null, broken = null;
  try {
    armed = await app.cdp.evaluate(PAGE);
    good = await app.cdp.evaluate("window.__handover(false)");
    broken = await app.cdp.evaluate("window.__handover(true)");
  } catch (e) {
    checks.push({ section: "drive", name: "the drive ran", ok: false,
      got: String((e && e.message) || e), want: "no throw" });
  } finally {
    await app.close();
  }

  check("drive", "the page helpers installed", armed, "armed");

  const goodLeg = "the handover, on the road the server mints";
  if (!good || good.error) {
    check(goodLeg, "the drive reached the handover", (good && good.error) || null, "");
  } else {
    check(goodLeg, "the booking reached the ledger", good.stored, 1);
    check(goodLeg, "the handover ran", good.handover.ran, true);
    check(goodLeg, "it found the new card", good.handover.foundCard, true);
    check(goodLeg, "and flashed it", good.handover.flashed, true);
    check(goodLeg, "the sheet slid back down", good.closed, true);
    check(goodLeg, "and is really gone", good.sheetDisplay, "none");
    check(goodLeg, "the overlay went with it", good.overlay, "none");
    check(goodLeg, "the professional's page is out of the way", good.profileDisplay, "none");
    check(goodLeg, "and its state is cleared", good.providerView, null);
    check(goodLeg, "the app landed on the bookings list", good.view, "bookings");
    check(goodLeg, "the new card is in the list", good.card, true);
  }

  const planted = "the same drive with the old store planted back in";
  if (!broken || broken.error) {
    check(planted, "the planted leg ran", (broken && broken.error) || null, "");
  } else {
    check(planted, "the booking was still filed", broken.stored, 1);
    check(planted, "the handover never ran", broken.handover.ran, false);
    check(planted, "so nothing was flashed", broken.handover.flashed, false);
    check(planted, "the sheet still comes down", broken.closed, true);
    check(planted, "no card was rendered for it", broken.card, false);
    check(planted, "the app stayed where it was", broken.view, "home");
    check(planted, "and the professional's page is still standing", broken.profileDisplay, "flex");
  }

  return {
    skipped: false,
    browser: app.browser,
    checks,
    pass: checks.filter((c) => c.ok).length,
    fail: checks.filter((c) => !c.ok).length,
  };
}

if (process.argv[1] && process.argv[1].endsWith("booking-handover.test.mjs")) {
  const r = await runHandoverGuard();
  if (r.skipped) {
    console.log("SKIP  booking handover — " + r.why);
    process.exit(0);
  }
  console.log("\nPampa booking handover · " + r.browser.split(/[\\/]/).pop() + "\n");
  let section = "";
  for (const c of r.checks) {
    if (c.section !== section) { section = c.section; console.log("\n" + section); }
    console.log((c.ok ? "  ok   " : "  FAIL ") + c.name +
      (c.ok ? "" : "  (got " + JSON.stringify(c.got) + ", want " + JSON.stringify(c.want) + ")"));
  }
  console.log("\n" + r.pass + " passed, " + r.fail + " failed\n");
  process.exit(r.fail ? 1 : 0);
}
