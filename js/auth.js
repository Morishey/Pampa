/* =========================================================
 * Pampa — auth — the two doors
 * Sign up and sign in, password hashing, roles, trades, push binding and logout.
 * ========================================================= */

/* ---------- Auth flow ---------- */
const OTP_CODE = "1234";

/* The two ways to arrive: work on Pampa, or book on it. Chosen once at
   onboarding, carried on the account, and changeable later from the profile
   because plenty of people are both. */
const ROLES = [
  { id: "pro", ico: "briefcase", name: "I work in beauty", note: "Take bookings, get paid through escrow", tag: "Professional" },
  { id: "client", ico: "user", name: "I want to book", note: "Find pros near me and hold a slot", tag: "Client" }
];

let roleDraft = "client";

function roleById(id) {
  return ROLES.find(function (r) { return r.id === id; }) || null;
}

function renderRoles() {
  $("#roleList").innerHTML = ROLES.map(function (r, i) {
    const active = roleDraft === r.id;
    return '<button class="roleCard' + (active ? " active" : "") + '" data-role="' + r.id + '" style="--i:' + i + '">' +
      '<span class="roleIco">' + icon(r.ico) + "</span>" +
      '<span class="roleInfo"><b>' + esc(r.name) + "</b><small>" + esc(r.note) + "</small></span>" +
      '<span class="roleTag">' + esc(r.tag) + "</span>" +
      (active ? '<span class="tradeCheck">' + icon("check") + "</span>" : "") +
      "</button>";
  }).join("");
}

function openRole() {
  roleDraft = (state.user && state.user.role) || "client";
  renderRoles();
  renderAuthKicker();
  showPage("role");
}

/* Two doors, and they do not share a corridor at all. **Create account**
   verifies a number with a code, then sets a password. **Sign in** asks for
   that identifier and that password — one screen, no code, ever: the code is
   only ever the price of admission to a new account.

   The one account that needs a way through is one made before passwords
   existed. It has no credential to check and no code is coming, so it is
   handed the only honest door left in a device-local app: set a password now,
   once, and it is yours from then on. That is stated on the screen rather
   than implied, because nothing about it can be verified without a server. */
let authMode = "signin";

const AUTH_COPY = {
  signin: {
    number: {
      title: 'Welcome back,<br>sign in',
      sub: 'Your username or email, and your password.<br>No code needed.'
    },
    otp: { title: 'Enter the code<br>we sent you', lead: 'Sent to' },
    password: {
      title: 'Set a new<br>password',
      note: 'This account was made before passwords — set one now and sign in with it from here on.'
    },
    name: null
  },
  signup: {
    number: {
      title: 'Can we get <br>your number ?',
      sub: 'We’ll text you a code to verify you’re really you.<br>Messages and data rates may apply.<span class="blue"> Resend code</span><span id="counter"></span>'
    },
    otp: { title: 'Enter the code<br>we sent you', lead: 'Sent to' },
    password: {
      title: 'Create a<br>password',
      note: 'This is what you’ll sign in with from now on — codes are only for setting up an account.'
    },
    name: { title: 'What should we<br>call you ?' }
  }
};

/* Steps are per path, not per mode: a client's onboarding genuinely has one
   screen fewer than a professional's, and the bar should not advertise a trade
   step a client will never see. Choosing "I work in beauty" therefore grows the
   bar from five to six — which is the honest picture. */
const AUTH_STEPS = {
  signin: ["Sign in"],
  signupPro: ["Number", "Code", "Name", "Password", "Role", "Trade", "Area"],
  signupClient: ["Number", "Code", "Name", "Password", "Role", "Area"]
};

function authStepPath() {
  if (authMode === "signin") return AUTH_STEPS.signin;
  const pro = roleDraft === "pro" || (state.user || {}).role === "pro";
  return pro ? AUTH_STEPS.signupPro : AUTH_STEPS.signupClient;
}

/* Positions are read from the step list itself rather than counted by hand, so
   adding a step cannot silently shift the bar. Every path runs number → otp →
   name → password → role, a professional's adds trade, and they all end on
   area — so the last entry is always the location screen. */
function authStepIndex(steps) {
  const order = ["number", "otp", "name", "password", "role"];
  if (steps.length >= 7) order.push("trade");
  order.push("location");
  const at = {};
  order.forEach(function (key, i) { at[key] = i; });
  return at;
}

