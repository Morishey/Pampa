/* The clip rail's ring, tested against the real source text.
 *
 * The rules it must keep:
 *   1. A clip that never reports trouble never shows a ring.
 *   2. A clip that reports trouble lights the ring after the grace period.
 *   3. Trouble that clears inside the grace never shows anything at all.
 *   4. Once lit, the ring stays lit long enough to be read.
 *   5. Clearing events cancel a pending ring, and put out a lit one.
 *
 * Run: node tools/clip-ring.test.mjs
 */
import { readFileSync } from "node:fs";

const src = readFileSync("js/clips.js", "utf8");
const start = src.indexOf("const CLIP_RING_GRACE");
const end = src.indexOf("/* A clip that cannot play");
if (start < 0 || end < 0) throw new Error("could not find the ring block in js/clips.js");
const block = src.slice(start, end);

/* a fake media element that only emits what the test tells it to */
function makeVideo() {
  const v = { __ringBound: false, listeners: {}, paused: false };
  v.addEventListener = (name, fn) => { (v.listeners[name] = v.listeners[name] || []).push(fn); };
  v.emit = (name) => { (v.listeners[name] || []).forEach((fn) => fn()); };
  return v;
}
function makeRing() {
  const on = new Set();
  return { classList: { add: (c) => on.add(c), remove: (c) => on.delete(c), contains: (c) => on.has(c) }, get lit() { return on.has("on"); } };
}

/* the real functions, compiled with nothing else of the app around them */
const compile = new Function(`${block}\nreturn { watchClipLoad: watchClipLoad, hideClipRing: hideClipRing };`);
const api = compile();
const attach = (v, r) => api.watchClipLoad(v, { querySelector: () => r });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  console.log((ok ? "  ok   " : "  FAIL ") + name + "  (got " + got + ", want " + want + ")");
  ok ? pass++ : fail++;
};

async function run(name, fn) { console.log("\n" + name); await fn(); }

/* 1 — a clip with nothing to say */
await run("1. nothing reported, nothing shown", async () => {
  const v = makeVideo(), r = makeRing();
  attach(v, r);
  await wait(700);
  check("ring stays dark", r.lit, false);
});

/* 2 — a video that runs dry lights the ring after the grace */
await run("2. a long wait lights the ring", async () => {
  const v = makeVideo(), r = makeRing();
  attach(v, r);
  v.emit("waiting");
  await wait(180);
  check("dark inside the grace", r.lit, false);
  await wait(400);
  check("lit after the grace", r.lit, true);
  check("timer spent once shown", v.__ringTimer, 0);
});

/* 3 — a hiccup shorter than the grace shows nothing */
await run("3. a hiccup shorter than the grace", async () => {
  const v = makeVideo(), r = makeRing();
  attach(v, r);
  v.emit("waiting");
  await wait(120);           /* inside the grace */
  v.emit("playing");         /* back before it mattered */
  await wait(600);
  check("ring never appeared", r.lit, false);
});

/* 4 — once lit, it is readable before it goes */
await run("4. a lit ring is readable", async () => {
  const v = makeVideo(), r = makeRing();
  attach(v, r);
  v.emit("stalled");
  await wait(400);
  check("lit", r.lit, true);
  v.emit("playing");         /* cleared the moment it resumed */
  await wait(120);
  check("still lit 120ms after it cleared", r.lit, true);
  await wait(420);
  check("dark after the minimum", r.lit, false);
});

/* 5 — the clearing events each cancel a pending ring */
await run("5. every all-clear cancels a pending ring", async () => {
  for (const name of ["playing", "canplay", "loadeddata", "seeked", "pause", "ended", "error", "emptied"]) {
    const v = makeVideo(), r = makeRing();
    attach(v, r);
    v.emit("loadstart");
    v.emit(name);
    await wait(420);
    check(name + " cancels it", r.lit, false);
  }
});

/* 6 — a lit ring is put out by an all-clear as soon as it is readable */
await run("6. error puts out a lit ring", async () => {
  const v = makeVideo(), r = makeRing();
  attach(v, r);
  v.emit("waiting");
  await wait(400);
  check("lit", r.lit, true);
  await wait(500);                 /* past the minimum read time */
  v.emit("error");
  check("dark again", r.lit, false);
});

/* 7 — binding twice does not double the listeners */
await run("7. binding is once per video", async () => {
  const v = makeVideo(), r = makeRing();
  attach(v, r);
  attach(v, r);
  check("loadstart listeners", (v.listeners.loadstart || []).length, 1);
  check("playing listeners", (v.listeners.playing || []).length, 1);
});

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
