/* =============================================================================
 * Pampa — the toast guard
 *
 * The app had a failure mode that no review caught and no test covered: a
 * Postgres refusal, plumbing and all, handed straight to a person.
 *
 *   toast(e && e.message ? e.message : "That didn't go through");
 *   return { added: 1, msg: e.message };
 *
 * Both of those are now routed through dbText() (js/db.js), which decides what
 * is worth saying and answers null when the app has already explained the
 * refusal somewhere the person can still read. This file is the fence around
 * that rule: it reads the files a browser can actually fetch and fails if any
 * of them grows a fresh `.message` read inside a sink.
 *
 * What it calls a sink — the places a caught error's words reach a person:
 *
 *   toast(...)                the toast bubble
 *   { msg: ... }              the shape every transition returns, which the
 *                             callers toast as-is (js/wiring.js, escrow.js)
 *   { body: ... }             pampaConfirm's body line
 *
 * A sink passes when it reads its words through dbText(). It also passes when
 * it is marked `toast-guard: ok` on its own line or the line above, with a
 * reason after the colon — the hatch exists for errors that are the app's own
 * sentences and never the database's (see escrow.js's image reader). Every
 * allowance is printed, so the hatch is visible rather than silent.
 *
 *   node tools/toast-guard.mjs              # scan the shipped files
 *   node tools/toast-guard.mjs --self-test  # prove the scanner still catches
 *
 * It runs as the first legs of tools/verify-db.mjs, before any call is made:
 * a static regression is reported whether or not a database answers.
 * ============================================================================= */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/* ---------- What actually ships ------------------------------------------
   .vercelignore is the source of truth: the app is index.html, css/, js/,
   img/, manifest.webmanifest, sw.js and pampa-push.js — everything else in
   the repo is local. So the scan is the root scripts, everything under js/,
   and index.html's own inline scripts if it ever grows any. A file nobody can
   fetch cannot toast anybody, and scanning tools/ would flag this file's own
   fixtures. */
export function shippedFiles(base = root) {
  const out = [];
  const add = (full) => {
    if (/\.(js|html)$/.test(full)) out.push(full);
  };

  for (const name of readdirSync(base)) {
    const full = join(base, name);
    try { if (statSync(full).isFile()) add(full); } catch (e) { /* gone */ }
  }
  let names = [];
  try { names = readdirSync(join(base, "js")); } catch (e) { names = []; }
  for (const name of names) {
    const full = join(base, "js", name);
    try { if (statSync(full).isFile()) add(full); } catch (e) { /* gone */ }
  }
  return out.sort();
}

/* ---------- Comments, strings and templates ------------------------------
   The word `toast(e.message)` inside a comment or a sentence is not a sink,
   and a `)` inside a string must not end an argument early. One pass marks
   every character as code (0), string (1) or comment (2). Template
   expressions are walked as code, so a sink inside `${ ... }` is still seen. */
const CODE = 0, STR = 1, CMT = 2;

export function kindMap(src) {
  const n = src.length;
  const kind = new Uint8Array(n);          /* 0 = code */
  let i = 0;
  let prev = "";                            /* last significant code character */
  const tpl = [];                           /* open `${ }` regions in templates */
  let depth = 0;

  /* A `/` starts a regex, not a division, after these. */
  const regexStart = () => !prev || "([{,;:=!&|?+-*%^~<>\n".indexOf(prev) >= 0;

  /* The tail of a template literal: strings until `${` (which returns us to
     code) or the closing backtick. Entered for a fresh literal and again after
     every `}` that closes a template expression — so it must mark from where
     it stands, never assume an opening quote to consume. */
  function templateBody() {
    while (i < n) {
      if (src[i] === "\\") { kind[i++] = STR; if (i < n) kind[i++] = STR; continue; }
      if (src[i] === "$" && src[i + 1] === "{") {
        kind[i++] = STR; kind[i++] = STR;
        tpl.push(true); depth = 0;
        return;
      }
      if (src[i] === "`") { kind[i++] = STR; if (tpl.length) tpl.pop(); return; }
      kind[i++] = STR;
    }
  }

  while (i < n) {
    const c = src[i];

    if (tpl.length) {
      if (c === "{") { kind[i++] = CODE; depth++; prev = "{"; continue; }
      if (c === "}") {
        if (depth === 0) { kind[i++] = CODE; templateBody(); prev = "`"; continue; }
        kind[i++] = CODE; depth--; prev = "}"; continue;
      }
    }

    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") kind[i++] = CMT;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      kind[i++] = CMT; if (i < n) kind[i++] = CMT;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) kind[i++] = CMT;
      if (i < n) { kind[i++] = CMT; if (i < n) kind[i++] = CMT; }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      kind[i++] = STR;
      if (q === "`") { templateBody(); prev = "`"; continue; }
      while (i < n) {
        if (src[i] === "\\") { kind[i++] = STR; if (i < n) kind[i++] = STR; continue; }
        if (src[i] === q) { kind[i++] = STR; break; }
        kind[i++] = STR;
      }
      prev = q;
      continue;
    }
    if (c === "/" && regexStart()) {
      kind[i++] = CODE;
      let inClass = false;
      while (i < n) {
        if (src[i] === "\\") { kind[i++] = CODE; if (i < n) kind[i++] = CODE; continue; }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) { kind[i++] = CODE; break; }
        else if (src[i] === "\n") break;      /* not a regex after all */
        kind[i++] = CODE;
      }
      prev = "/";
      continue;
    }

    kind[i] = CODE;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return kind;
}

