// Practice mode: talk through the lesson out loud. It listens (the browser's own speech recognition), keeps time,
// and ticks off the lesson's key points as you say their keywords. Going off on a tangent is fine: a point
// ticks once enough of its keywords have come up, in any order, in any words around them.
// Key points come from the lesson's headings and text. Edit them from the ••• menu: the edit stays on this
// device and goes to the site with the other changes when you tap Upload on Home (public/practice/<slug>.json).
import '../styles/practice.css';
import { stage } from './outbox';
import { pick, heard, need, fromSaved, toText, fromText, words, stem, pointId, type Point, type Saved, type Section } from './practice-match';

const root = document.documentElement;
const article = document.querySelector<HTMLElement>('[data-article]');
const slug = article?.dataset.slug || new URLSearchParams(location.search).get('p') || '';
const btns = document.querySelectorAll<HTMLButtonElement>('[data-practice]');
if (article && slug) btns.forEach((b) => b.addEventListener('click', () => open()));
else btns.forEach((b) => (b.hidden = true));

const base = document.body.dataset.base || '/';
const K = { pts: `cfi.practice.pts.${slug}`, cur: `cfi.practice.cur.${slug}`, runs: `cfi.practice.runs.${slug}`, frac: 'cfi.practice.frac' };
const load = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const clock = (ms: number) => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

/* ---------- key points ---------- */
const LEVELS = ['pa', 'ir', 'ca'];
const SKIP_HEAD = /^(try it yourself|videos?|references?|sources?|further reading|see also)$/i;
const NOISE = '.r, figure, svg, script, style, .lvl-tag, .ac-name, .crumbs, .meta-line, .keypoints, .sim, .video, iframe, button, .blk-tools, h1, .lede';
const headings = () => [...article!.querySelectorAll<HTMLElement>('h2, h3')].filter((h) => !h.closest('figure, .sheet, dialog') && !SKIP_HEAD.test(h.textContent!.trim()));
const headText = (h: HTMLElement) => (h.textContent || '').replace(/[#¶§]/g, '').trim();

/** The lesson's sections as one level of student sees them (aircraft and panel as currently chosen). */
function sections(level: string): { secs: (Section & { h: HTMLElement })[]; text: string } {
  const ac = root.dataset.ac || 'both', panel = root.dataset.panel || 'both';
  const hs = headings();
  const at = new Map(hs.map((h, i) => [h, i]));
  const secs = hs.map((h) => ({ id: pointId(headText(h)), title: headText(h), sub: h.tagName === 'H3', text: '', bold: [] as string[], h }));
  const hidden = (el: Element) => {
    const lv = el.closest<HTMLElement>('.lvl');
    if (lv && !(lv.dataset.lv || '').split(' ').includes(level)) return true;
    const only = el.closest<HTMLElement>('[data-only]')?.dataset.only;
    if (only && ac !== 'both' && only !== ac) return true;
    const po = el.closest<HTMLElement>('[data-panel-only]')?.dataset.panelOnly;
    if (po && panel !== 'both' && po !== panel) return true;
    return !!el.closest(NOISE);
  };
  let cur = -1, all = '';
  const w = document.createTreeWalker(article!, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 1) {
      const el = n as HTMLElement;
      if (at.has(el)) { cur = hidden(el) ? -2 : at.get(el)!; continue; }
      if (/^H[23]$/.test(el.tagName)) { cur = -2; continue; }   // References, Videos…: not a point, and not part of the one before
      if (cur >= 0 && /^(STRONG|B)$/.test(el.tagName) && !hidden(el) && !el.closest('h2, h3')) secs[cur].bold.push(el.textContent || '');
      continue;
    }
    const p = n.parentElement;
    if (!p || p.closest('h2, h3') || hidden(p)) continue;
    all += ' ' + n.textContent;
    if (cur >= 0) secs[cur].text += ' ' + n.textContent;
  }
  // a heading hidden for this level drops its whole section
  return { secs: secs.filter((s, i) => !hidden(hs[i])), text: all };
}

/** Points for every level at once, tagged with the levels they belong to. */
function derive(): Point[] {
  const by = new Map<string, Point>(), order: string[] = [];
  for (const lv of LEVELS) {
    const { secs, text } = sections(lv);
    for (const p of pick(secs, text)) {
      const had = by.get(p.id);
      if (had) { had.levels!.push(lv); continue; }
      by.set(p.id, { ...p, levels: [lv] }); order.push(p.id);
    }
  }
  // keep lesson order (a Commercial-only section sits where it is in the lesson)
  const pos = new Map(headings().map((h, i) => [pointId(headText(h)), i]));
  return order.sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0)).map((id) => {
    const p = by.get(id)!;
    return { ...p, levels: p.levels!.length === 3 ? null : p.levels };
  });
}

