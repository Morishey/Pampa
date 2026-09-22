/* =========================================================
 * Pampa — activity — news, from store to bell
 * The notification store, the URL routing a tap follows, and the bell sheet that lists it all.
 * ========================================================= */

/* ---------- Activity (notifications) ---------- */
/* Derived from the booking ledger rather than stored twice: every journal line
   already carries who it concerns and when it happened. Only the "seen"
   marker is persisted, once per account. */
const NOTIFY_KEY = "pampa.notify.v1";
/* `seen` is the unread marker, per account. `announced` is the same idea for
   notifications that leave the app: what this account has already been told. */
let notifyStore = { seen: {}, announced: {} };

function loadNotify() {
  try {
    const raw = localStorage.getItem(NOTIFY_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && typeof d.seen === "object") notifyStore.seen = d.seen || {};
      if (d && typeof d.announced === "object") notifyStore.announced = d.announced || {};
    }
  } catch (e) {
    console.warn("Pampa: activity unreadable", e);
  }
  if (!notifyStore || typeof notifyStore.seen !== "object") notifyStore.seen = {};
  if (typeof notifyStore.announced !== "object") notifyStore.announced = {};
}

function saveNotify() {
  try {
    localStorage.setItem(NOTIFY_KEY, JSON.stringify({ seen: notifyStore.seen, announced: notifyStore.announced }));
    return true;
  } catch (e) {
    console.warn("Pampa: activity not saved", e);
    return false;
  }
}

function accountKey() {
  return (state.user || {}).phone || "guest";
}

/* ---------- Deep links ----------
 * A notification should land on the thing it is about, not the app root.
 * Each news event describes its own destination as a tiny URL the app can
 * route after boot: #/b/<id> for a booking's desk, #/c/<clipId> for a clip,
 * #/c/<clipId>/comments to bring the comments up with it. The hash survives
 * a cold start, survives the service worker's client.navigate(), and needs
 * no history entries — the app is one page.
 */
function routeForEvent(e) {
  if (e.clipId) return "#/c/" + encodeURIComponent(e.clipId) + (e.kind === "comment" || e.kind === "reply" ? "/comments" : "");
  if (e.bookingId) return "#/b/" + encodeURIComponent(e.bookingId);
  return "";
}

