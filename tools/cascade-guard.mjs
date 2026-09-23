/* =============================================================================
 * Pampa — the cascade guard's engine
 *
 * The nav count badge shipped broken for weeks and nothing caught it, because
 * the bug was invisible to every check the app had: the markup was right, the
 * class was right, the component's own rule was right. What was wrong was that
 * a rule nobody had thought about out-ranked it.
 *
 *   css/polish.css    .tab > span { position: relative; }   
 *   css/directory.css .tabDot     { position: absolute; … }
 *
 * A broad rule (a subject that names no class, only a tag or *), anchored on an
 * ancestor, took the badge's geometry from the rule that named it — and the
 * badge fell into the tab's flex flow, half over the neighbouring tab. The fix
 * was to make the component's own rule win (span.tabDot) and to scope the shape
 * rule away from it (:not(.tabDot)).
 *
 * This file is that fence's *engine*: a real CSS parser (media blocks, strings,
 * comments, !important, selector lists), a selector matcher, specificity, and
 * the shorthand bookkeeping that lets inset: 0 compete with left: 0. Its
 * self-test fixtures drive the same runAudit the scan uses, and its LIVE_CHECK
 * snippet is the detector the render audit (tools/render-audit.mjs) runs inside
 * a real browser on every surface the app can show — which is the check that
 * ships. A static walk of the source cannot answer "does this selector ever
 * apply here": that is a question about rendered containment, so this file does
 * not gate on its own scan. It exports the parts that must agree across both
 * worlds and leaves the judging to the browser.
 * ========================================================================== */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { shippedFiles } from "./toast-guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/* ---------- The properties that move or size a box -----------------------
   A component's words, colours and backgrounds can be out-ranked without
   anybody noticing; its geometry cannot. These are the declarations whose
   outcome is visible as a broken layout. */
const FRAMING = new Set([
  "position", "top", "right", "bottom", "left",
  "inset", "inset-block", "inset-inline", "inset-block-start", "inset-block-end",
  "inset-inline-start", "inset-inline-end",
  "z-index", "transform", "translate", "scale", "rotate",
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "flex", "flex-basis", "flex-grow", "flex-shrink", "flex-wrap",
  "order", "grid-area", "grid-column", "grid-row", "align-self", "justify-self",
  "aspect-ratio", "overflow", "visibility", "opacity",
]);
const SPACING = new Set([
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "margin-block", "margin-inline", "margin-block-start", "margin-block-end",
  "margin-inline-start", "margin-inline-end",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "padding-block", "padding-inline", "padding-block-start", "padding-block-end",
  "padding-inline-start", "padding-inline-end",
  "gap", "row-gap", "column-gap",
]);
/* A shorthand covers every longhand it expands to, so `inset: 0` competes with
   `left: 0`. The audit walks longhands — a pair is judged on the one box edge
   both sides touch, whichever way each side writes it. */
const SHORTHAND = {
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  "margin-block": ["margin-block-start", "margin-block-end"],
  "margin-inline": ["margin-inline-start", "margin-inline-end"],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  "padding-block": ["padding-block-start", "padding-block-end"],
  "padding-inline": ["padding-inline-start", "padding-inline-end"],
  inset: ["top", "right", "bottom", "left"],
  "inset-block": ["inset-block-start", "inset-block-end"],
  "inset-inline": ["inset-inline-start", "inset-inline-end"],
  gap: ["row-gap", "column-gap"],
};
const AUDITED = new Set([...FRAMING, ...SPACING]);

/* What "floating" means for the verdict: a component that is taken out of the
   flow by its own rule, or named like one of the things that always is. */
const FLOATING_NAME = /(dot|badge|bubble|count|pill|chip|fab|toast|ring|live|pin|mark|tag)/i;

/* ---------- CSS parsing ---------------------------------------------------
   A parser for the subset this stylesheet set actually uses: comments,
   strings, nested @media and @supports, at-rules with blocks that hold no
   element selectors (@keyframes, @font-face, @page), selector lists, and
   declarations with !important. */
function lineIndex(text) {
  const nl = [];
  for (let k = 0; k < text.length; k++) if (text[k] === "\n") nl.push(k);
  return (idx) => {
    let lo = 0, hi = nl.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (nl[m] < idx) lo = m + 1; else hi = m; }
    return lo + 1;
  };
}

/* Split on `sep` at the top level, so a comma inside :is(...), [a=","] or
   url(...) does not cut a selector in half. */
export function splitTop(text, sep) {
  const out = [];
  let cur = "", depth = 0, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") { cur += text.slice(i, i + 2); i += 2; continue; }
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      while (j < text.length && text[j] !== q) { if (text[j] === "\\") j++; j++; }
      cur += text.slice(i, Math.min(j + 1, text.length));
      i = j + 1;
      continue;
    }
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ""; i++; continue; }
    cur += c;
    i++;
  }
  out.push(cur);
  return out;
}

