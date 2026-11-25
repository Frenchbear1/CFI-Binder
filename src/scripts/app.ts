// Client behavior: preferences, sheets, table of contents, search, video facades.
const root = document.documentElement;
const base = new URL(document.body.dataset.base || '/', document.baseURI).href;
const portable = document.body.hasAttribute('data-portable');
// Portable builds (single-folder previews) need explicit index.html in links.
const fixUrl = (u: string) => {
  const abs = new URL(u, location.href); // Pagefind already returns site-rooted paths
  if (portable && abs.pathname.endsWith('/')) abs.pathname += 'index.html';
  return abs.href;
};
import { cloudOn, syncState, signOutEverywhere } from './cloud';
import { bindModePill, onModeChange, compileOpts, prefs as sp } from './search-mode';
import { compile, MODES } from '../lib/is/search.js';
import { applyReadingTheme, openThemeBar, THEME_DEFAULTS } from '../lib/is/themes.js';

/* ---------- Reading themes (Instant Search's) ---------- */
let themePrefs: any = { ...THEME_DEFAULTS };
try { Object.assign(themePrefs, JSON.parse(localStorage.getItem('cfi.themePrefs') || '{}')); } catch {}
const saveTheme = () => { try { localStorage.setItem('cfi.themePrefs', JSON.stringify(themePrefs)); } catch {} };
applyReadingTheme(themePrefs);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ((themePrefs.rtheme || 'auto') === 'auto') applyReadingTheme(themePrefs); });

const LEVEL_SHORT: Record<string, string> = { pa: 'PVT', ir: 'IFR', ca: 'COM' };
const AC_SHORT: Record<string, string> = { both: 'Both', c172: 'C172', pa28: 'PA-28' };
const PANEL_SHORT: Record<string, string> = { both: '', analog: ' · Dials', glass: ' · Glass' };

/* ---------- Preferences (level + aircraft) ---------- */
function applyPrefs() {
  const lvl = root.dataset.level || 'pa';
  const ac = root.dataset.ac || 'both';
  const panel = root.dataset.panel || 'both';
  const width = root.dataset.width || 'full';
  document.querySelectorAll<HTMLElement>('[data-pref]').forEach((g) => {
    const v = g.dataset.pref === 'level' ? lvl : g.dataset.pref === 'panel' ? panel : g.dataset.pref === 'width' ? width : ac;
    g.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v)));
  });
  document.querySelectorAll('[data-chip-level]').forEach((e) => (e.textContent = LEVEL_SHORT[lvl]));
  document.querySelectorAll('[data-chip-ac]').forEach((e) => (e.textContent = AC_SHORT[ac]));
  document.querySelectorAll('[data-chip-panel]').forEach((e) => (e.textContent = PANEL_SHORT[panel] ?? ''));
  buildToc();
}
document.querySelectorAll<HTMLElement>('[data-pref]').forEach((g) => {
  g.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b?.dataset.v) return;
    const key = g.dataset.pref === 'level' ? 'level' : g.dataset.pref === 'panel' ? 'panel' : g.dataset.pref === 'width' ? 'width' : 'ac';
    root.dataset[key] = b.dataset.v;
    try { localStorage.setItem('cfi.' + key, b.dataset.v); } catch {}
    applyPrefs();
  });
});