/* Step chips for the current mode. A finished step keeps its number so the
   eye can count progress; only the current step carries the gold. The trade
   and area screens only count as steps while onboarding — opened from the
   profile they are edits, and the kicker gets out of the way. */
function renderAuthKicker() {
  const steps = authStepPath();
  const idx = authStepIndex(steps);
  $$(".authKicker").forEach(function (bar) {
    const page = bar.closest("#number, #otp, #name, #password, #role, #trade, #location");
    if (!page) return;
    const editing = (page.id === "trade" && tradeDraft.context !== "signup") ||
      (page.id === "location" && locContext !== "onboarding") ||
      (page.id === "password" && passwordContext === "change");
    bar.style.display = editing ? "none" : "";
    if (editing) return;
    const at = idx[page.id];
    const mode = bar.querySelector(".authMode");
    if (mode) mode.textContent = authMode === "signin" ? "Sign in" : "Create account";
    const chips = bar.querySelector(".authSteps");
    if (chips) {
      /* a one-screen sign-in has nothing to count down, so the bar states the
         mode and drops the numbers rather than showing a lonely "1" */
      chips.innerHTML = steps.length < 2 ? "" : steps.map(function (label, j) {
        const cls = j === at ? " cur" : (j < at ? " done" : "");
        return '<span class="authStep' + cls + '">' + (j + 1) + "</span>";
      }).join("");
    }
  });
}

/* Re-label the shared auth screens for the mode. Titles are written with <br>
   and an inline link, so this goes through innerHTML — the strings above are
   the only thing that ever reaches it. */
function applyAuthCopy() {
  const copy = AUTH_COPY[authMode];
  if (!copy) return;
  const set = function (id, html) {
    const el = document.getElementById(id);
    if (el && html !== undefined) el.innerHTML = html;
    else if (el && html === null) el.style.display = "none";
  };
  if (copy.number) {
    set("numberTitle", copy.number.title);
    set("numberSub", copy.number.sub);
  }
  if (copy.otp) {
    set("otpTitle", copy.otp.title);
    const lead = document.getElementById("otpLead");
    if (lead) lead.textContent = copy.otp.lead;
  }
  if (copy.name) set("nameTitle", copy.name.title);
  if (copy.password) {
    set("passwordTitle", copy.password.title);
    set("passwordNote", copy.password.note);
  }
  const send = document.getElementById("sendOtp");
  if (send) send.textContent = authMode === "signup" ? "Next" : "Sign in";
  const verify = document.getElementById("verifyOtp");
  if (verify) verify.textContent = "Verify";
  applyAuthFields();
  renderAuthKicker();
}

/* One number screen, two jobs. Step 1 of sign-up takes a phone number, with
   the dial code; the sign-in door takes one identifier — a number or the name
   the account was created under — and then a password. The fields follow the
   job, so neither door is ever shown the other's inputs. */
function applyAuthFields() {
  const signingIn = authMode === "signin";
  const phoneRow = $("#signupPhoneRow");
  const idRow = $("#signinIdRow");
  const pwRow = $("#signinPwRow");
  const pw = $("#signinPassword");
  if (phoneRow) phoneRow.style.display = signingIn ? "none" : "flex";
  if (idRow) idRow.style.display = signingIn ? "flex" : "none";
  if (pwRow) pwRow.style.display = signingIn ? "flex" : "none";
  if (pw && !signingIn) pw.value = "";
  if (!signingIn) {
    const id = $("#signinId");
    if (id) id.value = "";
  }
}

function authPagesGo(target) {
  showPage(target);
}

/* The door decides the mode, and the mode alone decides everything after it:
   there is no separate "via" for the screens to disagree about. */
function setAuthMode(mode) {
  authMode = mode === "signup" ? "signup" : "signin";
  /* the explanation belongs to the sign-in door it was written for */
  if (authMode !== "signin") hideSessionNote();
  applyAuthCopy();
  const pw = $("#signinPassword");
  if (pw) pw.value = "";
  showPage("number");
  const first = authMode === "signin" ? $("#signinId") : $("#telephone");
  if (first && !first.value) first.focus();
}

/* The number screen's button, which means two things now: sign in, or start a
   sign-up. Only the second one has a code in it. */