export function parseCss(text, file) {
  const lineOf = lineIndex(text);
  const rules = [];
  const n = text.length;

  const skipString = (i, end) => {
    const q = text[i];
    i++;
    while (i < end) { if (text[i] === "\\") { i += 2; continue; } if (text[i] === q) return i + 1; i++; }
    return i;
  };
  const skipComment = (i, end) => {
    const j = text.indexOf("*/", i + 2);
    return j < 0 || j > end ? end : j + 2;
  };
  const skipParen = (i, end) => {
    let d = 0;
    while (i < end) {
      const c = text[i];
      if (c === "\\") { i += 2; continue; }
      if (c === '"' || c === "'") { i = skipString(i, end); continue; }
      if (c === "(") { d++; i++; continue; }
      if (c === ")") { d--; i++; if (!d) return i; continue; }
      i++;
    }
    return i;
  };
  /* the `}` matching the `{` at `open` (never a brace inside a string or url) */
  const blockEnd = (open, end) => {
    let d = 0, i = open;
    while (i < end) {
      const c = text[i];
      if (c === "\\") { i += 2; continue; }
      if (c === '"' || c === "'") { i = skipString(i, end); continue; }
      if (c === "/" && text[i + 1] === "*") { i = skipComment(i, end); continue; }
      if (c === "{") { d++; i++; continue; }
      if (c === "}") { d--; i++; if (!d) return i - 1; continue; }
      i++;
    }
    return end - 1;
  };

  const readDecls = (from, to, rule) => {
    let i = from, start = from;
    while (i <= to) {
      const c = i < to ? text[i] : ";";
      if (i < to) {
        if (c === '"' || c === "'") { i = skipString(i, to); continue; }
        if (c === "(") { i = skipParen(i, to); continue; }
        if (c === "/" && text[i + 1] === "*") { i = skipComment(i, to); continue; }
      }
      if (c === ";") {
        const raw = text.slice(start, i).trim();
        if (raw) {
          const at = text.indexOf(raw, start);
          /* the first colon that is not inside a comment or a string */
          let colon = -1, d = 0;
          for (let j = 0; j < raw.length; j++) {
            const r = raw[j];
            if (r === "(") d++;
            else if (r === ")") d--;
            else if (r === ":" && d === 0) { colon = j; break; }
          }
          if (colon > 0) {
            const prop = raw.slice(0, colon).trim().toLowerCase();
            let value = raw.slice(colon + 1).trim();
            const important = /!\s*important\s*$/i.test(value);
            if (important) value = value.replace(/!\s*important\s*$/i, "").trim();
            if (/^[\w*-]+$/.test(prop)) rule.decls.push({ prop, value, important, line: lineOf(at) });
          }
        }
        start = i + 1;
      }
      i++;
    }
  };

  const readRules = (from, to, media) => {
    let i = from, preludeStart = from;
    while (i < to) {
      const c = text[i];
      if (c === "/" && text[i + 1] === "*") {
        const at = i;
        i = skipComment(i, to);
        /* a comment before a selector is not part of it */
        if (!text.slice(preludeStart, at).trim()) preludeStart = i;
        continue;
      }
      if (c === '"' || c === "'") { i = skipString(i, to); continue; }
      if (c === "(") { i = skipParen(i, to); continue; }
      if (c === "{") {
        const prelude = text.slice(preludeStart, i).trim();
        const close = blockEnd(i, to);
        if (prelude.startsWith("@")) {
          const name = ((prelude.slice(1).match(/^[\w-]+/) || [""])[0]).toLowerCase();
          if (name === "media" || name === "supports") {
            const cond = prelude.slice(1 + name.length).trim();
            readRules(i + 1, close, media ? media + " and " + cond : cond);
          }
          /* @keyframes, @font-face, @page, @property hold no element selectors */
        } else if (prelude) {
          const rule = { file, media, selectorText: prelude, line: lineOf(preludeStart), decls: [] };
          readDecls(i + 1, close, rule);
          rule.selectors = splitTop(prelude, ",").map((s) => s.trim()).filter(Boolean);
          if (rule.selectors.length && rule.decls.length) rules.push(rule);
        }
        i = close + 1;
        preludeStart = i;
        continue;
      }
      if (c === ";" && text.slice(preludeStart, i).trim().startsWith("@")) {
        /* a statement at-rule: @import, @charset, @layer a, b; */
        i++;
        preludeStart = i;
        continue;
      }
      i++;
    }
  };

  readRules(0, n, "");
  return rules;
}

/* ---------- Selectors -----------------------------------------------------
   Each selector becomes compounds, left to right, with the combinator that
   precedes each one. */
export function parseSelector(text) {
  const compounds = [], combs = [];
  let cur = "", comb = null, depth = 0, i = 0;
  const flush = () => {
    if (!cur.trim()) { cur = ""; return; }
    compounds.push(parseCompound(cur.trim()));
    combs.push(comb);
    cur = "";
    comb = null;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") { cur += text.slice(i, i + 2); i += 2; continue; }
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      while (j < text.length && text[j] !== q) { if (text[j] === "\\") j++; j++; }
      cur += text.slice(i, Math.min(j + 1, text.length));
      i = j + 1;
      continue;
    }
    if (c === "[" || c === "(") { depth++; cur += c; i++; continue; }
    if (c === "]" || c === ")") { depth = Math.max(0, depth - 1); cur += c; i++; continue; }
    if (!depth && (c === ">" || c === "+" || c === "~")) { flush(); comb = c; i++; continue; }
    if (!depth && /\s/.test(c)) { if (cur.trim()) { flush(); comb = " "; } i++; continue; }
    cur += c;
    i++;
  }
  flush();
  return { compounds, combs, raw: text };
}

