/* =========================================================
 * Pampa — confirm — one dialog for every decision worth a pause
 *
 * The app's destructive actions used to fire on the tap that asked for them:
 * a slip on "Cancel booking" cost the client their fee, a slip on "Log out"
 * signed them out mid-morning. Native confirm() would fix that, but it looks
 * like nothing else in the app and on some WebViews it is blocked entirely.
 *
 * This is one glass card in the app's own language: a title, a body that
 * names the consequence, and two buttons — Cancel, and the action in the
 * colour of its weight. It returns a promise, so a call site reads exactly
 * like the code it replaces:
 *
 *   if (!(await pampaConfirm({ title: "Cancel this booking?" }))) return;
 *   ...the thing itself...
 * ========================================================= */

/* Built once, shown many times. The card sits above every sheet (the desk,
 * the booking sheet, the story viewer all use z-index below this), because a
 * confirmation can be raised from inside any of them. */
let pampaConfirmEl = null;
let pampaConfirmResolve = null;

function pampaConfirmBuild() {
  const el = document.createElement("div");
  el.className = "confirmVeil";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.innerHTML =
    '<div class="confirmCard">' +
      '<h3 class="confirmTitle"></h3>' +
      '<p class="confirmBody"></p>' +
      '<div class="confirmActs">' +
        '<button class="confirmBtn ghost"></button>' +
        '<button class="confirmBtn main"></button>' +
      "</div>" +
    "</div>";

  const close = function (answer) {
    el.classList.remove("show");
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 220);
    const resolve = pampaConfirmResolve;
    pampaConfirmResolve = null;
    if (resolve) resolve(answer);
  };

  el.querySelector(".confirmBtn.ghost").addEventListener("click", function () { close(false); });
  el.querySelector(".confirmBtn.main").addEventListener("click", function () { close(true); });
  /* A tap on the darkness is a change of mind, the same as Cancel. */
  el.addEventListener("click", function (e) { if (e.target === el) close(false); });
  /* Escape answers no, like every dialog the platform draws. */
  el.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); close(false); }
  });

  document.body.appendChild(el);
  pampaConfirmEl = el;
  return el;
}

function pampaConfirm(opts) {
  const o = opts || {};
  const el = pampaConfirmEl && pampaConfirmEl.isConnected ? pampaConfirmEl : pampaConfirmBuild();
  /* A dialog raised while one is open answers the first as "no" — the second
     question deserves a fresh read, not a leftover promise. */
  if (pampaConfirmResolve) { pampaConfirmResolve(false); pampaConfirmResolve = null; }

  el.querySelector(".confirmTitle").textContent = o.title || "Are you sure?";
  el.querySelector(".confirmBody").textContent = o.body || "";
  const cancel = el.querySelector(".confirmBtn.ghost");
  const main = el.querySelector(".confirmBtn.main");
  cancel.textContent = o.cancelLabel || "Go back";
  main.textContent = o.confirmLabel || "Yes, continue";
  main.classList.toggle("danger", o.danger !== false);

  el.style.display = "flex";
  void el.offsetHeight;
  el.classList.add("show");
  main.focus();

  return new Promise(function (resolve) { pampaConfirmResolve = resolve; });
}