/* ---------- The sinks -----------------------------------------------------
   Returns each sink's own expression, so `toast(e.message)` is judged as a
   unit and a `dbText(...)` found inside it is the proof the words were
   filtered. */
export function sinks(src, kind) {
  const found = [];
  const n = src.length;
  const isCode = (idx) => kind[idx] === CODE;

  const lineAt = (idx) => {
    let line = 1;
    for (let j = 0; j < idx; j++) if (src[j] === "\n") line++;
    return line;
  };

  /* from an open paren, walk to its partner, ignoring parens in strings */
  const matchParen = (open) => {
    let d = 0;
    for (let j = open; j < n; j++) {
      if (!isCode(j)) continue;
      if (src[j] === "(") d++;
      else if (src[j] === ")") { d--; if (!d) return j; }
    }
    return -1;
  };

  /* the value of a `key:` field: up to the comma, brace or semicolon that ends
     it at its own depth */
  const valueEnd = (from) => {
    let d = 0;
    for (let j = from; j < n; j++) {
      if (!isCode(j)) continue;
      const c = src[j];
      if (c === "(" || c === "[" || c === "{") d++;
      else if (c === ")" || c === "]") { if (!d) return j; d--; }
      else if (c === "}") { if (!d) return j; d--; }
      else if (c === "," || c === ";") { if (!d) return j; }
    }
    return n;
  };

  const toasts = /\btoast\s*\(/g;
  let m;
  while ((m = toasts.exec(src)) !== null) {
    if (!isCode(m.index)) continue;
    const open = src.indexOf("(", m.index);
    const close = matchParen(open);
    if (close < 0) continue;
    found.push({ kind: "toast", start: m.index, text: src.slice(m.index, close + 1), line: lineAt(m.index) });
    toasts.lastIndex = close;
  }

  const fields = /(?:^|[{,;(\s])(msg|body)\s*:/g;
  while ((m = fields.exec(src)) !== null) {
    const at = m.index + m[0].indexOf(m[1]);
    if (!isCode(at)) continue;
    const from = src.indexOf(":", at) + 1;
    const end = valueEnd(from);
    found.push({ kind: m[1], start: at, text: m[1] + ": " + src.slice(from, end).trim(), line: lineAt(at) });
    fields.lastIndex = from;
  }

  return found.sort((a, b) => a.start - b.start);
}

const RAW = /\.message\b/;
const FILTERED = /dbText\s*\(/;
/* `dbText(e.message)` is not a filter — it hands the reader a string where it
   expects the error object, so the fallback quietly wins and the server's
   words are lost by accident rather than by decision. */
const MISUSED = /dbText\s*\(\s*[^,()]*\.message/;

function allowanceFor(src, index) {
  const eol = src.indexOf("\n", index);
  const lineStart = src.lastIndexOf("\n", index);    const line = src.slice(lineStart < 0 ? 0 : lineStart + 1, eol < 0 ? src.length : eol);
  if (/toast-guard:\s*ok/.test(line)) return line.trim();
  const prevStart = src.lastIndexOf("\n", lineStart - 1);
  const prevLine = src.slice(prevStart < 0 ? 0 : prevStart + 1, lineStart < 0 ? 0 : lineStart);
  if (/toast-guard:\s*ok/.test(prevLine)) return prevLine.trim();
  return null;
}

/* Scan one source text. Exported so the self-test drives the real scanner. */
export function scanSource(src, name = "(source)") {
  const kind = kindMap(src);
  const hits = [];
  const allowed = [];
  let raw = 0;

  for (const s of sinks(src, kind)) {
    if (!RAW.test(s.text)) continue;
    if (FILTERED.test(s.text) && !MISUSED.test(s.text)) continue;
    raw++;
    const why = allowanceFor(src, s.start);
    const row = { file: name, line: s.line, kind: s.kind };
    if (why) allowed.push(Object.assign(row, { why }));
    else hits.push(Object.assign(row, { text: s.text.replace(/\s+/g, " ").slice(0, 120) }));
  }

  return { raw, hits, allowed };
}

/* ---------- The whole shipped surface ------------------------------------ */
export function scanToasts(base = root) {
  const files = [];
  const hits = [];
  const allowed = [];
  let raw = 0;

  for (const full of shippedFiles(base)) {
    let src;
    try { src = readFileSync(full, "utf8"); } catch (e) { continue; }
    const name = relative(base, full).split(sep).join("/");

    /* an HTML file only speaks JavaScript inside its own <script> blocks */
    const blocks = name.endsWith(".html")
      ? [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
      : [src];
    if (!blocks.length) continue;

    files.push(name);
    for (const block of blocks) {
      const r = scanSource(block, name);
      raw += r.raw;
      hits.push(...r.hits);
      allowed.push(...r.allowed);
    }
  }

  return { ok: hits.length === 0, files, raw, hits, allowed };
}

/* ---------- The self-test -------------------------------------------------
   A guard that quietly stopped matching would be worse than none: it would
   read as proof. These fixtures are the shapes this file exists to catch, the
   traps a naive scan falls into, and the ways a sink may read an error's
   words. */
const FIXTURES = [
  { name: "a bare error message into a toast", src: 'toast(e.message);', want: 1 },
  { name: "a ternary that reads it twice", src: 'toast(e && e.message ? e.message : "no");', want: 1 },
  { name: "a template around it", src: 'toast(`failed: ${e.message}`);', want: 1 },
  { name: "a message field on a returned object", src: 'return { added: n, msg: e.message };', want: 1 },
  { name: "a message field with a suffix", src: 'return { added: n, msg: e && e.message ? e.message : "no" };', want: 1 },
  { name: "a dialog body", src: 'pampaConfirm({ title: "x", body: err.message });', want: 1 },
  { name: "dbText is the way through", src: 'toast(dbText(e, "That didn\'t go through"));', want: 0 },
  { name: "dbText with a prefix", src: 'toast(dbText(e, "not saved", "could not save: "));', want: 0 },
  { name: "a message field through dbText", src: 'return { added: n, msg: dbText(e) };', want: 0 },
  { name: "dbText handed a string loses the error", src: 'toast(dbText(e.message, "fallback"));', want: 1 },
  { name: "the word in a comment is not a sink", src: '/* never write toast(e.message) */\nconst x = 1;', want: 0 },
  { name: "the word in a sentence is not a sink", src: 'console.log("toast(e.message) is a bug");', want: 0 },
  { name: "a regex before a sink does not hide it", src: 'const r = /[()]/; toast(e.message);', want: 1 },
  { name: "a paren inside a string does not end early", src: 'toast("(" + e.message);', want: 1 },
  { name: "a sink inside a template expression", src: 'const s = `${ok ? "a" : b} ${toast(e.message)}`;', want: 1 },
  { name: "an allowance with a reason", src: 'toast(e.message); // toast-guard: ok — our own sentence', want: 0 },
  { name: "an allowance on the line above", src: '// toast-guard: ok — our own sentence\ntoast(e.message);', want: 0 },
  { name: "an allowance does not cover the next line", src: '// toast-guard: ok — our own sentence\nconst a = 1;\ntoast(e.message);', want: 1 },
  { name: "a different property is not a sink", src: 'return { note: e.message };', want: 0 },
  { name: "clean code has nothing to say", src: 'toast("Saved");\nreturn { msg: "ok" };', want: 0 },
  { name: "a sibling field after msg is not part of it", src: 'return { msg: dbText(e), tone: e.message };', want: 0 },
  { name: "a sibling field after a raw msg is judged on its own", src: 'return { msg: e.message, tone: "bad" };', want: 1 },
  { name: "two sinks on one line are two findings", src: 'if (!res.ok) { toast(res.msg); } return { msg: inner.message };', want: 1 },
];

export function selfTest() {
  return FIXTURES.map((f) => {
    const r = scanSource(f.src, f.name);
    const got = r.hits.length;
    return { name: f.name, want: f.want, got, ok: got === f.want };
  });
}

/* ---------- Command line -------------------------------------------------- */
function main() {
  if ((process.argv[2] || "") === "--self-test") {
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

  const r = scanToasts();
  console.log(`\nPampa toast guard\n  ${r.files.length} shipped files scanned · ${r.raw} sink${r.raw === 1 ? "" : "s"} reading a raw message · ${r.allowed.length} allowed\n`);
  for (const a of r.allowed) {
    console.log(`\x1b[2mallow\x1b[0m ${a.file}:${a.line} (${a.kind})\n      ${a.why}`);
  }
  if (!r.ok) {
    for (const h of r.hits) {
      console.log(`\x1b[31mFAIL\x1b[0m  ${h.file}:${h.line} — ${h.kind}\n      ${h.text}\n      read it through dbText(), or mark the line: toast-guard: ok — <reason>`);
    }
    console.log(`\n${r.hits.length} raw database message${r.hits.length === 1 ? "" : "s"} reach a person\n`);
    process.exit(1);
  }
  console.log(`\x1b[32mclean\x1b[0m — no shipped file hands a raw database message to a person\n`);
}

if (process.argv[1] && process.argv[1].endsWith("toast-guard.mjs")) main();
