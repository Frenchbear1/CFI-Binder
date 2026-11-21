// Makes the Aviation Interactives sims look like part of the binder: their dark "avionics" palette is
// re-mapped onto the binder's reading theme (light or dark, any colour), their fonts become the binder's,
// and they follow theme changes live. Runs first in every sim (before its own scripts draw anything).
(function () {
  'use strict';
  var inBinder = false, pdoc = null;
  try { pdoc = window.parent !== window ? window.parent.document : null; inBinder = !!pdoc; } catch (e) { pdoc = null; }
  if (!inBinder) return; // opened on its own: keep the original look
  var root = document.documentElement;
  root.classList.add('in-binder');

  // ---- colour maths ----
  var probe = document.createElement('canvas').getContext('2d');
  var fsDesc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'fillStyle');
  function parse(str) { // any CSS colour → [r,g,b,a] (null if not a plain colour)
    if (typeof str !== 'string') return null;
    var s = str.trim();
    var m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,\/]+([\d.]+%?))?\s*\)$/i);
    if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : (/%$/.test(m[4]) ? parseFloat(m[4]) / 100 : +m[4])];
    if (!/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return null;
    var h = s.slice(1); if (h.length <= 4) h = h.split('').map(function (c) { return c + c; }).join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  function norm(str) { fsDesc.set.call(probe, '#000'); fsDesc.set.call(probe, str); return parse(String(fsDesc.get.call(probe))); }
  var lum = function (c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; };
  var mix = function (a, b, t) { return [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * t); }); };
  function hsl(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d) { s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
    return [h, s, l];
  }
  function rgb(h, s, l) {
    if (!s) return [l * 255, l * 255, l * 255].map(Math.round);
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    var f = function (t) { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(function (x) { return Math.round(x * 255); });
  }
  var out = function (c, a) { return a >= 1 ? 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')' : 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + +a.toFixed(3) + ')'; };

  // The sims' own darkest background and brightest text: everything grey in between is placed on the
  // binder's page→ink scale; coloured things keep their hue (a little deeper on light pages so they read).
  var SRC_BG = lum([10, 16, 20]), SRC_INK = lum([228, 236, 233]);
  var T = null, cache = {};
  function tokens() {
    var cs = getComputedStyle(pdoc.documentElement);
    var pick = function (k, d) { return norm(cs.getPropertyValue(k).trim() || d) || parse(d); };
    var bg = pick('--doc-page', '#ffffff'), ink = pick('--doc-ink', '#1b1b1d'), page = pick('--bg', '#f5f4f1');
    return { bg: bg, ink: ink, page: page, light: lum(bg) > 0.5, font: cs.getPropertyValue('--font').trim() || 'system-ui, sans-serif', mono: cs.getPropertyValue('--mono').trim() || 'ui-monospace, monospace' };
  }
  function mapColor(str) {
    if (!T || typeof str !== 'string') return str;
    if (cache[str] !== undefined) return cache[str];
    var c = parse(str);
    if (!c) return (cache[str] = str);
    var hs = hsl(c), chroma = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]), res;
    if (chroma < 38 || hs[1] < 0.16) {
      var t = Math.max(0, Math.min(1, (lum(c) - SRC_BG) / (SRC_INK - SRC_BG)));
      res = mix(T.bg, T.ink, t);
    } else if (T.light) {
      res = rgb(hs[0], Math.min(1, hs[1] * 1.08), Math.min(hs[2], 0.43));
    } else res = c.slice(0, 3);
    return (cache[str] = out(res, c[3]));
  }
  var COLOR_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|rgba?\([^)]*\)/gi;
  var mapText = function (v) { return v.replace(COLOR_RE, function (m) { return mapColor(m); }); };
  var FONT_SWAP = function (v) {
    return v.replace(/"?Barlow Condensed"?|"?IBM Plex Sans"?|"?Arial Narrow"?/g, '__F__').replace(/"?IBM Plex Mono"?/g, '__M__')
      .replace(/(__F__\s*,\s*)+/g, '__F__,').replace(/__F__/g, T.font).replace(/__M__/g, T.mono);
  };

  // ---- canvas drawing ----
  ['fillStyle', 'strokeStyle', 'shadowColor'].forEach(function (k) {
    var d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, k);
    Object.defineProperty(CanvasRenderingContext2D.prototype, k, { configurable: true, get: d.get, set: function (v) { d.set.call(this, typeof v === 'string' ? mapColor(v) : v); } });
  });
  var fontDesc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font');
  Object.defineProperty(CanvasRenderingContext2D.prototype, 'font', { configurable: true, get: fontDesc.get, set: function (v) { fontDesc.set.call(this, T && typeof v === 'string' ? FONT_SWAP(v) : v); } });
  var addStop = CanvasGradient.prototype.addColorStop;
  CanvasGradient.prototype.addColorStop = function (o, c) { return addStop.call(this, o, mapColor(c)); };

  // ---- style sheets, style attributes and SVG colours ----
  var orig = new WeakMap(); // rule/element → its original values, so a theme change can redo the mapping
  function themeRule(rule) {
    if (rule.cssRules) { for (var i = 0; i < rule.cssRules.length; i++) themeRule(rule.cssRules[i]); }
    var st = rule.style; if (!st) return;
    var o = orig.get(rule);
    if (!o) {
      o = {};
      for (var j = 0; j < st.length; j++) { var p = st[j], v = st.getPropertyValue(p); if (COLOR_RE.test(v) || /font-family|^--f-/.test(p)) o[p] = [v, st.getPropertyPriority(p)]; COLOR_RE.lastIndex = 0; }
      orig.set(rule, o);
    }
    for (var k in o) { var nv = /font-family|^--f-/.test(k) ? FONT_SWAP(o[k][0]) : mapText(o[k][0]); if (st.getPropertyValue(k) !== nv) st.setProperty(k, nv, o[k][1]); }
  }
  function themeSheets() { for (var i = 0; i < document.styleSheets.length; i++) { try { var r = document.styleSheets[i].cssRules; for (var j = 0; j < r.length; j++) themeRule(r[j]); } catch (e) {} } }
  var ATTRS = ['fill', 'stroke', 'stop-color', 'flood-color', 'color', 'style'];
  var busy = false;
  function themeEl(el) {
    if (el.nodeType !== 1) return;
    var o = orig.get(el) || {};
    ATTRS.forEach(function (a) {
      var cur = el.getAttribute(a); if (cur == null) return;
      if (!(a in o) || (o[a].done !== cur)) o[a] = { src: cur };
      var nv = a === 'style' ? mapText(o[a].src).replace(/font-family\s*:[^;]+/g, function (f) { return FONT_SWAP(f); }) : mapText(o[a].src);
      o[a].done = nv;
      if (nv !== cur) el.setAttribute(a, nv);
    });
    orig.set(el, o);
  }
  function themeTree(n) { if (n.nodeType !== 1) return; themeEl(n); var all = n.getElementsByTagName('*'); for (var i = 0; i < all.length; i++) themeEl(all[i]); }
  new MutationObserver(function (ms) {
    if (busy) return; busy = true;
    ms.forEach(function (m) { if (m.type === 'attributes') themeEl(m.target); else m.addedNodes.forEach(themeTree); });
    busy = false;
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ATTRS });

  function apply() {
    T = tokens(); cache = {};
    root.style.colorScheme = T.light ? 'light' : 'dark';
    themeSheets();
    busy = true; themeTree(document.documentElement); busy = false;
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = mapColor('#0a1014');
  }
  T = tokens(); // canvas drawing during parsing already gets the theme
  document.addEventListener('DOMContentLoaded', function () { apply(); setTimeout(themeSheets, 400); });
  // Follow the binder when you change theme: re-map, then ask the sim to redraw.
  new MutationObserver(function () { apply(); window.dispatchEvent(new Event('resize')); })
    .observe(pdoc.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
})();