let custom: Saved | null = load<Saved | null>(K.pts, null);
let fetched = false;
async function fetchSaved() {
  if (custom || fetched) return;
  fetched = true;
  try {
    const r = await fetch(new URL(`practice/${slug}.json`, new URL(base, document.baseURI)), { cache: 'no-cache' });
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) { const j = await r.json(); if (j?.points?.length) { custom = j; refresh(); } } // an empty list means "use the lesson's own"
  } catch {}
}
let all: Point[] = [];
const points = () => all.filter((p) => !p.levels || p.levels.includes(root.dataset.level || 'pa'));

/* ---------- the run ---------- */
type Run = { started: number; ms: number; at: number; hits: Record<string, number>; manual: Record<string, boolean>; text: string };
let run: Run = fresh();
function fresh(): Run { return { started: Date.now(), ms: 0, at: 0, hits: {}, manual: {}, text: '' }; }
let live = false;           // timer + mic running
let since = 0;              // when the current stretch of live time began
let interim = '';
let frac = load<number>(K.frac, 0.5);
const elapsed = () => run.ms + (live ? Date.now() - since : 0);

const gkey = (p: Point, i: number) => p.id + '#' + i;
const isHit = (p: Point, i: number) => !!run.hits[gkey(p, i)];
const count = (p: Point) => p.groups.reduce((n, _, i) => n + (isHit(p, i) ? 1 : 0), 0);
const done = (p: Point) => run.manual[p.id] ?? count(p) >= need(p.groups.length, frac);

/* ---------- listening ---------- */
const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
let rec: any = null;
let sessionFinal = '';      // text already final in the recogniser's current session
let note = '';
let lock: any = null;

function listen() {
  if (!SR) return;
  rec = new SR();
  rec.lang = navigator.language?.startsWith('en') ? navigator.language : 'en-US';
  rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
  sessionFinal = '';
  rec.onresult = (e: any) => {
    // Rebuild this session's text from the whole result list. Android repeats earlier words inside later
    // results, so a result that just extends the one before it replaces it.
    const fin: string[] = [];
    let inter = '';
    for (let i = 0; i < e.results.length; i++) {
      const t = (e.results[i][0]?.transcript || '').trim();
      if (!t) continue;
      if (e.results[i].isFinal) {
        const last = fin[fin.length - 1];
        if (last && t.toLowerCase().startsWith(last.toLowerCase())) fin[fin.length - 1] = t; else fin.push(t);
      } else inter += ' ' + t;
    }
    const f = fin.join(' ');
    if (f.length > sessionFinal.length) { run.text += (run.text ? ' ' : '') + f.slice(sessionFinal.length).trim(); sessionFinal = f; }
    interim = inter.trim();
    note = '';
    check();
  };
  rec.onerror = (e: any) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    note = e.error === 'not-allowed' || e.error === 'service-not-allowed'
      ? 'The microphone is blocked. Allow it for this site in the browser settings, then tap Resume.'
      : e.error === 'network' ? "Can't reach the speech service. Check the connection." : `Listening stopped (${e.error}).`;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') pause();
    paint();
  };
  // Browsers end recognition after a silence or about a minute. Keep it going while the run is live.
  rec.onend = () => {
    if (interim) { run.text += (run.text ? ' ' : '') + interim; interim = ''; check(); }
    rec = null;
    if (live) setTimeout(() => { if (live && !rec) listen(); }, 200);
  };
  try { rec.start(); } catch { rec = null; }
}
async function awake(on: boolean) {
  try {
    if (on && !lock && 'wakeLock' in navigator) { lock = await (navigator as any).wakeLock.request('screen'); lock.addEventListener?.('release', () => (lock = null)); }
    if (!on && lock) { await lock.release(); lock = null; }
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && live) awake(true); });

