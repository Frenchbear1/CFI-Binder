// @ts-nocheck
// Runs the binder's sims (src/sims/<id>/) right in the page. Each sim is a block (.sim-root) whose markup comes
// from a <template> next to it. Its code gets a `document` that only sees its own block, so two sims (or a sim and
// the page) never trip over each other's ids, and its keyboard shortcuts only work while you're using it.
// Colours drawn by code (canvas, SVG, inline styles) are put on the reading theme here; the CSS does it by itself.

/* ---------- colour maths (the sims were drawn for a dark "avionics" screen) ---------- */
const probe = document.createElement('canvas').getContext('2d');
const P = CanvasRenderingContext2D.prototype;
const desc = (k) => Object.getOwnPropertyDescriptor(P, k);
const FS = desc('fillStyle');
function parse(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim();
  const m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
  if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : /%$/.test(m[4]) ? parseFloat(m[4]) / 100 : +m[4]];
  if (!/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return null;
  let h = s.slice(1); if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
}
const norm = (str) => { FS.set.call(probe, '#000'); FS.set.call(probe, str); return parse(String(FS.get.call(probe))); };
const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t));
function hsl(c) {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) { s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
  return [h, s, l];
}
function rgb(h, s, l) {
  if (!s) return [l * 255, l * 255, l * 255].map(Math.round);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((x) => Math.round(x * 255));
}
const out = (c, a) => (a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${+a.toFixed(3)})`);

const SRC_BG = lum([10, 16, 20]), SRC_INK = lum([228, 236, 233]);
let T = null, cache = {};
function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const pick = (k, d) => norm(cs.getPropertyValue(k).trim() || d) || parse(d);
  const bg = pick('--doc-page', '#ffffff'), ink = pick('--doc-ink', '#1b1b1d');
  return { bg, ink, light: lum(bg) > 0.5, font: cs.getPropertyValue('--font').trim() || 'system-ui, sans-serif', mono: cs.getPropertyValue('--mono').trim() || 'ui-monospace, monospace' };
}
export function mapColor(str) {
  if (typeof str !== 'string') return str;
  if (!T) T = tokens();
  if (cache[str] !== undefined) return cache[str];
  const c = parse(str);
  if (!c) return (cache[str] = str);
  const hs = hsl(c), chroma = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
  let res;
  if (chroma < 38 || hs[1] < 0.16) res = mix(T.bg, T.ink, Math.max(0, Math.min(1, (lum(c) - SRC_BG) / (SRC_INK - SRC_BG))));
  else if (T.light) res = rgb(hs[0], Math.min(1, hs[1] * 1.08), Math.min(hs[2], 0.43));
  else res = c.slice(0, 3);
  const o = out(res, c[3]); done.add(o);
  return (cache[str] = o);
}
const done = new Set(); // colours this file produced, so a style that's re-read isn't mapped twice
const COLOR_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\([^)]*\)/gi;
const mapText = (v) => v.replace(COLOR_RE, (m) => (done.has(m.replace(/\s/g, '')) ? m : mapColor(m)));
const fonts = (v) => {
  if (!T) T = tokens();
  return v.replace(/"?Barlow Condensed"?|"?IBM Plex Sans"?|"?Arial Narrow"?/g, '__F__').replace(/"?IBM Plex Mono"?/g, '__M__')
    .replace(/(__F__\s*,\s*)+/g, '__F__,').replace(/__F__/g, T.font).replace(/__M__/g, T.mono);
};

/* ---------- canvas: only the sims' own canvases are themed (the PDF reader draws on canvas too) ---------- */
const GRADS = ['createLinearGradient', 'createRadialGradient', 'createConicGradient'];
function themeCtx(ctx) {
  if (ctx.__sim) return ctx; ctx.__sim = 1;
  for (const k of ['fillStyle', 'strokeStyle', 'shadowColor']) {
    const d = desc(k);
    Object.defineProperty(ctx, k, { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, typeof v === 'string' ? mapColor(v) : v); } });
  }
  const fd = desc('font');
  Object.defineProperty(ctx, 'font', { configurable: true, get() { return fd.get.call(this); }, set(v) { fd.set.call(this, typeof v === 'string' ? fonts(v) : v); } });
  for (const g of GRADS) {
    if (!P[g]) continue;
    ctx[g] = function (...a) { const gr = P[g].apply(this, a); const add = gr.addColorStop; gr.addColorStop = (o, c) => add.call(gr, o, mapColor(c)); return gr; };
  }
  return ctx;
}
export function themeCanvas(cv) {
  if (cv.__sim) return cv; cv.__sim = 1;
  const g = cv.getContext;
  cv.getContext = function (type, o) { const c = g.call(this, type, o); return c && type === '2d' ? themeCtx(c) : c; };
  return cv;
}

/* ---------- colours set by code on SVG shapes and inline styles ---------- */
const ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color', 'color', 'style'];
const orig = new WeakMap();
function themeEl(el) {
  if (el.nodeType !== 1) return;
  const o = orig.get(el) || {};
  for (const a of ATTRS) {
    const cur = el.getAttribute(a); if (cur == null) continue;
    if (!(a in o) || o[a].done !== cur) o[a] = { src: cur };
    const nv = a === 'style' ? mapText(o[a].src).replace(/font-family\s*:[^;]+/g, fonts) : mapText(o[a].src);
    o[a].done = nv;
    if (nv !== cur) el.setAttribute(a, nv);
  }
  orig.set(el, o);
  if (el.localName === 'canvas') themeCanvas(el);
}
const themeTree = (n) => { if (n.nodeType !== 1) return; themeEl(n); for (const e of n.getElementsByTagName('*')) themeEl(e); };

/* ---------- a `document` that only sees one sim ---------- */
const using = (root) => root.matches(':hover') || root.contains(document.activeElement) || root.hasAttribute('data-sim-full');
function scopedDoc(root) {
  const $ = (s) => root.querySelector(s);
  const own = {
    getElementById: (id) => $('#' + CSS.escape(id)),
    querySelector: (s) => $(s),
    querySelectorAll: (s) => root.querySelectorAll(s),
    getElementsByClassName: (c) => root.getElementsByClassName(c),
    getElementsByTagName: (t) => root.getElementsByTagName(t),
    createElement: (n, o) => { const el = document.createElement(n, o); return String(n).toLowerCase() === 'canvas' ? themeCanvas(el) : el; },
    addEventListener: (type, fn, opt) => {
      if (!/^key/.test(type)) return document.addEventListener(type, fn, opt);
      // Keyboard shortcuts only while you're using this sim, and never while editing the page.
      const g = (e) => { if (!document.documentElement.classList.contains('editing') && using(root) && !e.target.closest?.('[contenteditable="true"]')) fn(e); };
      document.addEventListener(type, g, opt);
    },
  };
  return new Proxy(document, {
    get(t, k) {
      if (k in own) return own[k];
      const v = Reflect.get(t, k);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

/* ---------- mounting ---------- */
const mods = import.meta.glob('./*/sim.js');
let watching = false;
function watchTheme() {
  if (watching) return; watching = true;
  new MutationObserver(() => {
    T = tokens(); cache = {};
    document.querySelectorAll('.sim-root[data-mounted]').forEach((r) => {
      themeTree(r);
      // Nudge the sim's size watchers so drawings that only redraw on resize pick up the new colours.
      r.style.width = 'calc(100% - 1px)';
      requestAnimationFrame(() => requestAnimationFrame(() => { r.style.width = ''; }));
    });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
}

export async function mountSim(root) {
  if (root.dataset.mounted) return;
  root.dataset.mounted = '1';
  const id = root.dataset.sim, load = mods[`./${id}/sim.js`];
  const tpl = root.parentElement.querySelector(`template[data-sim-tpl="${id}"]`);
  if (!load || !tpl) return;
  T = tokens(); cache = {};
  root.replaceChildren(tpl.content.cloneNode(true));
  themeTree(root);
  new MutationObserver((ms) => {
    for (const m of ms) { if (m.type === 'attributes') themeEl(m.target); else m.addedNodes.forEach(themeTree); }
  }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ATTRS });
  watchTheme();
  try { (await load()).mount(root, scopedDoc(root)); }
  catch (e) { console.error(`sim ${id}`, e); root.insertAdjacentHTML('beforeend', '<p class="sim-err">This interactive could not start.</p>'); }
}

/** Start every sim on the page as it comes near the screen. */
export function bootSims(scope = document) {
  const roots = scope.querySelectorAll('.sim-root:not([data-mounted])');
  if (!roots.length) return;
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); mountSim(e.target); } }), { rootMargin: '600px 0px' });
  roots.forEach((r) => io.observe(r));
}
