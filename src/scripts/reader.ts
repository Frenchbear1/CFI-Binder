// In-lesson source reader, built on Instant Search's PDF rendering and search engine.
// Tap a reference (e.g. "PHAK 5-19") and the real page slides up with the lesson's key terms highlighted.
// Swipe sideways to move through every source cited in that section; expand for full-screen reading and
// a search across the whole library.
import { compile } from '../lib/is/search.js';
import { renderPdfPage } from '../lib/is/pdf.js';

type Ref = { doc: string; page: number; at?: string; label: string; href: string; q: string };
type DocData = { id: string; title: string; short: string; url: string; kind?: 'text'; labels: string[]; pages: string[] };

const base = new URL(document.body.dataset.base || '/', document.baseURI).href;
const dlg = document.getElementById('sheet-reader') as HTMLDialogElement | null;
const $ = <T extends HTMLElement>(sel: string) => dlg?.querySelector<T>(sel) as T;

let refs: Ref[] = [];
let idx = 0;
let page = 0; // page currently shown (can move away from the cited page)
let library: { id: string; title: string; short: string; pages: number; updated?: string }[] | null = null;
const docs = new Map<string, Promise<DocData>>();
const pdfs = new Map<string, Promise<any>>();
let cleanupPrev: (() => void) | null = null;
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
const getPdf = (id: string) => {
  if (!pdfs.has(id)) pdfs.set(id, loadPdfLib().then((lib) => lib.getDocument({ url: new URL(`library/${id}.pdf`, base).href, isEvalSupported: false }).promise));
  return pdfs.get(id)!;
};
// url -> doc id for every page the build snapshotted, so plain links (Boldmethod, CFI Notebook…) open here too.
let links: Record<string, string> = {};
const loadLinks = () => fetch(new URL('library/links.json', base)).then((r) => (r.ok ? r.json() : {})).then((j) => (links = j)).catch(() => {});
const norm = (u: string) => { try { const x = new URL(u, location.href); x.hash = ''; return x.href; } catch { return ''; } };
const isPdfUrl = (u: string) => /\.pdf($|[?#])/i.test(u);
// The doc a link opens in the reader, if any.
function docFor(a: HTMLAnchorElement): string | undefined {
  if (a.dataset.doc) return a.dataset.doc;
  if (!/^https?:/.test(a.href) || a.closest('.video, [data-noreader]')) return;
  return links[norm(a.href)];
}
const READABLE = '[data-article] a[href]';
const getLibrary = async () => (library ??= await fetch(new URL('library/index.json', base)).then((r) => r.json()).catch(() => []));

/* ---------- which words to highlight ---------- */
// The ref's own q, else the bold words in the paragraph it ends (minus the reference itself).
function queryFor(a: HTMLAnchorElement) {
  if (a.dataset.q) return a.dataset.q;
  const block = a.closest('p, li, td, .callout-body') || a.parentElement;
  const words = [...(block?.querySelectorAll('strong') || [])].map((s) => s.textContent || '').join(' ');
  return words.replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter((w) => w.length > 3 && !/^(the|and|with|that|your|more|both)$/i.test(w)).join(' ');
}

// All library refs in the same section (between the h2s around the tapped one), in reading order.
function sectionRefs(a: HTMLAnchorElement): { list: Ref[]; at: number } {
  const article = a.closest('[data-article]');
  const all = [...(article?.querySelectorAll<HTMLAnchorElement>(READABLE) || [])].filter((x) => docFor(x) && (x.offsetParent !== null || x === a));
  const h2s = [...(article?.querySelectorAll('h2') || [])];
  const sectionOf = (el: Element) => h2s.filter((h) => h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).length;
  const sec = sectionOf(a);
  const mine = all.filter((x) => sectionOf(x) === sec);
  const list: Ref[] = [];
  let at = 0;
  for (const x of mine) {
    const pdfPage = !x.dataset.doc && isPdfUrl(x.href) ? Number((x.href.match(/#page=(\d+)/) || [])[1] || 1) - 1 : -1;
    const r = { doc: docFor(x)!, page: x.dataset.page ? Number(x.dataset.page) : pdfPage, at: x.dataset.at, label: x.textContent || '', href: x.href, q: queryFor(x) };
    const dup = list.findIndex((y) => y.doc === r.doc && y.page === r.page && y.at === r.at);
    if (dup >= 0) { if (x === a) at = dup; if (!list[dup].q.includes(r.q)) list[dup].q = `${list[dup].q} ${r.q}`.trim(); continue; }
    if (x === a) at = list.length;
    list.push(r);
  }
  return { list, at };
}

/* ---------- rendering ---------- */
async function show(i: number, pageOverride?: number) {
  if (!dlg || !refs.length) return;
  idx = (i + refs.length) % refs.length;
  const ref = refs[idx];
  page = pageOverride ?? ref.page;
  const my = ++renderSeq;
  const stage = $('[data-rd-stage]');
  $('[data-rd-label]').textContent = ref.label;
  $('[data-rd-count]').textContent = refs.length > 1 ? `${idx + 1} of ${refs.length}` : '';
  $<HTMLAnchorElement>('[data-rd-orig]').href = ref.href;
  dlg.querySelectorAll('[data-rd-step]').forEach((b) => ((b as HTMLElement).hidden = refs.length < 2));
  stage.setAttribute('aria-busy', 'true');
  try {
    const doc = await getDoc(ref.doc);
    if (my !== renderSeq) return;
    if (pageOverride === undefined && ref.at) page = Math.max(0, doc.labels.indexOf(ref.at));
    page = Math.max(0, Math.min(page, doc.pages.length - 1));
    const web = doc.id.startsWith('web-');
    $('[data-rd-doc]').textContent = web ? `${doc.short} · ${doc.title}` : `${doc.title} · ${doc.kind === 'text' ? '' : 'page '}${doc.labels[page]}`;
    const m = ref.q ? compile(ref.q, { mode: 'any', wholeWord: false }) : null;
    const ranges = m && !('error' in m) ? m.soft(doc.pages[page]).map(([s, e, c]: number[]) => [s, e, c, null]) : [];
    const host = $('[data-rd-page]');
    if (doc.kind === 'text') {
      // AIM paragraphs and FAR sections: clean text with the same highlights.
      const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
      const text = doc.pages[page];
      let html = '', last = 0;
      for (const [s0, e0, c] of ranges) { html += esc(text.slice(last, s0)) + `<mark class="c${c}">${esc(text.slice(s0, e0))}</mark>`; last = e0; }
      html += esc(text.slice(last));
      cleanupPrev?.(); cleanupPrev = null;
      const para = (p: string) => {
        const img = p.replace(/<\/?mark[^>]*>/g, '').match(/^\[\[img (\S+)\|(.*)\]\]$/);
        if (img) return `<figure class="rd-fig"><img src="${img[1]}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()">${img[2] ? `<figcaption>${img[2]}</figcaption>` : ''}</figure>`;
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
      };
      host.innerHTML = `<div class="rd-text${web ? ' rd-web' : ''}">${web ? `<p class="rd-src">From ${esc(doc.short)}. Saved copy, refreshed weekly.</p>` : ''}${html.split(/\n{2,}/).map(para).join('')}</div>`;
    } else {
      const pdf = await getPdf(ref.doc);
      if (my !== renderSeq) return;
      const res = await renderPdfPage(pdf, page, host, ranges, host.clientWidth || stage.clientWidth);
      if (my !== renderSeq) return res.cleanup();
      cleanupPrev?.();
      res.show();
      cleanupPrev = res.cleanup;
    }
    const prev = $<HTMLButtonElement>('[data-rd-prevpage]'), next = $<HTMLButtonElement>('[data-rd-nextpage]');
    prev.hidden = page === 0; next.hidden = page >= doc.pages.length - 1;
    const unit = web ? '' : doc.kind === 'text' ? (doc.short === 'AIM' ? 'AIM ' : '§ ') : 'Page ';
    prev.textContent = page > 0 ? `↑ ${unit}${doc.labels[page - 1]}` : '';
    next.textContent = page < doc.pages.length - 1 ? `${unit}${doc.labels[page + 1]} ↓` : '';
    // Bring the first highlight into view.
    stage.scrollTop = 0;
    requestAnimationFrame(() => {
      const hit = host.querySelector<HTMLElement>('.box, mark');
      if (hit) stage.scrollTop = Math.max(0, hit.getBoundingClientRect().top - stage.getBoundingClientRect().top - stage.clientHeight * 0.3);
    });
  } catch {
    if (my !== renderSeq) return;
    $('[data-rd-page]').innerHTML = `<p class="rd-missing">This source isn’t in the binder’s library yet. <a href="${ref.href}" target="_blank" rel="noopener">Open it on the original site</a>.</p>`;
    $('[data-rd-doc]').textContent = '';
  } finally {
    if (my === renderSeq) stage.removeAttribute('aria-busy');
  }
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
  const m = compile(q, { mode: 'all', wholeWord: false });
  if (!m || 'error' in m) { out.innerHTML = m && 'error' in m ? `<p class="muted">${m.error}</p>` : ''; return; }
  const lib = await getLibrary();
  const hits: { doc: DocData; p: number; n: number; ex: string }[] = [];
  for (const d of lib) {
    const doc = await getDoc(d.id).catch(() => null);
    if (!doc) continue;
    doc.pages.forEach((text, p) => {
      const r = m.match(text);
      if (!r || !r.length) return;
      const [s] = r[0];
      const a = Math.max(0, s - 70);
      const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
      let ex = '', last = a;
      for (const [rs, re] of r.filter(([rs]: number[]) => rs < a + 180)) { ex += esc(text.slice(last, rs)) + '<mark>' + esc(text.slice(rs, re)) + '</mark>'; last = re; }
      ex += esc(text.slice(last, a + 180));
      hits.push({ doc, p, n: r.length, ex: (a > 0 ? '…' : '') + ex.replace(/\s+/g, ' ') + '…' });
    });
  }
  if (my !== searchSeq) return;
  hits.sort((x, y) => y.n - x.n);
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

/* ---------- wiring ---------- */
if (dlg) {
  loadLinks();
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>(READABLE);
    if (!a || !docFor(a) || e.metaKey || e.ctrlKey || e.shiftKey) return; // modifier-click still opens the original
    if (document.documentElement.classList.contains('editing')) return; // the editor handles links itself
    e.preventDefault();
    const { list, at } = sectionRefs(a);
    openReader(list, at);
  });
  $('[data-rd-prev]').addEventListener('click', () => show(idx - 1));
  $('[data-rd-next]').addEventListener('click', () => show(idx + 1));
  $('[data-rd-prevpage]').addEventListener('click', () => show(idx, page - 1));
  $('[data-rd-nextpage]').addEventListener('click', () => show(idx, page + 1));
  $('[data-rd-expand]').addEventListener('click', () => { dlg.classList.toggle('expanded'); show(idx, page); });
  $('[data-rd-search]').addEventListener('click', () => {
    dlg.classList.toggle('searching');
    if (dlg.classList.contains('searching')) { const inp = $<HTMLInputElement>('[data-rd-q]'); inp.value ||= refs[idx]?.q || ''; inp.focus(); inp.select(); runSearch(inp.value); }
  });
  let t: number | undefined;
  $<HTMLInputElement>('[data-rd-q]').addEventListener('input', (e) => { clearTimeout(t); t = window.setTimeout(() => runSearch((e.target as HTMLInputElement).value), 150); });
  dlg.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).matches('input')) return;
    if (e.key === 'ArrowRight') show(idx + 1);
    if (e.key === 'ArrowLeft') show(idx - 1);
  });
  dlg.addEventListener('close', () => { cleanupPrev?.(); cleanupPrev = null; dlg.classList.remove('expanded', 'searching'); });
  // Swipe left/right on the page to change source.
  const stage = $('[data-rd-stage]');
  let x0 = 0, y0 = 0;
  stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (refs.length > 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) show(idx + (dx < 0 ? 1 : -1));
  }, { passive: true });
}