function start() {
  if (live) return;
  live = true; since = Date.now(); note = SR ? '' : noSpeech();
  listen(); awake(true); tick(); paint();
}
function pause() {
  if (!live) return;
  run.ms += Date.now() - since; live = false;
  try { rec?.stop(); } catch {}
  if (interim) { run.text += (run.text ? ' ' : '') + interim; interim = ''; }
  awake(false); persist(); paint();
}
function noSpeech() {
  const android = /Android/i.test(navigator.userAgent), samsung = /SamsungBrowser/i.test(navigator.userAgent);
  return samsung || android ? "This browser can't listen. Open the binder in Chrome to practice out loud. The timer still runs, and you can tick points by hand."
    : "This browser can't listen. Use Chrome, Edge or Safari to practice out loud. The timer still runs, and you can tick points by hand.";
}

/* ---------- matching ---------- */
function check() {
  // Only the newest words need a look: a keyword stays ticked once it's been heard.
  const said = [...words(run.text).slice(-90), ...words(interim)].map(stem);
  const t = elapsed();
  let changed = false;
  for (const p of points()) {
    const was = done(p);
    p.groups.forEach((g, i) => { if (!isHit(p, i) && heard(g, said)) { run.hits[gkey(p, i)] = t; changed = true; } });
    if (!was && done(p)) { run.hits[p.id] = t; flash(p.id); }
  }
  if (changed) persist();
  paint();
}
let saveT = 0;
function persist() { clearTimeout(saveT); saveT = window.setTimeout(() => save(K.cur, { ...run, ms: elapsed(), at: Date.now() }), 400); }