/* ---------- Sheets ---------- */
const sheets: Record<string, HTMLDialogElement | null> = {
  nav: document.getElementById('sheet-nav') as HTMLDialogElement,
  search: document.getElementById('sheet-search') as HTMLDialogElement,
  prefs: document.getElementById('sheet-prefs') as HTMLDialogElement,
  screen: document.getElementById('sheet-screen') as HTMLDialogElement,
};
function openSheet(name: string) {
  Object.values(sheets).forEach((s) => s?.open && s.close());
  if (name === 'theme') { openThemeBar(themePrefs, { save: saveTheme }); return; }
  const s = sheets[name];
  if (!s) return;
  s.showModal();
  if (name === 'search') {
    const input = s.querySelector<HTMLInputElement>('[data-search-input]');
    input?.focus(); input?.select();
    if (!portable) loadPagefind();
    const res = s.querySelector<HTMLElement>('[data-search-results]');
    if (res && !input?.value) res.innerHTML = emptySearch();
    fitSearch();
  }
  if (name === 'nav') s.querySelector('.toc a.active')?.scrollIntoView({ block: 'center' });
}
// Phones: search fills the screen, with the box just above the keyboard.
function fitSearch() {
  const s = sheets.search, vv = window.visualViewport;
  if (!s || !vv) return;
  s.style.height = matchMedia('(max-width: 699px)').matches ? `${vv.height}px` : '';
}
window.visualViewport?.addEventListener('resize', () => { if (sheets.search?.open) fitSearch(); });
/* ---------- Sheets ride on top of the on-screen keyboard ----------
   iOS doesn't shrink the page for the keyboard, so a sheet pinned to the bottom ends up behind it.
   While a field in an open sheet has focus, lift the sheet to sit on the keyboard and keep the field in view. */
{
  const vv = window.visualViewport;
  let raf = 0;
  const lift = () => {
    raf = 0;
    if (!vv) return;
    const layoutH = document.documentElement.clientHeight;
    const kb = Math.max(0, layoutH - (vv.offsetTop + vv.height));
    const up = vv.height < layoutH - 80;
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => {
      if (d.classList.contains('sheet-search') && matchMedia('(max-width: 699px)').matches) {
        d.style.top = up ? `${vv.offsetTop}px` : ''; d.style.height = `${vv.height}px`; return;
      }
      if (!d.classList.contains('sheet')) return;
      if (!up) { d.style.marginBottom = d.style.maxHeight = ''; return; }
      d.style.marginBottom = `${kb}px`;
      d.style.maxHeight = `${Math.max(160, vv.height - 16)}px`;
      const f = document.activeElement as HTMLElement | null;
      if (f && d.contains(f) && f.matches('input, textarea, select, [contenteditable="true"]')) {
        const r = f.getBoundingClientRect(), dr = d.getBoundingClientRect();
        if (r.bottom > dr.bottom - 8 || r.top < dr.top) d.scrollTop += r.top - dr.top - 40;
      }
    });
  };
  const ask = () => { if (!raf) raf = requestAnimationFrame(lift); };
  vv?.addEventListener('resize', ask); vv?.addEventListener('scroll', ask);
  document.addEventListener('focusin', () => { ask(); setTimeout(ask, 300); setTimeout(ask, 600); });
  document.addEventListener('focusout', () => setTimeout(ask, 300));
}
document.querySelectorAll<HTMLElement>('[data-open]').forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.open!)));
Object.values(sheets).forEach((s) => {
  if (!s) return;
  // Tap the backdrop to close.
  s.addEventListener('click', (e) => { if (e.target === s) s.close(); });
  s.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => s.close()));
  // Following a link inside a sheet closes it.
  s.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('a')) s.close(); });
  // Swipe down on the grab handle area to dismiss.
  let y0 = 0;
  s.addEventListener('touchstart', (e) => { y0 = s.scrollTop <= 0 ? e.touches[0].clientY : -1; }, { passive: true });
  s.addEventListener('touchend', (e) => { if (y0 >= 0 && e.changedTouches[0].clientY - y0 > 90) s.close(); }, { passive: true });
});
document.querySelectorAll<HTMLDialogElement>('#sheet-reader').forEach((d) => {
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
});
document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  const typing = t.matches('input, textarea, [contenteditable]');
  if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
    e.preventDefault(); openSheet('search');
  }
});

/* ---------- Table of contents (built from visible headings, so it follows the level) ---------- */
let spy: IntersectionObserver | null = null;
function buildToc() {
  const article = document.querySelector('[data-article]');
  const lists = document.querySelectorAll<HTMLOListElement>('[data-toc]');
  if (!article || !lists.length) return;
  const heads = [...article.querySelectorAll<HTMLHeadingElement>('h2[id], h3[id]')].filter((h) => h.offsetParent !== null || h.getClientRects().length);
  const html = heads.map((h) => `<li class="t-${h.tagName.toLowerCase()}"><a href="#${h.id}" data-id="${h.id}">${h.textContent?.replace(/#$/, '').trim()}</a></li>`).join('');
  lists.forEach((l) => (l.innerHTML = html));
  spy?.disconnect();
  const current = document.querySelector('[data-current]');
  const setActive = (id: string, label: string) => {
    document.querySelectorAll('.toc a').forEach((a) => a.classList.toggle('active', (a as HTMLElement).dataset.id === id));
    if (current) current.textContent = label;
  };
  spy = new IntersectionObserver((entries) => {
    // Active heading = the last one that has scrolled above 30% of the viewport.
    const line = window.innerHeight * 0.3;
    let active: HTMLHeadingElement | undefined;
    for (const h of heads) { if (h.getBoundingClientRect().top < line) active = h; }
    if (active) setActive(active.id, active.textContent?.trim() || '');
    else setActive('', document.querySelector('h1')?.textContent?.trim() || '');
    void entries;
  }, { rootMargin: '0px 0px -60% 0px', threshold: [0, 1] });
  heads.forEach((h) => spy!.observe(h));
}

