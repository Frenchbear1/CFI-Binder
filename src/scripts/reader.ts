// In-lesson source reader, built on Instant Search's PDF rendering and search engine.
// Tap a reference (e.g. "PHAK 5-19") and the real page slides up with the lesson's key terms highlighted.
// Pages are cropped to their text like Instant Search. Swipe sideways for the next or previous page (the
// page follows your finger), pinch to zoom and drag with one finger to look around. ‹ › at the bottom step
// through every source cited in that section.
// Speed: the PDF library, the sources and the cited pages are fetched and drawn ahead of time, so a tap
// shows a page that's already drawn.
import { compile } from '../lib/is/search.js';
import { bindModePill, onModeChange, compileOpts } from './search-mode';
import { renderPdfPage } from '../lib/is/pdf.js';

type Ref = { doc: string; page: number; at?: string; find?: string; label: string; href: string; q: string };
type DocData = { id: string; title: string; short: string; url: string; kind?: 'text'; snap?: boolean; labels: string[]; pages: string[] };
type Drawn = { frame: HTMLElement; cleanup: () => void };

const base = new URL(document.body.dataset.base || '/', document.baseURI).href;
const dlg = document.getElementById('sheet-reader') as HTMLDialogElement | null;
const $ = <T extends HTMLElement>(sel: string) => dlg?.querySelector<T>(sel) as T;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

let refs: Ref[] = [];
let idx = 0;
let page = 0; // page currently shown (can move away from the cited page)
let curDoc: DocData | null = null;
let library: { id: string; title: string; short: string; pages: number; updated?: string }[] | null = null;
const docs = new Map<string, Promise<DocData>>();
const pdfs = new Map<string, Promise<any>>();
let renderSeq = 0;