/* ---------- the panel ---------- */
let panel: HTMLElement | null = null;
let openState: 'off' | 'small' | 'big' = 'off';
const icon = {
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

function build() {
  panel = document.createElement('section');
  panel.className = 'pr';
  panel.setAttribute('aria-label', 'Practice this lesson');
  panel.innerHTML = `
    <button type="button" class="pr-pill" data-pr="grow" aria-label="Show practice checklist"><span class="pr-dot"></span><span class="pr-time" data-pr-time>0:00</span><span class="pr-n" data-pr-n></span><span class="pr-bar"><i data-pr-bar></i></span>${icon.up}</button>
    <div class="pr-body">
      <header class="pr-head">
        <button type="button" class="pr-mic" data-pr="mic" aria-label="Start">${icon.mic}</button>
        <div class="pr-stat"><span class="pr-time" data-pr-time>0:00</span><span class="pr-n" data-pr-n></span><span class="pr-bar"><i data-pr-bar></i></span></div>
        <button type="button" class="pr-ic" data-pr="more" aria-label="More">${icon.more}</button>
        <button type="button" class="pr-ic" data-pr="shrink" aria-label="Make smaller">${icon.down}</button>
        <button type="button" class="pr-ic" data-pr="end" aria-label="Finish">${icon.x}</button>
        <div class="pr-menu" data-pr-menu hidden>
          <p class="pr-mh">Tick a point after</p>
          <div class="seg seg-full pr-seg" role="radiogroup" aria-label="How many keywords">
            <button role="radio" data-frac="0.34">A few words</button><button role="radio" data-frac="0.5">Half</button><button role="radio" data-frac="0.8">Most</button>
          </div>
          <button type="button" data-pr="edit">Edit key points</button>
          <button type="button" data-pr="runs">Past runs</button>
          <button type="button" data-pr="copy">Copy what I said</button>
          <button type="button" data-pr="restart" class="danger">Start over</button>
        </div>
      </header>
      <p class="pr-note" data-pr-note hidden></p>
      <ol class="pr-list" data-pr-list></ol>
      <button type="button" class="pr-said" data-pr="said" aria-label="What you said"><span data-pr-said></span></button>
    </div>`;
  document.body.appendChild(panel);
  panel.addEventListener('click', onClick);
}

function onClick(e: Event) {
  const t = e.target as HTMLElement;
  const menu = panel!.querySelector<HTMLElement>('[data-pr-menu]')!;
  const f = t.closest<HTMLElement>('[data-frac]');
  if (f) { frac = Number(f.dataset.frac); save(K.frac, frac); paint(); return; }
  const kw = t.closest<HTMLElement>('[data-kw]');
  if (kw) {
    const [id, i] = kw.dataset.kw!.split('|');
    const k = id + '#' + i;
    if (run.hits[k]) delete run.hits[k]; else run.hits[k] = elapsed();
    const p = points().find((x) => x.id === id);
    if (p && done(p) && !run.hits[p.id]) run.hits[p.id] = elapsed();
    persist(); paint(); return;
  }
  const tick = t.closest<HTMLElement>('[data-tick]');
  if (tick) {
    const p = points().find((x) => x.id === tick.dataset.tick)!;
    run.manual[p.id] = !done(p);
    if (run.manual[p.id] && !run.hits[p.id]) run.hits[p.id] = elapsed();
    persist(); paint(); return;
  }
  const go = t.closest<HTMLElement>('[data-goto]');
  if (go) { headings().find((h) => pointId(headText(h)) === go.dataset.goto)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const a = t.closest<HTMLElement>('[data-pr]')?.dataset.pr;
  if (a !== 'more') menu.hidden = true;
  if (a === 'grow') show('big');
  else if (a === 'shrink') show('small');
  else if (a === 'mic') live ? pause() : start();
  else if (a === 'more') menu.hidden = !menu.hidden;
  else if (a === 'end') finish();
  else if (a === 'edit') edit();
  else if (a === 'runs') history();
  else if (a === 'copy') { navigator.clipboard?.writeText(run.text).then(() => { note = 'Copied.'; paint(); setTimeout(() => { if (note === 'Copied.') { note = ''; paint(); } }, 1500); }).catch(() => {}); }
  else if (a === 'restart') { pause(); run = fresh(); save(K.cur, null); paint(); }
  else if (a === 'said') panel!.classList.toggle('pr-said-open');
}

function show(s: typeof openState) {
  openState = s;
  root.classList.toggle('practicing', s !== 'off');
  panel?.classList.toggle('small', s === 'small');
  btns.forEach((b) => b.classList.toggle('on', s !== 'off'));
  paint();
}

let painted = '';
function paint() {
  if (!panel) return;
  const ps = points(), n = ps.filter(done).length;
  const pct = ps.length ? Math.round((n / ps.length) * 100) : 0;
  panel.classList.toggle('live', live);
  panel.querySelectorAll('[data-pr-n]').forEach((e) => (e.textContent = `${n}/${ps.length}`));
  panel.querySelectorAll<HTMLElement>('[data-pr-bar]').forEach((e) => (e.style.width = pct + '%'));
  const mic = panel.querySelector<HTMLElement>('[data-pr="mic"]')!;
  mic.innerHTML = live ? icon.pause : icon.mic;
  mic.setAttribute('aria-label', live ? 'Pause' : run.ms ? 'Resume' : 'Start');
  panel.querySelectorAll<HTMLButtonElement>('[data-frac]').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.frac) === frac)));
  const nt = panel.querySelector<HTMLElement>('[data-pr-note]')!;
  const hint = !live && !run.ms && !run.text ? 'Tap the mic and teach the lesson out loud. Points tick off as you say their keywords.' : '';
  nt.textContent = note || hint; nt.hidden = !(note || hint);
  panel.querySelectorAll('[data-pr-time]').forEach((e) => (e.textContent = clock(elapsed())));
  // the checklist only re-renders when something in it changed
  const firstOpen = ps.find((p) => !done(p))?.id;
  const sig = JSON.stringify([ps.map((p) => p.id + p.groups.length), run.hits, run.manual, frac, firstOpen]);
  if (sig !== painted) {
    painted = sig;
    panel.querySelector('[data-pr-list]')!.innerHTML = ps.map((p) => {
      const d = done(p), at = run.hits[p.id];
      return `<li class="pr-pt${p.sub ? ' sub' : ''}${d ? ' done' : ''}${p.id === firstOpen ? ' next' : ''}" data-id="${esc(p.id)}">
        <button type="button" class="pr-tick" data-tick="${esc(p.id)}" aria-pressed="${d}" aria-label="${d ? 'Untick' : 'Tick'} ${esc(p.title)}"></button>
        <div class="pr-pb"><button type="button" class="pr-t" data-goto="${esc(p.id)}">${esc(p.title)}</button>${d && at != null ? `<span class="pr-at">${clock(at)}</span>` : ''}${p.levels ? `<span class="pr-lv">${p.levels.map((l) => ({ pa: 'PVT', ir: 'IR', ca: 'CA' } as any)[l]).join(' ')}</span>` : ''}
        <div class="pr-kws">${p.groups.map((g, i) => `<button type="button" class="pr-kw${isHit(p, i) ? ' hit' : ''}" data-kw="${esc(p.id)}|${i}" title="${esc(g.alts.join(' / '))}">${esc(g.alts[0])}</button>`).join('')}</div></div></li>`;
    }).join('') || '<li class="pr-empty">No key points found in this lesson. Add some from ••• › Edit key points.</li>';
  }
  // what was said, newest last, keywords that counted are marked
  const hitStems = new Set<string>();
  ps.forEach((p) => p.groups.forEach((g, i) => { if (isHit(p, i)) g.stems.forEach((a) => a.forEach((s) => hitStems.add(s))); }));
  const tail = (run.text.length > 1600 ? '…' + run.text.slice(-1600) : run.text);
  const mark = (s: string) => s.split(/(\s+)/).map((w) => { const ws = words(w); return ws.length && ws.every((x) => hitStems.has(stem(x))) ? `<mark>${esc(w)}</mark>` : esc(w); }).join('');
  panel.querySelector('[data-pr-said]')!.innerHTML = run.text || interim ? `${mark(tail)} <i>${esc(interim)}</i>` : '<span class="muted">What you say shows up here.</span>';
  const said = panel.querySelector<HTMLElement>('.pr-said')!;
  said.scrollTop = said.scrollHeight;
  // headings in the lesson get a tick too
  const doneIds = new Set(ps.filter(done).map((p) => p.id));
  headings().forEach((h) => h.classList.toggle('pr-done', openState !== 'off' && doneIds.has(pointId(headText(h)))));
}
function flash(id: string) {
  requestAnimationFrame(() => {
    const li = panel?.querySelector<HTMLElement>(`.pr-pt[data-id="${CSS.escape(id)}"]`);
    if (!li) return;
    li.classList.add('flash'); setTimeout(() => li.classList.remove('flash'), 1200);
    const list = panel!.querySelector<HTMLElement>('[data-pr-list]')!;
    const next = list.querySelector<HTMLElement>('.pr-pt.next');
    if (next && openState === 'big') list.scrollTo({ top: next.offsetTop - list.offsetTop - 40, behavior: 'smooth' });
  });
}
let tickT = 0;
function tick() { clearInterval(tickT); tickT = window.setInterval(() => { if (!live) return clearInterval(tickT); panel?.querySelectorAll('[data-pr-time]').forEach((e) => (e.textContent = clock(elapsed()))); if (Math.floor(elapsed() / 1000) % 5 === 0) persist(); }, 500); }