/* Before you type: recently opened pages, like Notion's search. */
function emptySearch() {
  let rec: { slug: string; title?: string; area?: string }[] = [];
  try { rec = JSON.parse(localStorage.getItem('cfi.recent') || '[]'); } catch {}
  const b = document.body.dataset.base || '/';
  const e = (t = '') => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  return (rec.length ? `<p class="sheet-h">Recent</p><div class="sr-recent">${rec.slice(0, 8).map((r) => `<a href="${b}${r.slug}/"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg><span><b>${e(r.title || r.slug)}</b><small>${e(r.area)}</small></span></a>`).join('')}</div>` : '')
    + '<p class="muted small">Try “dihedral”, “stabilator”, “aft CG” or “spiral”.</p>';
}
/* ---------- Search (Pagefind: static index, runs entirely in the browser) ---------- */
type PF = { search: (q: string) => Promise<{ results: { data: () => Promise<any> }[] }>; options?: (o: object) => Promise<void> };
let pf: PF | null = null;
let pfLoading: Promise<PF | null> | null = null;
function loadPagefind() {
  if (pf || pfLoading) return pfLoading;
  const url = base + 'pagefind/pagefind.js';
  pfLoading = import(/* @vite-ignore */ url).then(async (m) => { await m.options?.({ excerptLength: 18 }); pf = m; return m; }).catch(() => null);
  return pfLoading;
}
const input = document.querySelector<HTMLInputElement>('[data-search-input]');
// Search type (Any, All, Exact, Near, Boolean), like Instant Search. "All" with no extras is Pagefind's own
// search (forgiving: it matches word endings); the others check each page's text with Instant Search's engine.
{ const pill = document.querySelector<HTMLElement>('[data-mode-pill-main]'); if (pill) bindModePill(pill); }
onModeChange(() => input?.dispatchEvent(new Event('input')));
const out = document.querySelector<HTMLElement>('[data-search-results]');
let seq = 0;
input?.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); sheets.search?.close(); }
  if (e.key === 'Enter') { out?.querySelector<HTMLAnchorElement>('a')?.click(); }
});
input?.addEventListener('input', async () => {
  const q = input.value.trim();
  const my = ++seq;
  if (!out) return;
  if (!q) { out.innerHTML = emptySearch(); return; }
  if (portable) { renderSimple(q, my); return; }
  const lib = pf || (await loadPagefind());
  if (!lib) { out.innerHTML = '<p class="muted">Search index is built with <code>npm run build</code>. It isn’t available in dev mode.</p>'; return; }
  if (sp.mode !== 'all' || sp.matchCase || sp.wholeWord) { await modeSearch(lib, q, my); return; }
  const res = await lib.search(q);
  const data = await Promise.all(res.results.slice(0, 8).map((r) => r.data()));
  if (my !== seq) return;
  if (!data.length) { out.innerHTML = `<p class="muted">No matches for “${q.replace(/</g, '&lt;')}”.</p>`; return; }
  out.innerHTML = data.map((d) => {
    const subs = (d.sub_results || []).filter((s: any) => s.url !== d.url).slice(0, 4);
    return `<div class="hit">
      <a class="hit-title" href="${fixUrl(d.url)}">${d.meta?.title || 'Untitled'}</a>
      ${subs.length ? `<ul>${subs.map((s: any) => `<li><a href="${fixUrl(s.url)}"><span class="hit-sec">${s.title}</span><span class="hit-ex">${s.excerpt}</span></a></li>`).join('')}</ul>` : `<p class="hit-ex">${d.excerpt}</p>`}
    </div>`;
  }).join('');
});