function sendOtp() {
  if (authMode === "signin") {
    submitSignin();
    return;
  }
  const phone = $("#telephone").value.replace(/\D/g, "");
  if (phone.length < 7) {
    toast("Enter a valid phone number");
    return;
  }
  /* The code itself is the demo's, but asking for one is a round trip, and the
     screen says "we'll text you" — so it waits like one. A screen that claims
     to have texted somebody in the same millisecond is the kind of lie that
     makes the rest of it look fake too. */
  const btn = $("#sendOtp");
  setBusy(btn, true);
  beginWork();
  setTimeout(function () {
    setBusy(btn, false);
    endWork();
    state.draft.phone = "+234 " + phone;
    $("#otpPhone").textContent = state.draft.phone;
    $$(".otp-input").forEach(function (i) { i.value = ""; });
    $("#otpError").style.display = "none";
    showPage("otp");
    $$(".otp-input")[0].focus();
  }, 550);
}

/* ---------- Passwords ---------- */
/* A salted hash, not the password itself. This is still a device-local demo —
   there is no server to verify against, and a hash in localStorage is not a
   security boundary — but it does mean the accounts book never holds a
   password in the clear, which is the part that would otherwise survive into a
   real backend as a habit. */
function makeSalt() {
  const bytes = new Uint8Array(12);
  if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.prototype.map.call(bytes, function (b) {
    return ("0" + b.toString(16)).slice(-2);
  }).join("");
}

function hashPassword(password, salt) {
  const plain = String(salt || "") + "\u0000" + String(password || "");
  const subtle = window.crypto && window.crypto.subtle;
  if (subtle && window.TextEncoder) {
    return subtle.digest("SHA-256", new TextEncoder().encode(plain)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) {
        return ("0" + b.toString(16)).slice(-2);
      }).join("");
    }).catch(function () { return fallbackHash(plain); });
  }
  return Promise.resolve(fallbackHash(plain));
}

/* Used only when SubtleCrypto is unavailable (an old browser, or a context the
   page is not allowed to use it in). Weak on purpose-of-last-resort, and it
   says so rather than pretending to be SHA-256. */
function fallbackHash(plain) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < plain.length; i++) {
    const c = plain.charCodeAt(i);
    h1 = (h1 ^ c) * 16777619 >>> 0;
    h2 = (h2 + c * (i + 1)) >>> 0;
  }
  return "fb" + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}

function setAccountPassword(acc, password) {
  return new Promise(function (resolve) {
    if (!acc) { resolve(false); return; }
    const salt = makeSalt();
    hashPassword(password, salt).then(function (hash) {
      acc.salt = salt;
      acc.hash = hash;
      saveAccounts();
      resolve(true);
    });
  });
}

function passwordMatches(acc, password) {
  if (!acc || !acc.hash) return Promise.resolve(false);
  return hashPassword(password, acc.salt).then(function (hash) {
    return hash === acc.hash;
  });
}

/* The local part of a number typed any way at all: with the country code in
   front of it, with spaces, with the trunk zero or without one. Every account
   on the device is keyed "+234 " + this, so a returning client who types the
   number exactly as the app saved it — "+234 0805…" — must land on the same
   account as the one who types the bare local part. */
function localDigits(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  /* 234 is the country code, and no Nigerian local number starts with it, so
     stripping it can never eat part of a number that was already local */
  if (d.length > 10 && d.indexOf("234") === 0) d = d.slice(3);
  return d;
}

/* What the account was created with, typed one way: a username or an email,
   and — because every account that already exists was made with one — a phone
   number too. Names are not unique, so a shared one is reported rather than
   guessed at. */
function accountByIdentifier(id) {
  const raw = String(id || "").trim();
  if (!raw) return { acc: null, reason: "empty" };
  const key = raw.toLowerCase();

  /* An @ settles what was typed before the digits get a say. Without this an
     email with enough digits in it — chidi1234567@mail.com — has them pulled
     out, is read as a phone number, and lands on whoever owns those digits.
     An email is never a number: the database's own normaliser reads it the
     same way, so the two halves agree on what the same string means. */
  if (key.indexOf("@") !== -1) {
    const hits = Object.keys(accounts).filter(function (p) {
      return (accounts[p].email || "").toLowerCase() === key;
    });
    return hits.length ? { acc: accounts[hits[0]], phone: hits[0] } : { acc: null, reason: "none" };
  }

  const digits = localDigits(raw);
  if (digits.length >= 7) {
    const acc = accountByPhone("+234 " + digits);
    return acc ? { acc: acc, phone: "+234 " + digits } : { acc: null, reason: "none" };
  }
  const hits = Object.keys(accounts).filter(function (p) {
    return (accounts[p].name || "").toLowerCase() === key;
  });
  if (!hits.length) return { acc: null, reason: "none" };
  if (hits.length > 1) return { acc: null, reason: "ambiguous" };
  return { acc: accounts[hits[0]], phone: hits[0] };
}