function refresh() { all = custom ? fromSaved(custom) : derive(); painted = ''; paint(); }

function open() {
  if (!panel) build();
  if (openState !== 'off') { show(openState === 'big' ? 'small' : 'big'); return; }
  const saved = load<(Run & { at: number }) | null>(K.cur, null);
  if (saved && Date.now() - saved.at < 12 * 3600e3) run = { ...fresh(), ...saved };
  refresh(); fetchSaved();
  show('big');
}
// Level, aircraft or panel changed: the points follow.
new MutationObserver(() => { if (openState !== 'off') refresh(); }).observe(root, { attributes: true, attributeFilter: ['data-level', 'data-ac', 'data-panel'] });

/* ---------- popups: finish, edit, past runs ---------- */
function popup(cls: string, html: string) {
  const d = document.createElement('dialog');
  d.className = 'sheet pr-pop ' + cls;
  d.innerHTML = '<div class="grab" aria-hidden="true"></div>' + html;
  document.body.appendChild(d);
  d.addEventListener('click', (e) => { if (e.target === d || (e.target as HTMLElement).closest('[data-close]')) d.close(); });
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}
type Past = { at: number; ms: number; n: number; of: number; missed: string[]; text: string; level: string };

function finish() {
  pause();
  const ps = points(), got = ps.filter(done), missed = ps.filter((p) => !done(p));
  if (!run.ms && !run.text && !got.length) { show('off'); return; }
  const d = popup('pr-sum', `
    <p class="sheet-h">Practice run</p>
    <div class="pr-big"><span><b>${clock(run.ms)}</b><small>time</small></span><span><b>${got.length}/${ps.length}</b><small>points</small></span></div>
    ${missed.length ? `<p class="sheet-h">Not covered</p><ul class="pr-miss">${missed.map((p) => `<li><b>${esc(p.title)}</b><span>${p.groups.filter((_, i) => !isHit(p, i)).map((g) => esc(g.alts[0])).join(' · ')}</span></li>`).join('')}</ul>` : '<p class="small">Every key point covered.</p>'}
    ${got.length ? `<p class="sheet-h">Covered at</p><ul class="pr-when">${got.map((p) => `<li><span>${esc(p.title)}</span><span class="muted">${run.hits[p.id] != null ? clock(run.hits[p.id]) : ''}</span></li>`).join('')}</ul>` : ''}
    <div class="pr-row"><button type="button" class="link-btn" data-act="keep">Keep going</button><button type="button" class="eb-save" data-act="done">Save &amp; close</button></div>`);
  d.querySelector('[data-act="keep"]')!.addEventListener('click', () => d.close());
  d.querySelector('[data-act="done"]')!.addEventListener('click', () => {
    const runs = load<Past[]>(K.runs, []);
    runs.unshift({ at: run.started, ms: run.ms, n: got.length, of: ps.length, missed: missed.map((p) => p.title), text: run.text, level: root.dataset.level || 'pa' });
    // transcripts take room: keep the last 5 in full, and the scores of 30
    runs.forEach((r, i) => { if (i >= 5) r.text = ''; });
    save(K.runs, runs.slice(0, 30));
    run = fresh(); save(K.cur, null);
    d.close(); show('off');
  });
}