function parseRoute(hash) {
  const h = String(hash || "").replace(/^#\/?/, "");
  if (!h) return null;
  const parts = h.split("/").map(decodeURIComponent);
  if (parts[0] === "b" && parts[1]) return { kind: "booking", id: parts[1] };
  if (parts[0] === "c" && parts[1]) return { kind: "clip", id: parts[1], comments: parts[2] === "comments" };
  return null;
}

/* One pass at boot (and after a notification tap navigates the page): run the
   route, then clean the URL so a reload or a share doesn't replay it. */
function consumeRoute() {
  if (!(state.user || {}).phone) return false; /* signed out: the hash waits for sign-in */
  const route = parseRoute(location.hash);
  if (!route) return false;
  if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
  if (route.kind === "booking") {
    openBookingDesk(route.id);
    return true;
  }
  openClipFromNotify(route.id, route.comments ? "comment" : "");
  return true;
}

/* The bell's rows, the system notifications and the reference push server all
   carry the same routing string, so a tap behaves the same wherever it came
   from. */
function showSystemNote(title, body, route) {
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  const options = {
    body: body || "",
    tag: "pampa",
    icon: "./img/icon-192.png",
    badge: "./img/icon-192.png",
    data: { url: route || "./" },
  };
  try {
    if (swRegistration && swRegistration.showNotification) {
      swRegistration.showNotification(title, options);
      return true;
    }
    new Notification(title, options);
    return true;
  } catch (e) {
    return false;
  }
}

function announceNews() {
  if (notifyPermission() !== "granted") return;
  const key = accountKey();
  if (!notifyStore.announced) notifyStore.announced = {};
  const cursor = notifyStore.announced[key] || "";
  const fresh = notifyEvents().filter(function (e) { return (e.at || "") > cursor; });
  if (!fresh.length) return;
  fresh.slice(0, 3).forEach(function (e, i) {
    setTimeout(function () {
      /* the page shows it while the app is open; the server shows it when the
         app is closed — both are attempted, whoever gets there first wins on
         the same tag */
      showSystemNote(e.title, e.detail, routeForEvent(e));
      announceByPush(e);
    }, i * 300);
  });
  notifyStore.announced[key] = fresh[0].at;
  saveNotify();
}

/* The push server's announcement: same news, one destination string, so the
   backend stays a dumb pipe and the app keeps ownership of what opens where. */
function announceByPush(e) {
  /* Device-local events reach the phone through the page while it is open; a
     push that arrives with the app closed is the backend's half. A real
     server journalling the same events would call its own /announce with
     exactly this payload shape — the reference server in tools/ is that
     shape, standing in for it. */
  if (!window.PampaPush || typeof window.PampaPush.announce !== "function") return;
  window.PampaPush.announce({
    title: e.title,
    body: e.detail,
    tag: "pampa-" + (e.clipId ? "clip" : "booking"),
    url: routeForEvent(e),
  });
}

/* Journal lines are written by this app, so their phrasing is a stable key.
   `sides` says whose feed the line belongs in. */
function noteKind(label) {
  const t = String(label || "");
  if (/^Client paid .* into escrow/.test(t)) return { kind: "paid", sides: ["client", "pro"] };
  if (/^Stylist accepted the job/.test(t)) return { kind: "accepted", sides: ["client"] };
  /* money on a booking can be answered as well as moved: a price the
     professional sends and the yes or no it comes back with are events each
     side needs to hear about */
  if (/^Stylist countered /.test(t)) return { kind: "counter", sides: ["client"] };
  if (/^Client accepted the counter/.test(t)) return { kind: "agreed", sides: ["client", "pro"] };
  if (/^Client declined the counter/.test(t)) return { kind: "counteroff", sides: ["pro"] };
  if (/^Cancelled before payment/.test(t)) return { kind: "cancelled", sides: ["client"] };
  if (/^Refunded /.test(t)) return { kind: "refunded", sides: ["client", "pro"] };
  if (/^Stylist marked the job done/.test(t)) return { kind: "done", sides: ["client"] };
  if (/^Client released /.test(t)) return { kind: "released", sides: ["pro"] };
  if (/^Client rated /.test(t)) return { kind: "rated", sides: ["pro"] };
  if (/^Client reported a problem/.test(t)) return { kind: "disputed", sides: ["pro"] };
  if (/^Stylist responded/.test(t)) return { kind: "response", sides: ["client"] };
  if (/^Desk refunded/.test(t)) return { kind: "refund", sides: ["client", "pro"] };
  if (/^Desk released/.test(t)) return { kind: "release", sides: ["client", "pro"] };
  if (/^Desk split escrow/.test(t)) return { kind: "split", sides: ["client", "pro"] };
  return null;
}

/* One line per event, phrased for the side of the trade you are on. */
function notifyCopy(kind, role, b, sv) {
  const other = role === "pro" ? (b.clientName || "A client") : (b.stylistName || "Your stylist");
  const amount = b.pay ? b.pay.amount : (b.total || 0);
  const where = (sv.name || "Booking") + " · " + b.date + " at " + b.time;
  switch (kind) {
    case "paid":
      return role === "pro"
        ? { icon: "lock", tone: "gold", title: "New booking request", detail: other + " paid " + naira(amount) + " into escrow for " + (sv.name || "a service") }
        : { icon: "lock", tone: "gold", title: "Held in escrow", detail: naira(amount) + " is held for " + where };
    case "accepted":
      return { icon: "check", tone: "ok", title: other + " accepted your booking", detail: where };
    case "counter":
      return { icon: "coin", tone: "gold", title: other + " sent a price",
        detail: naira(lastCounterOf(b)) + " for " + (sv.name || "your booking") + " \u2014 accept it or decline for a full refund" };
    case "agreed":
      return role === "pro"
        ? { icon: "check", tone: "ok", title: "Price agreed \u2014 the job is confirmed",
            detail: other + " accepted " + naira(agreedPriceOf(b)) + " \u00b7 " + where }
        : { icon: "check", tone: "ok", title: "Price agreed at " + naira(agreedPriceOf(b)),
            detail: other + " is on the job \u00b7 " + where };
    case "counteroff":
      return { icon: "refund", tone: "info", title: "Your price was declined",
        detail: other + " turned down " + naira(lastCounterOf(b)) + " \u2014 the booking is closed and nothing was charged" };
    case "done":
      return { icon: "wrench", tone: "gold", title: other + " marked the job done", detail: "Release " + naira(b.pay ? b.pay.netToPro : 0) + " once you are happy" };
    case "released":
      return { icon: "coin", tone: "ok", title: "Payment released to you", detail: other + " released " + naira(b.pay ? b.pay.netToPro : 0) + " · " + (sv.name || "a job") };
    case "rated":
      return { icon: "star", tone: "gold", title: other + " rated you", detail: where + " — see it on your profile" };
    case "disputed":
      return { icon: "alert", tone: "warn", title: "A problem was reported", detail: other + " froze " + naira(amount) + " on " + (sv.name || "a job") + " — file your side" };
    case "response":
      return { icon: "send", tone: "info", title: other + " filed their side", detail: "The resolution desk has both statements for " + (sv.name || "your booking") };
    case "refunded":
      return role === "pro"
        ? { icon: "refund", tone: "info", title: "Booking refunded", detail: other + " was refunded " + naira(b.refund ? b.refund.amount : 0) + " — " + (sv.name || "the job") + " is closed" }
        : { icon: "refund", tone: "info", title: "Refunded", detail: naira(b.refund ? b.refund.amount : 0) + " came back to you for " + (sv.name || "your booking") };
    case "cancelled":
      return { icon: "close", tone: "info", title: "Booking cancelled", detail: (sv.name || "Your booking") + " was cancelled before payment" };
    case "refund":
      return { icon: "scale", tone: "info", title: "Desk refunded the client", detail: role === "pro" ? "The dispute on " + (sv.name || "a job") + " ended in a refund" : naira(b.resolution ? b.resolution.toClient : 0) + " is on its way back to you" };
    case "release":
      return { icon: "scale", tone: "ok", title: "Desk released the payment", detail: role === "pro" ? "You were paid " + naira(b.resolution ? b.resolution.toPro : 0) + " for " + (sv.name || "a job") : "The dispute on " + (sv.name || "a booking") + " was settled in the stylist's favour" };
    case "split":
      return { icon: "scale", tone: "gold", title: "Desk split the escrow", detail: role === "pro" ? "You were paid " + naira(b.resolution ? b.resolution.toPro : 0) + " for " + (sv.name || "a job") : naira(b.resolution ? b.resolution.toClient : 0) + " came back to you for " + (sv.name || "a booking") };
    default:
      return { icon: "info", tone: "info", title: "Booking updated", detail: where };
  }
}

/* ---------- Clip news ---------- */
/* A like, a comment and a reply are events like any other: they happened, they
   concern somebody, and they carry a moment. They are read from the same store
   the rail writes to, so the bell can never disagree with the clip it is
   talking about. */

function clipTitle(clip) {
  if (!clip) return "your clip";
  const w = clip.work || {};
  return w.note || (clip.provider ? providerSkill(clip.provider) : "a clip");
}

function shortText(t, n) {
  const s = String(t || "");
  const max = n || 90;
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function wroteThis(by, byId, me, meName) {
  if (byId) return byId === me;
  return !!by && !!meName && by === meName;
}

function clipNews() {
  const me = viewerId();
  const meName = (state.user || {}).name || "";
  const owner = myProviderRecord();
  const ownerId = owner ? owner.id : selfKey();
  const out = [];
  allClips().forEach(function (clip) {
    const mineClip = String(clip.id).indexOf(ownerId + ":") === 0;
    if (mineClip) {
      /* somebody liked a clip of mine */
      likeEntries(clip.id).forEach(function (l) {
        if (!l.at || l.by === me) return;
        out.push({
          at: l.at, side: "pro", clipId: clip.id, kind: "like",
          icon: "heart", tone: "gold",
          title: nameOf(l.by, l.name) + " liked your clip",
          detail: clipTitle(clip),
        });
      });
      /* and anything said under it, re replies included */
      commentsFor(clip.id).forEach(function (c) {
        if (c.at && !wroteThis(c.by, c.byId, me, meName)) {
          out.push({
            at: c.at, side: "pro", clipId: clip.id, kind: "comment",
            icon: "chat", tone: "info",
            title: c.by + " commented on your clip",
            detail: shortText(c.text),
          });
        }
        (c.replies || []).forEach(function (r) {
          if (!r.at || wroteThis(r.by, r.byId, me, meName)) return;
          out.push({
            at: r.at, side: "pro", clipId: clip.id, kind: "reply",
            icon: "reply", tone: "info",
            title: r.by + " replied to " + c.by,
            detail: shortText(r.text),
          });
        });
      });
      return;
    }
    /* the other half of a conversation: a professional answered a client */
    commentsFor(clip.id).forEach(function (c) {
      if (!wroteThis(c.by, c.byId, me, meName)) return;
      (c.replies || []).forEach(function (r) {
        if (!r.at || wroteThis(r.by, r.byId, me, meName)) return;
        out.push({
          at: r.at, side: "client", clipId: clip.id, kind: "reply",
          icon: "reply", tone: "gold",
          title: r.by + " replied to your comment",
          detail: shortText(r.text) + " · " + clipTitle(clip),
        });
      });
    });
  });
  return out;
}

/* Somebody watched a status of mine and left something: a quick emoji or a
   short message. Read from the same social store the viewer writes to, filtered
   to the statuses that are still live — a story that has expired takes its
   news with it, exactly like the clip feed's ledger. */
function statusNews() {
  const me = myProviderRecord();
  if (!me) return [];
  const meKey = accountKey();
  const meName = (state.user || {}).name || "";
  const out = [];
  statusItems(me).forEach(function (s) {
    const t = statusThreadRead(s.id);
    (t.reactions || []).forEach(function (r) {
      if (!r.at || r.byId === meKey || (meName && r.by === meName)) return;
      out.push({
        at: r.at, side: "pro", kind: "statusLike", statusId: s.id,
        icon: "heart", tone: "gold",
        title: r.by + " reacted " + r.emoji + " to your status",
        detail: statusLeftText(s) ? "Live now \u00b7 " + statusLeftText(s) : "Your status",
      });
    });
    (t.messages || []).forEach(function (m) {
      if (!m.at || m.byId === meKey || (meName && m.by === meName)) return;
      out.push({
        at: m.at, side: "pro", kind: "statusMsg", statusId: s.id,
        /* the message keeps its own id and its author, so the desk can answer
           this exact sentence from the row it is sitting on */
        msgId: m.id || "", from: m.by,
        icon: "chat", tone: "info",
        title: m.by + " sent a message on your status",
        detail: shortText(m.text),
      });
    });
  });
  return out;
}

/* The client's half of the same conversation: a message they left on somebody's
   status is theirs, and the answer to it is their news. Read from the same
   store, and only while the status it is about is still live — an expired
   story takes its thread with it, exactly like the professional's side. */
function statusReplyNews() {
  const meKey = meStatusId();
  const out = [];
  Object.keys(statusSocial).forEach(function (sid) {
    const p = providerForStatusId(sid);
    if (!p || p.id === selfKey()) return; /* my own status is not news to me */
    const msgs = statusThreadRead(sid).messages || [];
    msgs.forEach(function (m) {
      if (!m.id || m.byId !== meKey) return;
      msgs.forEach(function (r) {
        if (!r.at || r.replyTo !== m.id || r.byId === meKey) return;
        out.push({
          at: r.at, side: "client", kind: "statusReply", statusId: sid,
          icon: "reply", tone: "gold",
          title: p.name + " replied to your message",
          detail: shortText(r.text, 90),
        });
      });
    });
  });
  return out;
}

function notifyEvents() {
  const phone = (state.user || {}).phone || "";
  const key = selfKey();
  const proId = proStore.proId;
  const out = [];
  state.bookings.forEach(function (b) {
    const isClient = (b.clientPhone || "") === phone;
    const isPro = b.stylistId === key || (!!proId && b.stylistId === proId);
    if (!isClient && !isPro) return;
    const sv = SERVICES.find(function (s) { return s.id === b.serviceId; }) || {};
    (b.history || []).forEach(function (h) {
      const info = noteKind(h.label);
      if (!info) return;
      const role = isPro && !isClient ? "pro" : "client";
      if (info.sides.indexOf(role) === -1) return;
      const copy = notifyCopy(info.kind, role, b, sv);
      out.push({
        at: h.at || b.createdAt || "",
        side: role,
        bookingId: b.id,
        icon: copy.icon,
        tone: copy.tone,
        title: copy.title,
        detail: copy.detail,
      });
    });
  });
  /* bookings and escrow on one side, clips and statuses on the other — one
     feed, and a status reply is news to whichever end of it did not write it */
  return out.concat(clipNews(), statusNews(), statusReplyNews())
    .sort(function (a, b) { return (b.at || "").localeCompare(a.at || ""); });
}

/* Which message the bell is answering right now, as `statusId|msgId`. It lives
   outside the DOM because the sheet is re-rendered on every toggle. */
let statusReplyTarget = "";

function unreadEvents() {
  const seen = notifyStore.seen[accountKey()] || "";
  return notifyEvents().filter(function (e) { return (e.at || "") > seen; });
}

function renderNotify() {
  const dot = $("#notifyDot");
  const btn = $("#notifyBtn");
  if (!dot || !btn) return;
  const n = unreadEvents().length;
  dot.style.display = n ? "flex" : "none";
  dot.textContent = n > 9 ? "9+" : String(n);
  btn.classList.toggle("hasUnread", n > 0);
  btn.setAttribute("aria-label", n ? "Activity, " + n + " unread" : "Activity");
}

function renderNotifySheet() {
  const all = notifyEvents();
  const seen = notifyStore.seen[accountKey()] || "";
  $("#notifySub").textContent = all.length
    ? all.length + " update" + (all.length === 1 ? "" : "s") + " on your bookings, clips and status"
    : "Everything that moved on your bookings, clips and status";
  $("#notifyBody").innerHTML = all.length
    ? '<div class="notifyList">' + all.slice(0, 40).map(function (e) {
        /* a booking event opens the booking; a clip event opens the clip it is
           about, with its comments already up; a status event plays the story */
        const go = e.clipId
          ? ' data-notifyclip="' + esc(e.clipId) + '" data-notifykind="' + esc(e.kind) + '"'
          : e.statusId
            ? ' data-notifystatus="' + esc(e.statusId) + '"'
            : ' data-notifygo="' + esc(e.bookingId) + '"';
        const unread = (e.at || "") > seen ? " unread" : "";
        const inner =
          '<span class="nIco ' + e.tone + '">' + icon(e.icon) + "</span>" +
          '<span class="nInfo"><b>' + esc(e.title) + "</b><small>" + esc(e.detail) + "</small>" +
            '<small class="nWhen">' + esc(fmtWhen(e.at)) +
              (e.clipId ? " · clip" : e.statusId ? " · status" : e.side === "pro" ? " · as stylist" : "") + "</small></span>" +
          '<span class="chev">' + icon("chevron") + "</span>";
        /* A client's message on a status is the one row in the feed that can be
           answered from where it is read: the reply opens under the row it
           belongs to, so the desk never has to walk to the story it is about. */
        if (e.kind === "statusMsg" && e.msgId && e.side === "pro") {
          const key = e.statusId + "|" + e.msgId;
          const open = statusReplyTarget === key;
          const done = statusRepliedTo(e.statusId, e.msgId);
          return '<div class="notifyItem">' +
            '<div class="notifyRow' + unread + '">' +
              '<button class="nMain"' + go + ">" + inner + "</button>" +
              (done && !open
                ? '<span class="nReplied">' + icon("check") + "Replied</span>"
                : '<button class="nReply" data-statusreply="' + esc(key) + '">' + (open ? "Cancel" : "Reply") + "</button>") +
            "</div>" +
            (open
              ? '<div class="nReplyBox">' +
                  '<input id="nReplyInput" type="text" maxlength="' + STATUS_MSG_MAX + '" autocomplete="off"' +
                    ' placeholder="Reply to ' + esc(e.from || "them") + '\u2026">' +
                  '<button class="nReplySend" data-statusreplysend="' + esc(key) + '" aria-label="Send reply">' + icon("send") + "</button>" +
                "</div>"
              : "") +
            "</div>";
        }
        return '<button class="notifyRow' + unread + '"' + go + ">" + inner + "</button>";
      }).join("") + "</div>"
    : emptyState("requests", "Nothing yet", "Requests, acceptances, escrow events — and reactions or messages on your status — land here as they happen.");
  renderNotifyPermit();
  bindNotifyReply();
}

/* The reply under an open row: the field takes the focus the moment the box
   appears, and Enter sends so the desk does not have to move its hand. */
function bindNotifyReply() {
  const el = $("#nReplyInput");
  if (!el) return;
  el.focus();
  el.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    sendReplyFromBell(statusReplyTarget);
  });
  const item = el.closest(".notifyItem");
  if (item && item.scrollIntoView) item.scrollIntoView({ block: "nearest" });
}