/* The shape an email has to have. Kept beside the door that asks for one:
   the same check runs on the server, and this is the half that answers before
   a round trip. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function looksLikeEmail(v) {
  return String(v || "").indexOf("@") !== -1;
}

/* The password door: one screen, two fields, and no code anywhere in it. The
   one identifier field takes a username or an email — one of the two, not
   both, and never two fields to fill in. */
function submitSignin() {
  hideSessionNote();
  const id = $("#signinId").value.trim();
  const password = $("#signinPassword").value;
  if (!id) { toast("Enter your username or email"); return; }
  /* An address that could not be one is said now: sending it to the server
     would only come back as "no such account", which blames the wrong thing. */
  if (looksLikeEmail(id) && !EMAIL_SHAPE.test(id)) {
    toast("That email doesn’t look right");
    const field = $("#signinId");
    if (field) field.select();
    return;
  }
  if (!password) { toast("Enter your password"); return; }

  /* With a database behind the app, the check is the database's: the password
     is compared against the hash Postgres holds, not the one this device
     remembers, and the answer is a session token. The device's own book is
     only reached when there is no network to ask — it is a cache of who has
     signed in here, not the authority on who they are. */
  if (dbConfigured()) {
    const btn = $("#sendOtp");
    setBusy(btn, true);
    beginWork();
    db.login(id, password).then(function (res) {
      setBusy(btn, false);
      endWork();
      dbSessionSet(res);
      const acc = dbAdoptAccount(res.account);
      if (!acc) { toast("That account came back incomplete — try again"); return; }
      state.draft.phone = acc.phone || id;
      /* signInReturning lands the session on its dashboard, and entering the
         app is where the sync runs — bookings, directory and flags in one
         pass — so nothing is fetched twice here. */
      signInReturning(acc);
    }).catch(function (e) {
      setBusy(btn, false);
      endWork();
      if (e && (e.code === "offline" || e.code === "no_database")) {
        signInFromDevice(id, password);
        return;
      }
      /* the server's own words when there are any; a session that died under
         the form is already explained on the sign-in screen, so this says
         nothing rather than saying it twice */
      toast(dbText(e, "That didn’t go through — try again"));
      const input = $("#signinPassword");
      if (input) {
        input.classList.add("shake");
        setTimeout(function () { input.classList.remove("shake"); }, 500);
        input.select();
      }
    });
    return;
  }
  signInFromDevice(id, password);
}

/* The device's own door, unchanged: the accounts book this browser has built
   up, checked against the salted hash it stored. It is what answers when the
   database is unreachable or was never configured. */
function signInFromDevice(id, password) {
  const found = accountByIdentifier(id);
  if (found.reason === "empty") { toast("Enter your username or email"); return; }
  if (!password) { toast("Enter your password"); return; }
  if (found.reason === "ambiguous") {
    toast("Two accounts share that name — sign in with your email or number");
    return;
  }
  if (!found.acc) {
    toast("No account on that username or email yet — let’s set one up");
    /* A number they can start from; an email cannot send them to a screen that
       wants a phone, so nothing is carried across for one. */
    const digits = localDigits(id);
    if (!looksLikeEmail(id) && digits.length >= 7) $("#telephone").value = digits;
    setAuthMode("signup");
    return;
  }
  const acc = found.acc;
  if (!acc.hash) {
    /* An account from before passwords existed. Nothing can be checked and no
       code is coming, so it takes the one honest route left on a device with
       no server: set the password now, and say so on the screen. */
    state.draft.phone = found.phone;
    pendingAccount = acc;
    toast("This account has no password yet — set one to sign in");
    openPassword("setup");
    return;
  }
  const btn = $("#sendOtp");
  setBusy(btn, true);
  beginWork();
  passwordMatches(acc, password).then(function (ok) {
    setBusy(btn, false);
    endWork();
    if (!ok) {
      toast("That password doesn’t match");
      const input = $("#signinPassword");
      if (input) {
        input.classList.add("shake");
        setTimeout(function () { input.classList.remove("shake"); }, 500);
        input.select();
      }
      return;
    }
    state.draft.phone = found.phone;
    signInReturning(acc);
  }, function () {
    setBusy(btn, false);
    endWork();
    toast("Could not check that password — try again");
  });
}

