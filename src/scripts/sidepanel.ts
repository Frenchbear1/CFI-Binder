// Side panel on iPad, Windows and Mac (768px and wider): when a lesson is open, Home's folders sit in a
// panel at the left, with a box at the top to find a page by name. The button at the left of the top bar
// (or Ctrl/⌘ + \) hides and shows it. On a laptop or a landscape iPad (1024px+) it sits beside the page
// and the device remembers whether you left it open; on a portrait iPad it slides over the page and closes
// when you tap outside it. Phones keep the dock and the Contents sheet.
import interactives from '../data/interactives.json';
import { referencesFolder } from './references';
import { hrefOf } from './cloud';
import { treeHtml, type Folder } from '../data/tree';

const side = document.querySelector<HTMLElement>('[data-side]');
if (side) init(side);

function init(side: HTMLElement) {
  const root = document.documentElement;
  const base = document.body.dataset.base || '/';
  const treeEl = side.querySelector<HTMLElement>('[data-side-tree]')!;
  const q = side.querySelector<HTMLInputElement>('[data-side-q]')!;
  const toggles = [...document.querySelectorAll<HTMLButtonElement>('[data-side-toggle]')];
  const scrim = document.querySelector<HTMLElement>('[data-side-scrim]');
  const wide = matchMedia('(min-width: 1024px)'); // beside the page
  const big = matchMedia('(min-width: 768px)'); // there at all
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

  /* ---------- open / closed ---------- */
  const remembered = () => { try { return localStorage.getItem('cfi.side') !== 'closed'; } catch { return true; } };
  const isOpen = () => root.classList.contains('side-open');
  function set(open: boolean, remember = false) {
    root.classList.toggle('side-open', open);
    syncInert();
    toggles.forEach((b) => { b.setAttribute('aria-expanded', String(open)); b.title = open ? 'Hide the binder (Ctrl \\)' : 'Show the binder (Ctrl \\)'; });
    if (remember && wide.matches) try { localStorage.setItem('cfi.side', open ? 'open' : 'closed'); } catch {}
    if (open) side.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
  }
  const fit = () => set(big.matches && wide.matches && remembered());
  set(isOpen() && big.matches);
  wide.addEventListener?.('change', fit); big.addEventListener?.('change', fit);
  toggles.forEach((b) => b.addEventListener('click', () => set(!isOpen(), true)));
  scrim?.addEventListener('click', () => set(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === '\\' && (e.ctrlKey || e.metaKey) && big.matches) { e.preventDefault(); set(!isOpen(), true); }
    if (e.key === 'Escape' && isOpen() && !wide.matches) set(false);
  });
  // Slid over the page (portrait iPad): following a link closes it.
  treeEl.addEventListener('click', (e) => { if (!wide.matches && (e.target as HTMLElement).closest('a')) set(false); });
  // While you edit a lesson the panel steps aside.
  function syncInert() { side.inert = !isOpen() || !big.matches || root.classList.contains('editing'); }
  new MutationObserver(syncInert).observe(root, { attributes: true, attributeFilter: ['class'] });

  /* ---------- the folder tree ---------- */
  const folds: Record<string, boolean> = (() => { try { return JSON.parse(sessionStorage.getItem('cfi.sideFolds') || '{}'); } catch { return {}; } })();
  const saveFolds = () => { try { sessionStorage.setItem('cfi.sideFolds', JSON.stringify(folds)); } catch {} };
  const FOLDER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  const SIM = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/></svg>';
  const sims = document.createElement('details');
  sims.className = 'fold'; sims.dataset.fold = 'Interactives';
  sims.innerHTML = `<summary><span class="chev" aria-hidden="true"></span><span class="ico">${FOLDER}</span><span class="fold-t">Interactives</span></summary><ul>${interactives.items.map((s) => `<li class="row"><a class="pg" href="${base}interactives/${s.id}/"><span class="ico">${SIM}</span><span class="pg-t">${esc(s.name)}</span></a></li>`).join('')}</ul>`;
  const refs = referencesFolder(base, () => bind());

  // Which link is this page? Lessons by path; pages made in the app by their ?p=.
  const here = (() => {
    const p = new URLSearchParams(location.search).get('p');
    return p ? `${location.pathname}?p=${encodeURIComponent(p)}` : location.pathname;
  })();
  const isHere = (a: HTMLAnchorElement) => { const u = new URL(a.href, location.href); return (u.searchParams.get('p') ? u.pathname + u.search : u.pathname) === here; };

  function bind() {
    treeEl.querySelectorAll<HTMLDetailsElement>('details.fold').forEach((d) => {
      if (d.dataset.bound) return;
      d.dataset.bound = '1';
      const k = d.dataset.fold!;
      if (k in folds) d.open = folds[k];
      d.addEventListener('toggle', () => { if (filtering) return; folds[k] = d.open; saveFolds(); });
    });
  }
  function render(areas: Folder[]) {
    treeEl.innerHTML = treeHtml(areas, { base, href: hrefOf });
    treeEl.append(sims, refs);
    treeEl.querySelectorAll('.row-more').forEach((b) => b.remove());
    treeEl.querySelectorAll<HTMLButtonElement>('.pg.planned').forEach((b) => { b.disabled = true; b.title = 'Not written yet'; });
    // this page: marked, and its folders open
    treeEl.querySelectorAll<HTMLAnchorElement>('a.pg').forEach((a) => {
      if (!isHere(a)) return;
      a.setAttribute('aria-current', 'page');
      for (let d = a.closest('details'); d; d = d.parentElement!.closest('details')) folds[d.dataset.fold!] = true;
    });
    bind();
    if (q.value.trim()) filter();
  }

  /* ---------- find a page by name ---------- */
  let filtering = false;
  function filter() {
    const words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    filtering = words.length > 0;
    side.classList.toggle('filtering', filtering);
    const rows = [...treeEl.querySelectorAll<HTMLElement>('.pg')].map((p) => p.closest('li')!).filter(Boolean);
    const folders = [...treeEl.querySelectorAll<HTMLDetailsElement>('details.fold')];
    if (!filtering) {
      rows.forEach((r) => r.classList.remove('f-hide'));
      folders.forEach((d) => { d.classList.remove('f-hide'); d.open = folds[d.dataset.fold!] ?? false; });
      return;
    }
    const hit = (t: string) => { t = t.toLowerCase(); return words.every((w) => t.includes(w)); };
    rows.forEach((r) => {
      const path = [r.querySelector('.pg-t')?.textContent || ''];
      for (let d = r.closest('details'); d; d = d.parentElement!.closest('details')) path.push(d.querySelector(':scope > summary .fold-t')?.textContent || '');
      r.classList.toggle('f-hide', !hit(path.join(' ')));
    });
    // deepest folders first, so a folder knows whether anything inside it is still showing
    folders.reverse().forEach((d) => {
      const any = !!d.querySelector(':scope > ul > li:not(.f-hide):not(.pg-empty)');
      d.classList.toggle('f-hide', !any);
      d.closest('li.sub')?.classList.toggle('f-hide', !any);
      d.open = any;
    });
    side.querySelector<HTMLElement>('[data-side-none]')!.hidden = !!treeEl.querySelector('li:not(.f-hide) > .pg');
  }
  q.addEventListener('input', filter);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { q.value = ''; filter(); q.blur(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = treeEl.querySelector<HTMLAnchorElement>('li:not(.f-hide) > a.pg');
      if (first && filtering) first.click();
    }
  });
  // "Search inside the lessons" hands the words to the full search
  side.querySelector('[data-side-search]')?.addEventListener('click', () => {
    const words = q.value;
    document.querySelector<HTMLElement>('.searchfield')?.click();
    const input = document.querySelector<HTMLInputElement>('[data-search-input]');
    if (input && words.trim()) { input.value = words; input.dispatchEvent(new Event('input')); }
  });

  let built: Folder[] = [];
  try { built = JSON.parse(document.getElementById('outline-data')?.textContent || '[]'); } catch {}
  render(built);
  // the folder list as it is now in the cloud (live.ts)
  window.addEventListener('cfi:outline', (e) => render((e as CustomEvent<Folder[]>).detail));
}