function parseCompound(text) {
  const c = { type: null, universal: false, id: [], classes: [], attrs: [], pseudoClasses: [], pseudoElement: null, raw: text };
  let i = 0;
  const lead = /^([\w-]+|\*)/.exec(text);
  if (lead) {
    if (lead[1] === "*") c.universal = true;
    else c.type = lead[1].toLowerCase();
    i = lead[0].length;
  }
  while (i < text.length) {
    const ch = text[i];
    if (ch === ".") {
      const m = /^\.([\w-]+)/.exec(text.slice(i));
      if (m) { c.classes.push(m[1]); i += m[0].length; continue; }
      i++; continue;
    }
    if (ch === "#") {
      const m = /^#([\w-]+)/.exec(text.slice(i));
      if (m) { c.id.push(m[1]); i += m[0].length; continue; }
      i++; continue;
    }
    if (ch === "[") {
      const end = text.indexOf("]", i);
      c.attrs.push(text.slice(i, end < 0 ? text.length : end + 1));
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (ch === ":") {
      if (text[i + 1] === ":") {
        const m = /^::([\w-]+)/.exec(text.slice(i));
        c.pseudoElement = m ? m[1].toLowerCase() : "";
        i += m ? m[0].length : 2;
        continue;
      }
      const m = /^:([\w-]+)(\(([^)]*)\))?/.exec(text.slice(i));
      if (!m) { i++; continue; }
      c.pseudoClasses.push({ name: m[1].toLowerCase(), arg: m[3] || null });
      i += m[0].length;
      continue;
    }
    i++;
  }
  return c;
}

const specOf = (sel) => {
  let a = 0, b = 0, c = 0;
  for (const comp of sel.compounds) {
    a += comp.id.length;
    b += comp.classes.length + comp.attrs.length;
    if (comp.type) c++;
    if (comp.pseudoElement) c++;
    for (const p of comp.pseudoClasses) {
      if (p.name === "not" || p.name === "is" || p.name === "matches" || p.name === "any" || p.name === "has") {
        let best = { a: 0, b: 0, c: 0 };
        for (const inner of splitTop(p.arg || "", ",")) {
          const s = specOf(parseSelector(inner.trim()));
          if (compareSpec(s, best) > 0) best = s;
        }
        a += best.a; b += best.b; c += best.c;
        continue;
      }
      if (p.name === "where") continue;
      b++;
    }
  }
  return { a, b, c };
};

const compareSpec = (x, y) => (x.a - y.a) || (x.b - y.b) || (x.c - y.c);

/* The compound that decides which element a rule is about. */
const subject = (sel) => sel.compounds[sel.compounds.length - 1];

/* A rule written for a component: its subject names a class of that element. */
const namesAClass = (sel, el) => subject(sel).classes.some((c) => el.classes.includes(c));

/* A rule written for a shape: no class, no id, no pseudo-element on the
   subject — only a tag, `*`, and pseudo-classes like :not(...). */
const isBroad = (sel) => {
  const s = subject(sel);
  return !s.classes.length && !s.id.length && !s.pseudoElement && !s.attrs.length;
};

const typeCouldMeet = (sel, el) => {
  const s = subject(sel);
  if (!s.type) return true;                 /* a universal subject meets any tag */
  if (!el.tag) return true;                 /* the tag is not knowable from source */
  return s.type === el.tag;
};

/* `:not(.tabDot)` is how the fix keeps a shape rule off a component, so the
   guard has to honour it: an element carrying the excluded class is not a
   candidate for that rule. Only predicates decidable from the descriptor are
   decided — everything else stays possible. */
function excludedBy(sel, el) {
  for (const p of subject(sel).pseudoClasses) {
    if (p.name !== "not") continue;
    for (const inner of splitTop(p.arg || "", ",")) {
      const comp = parseCompound(inner.trim());
      if (comp.pseudoElement) continue;
      if (comp.type && el.tag && comp.type !== el.tag) continue;
      if (comp.type && !el.tag) continue;
      if (comp.classes.length && !comp.classes.every((c) => el.classes.includes(c))) continue;
      if (comp.id.length && !comp.id.every((id) => el.id === id)) continue;
      if (comp.attrs.length || comp.pseudoClasses.some((q) => q.name !== "not")) continue;   /* undecidable */
      if (!comp.type && !comp.classes.length && !comp.id.length && !comp.universal) continue;
      return true;
    }
  }
  return false;
}