/* The code has exactly one job left: it is the first half of creating an
   account. Nothing on the sign-in door reaches this screen. */
function verifyOtp() {
  const code = $$(".otp-input").map(function (i) { return i.value; }).join("");
  if (code !== OTP_CODE) {
    $("#otpError").style.display = "block";
    return;
  }
  showPage("name");
  $("#userName").focus();
}

/* ---------- The password screen ---------- */
let passwordContext = "signup";   /* "signup" | "setup" | "change" */
let pendingAccount = null;        /* the account a "setup" password belongs to */

function openPassword(context) {
  passwordContext = context === "setup" || context === "change" ? context : "signup";
  const title = $("#passwordTitle");
  const note = $("#passwordNote");
  const row = $("#pwCurrentRow");
  const save = $("#pwSave");
  const current = $("#pwCurrent");
  const next = $("#pwNew");
  if (passwordContext === "change") {
    if (title) title.innerHTML = "Change your<br>password";
    if (note) note.textContent = "Enter your current password, then the one you want to use.";
    if (row) row.style.display = "flex";
    if (save) save.textContent = "Save password";
  } else if (passwordContext === "setup") {
    if (title) title.innerHTML = "Set a<br>password";
    if (note) note.textContent = "This account was made before passwords existed, so there is nothing to check against yet. Set one now — you’ll sign in with it from here on.";
    if (row) row.style.display = "none";
    if (save) save.textContent = "Set password & sign in";
  } else {
    if (title) title.innerHTML = "Create a<br>password";
    if (note) note.textContent = "This is what you’ll sign in with — codes are only for setting up an account.";
    if (row) row.style.display = "none";
    if (save) save.textContent = "Continue";
  }
  if (current) current.value = "";
  if (next) next.value = "";
  const err = $("#pwError");
  if (err) err.style.display = "none";
  renderAuthKicker();
  showPage("password");
  if (next) next.focus();
}

function pwError(msg) {
  const err = $("#pwError");
  const next = $("#pwNew");
  if (err) {
    err.textContent = msg;
    err.style.display = "block";
  }
  if (next) {
    next.classList.add("shake");
    setTimeout(function () { next.classList.remove("shake"); }, 500);
    next.focus();
  }
}

/* Writes the credential, then continues down whichever road arrived here. */
function applyPassword(password) {
  const finish = function () {
    if (passwordContext === "change") {
      toast("Password updated — use it the next time you sign in");
      renderProfile();
      enterApp();
      return;
    }
    if (passwordContext === "setup") {
      /* the account that had nothing to check against now has a password: it
         walks through the sign-in door it just came from */
      if (pendingAccount) {
        state.draft.phone = pendingAccount.phone || state.draft.phone;
        toast("Password set — signing you in");
        signInReturning(pendingAccount);
      }
      return;
    }
    toast("Welcome to Pampa, " + ((state.user || {}).name || "") + " — no code needed to sign in from now on");
    /* The account is not created in the database yet: role, trade and location
       are still ahead, and the server wants all of it in one call. The
       credentials are held in memory until the location screen saves, which
       is the last step of onboarding. */
    if (dbConfigured()) {
      dbArmRegistration(state.draft.phone, password, (state.user || {}).name || "");
    }
    openRole();
  };
  if (passwordContext === "change") {
    /* A server account's password is the server's, and this device has never
       held it — so the check has to happen where the hash is. It can: the door
       is pampa_change_password, it verifies the current password and refuses
       in words. Nothing called it. The branch below read the device-local book
       instead, found no entry for an account that had signed in from the
       server, and took the `if (!acc) return finish()` road — which toasts
       "Password updated" and changes nothing anywhere. The next sign-in still
       needed the old password, and the person had been told otherwise. */
    const cloud = typeof dbSignedIn === "function" && dbSignedIn() && typeof db !== "undefined"
      && typeof db.changePassword === "function";
    if (cloud) {
      const current = ($("#pwCurrent") || {}).value || "";
      if (!current) { pwError("Enter your current password"); return; }
      return db.changePassword(current, password).then(finish, function (e) {
        /* The server's own sentence — "That password does not match", "Use at
           least six characters" — belongs on the field it is about. A refusal
           the app has already explained elsewhere (a session that died on the
           way here) answers null, and saying nothing is right: the sign-in
           screen is already holding that line. */
        const words = typeof dbText === "function" ? dbText(e) : null;
        if (words) pwError(words);
      });
    }
    const acc = accountByPhone((state.user || {}).phone);
    if (!acc) { finish(); return; }
    /* An account with nothing to compare against simply gains one. */
    if (!acc.hash) {
      setAccountPassword(acc, password).then(finish);
      return;
    }
    const current = ($("#pwCurrent") || {}).value || "";
    if (!current) { pwError("Enter your current password"); return; }
    passwordMatches(acc, current).then(function (ok) {
      if (!ok) { pwError("That current password doesn’t match"); return; }
      setAccountPassword(acc, password).then(finish);
    });
    return;
  }
  const phone = passwordContext === "setup"
    ? ((pendingAccount || {}).phone || state.draft.phone)
    : (state.user || {}).phone;
  const acc = accountByPhone(phone) || ensureAccount(phone);
  setAccountPassword(acc, password).then(finish);
}

