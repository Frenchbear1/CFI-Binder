// Search type picker, as in Instant Search (github.com/Frenchbear1/Instant-Search, js/app.js "search type picker").
// A small pill by the search box shows the type. Tap it for the list and tap a type, or press it, slide
// onto a type and let go. On a mouse, the scroll wheel over the pill steps through the types.
// One setting for every search in the binder (the binder's search and the source reader's), kept on this device.
import { MODES } from '../lib/is/search.js';

export type Mode = 'any' | 'all' | 'phrase' | 'near' | 'boolean';
export type SearchPrefs = { mode: Mode; near: number; matchCase: boolean; wholeWord: boolean };
const KEY = 'cfi.smode';
const SHORT: Record<Mode, string> = { any: 'Any', all: 'All', phrase: 'Exact', near: 'Near', boolean: 'Bool' };
const HINT: Record<Mode, string> = { any: 'Any of the words', all: 'Every word, anywhere on the page', phrase: 'The words together, in order', near: 'All the words close together', boolean: 'AND, OR, NOT and ( )' };
const NEAR_STEPS = [2, 3, 5, 8, 12, 20, 40, 80];
const ORDER = Object.keys(MODES) as Mode[];

export const prefs: SearchPrefs = (() => {
  const d: SearchPrefs = { mode: 'all', near: 8, matchCase: false, wholeWord: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return d; }
})();
const listeners = new Set<() => void>();
export const onModeChange = (f: () => void) => listeners.add(f);
function changed() {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
  document.querySelectorAll<HTMLElement>('[data-mode-pill]').forEach(paint);
  listeners.forEach((f) => f());
}
export function setMode(m: Mode) { if (prefs.mode === m) return; prefs.mode = m; changed(); }
export const compileOpts = () => ({ mode: prefs.mode, near: prefs.near, matchCase: prefs.matchCase, wholeWord: prefs.wholeWord });

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const ARROW = '<svg class="pill-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10l4 4 4-4"/></svg>';
function paint(pill: HTMLElement) {
  const flags = [prefs.matchCase ? 'Aa' : '', prefs.wholeWord ? '<u>ab</u>' : '', prefs.mode === 'near' ? `≤${prefs.near}` : ''].filter(Boolean);
  pill.innerHTML = `<span>${SHORT[prefs.mode]}</span>${flags.map((f) => `<em>${f}</em>`).join('')}${ARROW}`;
  pill.title = `Search type: ${MODES[prefs.mode].label}. Tap for options, or press and slide to switch.`;
}

/* ---------- the list ---------- */
let open: { el: HTMLElement; anchor: HTMLElement } | null = null;
function listHtml() {
  const opts = ORDER.map((m) => `<button type="button" class="pk-opt${prefs.mode === m ? ' on' : ''}" data-mode="${m}" role="option" aria-selected="${prefs.mode === m}"><span class="pk-txt"><b>${MODES[m].label}</b><span>${HINT[m]}</span></span>${CHECK}</button>`).join('');
  const near = prefs.mode === 'near'
    ? `<div class="pk-near"><span>Within</span><button type="button" class="pk-step" data-near="-1" aria-label="Fewer words apart">−</button><b>${prefs.near}</b><button type="button" class="pk-step" data-near="1" aria-label="More words apart">+</button><span>words</span></div>` : '';
  return `<div class="pk-opts" role="listbox" aria-label="Search type">${opts}</div>${near}<div class="pk-togs"><button type="button" class="pk-tog" data-tog="case" aria-pressed="${prefs.matchCase}"><i>Aa</i>Match case</button><button type="button" class="pk-tog" data-tog="word" aria-pressed="${prefs.wholeWord}"><i><u>ab</u></i>Whole words</button></div>`;
}
function place() {
  if (!open) return;
  const r = open.anchor.getBoundingClientRect(), m = open.el, vh = innerHeight, vw = innerWidth;
  m.style.left = `${Math.max(8, Math.min(r.left, vw - m.offsetWidth - 8))}px`;
  // Below the pill if it fits, else above it (the phone's search box sits at the bottom).
  const below = r.bottom + 6 + m.offsetHeight <= vh - 8;
  m.style.top = below ? `${r.bottom + 6}px` : `${Math.max(8, r.top - 6 - m.offsetHeight)}px`;
}
export function closeList() {
  if (!open) return;
  open.anchor.classList.remove('menu-open'); open.anchor.setAttribute('aria-expanded', 'false');
  open.el.remove(); open = null;
}
function openList(anchor: HTMLElement) {
  closeList();
  const el = document.createElement('div');
  el.className = 'pk-menu';
  el.innerHTML = listHtml();
  // Inside an open sheet the list has to live in the sheet, or it would sit under it.
  (anchor.closest('dialog') || document.body).append(el);
  open = { el, anchor };
  anchor.classList.add('menu-open'); anchor.setAttribute('aria-expanded', 'true');
  el.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the keyboard and the text where they are
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const t = e.target as HTMLElement;
    const o = t.closest<HTMLElement>('.pk-opt');
    if (o) { closeList(); setMode(o.dataset.mode as Mode); return; }
    const tog = t.closest<HTMLElement>('[data-tog]');
    if (tog) { if (tog.dataset.tog === 'case') prefs.matchCase = !prefs.matchCase; else prefs.wholeWord = !prefs.wholeWord; }
    const n = t.closest<HTMLElement>('[data-near]');
    if (n) prefs.near = Number(n.dataset.near) > 0 ? (NEAR_STEPS.find((x) => x > prefs.near) ?? prefs.near) : ([...NEAR_STEPS].reverse().find((x) => x < prefs.near) ?? prefs.near);
    if (!tog && !n) return;
    el.innerHTML = listHtml(); place(); changed();
  });
  place();
  return el;
}
document.addEventListener('pointerdown', (e) => { if (open && !open.el.contains(e.target as Node) && !open.anchor.contains(e.target as Node)) closeList(); }, true);
document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') { e.stopPropagation(); closeList(); } }, true);
addEventListener('resize', () => place());