/* One path for a reply sent from the bell, whichever control sent it: the send
   button or the Enter key. */
function sendReplyFromBell(key) {
  const parts = String(key || "").split("|");
  const input = $("#nReplyInput");
  if (parts.length !== 2 || !input) return;
  const res = sendStatusReply(parts[0], parts[1], input.value);
  if (!res.ok) {
    toast(res.msg);
    return;
  }
  statusReplyTarget = "";
  const body = $("#notifyBody");
  const keep = body ? body.scrollTop : 0;
  renderNotifySheet();
  if (body) body.scrollTop = keep;
  toast("Sent \u2014 " + (res.to || "they") + " will see it in their bell");
}

/* Opening the clip a notification is about: the rail comes up on that clip and,
   when the news was a comment or a reply, the comments sheet opens over it with
   the composer ready. */
function openClipFromNotify(clipId, kind) {
  hideSheetEl("#notifySheet");
  openClipFeed({ clipId: clipId });
  if (kind !== "comment" && kind !== "reply") return;
  setTimeout(function () {
    if (!$("#clipFeed") || $("#clipFeed").style.display === "none") return;
    openComments(clipId);
  }, 120);
}

/* A news event about a booking lands on the booking itself: the right list,
   the right card, scrolled into view. A route that names a booking nobody on
   this device has ever seen (the demo strolled in on another account) falls
   through to the plain list rather than an error. */
function openBookingDesk(bookingId) {
  hideSheetEl("#notifySheet");
  const b = state.bookings.find(function (x) { return x.id === bookingId; });
  if (!b) { switchView("bookings"); return; }
  const isPro = (state.user || {}).role === "pro";
  if (isPro) switchView("work"); else switchView("bookings");
  const live = (state.statusFilter || "upcoming") === "upcoming" ? !bookingIsUpcoming(b) : bookingIsUpcoming(b);
  if (live) {
    const other = (state.statusFilter || "upcoming") === "upcoming" ? "past" : "upcoming";
    const chip = document.querySelector('.chip[data-status="' + other + '"]');
    if (chip) chip.click();
  }
  const card = document.querySelector('[data-bookcard="' + bookingId + '"]');
  if (card && card.scrollIntoView) {
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    card.classList.remove("cardFlash");
    void card.offsetWidth;
    card.classList.add("cardFlash");
  }
}

function openNotifySheet() {
  renderNotifySheet();
  showSheetEl("#notifySheet");
  notifyStore.seen[accountKey()] = new Date().toISOString();
  saveNotify();
  renderNotify();
}