/* A sign-up that reached this screen has an account record already, because the
   name step wrote one. This is the belt to that pair of braces: if it is
   somehow missing, the record is created rather than the password vanishing. */
function ensureAccount(phone) {
  if (!phone) return null;
  if (!accounts[phone]) accounts[phone] = { name: (state.user || {}).name || "", role: "client" };
  return accounts[phone];
}

function savePassword() {
  const next = (($("#pwNew") || {}).value || "").trim();
  if (next.length < 6) { pwError("Password must be at least 6 characters"); return; }
  /* hashing is real work behind a real button: it says so while it runs */
  const btn = $("#pwSave");
  setBusy(btn, true);
  beginWork();
  const done = function () { setBusy(btn, false); endWork(); };
  Promise.resolve(applyPassword(next)).then(done, done);
}

/* Picks up exactly where this account last left off: name, trade, area. A
   provider lands back in pro mode with their trade intact, and their bookings
   reconnect because they are keyed to the same phone. */
function signInReturning(acc) {
  /* Merge, not clobber: the cloud layer (dbAdoptAccount) may already have
     written fields this call does not receive — above all serverId, the uuid
     every server booking is keyed by. Rebuilding state.user from the acc
     alone would silently drop the session's identity and send every booking
     made afterwards to the local ledger. */
  const prev = state.user || {};
  state.user = {
    name: acc.name,
    phone: acc.phone || state.draft.phone || prev.phone || "",
    role: acc.role || prev.role || (acc.trade ? "pro" : "client"),
    trade: acc.trade !== undefined ? acc.trade : (prev.trade || null),
    area: acc.area || prev.area || null,
    coords: acc.coords || prev.coords || null,
    coordsAccuracy: acc.coordsAccuracy || prev.coordsAccuracy || null,
    address: acc.address || prev.address || "",
    dp: acc.dp || prev.dp || "",
    /* The email is a way in, so a sign-in has to leave the account holding it:
       rebuilding the session without it would forget the address the person
       just used to get here. */
    email: acc.email || prev.email || "",
    serverId: acc.serverId || prev.serverId || undefined,
    remember: true
  };
  if (!state.user.serverId) delete state.user.serverId;
  save();
  /* A professional's public record is refreshed from the profile they just
     signed back into — the same refresh saving a trade, a bio or a location
     does — because that record is what clients book, and it has to carry their
     current area, the address a walk-in comes to, and whether they are taking
     new bookings. registerProviderSelf keeps the bio, the picture, the
     portfolio and the reputation when the session does not carry them. */
  if (state.user.trade) registerProviderSelf();
  enterApp();
  toast("Welcome back, " + acc.name);
}

function saveName() {
  const name = $("#userName").value.trim();
  if (!name) {
    toast("Tell us your name first");
    return;
  }
  state.user = { name: name, phone: state.draft.phone || "", remember: true };
  save();
  rememberAccount();
  /* the credential comes next, before the role the account will work under */
  openPassword("signup");
}

/* ---------- Trade screen ---------- */
const tradeDraft = { trade: null, context: "signup" };

function tradeById(id) {
  return TRADES.find(function (t) { return t.id === id; }) || null;
}