/* ---------- the pill: tap, or press-slide-release ---------- */
export function bindModePill(pill: HTMLElement) {
  pill.dataset.modePill = '';
  pill.setAttribute('aria-haspopup', 'listbox'); pill.setAttribute('aria-expanded', 'false');
  paint(pill);
  let st: { x: number; y: number; moved: boolean; wasOpen: boolean; hot: HTMLElement | null } | null = null;
  const rowAt = (x: number, y: number) => {
    if (!open || open.anchor !== pill) return null;
    for (const o of open.el.querySelectorAll<HTMLElement>('.pk-opt')) {
      const r = o.getBoundingClientRect();
      if (y >= r.top && y < r.bottom && x >= r.left - 48 && x <= r.right + 48) return o;
    }
    return null;
  };
  const light = (o: HTMLElement | null) => {
    if (!st || o === st.hot) return;
    st.hot?.classList.remove('hot'); o?.classList.add('hot'); st.hot = o;
    if (o) navigator.vibrate?.(4);
  };
  pill.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no focus jump or text selection on a long press
    const wasOpen = !!open && open.anchor === pill;
    if (!wasOpen) openList(pill);
    st = { x: e.clientX, y: e.clientY, moved: false, wasOpen, hot: null };
    pill.setPointerCapture(e.pointerId);
    pill.classList.add('pressing');
  });
  pill.addEventListener('pointermove', (e) => {
    if (!st) return;
    if (!st.moved && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 10) st.moved = true;
    if (st.moved) light(rowAt(e.clientX, e.clientY));
  });
  const end = (e: PointerEvent, ok: boolean) => {
    if (!st) return;
    const s = st; st = null;
    pill.classList.remove('pressing'); s.hot?.classList.remove('hot');
    if (!ok) return;
    if (s.moved) {
      const o = rowAt(e.clientX, e.clientY);
      const r = pill.getBoundingClientRect();
      const onPill = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (o) { closeList(); setMode(o.dataset.mode as Mode); navigator.vibrate?.(8); }
      else if (!onPill) closeList(); // slid off the list: nothing changes
      return;
    }
    if (s.wasOpen) closeList(); // tapping the pill again closes the list
  };
  pill.addEventListener('pointerup', (e) => end(e, true));
  pill.addEventListener('pointercancel', (e) => end(e, false));
  pill.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.detail !== 0) return; // pointer handlers already acted
    if (open && open.anchor === pill) closeList(); // keyboard: Enter / Space
    else openList(pill).querySelector<HTMLElement>('.pk-opt.on')?.focus({ preventScroll: true });
  });
  let wheelAt = 0;
  pill.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (Date.now() - wheelAt < 180) return;
    wheelAt = Date.now();
    const i = ORDER.indexOf(prefs.mode) + (e.deltaY > 0 || e.deltaX > 0 ? 1 : -1);
    setMode(ORDER[(i + ORDER.length) % ORDER.length]);
  }, { passive: false });
}