/* ---------- What the app renders -----------------------------------------
   Every element the app can put on a screen, read from the markup in
   index.html and the template strings in js/*.js — the union of all surfaces,
   so a component built only on, say, the dispute sheet is audited too. */
function tagBefore(text, at) {
  const open = text.lastIndexOf("<", at);
  if (open < 0) return null;
  if (text[open + 1] === "/" || text[open + 1] === "!") return null;
  const m = /^<([a-zA-Z][\w:-]*)/.exec(text.slice(open, open + 48));
  return m ? m[1].toLowerCase() : null;
}

export function collectElements(base = root) {
  const seen = new Map();
  const add = (tag, classes, file, line, dynamic) => {
    if (!classes.length) return;
    const key = (tag || "?") + "|" + [...classes].sort().join(".");
    if (seen.has(key)) return;
    seen.set(key, { tag, classes, id: null, file, line, dynamic: !!dynamic });
  };

  for (const full of shippedFiles(base)) {
    let text;
    try { text = readFileSync(full, "utf8"); } catch (e) { continue; }
    const name = relative(base, full).split(sep).join("/");
    const lineOf = lineIndex(text);

    const attr = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = attr.exec(text)) !== null) {
      const raw = m[2] !== undefined ? m[2] : m[3];
      const dynamic = /[$`{}]/.test(raw);
      const classes = raw.split(/\s+/).map((t) => t.trim()).filter((t) => t && /^[\w-]+$/.test(t));
      add(tagBefore(text, m.index), classes, name, lineOf(m.index), dynamic);
    }

    /* classes handed to an existing element in script */
    const api = /classList\s*\.\s*(?:add|toggle)\s*\(\s*(['"])([\w-]+)\1/g;
    while ((m = api.exec(text)) !== null) {
      if (text.slice(Math.max(0, m.index - 400), m.index).includes("class=")) continue;
      add(null, [m[2]], name, lineOf(m.index), true);
    }
  }

  return [...seen.values()];
}

/* ---------- The check ----------------------------------------------------
   For each element and each audited property: who wins? If the winner is a
   broad rule while the element's own rule declares the same property and
   loses, that component's geometry is at the mercy of a rule that never
   mentioned it. */
/* Does a declaration of `declared` decide the value of `longhand`? */
const covers = (declared, longhand) => declared === longhand
  || (SHORTHAND[declared] || []).includes(longhand);

/* The longhands a declaration takes part in — itself, and for a shorthand
   every edge it sets. */
const coveredBy = (declared) => SHORTHAND[declared] ? [declared, ...SHORTHAND[declared]] : [declared];

export function auditCascades(base = root) {
  const cssFiles = stylesheetOrder(base);
  const flat = [];
  let order = 0;
  for (const file of cssFiles) {
    let css;
    try { css = readFileSync(file.full, "utf8"); } catch (e) { continue; }
    for (const rule of parseCss(css, file.name)) {
      for (const text of rule.selectors) {
        const sel = parseSelector(text);
        if (!sel.compounds.length) continue;
        flat.push({ rule, sel, spec: specOf(sel), order: order++, text });
      }
    }
  }

  const elements = collectElements(base);
  const { findings, allowed } = runAudit(flat, elements, (file, line) => allowanceFor(base, file, line));

  return {
    ok: findings.length === 0,
    files: cssFiles.map((f) => f.name),
    rules: flat.length,
    elements: elements.length,
    findings,
    allowed,
  };
}

/* The check itself. Shared by the real scan and the self-test, so the fixtures
   drive the engine that ships rather than a copy of it. */
function runAudit(flat, elements, allowance) {
  const findings = [];
  const allowed = [];

  /* the declaration of a rule that decides `longhand`, direct or through a
     shorthand; a later direct declaration beats an earlier shorthand */
  const declFor = (rule, longhand) => {
    let found = null;
    for (const d of rule.decls) {
      if (!covers(d.prop, longhand)) continue;
      if (!found || d.prop === longhand) found = d;
    }
    return found;
  };

  /* who wins, between two declarations of the same longhand */
  const beats = (a, b) => {
    if (a.decl.important !== b.decl.important) return a.decl.important ? 1 : -1;
    const s = compareSpec(a.spec, b.spec);
    if (s) return s > 0 ? 1 : -1;
    if (a.order !== b.order) return a.order > b.order ? 1 : -1;
    return 0;
  };

  for (const el of elements) {
    const own = flat.filter((e) => namesAClass(e.sel, el) && !subject(e.sel).pseudoElement);
    if (!own.length) continue;

    /* is this component floating, by its own rules or by its name? */
    const floats = own.some((e) => ((declFor(e.rule, "position") || {}).value || "").match(/^(absolute|fixed)$/))
      || el.classes.some((c) => FLOATING_NAME.test(c));

    /* the box edges this component has an opinion about */
    const axis = new Set();
    for (const e of own) for (const d of e.rule.decls) {
      if (!AUDITED.has(d.prop)) continue;
      for (const longhand of coveredBy(d.prop)) if (AUDITED.has(longhand)) axis.add(longhand);
    }

    for (const longhand of axis) {
      const mine = own.map((e) => ({ ...e, decl: declFor(e.rule, longhand) }))
        .filter((e) => e.decl)
        /* the strongest declaration this component writes for itself */
        .sort((x, y) => beats(y, x))[0];
      if (!mine) continue;

      const broad = flat.filter((e) => isBroad(e.sel) && !subject(e.sel).pseudoElement
        && typeCouldMeet(e.sel, el) && !excludedBy(e.sel, el)
        && declFor(e.rule, longhand));

      for (const other of broad) {
        const decl = declFor(other.rule, longhand);
        if (beats({ ...other, decl }, mine) <= 0) continue;      /* the component still wins */

        const row = {
          file: el.file, line: el.line,
          element: (el.tag ? el.tag + "." : ".") + el.classes.join("."),
          prop: longhand,
          own: { prop: mine.decl.prop, value: mine.decl.value, file: mine.rule.file,
                 line: mine.decl.line, selector: mine.rule.selectorText },
          broad: { prop: decl.prop, value: decl.value, file: other.rule.file, line: decl.line,
                   selector: other.rule.selectorText, media: other.rule.media },
          tier: floats ? "floating" : (SPACING.has(longhand) ? "spacing" : "sizing"),
        };
        const why = allowance(other.rule.file, decl.line) || allowance(mine.rule.file, mine.decl.line);
        if (why) allowed.push(Object.assign(row, { why }));
        else findings.push(row);
      }
    }
  }

  findings.sort((a, b) => (b.tier === "floating") - (a.tier === "floating")
    || a.element.localeCompare(b.element) || a.prop.localeCompare(b.prop));

  return { findings, allowed };
}

/* The stylesheets, in the order the document loads them — equal specificity is
   decided by source order, so the order is not cosmetic. */
function stylesheetOrder(base = root) {
  const out = [];
  let html = "";
  try { html = readFileSync(join(base, "index.html"), "utf8"); } catch (e) { html = ""; }
  for (const m of html.matchAll(/<link[^>]+href\s*=\s*"([^"]+\.css)(?:\?[^"]*)?"/g)) {
    const name = m[1].replace(/^\.?\//, "");
    if (!out.some((f) => f.name === name)) out.push({ name, full: join(base, name) });
  }
  let names = [];
  try { names = readdirSync(join(base, "css")); } catch (e) { names = []; }
  for (const n of names.sort()) {
    const name = "css/" + n;
    if (!out.some((f) => f.name === name)) out.push({ name, full: join(base, name) });
  }
  return out;
}

let allowanceCache = new Map();
function allowanceFor(base, file, line) {
  const key = file + ":" + line;
  if (allowanceCache.has(key)) return allowanceCache.get(key);
  let text = "";
  try { text = readFileSync(join(base, file), "utf8"); } catch (e) { text = ""; }
  const lines = text.split(/\r?\n/);
  const check = (l) => (lines[l - 1] || "");
  const hit = [check(line), check(line - 1)].find((l) => /cascade-audit:\s*ok/.test(l));
  const out = hit ? hit.trim() : null;
  allowanceCache.set(key, out);
  return out;
}

/* ---------- The self-test -------------------------------------------------
   Each fixture is a stylesheet and one element. `want` is how many findings
   the real engine should report. The trap itself, both fixed forms, ties
   decided by source order, !important on either side, and the shapes a naive
   matcher gets wrong. */
const FIXTURES = [
  {
    name: "the trap: a shape rule out-ranks the badge's own rule",
    css: ".tab > span { position: relative; }\n.dotBadge { position: absolute; }",
    el: { tag: "span", classes: ["dotBadge"] }, want: 1,
  },
  {
    name: "fixed by scoping the shape rule away (:not)",
    css: ".tab > span:not(.dotBadge) { position: relative; }\n.dotBadge { position: absolute; }",
    el: { tag: "span", classes: ["dotBadge"] }, want: 0,
  },
  {
    name: "fixed by making the component's rule more specific",
    css: ".tab > span { position: relative; }\nspan.dotBadge { position: absolute; }",
    el: { tag: "span", classes: ["dotBadge"] }, want: 0,
  },
  {
    name: "a bare tag rule cannot out-rank a class on its own",
    css: "span { position: relative; }\n.dotBadge { position: absolute; }",
    el: { tag: "span", classes: ["dotBadge"] }, want: 0,
  },
  {
    name: "an ancestor is what tips a shape rule over the component's rule",
    css: ".tab > span { position: relative; }\n.dotBadge { position: absolute; }",
    el: { tag: "span", classes: ["dotBadge"] }, want: 1,
  },
  {
    name: "a rule about another tag cannot touch it",
    css: ".tab > div { position: relative; }\n.dotBadge { position: absolute; }",
    el: { tag: "span", classes: ["dotBadge"] }, want: 0,
  },
  {
    name: "a universal subject can meet any tag, later in the file",
    css: ".actRow { margin-top: 12px; }\n.row > * { margin-top: 4px; }",
    el: { tag: "div", classes: ["actRow"] }, want: 1,
  },
  {
    name: "a universal subject that comes first still loses",
    css: ".row > * { margin-top: 4px; }\n.actRow { margin-top: 12px; }",
    el: { tag: "div", classes: ["actRow"] }, want: 0,
  },
  {
    name: "a rule that names a class is not broad",
    css: ".tabHead > .actRow { margin-top: 4px; }\n.actRow { margin-top: 12px; }",
    el: { tag: "div", classes: ["actRow"] }, want: 0,
  },
  {
    name: "an id-rooted shape rule out-ranks a class rule, and is reported",
    css: "#toasts > div { margin-top: 4px; }\n.actRow { margin-top: 12px; }",
    el: { tag: "div", classes: ["actRow"] }, want: 1,
  },
  {
    name: "!important in the component's own rule holds the line",
    css: "span { position: relative; }\n.dotBadge { position: absolute !important; }",
    el: { tag: "span", classes: ["dotBadge"] }, want: 0,
  },
  {
    name: "!important on the shape rule wins anyway",
    css: "span { position: relative !important; }\n.dotBadge { position: absolute; }",
    el: { tag: "span", classes: ["dotBadge"] }, want: 1,
  },
  {
    name: "a property the component does not declare is not a finding",
    css: ".tab > span { position: relative; }\n.dotBadge { width: 8px; }",
    el: { tag: "span", classes: ["dotBadge"] }, want: 0,
  },
  {
    name: "a property nobody audits is left alone",
    css: ".tab > span { color: red; }\n.dotBadge { color: blue; }",
    el: { tag: "span", classes: ["dotBadge"] }, want: 0,
  },
  {
    name: "an inset shorthand competes with a longhand",
    css: ".tab > span { left: 0; }\n.dotBadge { inset: auto 4px auto auto; }",
    el: { tag: "span", classes: ["dotBadge"] }, want: 1,
  },
  {
    name: "a selector list is judged one selector at a time",
    css: ".tab > p, .tab > span { position: relative; }\n.dotBadge { position: absolute; }",
    el: { tag: "span", classes: ["dotBadge"] }, want: 1,
  },
  {
    name: "a pseudo-element subject is not the element's own box",
    css: ".dotBadge::after { position: absolute; inset: 0; }\n.tab > span { position: relative; }",
    el: { tag: "span", classes: ["dotBadge"] }, want: 0,
  },
  {
    name: "a nested @media shape rule still counts",
    css: "@media (max-width: 360px) { .tab > span { position: relative; } }\n.dotBadge { position: absolute; }",
    el: { tag: "span", classes: ["dotBadge"] }, want: 1,
  },
  {
    name: "a rule gated on a state class is still the component's own",
    css: ".tab > span { position: relative !important; }\n.dotBadge.on { position: absolute; }",
    el: { tag: "span", classes: ["dotBadge"] }, want: 1,
  },
  {
    name: "an attribute subject is a state hook, not a shape rule",
    css: '[hidden] { position: absolute; }\n.dotBadge { position: relative; }',
    el: { tag: "span", classes: ["dotBadge"] }, want: 0,
  },
  {
    name: "a class named in an ancestor compound is not the element's own rule",
    css: ".dotBadge span { position: absolute; }\n.tab > span { position: relative; }",
    el: { tag: "span", classes: ["dotBadge"] }, want: 0,
  },
  {
    name: "an allowance silences a deliberate pair",
    css: ".tab > span { position: relative; } /* cascade-audit: ok — the dot is meant to sit in flow */\n.dotBadge { position: absolute; }",
    el: { tag: "span", classes: ["dotBadge"] }, want: 0,
  },
  {
    name: "clean markup has nothing to say",
    css: ".tab > span:not(.dotBadge) { position: relative; }\nspan.dotBadge { position: absolute; inset: 9px auto auto 50%; }",
    el: { tag: "span", classes: ["dotBadge"] }, want: 0,
  },
];

export function selfTest() {
  return FIXTURES.map((f) => {
    const rules = parseCss(f.css, "(fixture)");
    const flat = [];
    let order = 0;
    for (const rule of rules) {
      for (const text of rule.selectors) {
        const sel = parseSelector(text);
        if (!sel.compounds.length) continue;
        flat.push({ rule, sel, spec: specOf(sel), order: order++, text });
      }
    }
    const el = { id: null, file: "(fixture)", line: 1, ...f.el };
    const lines = f.css.split(/\r?\n/);
    const allowance = (file, line) => [lines[line - 1] || "", lines[line - 2] || ""]
      .find((l) => /cascade-audit:\s*ok/.test(l)) || null;

    const { findings } = runAudit(flat, [el], allowance);
    const got = findings.length;
    return { name: f.name, want: f.want, got, ok: got === f.want };
  });
}

/* ---------- The live cross-check -----------------------------------------
   The rendered half of the same question, for a browser: for every floating
   component on the screen, the declaration that actually wins each audited
   property, and whether a rule naming no class of that element takes it from
   the rule that does. The static pass judges pairs *possible*; this says what
   is true of the DOM in front of it, with el.matches() and the real cascade
   order, so it is also the proof that the static engine has not drifted.

   Run it per surface: paste it in the app's console (or send it through the
   preview), once on each screen, and it answers with an empty array or the
   same shape of finding the static pass prints.

     node tools/cascade-guard.mjs --live-check
 */
export const LIVE_CHECK = `(() => {
  const FRAMING = ${JSON.stringify([...FRAMING])};
  const SPACING = ${JSON.stringify([...SPACING])};
  const SHORTHAND = ${JSON.stringify(SHORTHAND)};
  const AUDITED = [...FRAMING, ...SPACING];

  /* Selectors as they are on the page, each with its own specificity and its
     place in the cascade. Media conditions are honoured, so a rule that only
     applies at 360px is only counted there. */
  const entries = [];
  let order = 0;
  const splitSel = (text) => {
    const out = []; let cur = "", depth = 0;
    for (const c of text) {
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      if (c === "," && !depth) { out.push(cur); cur = ""; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim()).filter(Boolean);
  };
  const SPEC = (sel) => {
    let a = 0, b = 0, c = 0;
    const inner = sel.match(/:(?:not|is|matches|any|where)\\(([^)]*)\\)/g) || [];
    let rest = sel;
    for (const one of inner) {
      const arg = one.slice(one.indexOf("(") + 1, -1);
      if (/^:where/.test(one)) { rest = rest.replace(one, " "); continue; }
      const worst = splitSel(arg).map(SPEC).sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2])).pop() || [0, 0, 0];
      a += worst[0]; b += worst[1]; c += worst[2];
      rest = rest.replace(one, " ");
    }
    a += (rest.match(/#[\\w-]+/g) || []).length;
    b += (rest.match(/\\.[\\w-]+|\\[[^\\]]*\\]|:(?!:)[\\w-]+/g) || []).length;
    c += (rest.replace(/\\.[\\w-]+|#[\\w-]+|\\[[^\\]]*\\]|::?[\\w-]+/g, " ").match(/[a-z][\\w-]*|\\*/g) || []).length;
    return [a, b, c];
  };
  const cmp = (x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);
  const subject = (sel) => sel.split(/[\\s>+~]+/).filter(Boolean).pop() || sel;
  const FLOATING = /(dot|badge|bubble|count|pill|chip|fab|toast|ring|live|pin|mark|tag)/i;

  for (const sheet of document.styleSheets) {
    let list;
    try { list = sheet.cssRules; } catch (e) { continue; }
    const walk = (rules, media) => {
      for (const rule of rules) {
        if (!rule.selectorText && rule.cssRules) {
          const cond = rule.conditionText || "";
          walk(rule.cssRules, cond ? (media ? media + " and " + cond : cond) : media);
          continue;
        }
        if (!rule.selectorText || !rule.style) continue;
        for (const sel of splitSel(rule.selectorText)) {
          entries.push({ sel, style: rule.style, spec: SPEC(sel), order: order++, media: media || "" });
        }
      }
    };
    walk(list, "");
  }

  /* Derived once per entry rather than per element × rule × property: the
     subject's class names, whether the subject names a class/id/attr at all
     (the broad shape this audit hunts), its leading tag, and whether its media
     condition holds at this width. Doing this work in the inner loops is what
     made a single pass take seconds on a dense surface. */
  for (const e of entries) {
    const s = subject(e.sel);
    e.sClasses = (s.match(/\\.[\\w-]+/g) || []).map((c) => c.slice(1));
    e.sPseudo = s.indexOf("::") !== -1;
    e.sBroad = !e.sPseudo && !/\\.[\\w-]+|#[\\w-]+|\\[[^\\]]*\\]/.test(s);
    const lead = /^([\\w-]+|\\*)/.exec(s);
    e.sLead = lead && lead[1] !== "*" ? lead[1].toLowerCase() : null;
    e.on = !e.media || (() => { try { return matchMedia(e.media).matches; } catch (err) { return true; } })();
  }

  const declOf = (e, prop) => {
    const long = e.style.getPropertyValue(prop);
    if (long) return { value: long, important: /important/i.test(e.style.getPropertyPriority(prop) || "") };
    for (const [sh, list] of Object.entries(SHORTHAND)) {
      if (!list.includes(prop)) continue;
      const v = e.style.getPropertyValue(sh);
      if (v) return { value: v, important: /important/i.test(e.style.getPropertyPriority(sh) || "") };
    }
    return null;
  };
  const beats = (a, b) => a.decl.important !== b.decl.important
    ? (a.decl.important ? 1 : -1)
    : (cmp(a.spec, b.spec) || (a.order - b.order));
  const mediaOn = (e) => {
    if (!e.media) return true;
    try { return matchMedia(e.media).matches; } catch (err) { return true; }
  };

  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll("*")) {
    const classes = [...el.classList];
    const tagName = el.tagName.toLowerCase();
    const own = entries.filter((e) => {
      if (e.sPseudo || !e.on) return false;
      if (!e.sClasses.some((c) => classes.includes(c))) return false;
      try { return el.matches(e.sel); } catch (err) { return false; }
    });
    if (!own.length) continue;

    const style = getComputedStyle(el);
    const floating = style.position === "absolute" || style.position === "fixed"
      || own.some((e) => { const dp = declOf(e, "position"); return !!dp && (dp.value === "absolute" || dp.value === "fixed"); })
      || classes.some((c) => FLOATING.test(c));
    if (!floating) continue;

    const props = new Set();
    for (const e of own) for (const p of AUDITED) if (declOf(e, p)) props.add(p);

    for (const prop of props) {
      const mine = own.map((e) => ({ ...e, decl: declOf(e, prop) })).filter((e) => e.decl).sort((x, y) => beats(y, x))[0];
      if (!mine) continue;
      for (const other of entries) {
        if (!other.sBroad || !other.on) continue;
        if (other.sLead && other.sLead !== tagName) continue;
        const decl = declOf(other, prop);
        if (!decl) continue;
        try { if (!el.matches(other.sel)) continue; } catch (err) { continue; }
        if (beats({ ...other, decl }, mine) <= 0) continue;
        const key = classes.join(".") + "|" + prop + "|" + other.sel;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          element: el.tagName.toLowerCase() + (classes.length ? "." + classes.join(".") : ""),
          prop,
          own: mine.sel + " { " + prop + ": " + mine.decl.value + " }",
          beatenBy: other.sel + " { " + prop + ": " + decl.value + " }" + (other.media ? " @media " + other.media : ""),
          computed: style.getPropertyValue(prop),
        });
      }
    }
  }
  return { surfaces: document.body.dataset.view || document.querySelector('.page:not([hidden])')?.id || "(unknown)", findings: out };

})()`;

/* ---------- Command line -------------------------------------------------- */
function main() {
  const arg = process.argv[2] || "";

  if (arg === "--self-test") {
    const rows = selfTest();
    let bad = 0;
    for (const r of rows) {
      if (r.ok) { console.log(`\x1b[32mPASS\x1b[0m  ${r.name}`); continue; }
      bad++;
      console.log(`\x1b[31mFAIL\x1b[0m  ${r.name}\n      expected ${r.want} finding(s), got ${r.got}`);
    }
    console.log(`\n${rows.length - bad} passed, ${bad} failed\n`);
    process.exit(bad ? 1 : 0);
  }

  if (arg === "--live-check") {
    console.log(LIVE_CHECK);
    return;
  }

  /* The default run answers "is the engine still sound" — the fixtures. The
     shipped gate is the rendered audit (tools/render-audit.mjs), which judges
     the live cascade in a real browser; the source scan below stays available
     as --static for research, but it cannot know containment from markup
     alone, so its "possible pair" findings number in the thousands and are
     not a verdict on the app. */
  if (arg !== "--static") {
    console.log(`Pampa cascade guard — the engine.\n` +
      `  the shipped gate is:  node tools/render-audit.mjs\n` +
      `  this file:            --self-test (the 23 fixtures) · --live-check (the detector snippet) · --static (research scan)\n`);
    const rows = selfTest();
    let bad = 0;
    for (const r of rows) {
      if (r.ok) { console.log(`\x1b[32mPASS\x1b[0m  ${r.name}`); continue; }
      bad++;
      console.log(`\x1b[31mFAIL\x1b[0m  ${r.name}\n      expected ${r.want} finding(s), got ${r.got}`);
    }
    console.log(`\n${rows.length - bad} passed, ${bad} failed\n`);
    process.exit(bad ? 1 : 0);
  }

  const r = auditCascades();
  console.log(`\nPampa cascade guard\n  ${r.files.length} stylesheets · ${r.rules} selectors · ${r.elements} rendered elements · ${r.allowed.length} allowed\n`);
  for (const a of r.allowed) {
    console.log(`\x1b[2mallow\x1b[0m ${a.element} { ${a.prop} } — ${a.broad.file}:${a.broad.line}\n      ${a.why}`);
  }
  if (!r.ok) {
    for (const f of r.findings) {
      console.log(`\x1b[31mFAIL\x1b[0m  ${f.tier} · ${f.element} { ${f.prop} }   (${f.file}:${f.line})\n` +
        `      its own rule loses:  ${f.own.selector} { ${f.own.prop}: ${f.own.value} }   ${f.own.file}:${f.own.line}\n` +
        `      beaten by:           ${f.broad.selector} { ${f.broad.prop}: ${f.broad.value} }   ${f.broad.file}:${f.broad.line}` +
        (f.broad.media ? `   @media ${f.broad.media}` : "") +
        `\n      scope the broader rule away from this component, make the component's rule win, or mark either line: cascade-audit: ok — <reason>`);
    }
    console.log(`\n${r.findings.length} component${r.findings.length === 1 ? "" : "s"} can be out-ranked by a selector that never names them\n`);
    process.exit(1);
  }
  console.log(`\x1b[32mclean\x1b[0m — no component's own rule is beaten by a broader selector\n`);
}

if (process.argv[1] && process.argv[1].endsWith("cascade-guard.mjs")) main();