function openTrade(context) {
  tradeDraft.context = context === "update" ? "update" : "signup";
  tradeDraft.trade = (state.user && state.user.trade) || null;
  $("#tradeHint").textContent = tradeDraft.context === "signup"
    ? "What your clients will book you for."
    : "Change the trade you take jobs under.";
  $("#saveTrade").textContent = tradeDraft.context === "signup" ? "Continue" : "Save trade";
  renderTrades();
  renderAuthKicker();
  showPage("trade");
}

function saveRole() {
  const u = state.user;
  if (!u) { showPage("welcomePage"); return; }
  u.role = roleDraft;
  save();
  rememberAccount();
  if (roleDraft === "pro") {
    openTrade("signup");
  } else {
    /* a client skips the trade step: their onboarding is location only */
    openLocation("onboarding");
  }
}

function renderTrades() {
  const chosen = tradeDraft.trade;
  $("#tradeList").innerHTML = TRADES.map(function (t, i) {
    const active = chosen === t.id;
    return '<button class="tradeCard' + (active ? " active" : "") + '" data-trade="' + t.id + '" style="--i:' + i + '">' +
      '<span class="tradeIco">' + icon(t.ico) + "</span>" +
      '<span class="tradeInfo"><b>' + esc(t.name) + "</b><small>" + esc(t.note) + "</small></span>" +
      (active ? '<span class="tradeCheck">' + icon("check") + "</span>" : "") +
      "</button>";
  }).join("");
  /* the list just changed height: the bottom cue is a measurement, so it is
     taken here rather than left to a scroll that may never come */
  bindScrollCue($("#tradeList"));
}

function saveTrade() {
  if (state.user) {
    if (tradeDraft.trade) state.user.trade = tradeDraft.trade;
    else delete state.user.trade;
    /* the trade is what puts you in the directory */
    registerProviderSelf();
    save();
    rememberAccount();
  }
  if (tradeDraft.context === "signup") {
    openLocation("onboarding");
    return;
  }
  $("#trade").style.display = "none";
  $("#app").style.removeProperty("display");
  renderProfile();
  const t = tradeById(tradeDraft.trade);
  toast(t ? "You take jobs as " + t.name : "You are browsing as a client");
}

/* The push chain is only as good as its quietest link: permission (the user's
   yes), a registered worker (the shell), and a configured server. One status,
   one truth, wherever the question is asked. */
function pushStatusText() {
  if (!window.PampaPush) return { ok: false, text: "Push is unavailable in this browser." };
  if (!("Notification" in window) || Notification.permission === "denied") {
    return { ok: false, text: "Notifications are off or blocked — push rides on top of them." };
  }
  return window.PampaPush.state().then(function (s) {
    if (s.state === "unsupported" || s.state === "noworker") {
      return { ok: false, text: s.why || "Push is not available here yet." };
    }
    if (s.state === "prompt" || s.state === "unsubscribed") {
      return { ok: false, text: "Turn on notifications and Pampa will connect its push channel." };
    }
    return { ok: true, text: "Push is connected — news reaches this phone even with Pampa closed." };
  });
}

function renderPushStatus() {
  const el = $("#pushStatus");
  if (!el) return;
  if (!(window.PampaPush && (state.user || {}).phone)) { el.style.display = "none"; return; }
  el.style.display = "block";
  Promise.resolve(pushStatusText()).then(function (r) {
    el.textContent = r.text;
    el.classList.toggle("good", !!r.ok);
  });
}

function bindPushToAccount() {
  if (!window.PampaPush) return;
  window.PampaPush.ensureSubscribed(accountKey()).then(function (r) {
    renderPushStatus();
    /* one honest line if the reference server is not running: push is wired,
       it is just not configured on this machine */
    if (!r || !r.ok) {
      const el = $("#pushStatus");
      if (el && Notification.permission === "granted" &&
          (r.state === "unreachable" || r.state === "noworker")) {
        el.textContent = "Push is wired up — start the reference server (tools/push-server.js) to switch it on.";
        el.classList.remove("good");
      }
    }
  });
}

/* Every door this device opened for the account that is leaving, closed in one
   place — because there are two ways a session ends and only one of them used
   to do any of this. The person tapping Sign out is the obvious one. The other
   is the server ending it: a token revoked elsewhere, the sixty days running
   out, or the account deleted. That one used to leave the dashboard standing
   with nothing behind it, which is the whole reason this is a function. */