function history() {
  const runs = load<Past[]>(K.runs, []);
  const lv: Record<string, string> = { pa: 'Private', ir: 'Instrument', ca: 'Commercial' };
  popup('pr-hist', `<p class="sheet-h">Past runs</p>${runs.length ? `<ul class="pr-runs">${runs.map((r) => `<li><details><summary><span>${new Date(r.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${lv[r.level] || ''}</span><span><b>${clock(r.ms)}</b> · ${r.n}/${r.of}</span></summary>
    ${r.missed.length ? `<p class="small"><b>Missed:</b> ${r.missed.map(esc).join(', ')}</p>` : '<p class="small">Covered everything.</p>'}${r.text ? `<p class="small muted pr-tx">${esc(r.text)}</p>` : ''}</details></li>`).join('')}</ul>` : '<p class="small muted">No finished runs yet.</p>'}
    <div class="pr-row"><button type="button" class="eb-save" data-close>Close</button></div>`);
}

function edit() {
  const cur = custom ? fromSaved(custom) : derive();
  const d = popup('pr-edit', `
    <div class="pr-row pr-edit-top"><p class="sheet-h">Key points</p><button type="button" class="link-btn" data-close>Cancel</button><button type="button" class="eb-save" data-act="save">Save</button></div>
    <p class="small muted">One point per line: <code>Title: keyword, keyword / another way to say it</code>. Start a line with <code>-</code> for a sub-point, or <code>[IR CA]</code> to show it only at those levels.</p>
    <textarea class="pr-text" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>
    <div class="pr-row"><button type="button" class="link-btn" data-act="reset">${custom ? 'Go back to the lesson’s own points' : 'Fill in again from the lesson'}</button><span class="small muted" data-msg></span></div>`);
  const ta = d.querySelector<HTMLTextAreaElement>('textarea')!;
  ta.value = toText(cur);
  d.querySelector('[data-act="reset"]')!.addEventListener('click', () => { ta.value = toText(derive()); d.querySelector('[data-msg]')!.textContent = 'Save to use these.'; });
  d.querySelector('[data-act="save"]')!.addEventListener('click', async () => {
    const s = fromText(ta.value);
    const same = toText(fromSaved(s)) === toText(derive());
    custom = same ? null : s;
    save(K.pts, custom);
    const json = JSON.stringify(same ? { v: 1, points: [] } : s, null, 1) + '\n';
    try { await stage([{ path: `public/practice/${slug}.json`, content: json }], `Practice key points: ${document.title.split(' · ')[0]}`); } catch {}
    d.close(); refresh();
  });
}