/* ---------- loading ---------- */
let pdfLib: Promise<any> | null = null;
function loadPdfLib() {
  return (pdfLib ??= new Promise((ok, fail) => {
    if ((window as any).pdfjsLib) return ok((window as any).pdfjsLib);
    const s = document.createElement('script');
    s.src = new URL('vendor/pdf.min.js', base).href;
    s.onload = () => {
      const lib = (window as any).pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.js', base).href;
      ok(lib);
    };
    s.onerror = fail;
    document.head.append(s);
  }));
}
const getDoc = (id: string) => {
  if (!docs.has(id)) docs.set(id, fetch(new URL(`library/${id}.json`, base)).then((r) => { if (!r.ok) throw new Error('missing'); return r.json(); }));
  return docs.get(id)!;
};
// Whole-file fetch (no range requests) so the browser and the app's offline cache can keep it.
const getPdf = (id: string) => {
  if (!pdfs.has(id)) pdfs.set(id, loadPdfLib().then((lib) => lib.getDocument({ url: new URL(`library/${id}.pdf`, base).href, isEvalSupported: false, disableRange: true, disableStream: true }).promise));
  return pdfs.get(id)!;
};
// url -> doc id for every page the build snapshotted, so plain links (Boldmethod, CFI Notebook…) open here too.
let links: Record<string, string> = {};
const linksReady = fetch(new URL('library/links.json', base)).then((r) => (r.ok ? r.json() : {})).then((j) => (links = j)).catch(() => {});
const norm = (u: string) => { try { const x = new URL(u, location.href); x.hash = ''; return x.href; } catch { return ''; } };
const isPdfUrl = (u: string) => /\.pdf($|[?#])/i.test(u);
function docFor(a: HTMLAnchorElement): string | undefined {
  if (a.dataset.doc) return a.dataset.doc;
  if (a.dataset.via) return links[norm(a.dataset.via)]; // a sim's reference: the library copy of its document
  if (!/^https?:/.test(a.href) || a.closest('.video, [data-noreader]')) return;
  return links[norm(a.href)];
}
const READABLE = '[data-article] a[href], .sim-root a[href], .kit-dlg a[href]';
const SIM_REFS = '.kit-refs, .kit-dlg, .kit-deep';
const getLibrary = async () => (library ??= await fetch(new URL('library/index.json', base)).then((r) => r.json()).catch(() => []));

/* ---------- which words to highlight ---------- */
function queryFor(a: HTMLAnchorElement) {
  if (a.dataset.q) return a.dataset.q;
  const block = a.closest('p, li, td, .callout-body') || a.parentElement;
  const words = [...(block?.querySelectorAll('strong') || [])].map((s) => s.textContent || '').join(' ');
  return words.replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter((w) => w.length > 3 && !/^(the|and|with|that|your|more|both)$/i.test(w)).join(' ');
}
function refOf(x: HTMLAnchorElement): Ref {
  const pdfPage = !x.dataset.doc && isPdfUrl(x.href) ? Number((x.href.match(/#page=(\d+)/) || [])[1] || 1) - 1 : -1;
  return { doc: docFor(x)!, page: x.dataset.page ? Number(x.dataset.page) : pdfPage, at: x.dataset.at, find: x.dataset.find, label: x.textContent || '', href: x.href, q: queryFor(x) };
}
// All library refs in the same section (between the h2s around the tapped one), in reading order.
function sectionRefs(a: HTMLAnchorElement): { list: Ref[]; at: number } {
  // In a sim: the references shown together with this one (the step's chips, or the Sources list).
  const group = a.closest(SIM_REFS);
  if (group) {
    const list: Ref[] = [];
    let at = 0;
    for (const x of group.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      if (!docFor(x)) continue;
      if (x === a) at = list.length;
      list.push(refOf(x));
    }
    return { list, at };
  }
  const article = a.closest('[data-article]');
  const all = [...(article?.querySelectorAll<HTMLAnchorElement>(READABLE) || [])].filter((x) => docFor(x) && !x.closest('.sim-root') && (x.offsetParent !== null || x === a));
  const h2s = [...(article?.querySelectorAll('h2') || [])];
  const sectionOf = (el: Element) => h2s.filter((h) => h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).length;
  const sec = sectionOf(a);
  const list: Ref[] = [];
  let at = 0;
  for (const x of all.filter((y) => sectionOf(y) === sec)) {
    const r = refOf(x);
    const dup = list.findIndex((y) => y.doc === r.doc && y.page === r.page && y.at === r.at);
    if (dup >= 0) { if (x === a) at = dup; if (!list[dup].q.includes(r.q)) list[dup].q = `${list[dup].q} ${r.q}`.trim(); continue; }
    if (x === a) at = list.length;
    list.push(r);
  }
  return { list, at };
}

/* ---------- drawing pages (kept in a small cache so going back and forth is instant) ---------- */
const stage = $('[data-rd-stage]');
const host = $('[data-rd-page]');
const pageWidth = () => Math.min(900, (stage?.clientWidth || innerWidth) - 20);
// find: words that must all be on the page ("a|b"); contents pages (rows of dot leaders) are passed over.
const plain = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function findPage(doc: DocData, find: string) {
  const want = find.split('|').map(plain).filter(Boolean);
  const hits = doc.pages.map((p, i) => [plain(p), i, (p.match(/\.{4,}/g) || []).length] as const).filter(([t]) => want.every((w) => t.includes(w)));
  return (hits.find((h) => h[2] < 4) || hits[0])?.[1] ?? -1;
}
const pageIndex = (doc: DocData, ref: Ref) => {
  let p = ref.at ? doc.labels.indexOf(ref.at) : -1;
  if (p < 0 && ref.find) p = findPage(doc, ref.find);
  if (p < 0) p = ref.at ? 0 : ref.page;
  return Math.max(0, Math.min(p, doc.pages.length - 1));
};
const CACHE_MAX = 10;
const drawn = new Map<string, Promise<Drawn | null>>();
const keyOf = (doc: string, n: number, q: string, w: number, sharp: boolean) => `${doc}|${n}|${q}|${Math.round(w)}|${sharp ? 2 : 1}`;
function trimCache() {
  while (drawn.size > CACHE_MAX) {
    const [k, p] = drawn.entries().next().value!;
    drawn.delete(k);
    p.then((d) => { if (d && !d.frame.isConnected) d.cleanup(); });
  }
}
function rangesFor(doc: DocData, n: number, q: string) {
  const m = q ? compile(q, { mode: 'any', wholeWord: false }) : null;
  return m && !('error' in m) ? m.soft(doc.pages[n]).map(([s, e, c]: number[]) => [s, e, c, null]) : [];
}
function textPage(doc: DocData, n: number, q: string): Drawn {
  const web = doc.id.startsWith('web-');
  const text = doc.pages[n];
  let html = '', last = 0;
  for (const [s0, e0, c] of rangesFor(doc, n, q)) { html += esc(text.slice(last, s0)) + `<mark class="c${c}">${esc(text.slice(s0, e0))}</mark>`; last = e0; }
  html += esc(text.slice(last));
  const para = (p: string) => {
    const m = p.replace(/<\/?mark[^>]*>/g, '').match(/^\[\[(img|embed|video|audio) (\S+)\|(.*)\]\]$/s);
    if (m) {
      const [, kind, url, cap] = m;
      const fc = cap ? `<figcaption>${cap}</figcaption>` : '';
      if (!/^(https:|data:image\/)/.test(url)) return '';
      if (kind === 'img') return `<figure class="rd-fig"><img src="${url}" alt="${cap}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.remove()">${fc}</figure>`;
      if (kind === 'embed') return `<figure class="rd-fig rd-embed"><div class="rd-player"><iframe src="${url}" title="${cap || 'Video'}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>${fc}</figure>`;
      if (kind === 'video') return `<figure class="rd-fig"><video src="${url}" controls playsinline preload="metadata" onerror="this.parentNode.remove()"></video>${fc}</figure>`;
      return `<figure class="rd-fig"><audio src="${url}" controls preload="none"></audio>${fc}</figure>`;
    }
    if (p.startsWith('[[table]]\n')) {
      const rows = p.slice(10).split('\n').map((r) => r.split('\t'));
      const [head, ...body] = rows;
      const tr = (r: string[], t: string) => `<tr>${r.map((c) => `<${t}>${c}</${t}>`).join('')}</tr>`;
      return `<div class="rd-table"><table><thead>${tr(head, 'th')}</thead><tbody>${body.map((r) => tr(r, 'td')).join('')}</tbody></table></div>`;
    }
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  };
  const frame = document.createElement('div');
  frame.className = `rd-text${web ? ' rd-web' : ''}`;
  frame.innerHTML = `${web ? `<p class="rd-src">From ${esc(doc.short)}. Saved copy, refreshed weekly.</p>` : ''}${html.split(/\n{2,}/).map(para).join('')}`;
  return { frame, cleanup: () => frame.remove() };
}
/* ---------- web sources: the saved copy of the real page, shown as the site shows it ---------- */
// One frame per source, kept while you move between its sections. It's sandboxed: no scripts can run in it,
// but the reader can still mark words in it and scroll it. Links in it open the site in a new tab.
let snapEl: { id: string; frame: HTMLElement; iframe: HTMLIFrameElement; ready: Promise<boolean>; q: string } | null = null;
function snapFor(doc: DocData) {
  if (snapEl?.id === doc.id && snapEl.frame.isConnected) return snapEl;
  const frame = document.createElement('div');
  frame.className = 'rd-snap';
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.title = doc.title;
  iframe.src = new URL(`library/${doc.id}.html`, base).href;
  const ready = new Promise<boolean>((ok) => {
    iframe.addEventListener('load', () => ok(!!iframe.contentDocument?.body?.childElementCount), { once: true });
    setTimeout(() => ok(!!iframe.contentDocument?.body?.childElementCount), 12000);
  });
  frame.append(iframe);
  snapEl = { id: doc.id, frame, iframe, ready, q: '\u0000' };
  return snapEl;
}
function snapMark(d: Document, q: string) {
  d.querySelectorAll('mark.cfi-hl').forEach((m) => m.replaceWith(...m.childNodes));
  d.body.normalize();
  const m = q ? compile(q, { mode: 'any', wholeWord: false }) : null;
  if (!m || 'error' in m) return;
  const walk = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest('script, style, noscript, textarea, title') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const nodes: Text[] = []; for (let n = walk.nextNode(); n; n = walk.nextNode()) if ((n.textContent || '').trim().length > 2) nodes.push(n as Text);
  let made = 0;
  for (const t of nodes) {
    const r = m.soft(t.data) as number[][];
    if (!r.length) continue;
    for (const [s0, e0] of [...r].sort((a, b) => b[0] - a[0])) {
      const hit = t.splitText(s0); hit.splitText(e0 - s0);
      const mk = d.createElement('mark'); mk.className = 'cfi-hl'; hit.replaceWith(mk); mk.append(hit);
      if (++made > 3000) return;
    }
  }
}
// The cited part of the page: the element whose text starts with the section's label (an AIM number, a § number,
// or a heading), then the first marked word from there on.
function snapTarget(d: Document, doc: DocData, n: number): Element | null {
  const label = doc.labels[n] || '';
  if (!label || label === 'Intro') return d.querySelector('mark.cfi-hl');
  const want = plain(label), sec = /^\d/.test(label) ? new RegExp(`^(§\\s*)?${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`) : null;
  let at: Element | null = null;
  // Headings first, then paragraphs (a big regulation has thousands of elements, so no walking every box).
  for (const sel of ['h1, h2, h3, h4, h5, h6', 'p, li, dt, strong, b, a[name]']) {
    for (const el of d.body.querySelectorAll(sel)) {
      const t = (el.textContent || '').slice(0, 300).replace(/\s+/g, ' ').trim();
      if (t && (sec ? sec.test(t) : plain(t).startsWith(want))) { at = el; break; }
    }
    if (at) break;
  }
  if (!at) return d.querySelector('mark.cfi-hl');
  const marks = [...d.querySelectorAll('mark.cfi-hl')];
  const after = marks.find((mk) => at!.compareDocumentPosition(mk) & (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY));
  return after && after.getBoundingClientRect().top - at.getBoundingClientRect().top < 900 ? after : at;
}
async function showSnap(doc: DocData, n: number, q: string, my: number) {
  const s = snapFor(doc);
  put({ frame: s.frame, cleanup: () => {} });
  stage.classList.add('snap');
  const ok = await s.ready;
  if (my !== renderSeq) return true;
  const d = s.iframe.contentDocument;
  if (!ok || !d?.body) { snapEl = null; return false; }
  if (s.q !== q) { snapMark(d, q); s.q = q; }
  d.querySelectorAll('.cfi-cur').forEach((x) => x.classList.remove('cfi-cur'));
  const el = snapTarget(d, doc, n);
  const win = s.iframe.contentWindow!;
  if (el) {
    if (el.matches('mark')) el.classList.add('cfi-cur');
    const top = el.getBoundingClientRect().top + win.scrollY;
    win.scrollTo({ top: Math.max(0, top - win.innerHeight * 0.3), behavior: 'instant' as ScrollBehavior });
  } else win.scrollTo(0, 0);
  return true;
}

// sharp = full resolution; otherwise a quick 1x draw that shows sooner.
function draw(docId: string, n: number, q: string, sharp = true, width = pageWidth()): Promise<Drawn | null> {
  const k = keyOf(docId, n, q, width, sharp);
  let p = drawn.get(k);
  if (p) { drawn.delete(k); drawn.set(k, p); return p; } // most recently used goes last
  p = (async () => {
    const doc = await getDoc(docId);
    if (doc.kind === 'text') return textPage(doc, n, q);
    const pdf = await getPdf(docId);
    const res = await renderPdfPage(pdf, n, null, rangesFor(doc, n, q), width, { trim: true, cropY: true, dpr: sharp ? 2 : 1 });
    if (res.cancelled) return null;
    return { frame: res.frame, cleanup: res.cleanup };
  })().catch(() => null);
  drawn.set(k, p);
  trimCache();
  return p;
}
const isDone = async (p: Promise<unknown>) => Promise.race([p.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 0))]);

// Quietly draw what you're likely to open next, one page at a time.
const queue: (() => Promise<unknown>)[] = [];
let busy = false;
function later(job: () => Promise<unknown>) {
  queue.push(job);
  if (busy) return;
  busy = true;
  const next = () => {
    const j = queue.shift();
    if (!j) { busy = false; return; }
    const idle = (window as any).requestIdleCallback || ((f: () => void) => setTimeout(f, 60));
    idle(() => j().finally(next));
  };
  next();
}
async function warmRef(r: Ref) {
  try { const doc = await getDoc(r.doc); if (doc.snap) { fetch(new URL(`library/${doc.id}.html`, base)).catch(() => {}); return; } await draw(r.doc, pageIndex(doc, r), r.q); } catch {}
}

/* ---------- showing a page ---------- */
let zoom = 1;
let zoomDrawn: Drawn | null = null;
function setZoomLayout() {
  if (zoom <= 1.01) { host.style.width = ''; host.style.maxWidth = ''; }
  else { host.style.maxWidth = 'none'; host.style.width = `${pageWidth() * zoom}px`; }
  // the paper grain and web-page text grow with the page, so zooming looks like a closer look, not a reflow
  host.style.setProperty('--pz', String(zoom > 1.01 ? zoom : 1));
  stage.classList.toggle('zoomed', zoom > 1.01);
}
function resetZoom() { zoom = 1; setZoomLayout(); zoomDrawn?.cleanup(); zoomDrawn = null; }
function put(d: Drawn) {
  if (host.firstElementChild === d.frame && host.childElementCount === 1) return;
  host.replaceChildren(d.frame);
}

async function show(i: number, pageOverride?: number) {
  if (!dlg || !refs.length) return;
  idx = (i + refs.length) % refs.length;
  const ref = refs[idx];
  const my = ++renderSeq;
  resetZoom();
  $('[data-rd-label]').textContent = ref.label;
  $('[data-rd-count]').textContent = refs.length > 1 ? `${idx + 1} of ${refs.length}` : '';
  $<HTMLAnchorElement>('[data-rd-orig]').href = ref.href;
  dlg.querySelectorAll('[data-rd-step]').forEach((b) => ((b as HTMLElement).hidden = refs.length < 2));
  try {
    const doc = await getDoc(ref.doc);
    if (my !== renderSeq) return;
    curDoc = doc;
    page = Math.max(0, Math.min(pageOverride ?? pageIndex(doc, ref), doc.pages.length - 1));
    const web = doc.id.startsWith('web-');
    $('[data-rd-doc]').textContent = web ? `${doc.short} · ${doc.title}` : `${doc.title} · ${doc.kind === 'text' ? '' : 'page '}${doc.labels[page]}`;
    const unit = web ? '' : doc.kind === 'text' ? (doc.short === 'AIM' ? 'AIM ' : '§ ') : 'Page ';
    const prev = $<HTMLButtonElement>('[data-rd-prevpage]'), next = $<HTMLButtonElement>('[data-rd-nextpage]');
    prev.hidden = page === 0; next.hidden = page >= doc.pages.length - 1;
    prev.textContent = page > 0 ? `‹ ${unit}${doc.labels[page - 1]}` : '';
    next.textContent = page < doc.pages.length - 1 ? `${unit}${doc.labels[page + 1]} ›` : '';
    stage.classList.remove('snap');
    if (doc.snap && (await showSnap(doc, page, ref.q, my))) {
      for (const r of [refs[idx + 1], refs[idx - 1]]) if (r) later(() => warmRef(r));
      return;
    }
    if (my !== renderSeq) return;
    const sharp = draw(ref.doc, page, ref.q, true);
    let early = false;
    if (!(await isDone(sharp)) && doc.kind !== 'text') {
      // Not drawn yet: show a quick 1x draw first, then swap in the sharp one.
      stage.setAttribute('aria-busy', 'true');
      const quick = await Promise.race([draw(ref.doc, page, ref.q, false), sharp]);
      if (my !== renderSeq) return;
      if (quick) { put(quick); scrollToHit(); early = true; }
    }
    const d = await sharp;
    if (my !== renderSeq) return;
    if (!d) throw new Error('draw');
    put(d);
    if (!early) scrollToHit();
    // Next likely stops: the pages either side, then the other sources in this section.
    for (const n of [page + 1, page - 1]) if (n >= 0 && n < doc.pages.length) later(() => draw(ref.doc, n, ref.q));
    for (const r of [refs[idx + 1], refs[idx - 1]]) if (r) later(() => warmRef(r));
  } catch {
    if (my !== renderSeq) return;
    host.innerHTML = `<p class="rd-missing">This source isn’t in the binder’s library yet. <a href="${ref.href}" target="_blank" rel="noopener">Open it on the original site</a>.</p>`;
    $('[data-rd-doc]').textContent = '';
  } finally {
    if (my === renderSeq) stage.removeAttribute('aria-busy');
  }
}
function scrollToHit() {
  stage.scrollTop = 0; stage.scrollLeft = 0;
  requestAnimationFrame(() => {
    const hit = host.querySelector<HTMLElement>('.box, mark');
    if (hit) stage.scrollTop = Math.max(0, hit.getBoundingClientRect().top - stage.getBoundingClientRect().top - stage.clientHeight * 0.3);
  });
}

export function openReader(list: Ref[], at: number) {
  if (!dlg) return;
  refs = list;
  document.querySelectorAll('dialog[open]').forEach((d) => (d as HTMLDialogElement).close());
  dlg.classList.remove('searching');
  dlg.showModal();
  show(at);
}

/* ---------- library search (Instant Search engine over every page of every source) ---------- */
let searchSeq = 0;
async function runSearch(q: string) {
  const out = $('[data-rd-results]');
  const my = ++searchSeq;
  if (!q.trim()) { out.innerHTML = ''; return; }
  // Keywords: a page matching more of them ranks higher, then more hits.
  const m = compile(q, compileOpts());
  if (!m || 'error' in m) { out.innerHTML = m && 'error' in m ? `<p class="muted">${m.error}</p>` : ''; return; }
  const lib = await getLibrary();
  const hits: { doc: DocData; p: number; n: number; terms: number; ex: string }[] = [];
  for (const d of lib) {
    const doc = await getDoc(d.id).catch(() => null);
    if (!doc) continue;
    doc.pages.forEach((text, p) => {
      const r = m.match(text);
      if (!r || !r.length) return;
      const terms = new Set(r.map((x: number[]) => x[2])).size;
      const [s] = r[0];
      const a = Math.max(0, s - 70);
      let ex = '', last = a;
      for (const [rs, re] of r.filter(([rs]: number[]) => rs < a + 180)) { ex += esc(text.slice(last, rs)) + '<mark>' + esc(text.slice(rs, re)) + '</mark>'; last = re; }
      ex += esc(text.slice(last, a + 180));
      hits.push({ doc, p, n: r.length, terms, ex: (a > 0 ? '…' : '') + ex.replace(/\s+/g, ' ') + '…' });
    });
  }
  if (my !== searchSeq) return;
  hits.sort((x, y) => y.terms - x.terms || y.n - x.n);
  out.innerHTML = hits.length
    ? hits.slice(0, 40).map((h, i) => `<button type="button" class="rd-hit" data-i="${i}"><span class="rd-hit-t">${h.doc.short} ${h.doc.labels[h.p]} <span class="muted">· ${h.n} hit${h.n > 1 ? 's' : ''}</span></span><span class="rd-hit-x">${h.ex}</span></button>`).join('')
    : `<p class="muted">No pages match.</p>`;
  out.querySelectorAll<HTMLButtonElement>('.rd-hit').forEach((b) => b.addEventListener('click', () => {
    const h = hits[Number(b.dataset.i)];
    refs = [{ doc: h.doc.id, page: h.p, label: `${h.doc.short} ${h.doc.labels[h.p]}`, href: h.doc.kind === 'text' ? h.doc.url : `${h.doc.url}#page=${h.p + 1}`, q }];
    dlg!.classList.remove('searching');
    show(0);
  }));
}

// One row of keyword chips: the reference's own words, then the bold terms and headings of the lesson.
function chipWords(): string[] {
  const seen = new Set<string>(), out: string[] = [];
  const add = (w: string) => {
    w = w.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim().replace(/^(the|a|an|our|both)\s+/i, '');
    const k = w.toLowerCase();
    if (w.length < 3 || w.length > 28 || seen.has(k) || /^(the|and|with|that|your|more|both|what|this|from)$/i.test(w)) return;
    seen.add(k); out.push(w);
  };
  (refs[idx]?.q || '').split(/\s+/).forEach(add);
  const art = document.querySelector('[data-article]');
  art?.querySelectorAll('strong').forEach((s) => add(s.textContent || ''));
  art?.querySelectorAll('h2, h3').forEach((h) => add((h.textContent || '').replace(/#$/, '')));
  return out.slice(0, 24);
}

/* ---------- gestures: swipe for pages, pinch to zoom, one finger to pan, double-tap to zoom ---------- */
const SWIPE_GAP = 24, SWIPE_AT = 72;
function bindGestures() {
  let peek: HTMLElement | null = null;
  let s: null | { x: number; y: number; t: number; on: boolean; dir: number; w: number; next: number; ready: Drawn | null } = null;
  let pinch: null | { d0: number; z0: number; fx: number; fy: number } = null;
  let lastTap = 0, lastX = 0, lastY = 0, moved = false;
  const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const zoomAt = (z: number, mx: number, my: number, fx?: number, fy?: number) => {
    const r0 = host.getBoundingClientRect();
    fx ??= (mx - r0.left) / r0.width; fy ??= (my - r0.top) / r0.height;
    zoom = Math.max(1, Math.min(5, z));
    setZoomLayout();
    const r1 = host.getBoundingClientRect();
    stage.scrollLeft += r1.left + fx * r1.width - mx;
    stage.scrollTop += r1.top + fy * r1.height - my;
  };
  let sharpT: number | undefined;
  const sharpen = () => {
    clearTimeout(sharpT);
    sharpT = window.setTimeout(async () => {
      const ref = refs[idx], my = renderSeq, z = zoom;
      if (!curDoc || curDoc.kind === 'text' || z < 1.3) return;
      const pdf = await getPdf(ref.doc);
      const res = await renderPdfPage(pdf, page, null, rangesFor(curDoc, page, ref.q), pageWidth() * z, { trim: true, cropY: true, dpr: 2 });
      if (my !== renderSeq || z !== zoom || res.cancelled) { res.cleanup(); return; }
      const old = zoomDrawn; zoomDrawn = { frame: res.frame, cleanup: res.cleanup };
      host.replaceChildren(res.frame);
      old?.cleanup();
    }, 280);
  };
  const clearPeek = () => { peek?.remove(); peek = null; };
  stage.addEventListener('touchstart', (e) => {
    if (stage.classList.contains('snap')) { s = null; return; } // a web page scrolls and zooms by itself
    if (e.touches.length === 2) {
      s = null; clearPeek(); host.style.transform = ''; host.style.opacity = '';
      const t = e.touches, r = host.getBoundingClientRect();
      const mx = (t[0].clientX + t[1].clientX) / 2, my = (t[0].clientY + t[1].clientY) / 2;
      pinch = { d0: dist(t), z0: zoom, fx: (mx - r.left) / r.width, fy: (my - r.top) / r.height };
      return;
    }
    if (e.touches.length !== 1) return;
    moved = false;
    const t = e.touches[0];
    s = zoom <= 1.01 && curDoc ? { x: t.clientX, y: t.clientY, t: performance.now(), on: false, dir: 0, w: host.offsetWidth, next: -1, ready: null } : null;
  }, { passive: true });
  stage.addEventListener('touchmove', (e) => {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const t = e.touches;
      zoomAt(pinch.z0 * (dist(t) / pinch.d0), (t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2, pinch.fx, pinch.fy);
      return;
    }
    const t = e.touches[0];
    if (t && (Math.abs(t.clientX - lastX) > 8 || Math.abs(t.clientY - lastY) > 8)) moved = true;
    if (!s || !t || !curDoc) return;
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (!s.on) {
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) * 1.3) { s = null; return; } // scrolling
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 0.7) return;
      s.on = true;
    }
    e.preventDefault();
    const dir = dx < 0 ? 1 : -1;
    const n = page + dir;
    const edge = n < 0 || n >= curDoc.pages.length;
    if (dir !== s.dir) {
      s.dir = dir; clearPeek(); s.ready = null; s.next = n;
      if (!edge) {
        peek = document.createElement('div');
        peek.className = 'rd-page rd-peek';
        Object.assign(peek.style, { top: host.offsetTop + 'px', left: host.offsetLeft + 'px', width: s.w + 'px' });
        peek.innerHTML = `<p class="rd-peek-l">${esc(curDoc.labels[n] || '')}</p>`;
        stage.append(peek);
        const want = n, ref = refs[idx], pk = peek;
        draw(ref.doc, want, ref.q).then((d) => { if (d && s && s.next === want && peek === pk) { s.ready = d; pk.replaceChildren(d.frame); } });
      }
    }
    const move = edge ? Math.sign(dx) * Math.min(60, Math.abs(dx) * 0.3) : dx;
    host.style.transform = `translateX(${move}px)`;
    host.style.opacity = String(edge ? 1 : 1 - Math.min(0.6, Math.abs(dx) / (s.w * 0.6) * 0.6));
    if (peek) peek.style.transform = `translateX(${dir * (s.w + SWIPE_GAP) + move}px)`;
  }, { passive: false });
  const end = (e: TouchEvent) => {
    if (pinch) {
      if (e.touches.length < 2) { pinch = null; if (zoom < 1.05) resetZoom(); else sharpen(); }
      return;
    }
    // Double-tap: zoom in where you tapped, or back out.
    const t = e.changedTouches[0];
    if (!s?.on && !moved && t) {
      const now = performance.now();
      if (now - lastTap < 300 && Math.hypot(t.clientX - lastX, t.clientY - lastY) < 30) {
        lastTap = 0;
        if (zoom > 1.01) resetZoom(); else { zoomAt(2.5, t.clientX, t.clientY); sharpen(); }
        s = null; return;
      }
      lastTap = now; lastX = t.clientX; lastY = t.clientY;
    }
    if (!s || !s.on || !t) { s = null; return; }
    const { dir, w, next } = s;
    const dx = t.clientX - s.x;
    const v = Math.abs(dx) / Math.max(1, performance.now() - s.t);
    s = null;
    const from = host.style.transform, fromO = host.style.opacity || '1';
    const ok = curDoc && next >= 0 && next < curDoc.pages.length && (dx < 0 ? 1 : -1) === dir && (Math.abs(dx) >= SWIPE_AT || v > 0.45);
    const ease = 'cubic-bezier(0.2, 0.9, 0.3, 1)';
    if (!ok) {
      host.style.transform = ''; host.style.opacity = '';
      host.animate([{ transform: from, opacity: fromO }, { transform: 'none', opacity: 1 }], { duration: 240, easing: ease });
      const pk = peek; peek = null;
      if (pk) pk.animate([{ transform: pk.style.transform }, { transform: `translateX(${dir * (w + SWIPE_GAP)}px)` }], { duration: 240, easing: ease }).onfinish = () => pk.remove();
      return;
    }
    const pk = peek; peek = null;
    host.animate([{ transform: from, opacity: fromO }, { transform: `translateX(${-dir * (w + SWIPE_GAP)}px)`, opacity: 0 }], { duration: 220, easing: ease, fill: 'forwards' });
    const go = () => {
      host.getAnimations().forEach((a) => a.cancel());
      host.style.transform = ''; host.style.opacity = '';
      if (pk?.firstElementChild?.classList.contains('pdf-frame') || pk?.firstElementChild?.classList.contains('rd-text')) host.replaceChildren(pk.firstElementChild!);
      pk?.remove();
      stage.scrollTop = 0;
      show(idx, next);
    };
    if (pk) pk.animate([{ transform: pk.style.transform }, { transform: 'translateX(0)' }], { duration: 220, easing: ease, fill: 'forwards' }).onfinish = go;
    else go();
  };
  stage.addEventListener('touchend', end, { passive: true });
  stage.addEventListener('touchcancel', end, { passive: true });
  // iOS Safari's own page zoom would fight ours.
  dlg!.addEventListener('gesturestart', (e) => e.preventDefault());
  dlg!.addEventListener('gesturechange', (e) => e.preventDefault());
  // Laptop: ctrl + scroll (and trackpad pinch) zooms, a sideways trackpad swipe turns the page.
  let acc = 0, quiet = 0, accT: number | undefined;
  stage.addEventListener('wheel', (e) => {
    if (e.ctrlKey) { e.preventDefault(); zoomAt(zoom * Math.exp(-e.deltaY / 200), e.clientX, e.clientY); if (zoom < 1.03) resetZoom(); else sharpen(); return; }
    if (zoom > 1.01 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    if (performance.now() < quiet) return;
    acc += e.deltaX; clearTimeout(accT); accT = window.setTimeout(() => (acc = 0), 220);
    if (Math.abs(acc) > 120 && curDoc) { const n = page + (acc > 0 ? 1 : -1); acc = 0; quiet = performance.now() + 600; if (n >= 0 && n < curDoc.pages.length) show(idx, n); }
  }, { passive: false });
}

/* ---------- wiring ---------- */
if (dlg) {
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>(READABLE);
    if (!a || !docFor(a) || e.metaKey || e.ctrlKey || e.shiftKey) return; // modifier-click still opens the original
    if (document.documentElement.classList.contains('editing')) return; // the editor handles links itself
    e.preventDefault();
    const { list, at } = sectionRefs(a);
    openReader(list, at);
  });
  // Start drawing the moment a finger lands on a reference, before the tap even finishes.
  document.addEventListener('pointerdown', (e) => {
    const a = (e.target as HTMLElement).closest?.<HTMLAnchorElement>(READABLE);
    if (a && docFor(a) && !document.documentElement.classList.contains('editing')) warmRef(refOf(a));
  }, { passive: true });
  // Get the reader ready while the lesson is being read: the PDF library, the sources, and the cited
  // pages of references as they scroll into view.
  const article = document.querySelector('[data-article]');
  if (article) {
    const start = () => linksReady.then(() => {
      const anchors = [...article.querySelectorAll<HTMLAnchorElement>(READABLE)].filter((a) => docFor(a));
      if (!anchors.length) return;
      loadPdfLib().catch(() => {});
      for (const id of new Set(anchors.map((a) => docFor(a)!))) getDoc(id).then((d) => { if (d.kind !== 'text') getPdf(id); }).catch(() => {});
      const io = new IntersectionObserver((es) => es.forEach((en) => {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        later(() => warmRef(refOf(en.target as HTMLAnchorElement)));
      }), { rootMargin: '200px 0px' });
      anchors.forEach((a) => io.observe(a));
    });
    if (document.readyState === 'complete') setTimeout(start, 400); else addEventListener('load', () => setTimeout(start, 400));
  }

  $('[data-rd-prev]').addEventListener('click', () => show(idx - 1));
  $('[data-rd-next]').addEventListener('click', () => show(idx + 1));
  $('[data-rd-prevpage]').addEventListener('click', () => show(idx, page - 1));
  $('[data-rd-nextpage]').addEventListener('click', () => show(idx, page + 1));
  $('[data-rd-expand]').addEventListener('click', () => { dlg.classList.toggle('expanded'); show(idx, page); });

  const inp = $<HTMLInputElement>('[data-rd-q]');
  const chips = $('[data-rd-chips]');
  let filledFor = '';
  $('[data-rd-search]').addEventListener('click', () => {
    dlg.classList.toggle('searching');
    if (!dlg.classList.contains('searching')) return;
    // Prefill with the words of the reference you're looking at now (kept if you typed for this same one).
    const key = `${refs[idx]?.doc}|${refs[idx]?.page}|${refs[idx]?.q}`;
    if (key !== filledFor || !inp.value.trim()) { inp.value = refs[idx]?.q || ''; filledFor = key; }
    chips.innerHTML = chipWords().map((w) => `<button type="button" data-w="${esc(w)}">${esc(w)}</button>`).join('');
    chips.scrollLeft = 0;
    inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
    runSearch(inp.value);
  });
  chips.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the keyboard up
  chips.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-w]');
    if (!b) return;
    const w = b.dataset.w!;
    const have = inp.value.toLowerCase().split(/\s+/);
    if (!w.toLowerCase().split(/\s+/).every((x) => have.includes(x))) inp.value = `${inp.value.trim()} ${w}`.trim();
    b.classList.add('on');
    runSearch(inp.value);
  });
  let t: number | undefined;
  inp.addEventListener('input', () => { clearTimeout(t); t = window.setTimeout(() => runSearch(inp.value), 150); });
  { const pill = $('[data-mode-pill-rd]'); if (pill && !pill.dataset.modePill) { bindModePill(pill); onModeChange(() => { if (dlg.classList.contains('searching')) runSearch(inp.value); }); } }
  dlg.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches('input')) return;
    if (e.key === 'ArrowRight' && curDoc && page < curDoc.pages.length - 1) show(idx, page + 1);
    if (e.key === 'ArrowLeft' && page > 0) show(idx, page - 1);
  });
  dlg.addEventListener('close', () => { resetZoom(); dlg.classList.remove('expanded', 'searching'); });
  bindGestures();
}