function tearDownSession() {
  state.user = null;
  state.view = "home";
  state.catFilter = "all";
  state.query = "";
  /* one account's expanded feed must not greet the next */
  actExpanded = false;
  actPullReset();
  /* nor should one account's news keep chiming over the next one's session,
     or its session clock keep redrawing the app behind a signed-out screen */
  stopNewsWatch();
  stopSessionWatch();
  clearReplyTarget();
  /* nor their open surfaces: the clip rail and any sheet on top of it would
     otherwise still be showing the previous account's clips and comments */
  if (typeof closeClipFeed === "function") closeClipFeed();
  /* nor the full-screen account surfaces: the escrow desk, the resolution desk
     and a provider's page all outlive a session unless they are closed here */
  if (typeof closeAccountSurfaces === "function") closeAccountSurfaces();
  const commentSheet = $("#commentSheet");
  if (commentSheet) { commentSheet.classList.remove("show"); commentSheet.style.display = "none"; }
  const overlay = $("#sheetOverlay");
  if (overlay) overlay.style.display = "none";
  /* nor their face: the nav avatar is cleared with the session that filled it */
  const nav = $("#homeAvatar");
  if (nav) {
    nav.innerHTML = "P";
    nav.setAttribute("aria-label", "Your profile");
  }
  /* The push registration was made for this account, so the server must not
     chime somebody else's phone with this one's news. It also must not be able
     to stop this teardown: a push module that throws (it reads a service
     worker the browser never gave it) would leave the person on their
     dashboard with a live session and no sign-in screen — the exact outcome
     signing out exists to prevent. So it is the one step here that is allowed
     to fail quietly. */
  try {
    if (window.PampaPush) window.PampaPush.unsubscribeAll();
  } catch (e) {
    console.warn("Pampa: push unsubscribe failed", e);
  }
  /* The device's half of signing out is done here; this is the server's — the
     token is revoked so it cannot be replayed, and the cloud caches this
     session filled are emptied with it. */
  if (typeof dbCloudSignOut === "function") dbCloudSignOut();
  const searchInput = $("#search");
  if (searchInput) searchInput.value = "";
  try { localStorage.removeItem(KEY); } catch (e) {}
  $("#app").style.display = "none";
  $("#userName").value = "";
  $("#telephone").value = "";
  $("#signinId").value = "";
  $("#signinPassword").value = "";
  pendingAccount = null;
  /* the accounts book survives logout on purpose — it is what lets the next
     sign-in skip onboarding */
  showPage("welcomePage");
}

function logout() {
  /* Signing out closes every door on this device — worth one confirmation.
     The teardown runs on the promise so the screen doesn't flash while the
     dialog is up. */
  pampaConfirm({
    title: "Sign out?",
    body: "You'll need to sign in again to reach your bookings and this device's session ends here.",
    confirmLabel: "Sign out",
  }).then(function (yes) {
    if (!yes) return;
    tearDownSession();
    toast("You have been logged out");
  });
}

/* A session the server has already ended. db.js reports it the moment any call
   comes back 28000 carrying a token — a revoked session, an expired one, or an
   account deleted out from under the app. There is nothing to confirm and
   nobody to warn: the person is looking at a dashboard whose every button is
   already refused, so the honest thing is to take them back to the sign-in
   screen and say why. Their handle is left in the field, because they are the
   one person we know is signing in next. */
function pampaSessionEnded() {
  const was = state.user || {};
  const lastId = was.username || was.phone || "";
  tearDownSession();
  /* The splash is still queued behind a boot-time restore: stand its timers
     down the way a restored session does, or the intro slides back over the
     sign-in screen a second after it opens. */
  dbSessionLanded = true;
  const intro = $(".intro");
  if (intro) intro.style.display = "none";
  setAuthMode("signin");
  /* Why the dashboard went away is said on the screen rather than in a toast:
     the person has a handle to type and a password to remember, and a message
     that has already faded by then explains nothing. */
  showSessionNote("Your session ended — sign in again.");
  const id = $("#signinId");
  if (id && !id.value && lastId) id.value = lastId;
}

/* ---------- The note the sign-in screen carries ---------- */
function showSessionNote(text) {
  const el = $("#sessionNote");
  if (!el) return;
  el.textContent = text;
  el.style.removeProperty("display");
}

function hideSessionNote() {
  const el = $("#sessionNote");
  if (el) el.style.display = "none";
}