// Any / Exact / Near / Boolean (or match case, whole words): find the pages that hold the words with
// Pagefind, then keep the ones that really match and show where.
async function modeSearch(lib: PF, q: string, my: number) {
  if (!out) return;
  const m = compile(q, compileOpts());
  if (!m || 'error' in m) { out.innerHTML = `<p class="muted">${m ? m.error : ''}</p>`; return; }
  const words = [...new Set(q.replace(/\b(AND|OR|NOT)\b/g, ' ').replace(/[()"“”*]/g, ' ').split(/\s+/).filter((w) => w.length > 1))];
  const seen = new Map<string, { data: () => Promise<any> }>();
  for (const w of words.slice(0, 8)) {
    const r = await lib.search(w);
    r.results.slice(0, 40).forEach((x: any) => seen.set(x.id, x));
  }
  const pages = await Promise.all([...seen.values()].map((r) => r.data()));
  if (my !== seq) return;
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const hits = pages.map((d) => {
    const text: string = d.content || '';
    const r = m.match(text);
    if (!r || !r.length) return null;
    // The first few places it matches, each with a little text around it.
    const spots: string[] = [];
    let last = -1;
    for (const [s0, e0] of r) {
      if (s0 < last + 120) continue;
      const a = Math.max(0, s0 - 60), b = Math.min(text.length, e0 + 90);
      let ex = '', at = a;
      for (const [s1, e1] of r) if (s1 >= a && e1 <= b && s1 >= at) { ex += esc(text.slice(at, s1)) + `<mark>${esc(text.slice(s1, e1))}</mark>`; at = e1; }
      ex += esc(text.slice(at, b));
      spots.push(`${a > 0 ? '…' : ''}${ex}${b < text.length ? '…' : ''}`);
      last = s0;
      if (spots.length === 3) break;
    }
    const first = text.slice(r[0][0], r[0][1]);
    return { d, n: r.length, spots, frag: `#:~:text=${encodeURIComponent(first)}` };
  }).filter(Boolean).sort((a: any, b: any) => b.n - a.n).slice(0, 10) as { d: any; n: number; spots: string[]; frag: string }[];
  if (!hits.length) { out.innerHTML = `<p class="muted">No ${MODES[sp.mode].label.toLowerCase()} matches for “${esc(q)}”.</p>`; return; }
  out.innerHTML = hits.map((h) => `<div class="hit">
      <a class="hit-title" href="${fixUrl(h.d.url)}${h.frag}">${esc(h.d.meta?.title || 'Untitled')} <span class="muted small">· ${h.n} ${h.n === 1 ? 'match' : 'matches'}</span></a>
      <ul>${h.spots.map((x) => `<li><a href="${fixUrl(h.d.url)}${h.frag}"><span class="hit-ex">${x}</span></a></li>`).join('')}</ul>
    </div>`).join('');
}

// Fallback search for sandboxed previews (no Pagefind): plain substring matching over sections.
let simple: { url: string; page: string; section: string; text: string }[] | null = null;
async function renderSimple(q: string, my: number) {
  if (!out) return;
  simple ??= await fetch(new URL('search-index.json', base)).then((r) => r.json()).catch(() => []);
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const hits = (simple || []).map((s) => {
    const hay = (s.section + ' ' + s.text).toLowerCase();
    if (!terms.every((t) => hay.includes(t))) return null;
    const score = terms.reduce((n, t) => n + (s.section.toLowerCase().includes(t) ? 5 : 0) + hay.split(t).length - 1, 0);
    const i = Math.max(0, s.text.toLowerCase().indexOf(terms[0]) - 60);
    let ex = esc(s.text.slice(i, i + 160));
    terms.forEach((t) => { ex = ex.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`); });
    return { s, score, ex: (i > 0 ? '…' : '') + ex + '…' };
  }).filter(Boolean).sort((a, b) => b!.score - a!.score).slice(0, 10) as { s: any; ex: string }[];
  if (my !== seq) return;
  out.innerHTML = hits.length ? `<div class="hit"><ul>${hits.map((h) => `<li><a href="${new URL(h.s.url.replace(/\/(#|$)/, '/index.html$1'), base).href}"><span class="hit-sec">${esc(h.s.section)} <span class="muted">· ${esc(h.s.page)}</span></span><span class="hit-ex">${h.ex}</span></a></li>`).join('')}</ul></div>`
    : `<p class="muted">No matches for “${esc(q)}”.</p>`;
}

/* ---------- Video facades: load the real player only when tapped ---------- */
document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-video]');
  if (!btn) return;
  const { provider, vid, start } = btn.dataset;
  const frame = document.createElement('iframe');
  frame.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';
  frame.allowFullscreen = true;
  frame.title = btn.getAttribute('aria-label') || 'Video';
  if (provider === 'youtube') frame.src = `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&rel=0&playsinline=1${start ? `&start=${start}` : ''}`;
  else if (provider === 'vimeo') frame.src = `https://player.vimeo.com/video/${vid}?autoplay=1${start ? `#t=${start}s` : ''}`;
  btn.replaceWith(frame);
});

// In a sandboxed preview, outside players can't be embedded, so videos open on the source site instead.
if (portable) document.querySelectorAll<HTMLButtonElement>('[data-video]').forEach((btn) => {
  const a = document.createElement('a');
  a.href = btn.dataset.watch || '#'; a.target = '_blank'; a.rel = 'noopener';
  a.className = 'video-link'; a.innerHTML = btn.innerHTML; a.setAttribute('style', btn.getAttribute('style') || '');
  btn.replaceWith(a);
});

applyPrefs();
window.addEventListener('load', buildToc);
document.addEventListener('cfi:article', buildToc);

// Offline support: cache pages as they're visited so the binder works with no signal.
if (!portable && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register(base + 'sw.js').catch(() => {});
}

/* ---------- Embeds load on tap ---------- */
document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-embed-load]');
  if (!b || document.documentElement.classList.contains('editing')) return;
  const fig = b.closest<HTMLElement>('[data-embed]')!;
  const f = document.createElement('iframe');
  f.src = fig.dataset.embed!; f.loading = 'lazy'; f.allowFullscreen = true;
  f.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
  b.replaceWith(f);
});

/* ---------- Recently opened pages (shown on the home page) ---------- */
{
  const art = document.querySelector<HTMLElement>('[data-article]');
  if (art?.dataset.slug) {
    try {
      const rec = JSON.parse(localStorage.getItem('cfi.recent') || '[]').filter((r: any) => r.slug !== art.dataset.slug);
      rec.unshift({ slug: art.dataset.slug, title: document.querySelector('h1')?.textContent?.trim(), area: art.dataset.area });
      localStorage.setItem('cfi.recent', JSON.stringify(rec.slice(0, 8)));
    } catch {}
  }
}

/* ---------- No ring on the first button when a sheet opens (the browser focuses it for you) ---------- */
{
  const open = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    open.call(this);
    const a = document.activeElement as HTMLElement | null;
    if (a && this.contains(a) && !a.matches('input, textarea, select, [contenteditable="true"]')) a.blur();
  };
}

// The search field's shortcut, as this computer writes it.
if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) document.querySelectorAll('[data-kbd]').forEach((k) => (k.textContent = '⌘K'));

/* ---------- The headings column at the right (iPad, Windows, Mac) ----------
   With a mouse it opens while the pointer is over it; on an iPad the first tap opens it, a tap on a heading
   goes there and closes it, and a tap anywhere else closes it. */
{
  const rail = document.querySelector<HTMLElement>('.toc-rail');
  if (rail) {
    const hover = matchMedia('(hover: hover) and (pointer: fine)');
    rail.addEventListener('mouseenter', () => { if (hover.matches) rail.classList.add('open'); });
    rail.addEventListener('mouseleave', () => { if (hover.matches) rail.classList.remove('open'); });
    rail.addEventListener('click', (e) => {
      if (hover.matches) return;
      if (!rail.classList.contains('open')) { e.preventDefault(); e.stopPropagation(); rail.classList.add('open'); return; }
      if ((e.target as HTMLElement).closest('a')) rail.classList.remove('open');
    }, true);
    document.addEventListener('click', (e) => { if (!rail.contains(e.target as Node)) rail.classList.remove('open'); });
  }
}

/* ---------- Settings: how syncing is going, and Sign out ---------- */
if (cloudOn) {
  const note = document.querySelector<HTMLElement>('[data-sync-note]');
  const say = () => {
    if (!note) return;
    const s = syncState();
    note.dataset.kind = s.error ? 'err' : '';
    note.textContent = s.error ? s.error : s.inflight ? (navigator.onLine ? 'Syncing…' : 'Saved on this device. Syncs when you’re back online.') : 'Synced to your Google account';
  };
  window.addEventListener('cfi:sync', say); window.addEventListener('online', say); window.addEventListener('offline', say);
  say();
  document.querySelector('[data-signout]')?.addEventListener('click', (e) => { e.preventDefault(); signOutEverywhere(); });
}
