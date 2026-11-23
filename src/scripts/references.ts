// References folder on Home: every source in the binder's library (the same ones the reader and its
// search use), sorted into folders by kind (ACS, PHAK, AFH, AIM, 14 CFR…) so you can browse any of them by
// hand. Tapping one opens it in the source reader at its first page; ‹ › in the reader steps through the
// other sources in the same folder.
import { openReader } from './reader';

type Entry = { id: string; title: string; short: string; url: string; pages?: number };
type Group = { key: string; title: string; strip?: RegExp; items: Entry[] };

const FOLDER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const BOOK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/><path d="M8 7h7"/></svg>';
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// Folders in the order they show, FAA first. `match` picks the docs that belong; the first match wins.
const KINDS: { key: string; title: string; match: (d: Entry) => boolean; strip?: RegExp }[] = [
  { key: 'acs', title: 'ACS', match: (d) => d.short === 'ACS' || d.id.startsWith('acs-') },
  { key: 'phak', title: 'PHAK', match: (d) => d.short === 'PHAK', strip: /^PHAK\s+/ },
  { key: 'afh', title: 'AFH', match: (d) => d.short === 'AFH', strip: /^AFH\s+/ },
  { key: 'ifh', title: 'IFH', match: (d) => d.short === 'IFH' },
  { key: 'hb', title: 'Other FAA handbooks', match: (d) => /handbook/i.test(d.title) && !d.id.startsWith('web-') },
  { key: 'aim', title: 'AIM', match: (d) => d.short === 'AIM', strip: /^AIM\s+/ },
  { key: 'cfr', title: '14 CFR', match: (d) => d.short === '14 CFR', strip: /^14 CFR\s+/ },
  { key: 'ac', title: 'Advisory Circulars', match: (d) => /^AC\b/.test(d.short) },
  { key: 'faa', title: 'FAA web pages', match: (d) => d.short === 'FAA' },
];

// Natural order, so Chapter 2 comes before Chapter 10 and Part 61 before Part 91.
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function groupsOf(lib: Entry[]): { faa: Group[]; web: Group[]; other: Entry[] } {
  const faa: Group[] = KINDS.map((k) => ({ key: k.key, title: k.title, strip: k.strip, items: [] }));
  const sites = new Map<string, Group>();
  const other: Entry[] = [];
  for (const d of lib) {
    const k = KINDS.findIndex((x) => x.match(d));
    if (k >= 0) { faa[k].items.push(d); continue; }
    if (d.id.startsWith('web-')) {
      const site = d.short || 'Web';
      if (!sites.has(site)) sites.set(site, { key: `web:${site}`, title: site, items: [] });
      sites.get(site)!.items.push(d);
      continue;
    }
    other.push(d);
  }
  const byTitle = (a: Entry, b: Entry) => natural.compare(a.title, b.title);
  for (const g of [...faa, ...sites.values()]) g.items.sort(byTitle);
  return { faa: faa.filter((g) => g.items.length), web: [...sites.values()].sort((a, b) => natural.compare(a.title, b.title)), other: other.sort(byTitle) };
}

const fold = (key: string, title: string, inner: string, n?: number) =>
  `<li class="sub"><details class="fold" data-fold="${esc(key)}"><summary><span class="chev" aria-hidden="true"></span><span class="ico">${FOLDER}</span><span class="fold-t">${esc(title)}</span>${n ? `<small class="fold-n">${n}</small>` : ''}</summary><ul>${inner}</ul></details></li>`;

/** The References folder. Its contents load from the library list the first time it's opened. */
export function referencesFolder(base: string, onFolds: () => void): HTMLDetailsElement {
  const el = document.createElement('details');
  el.className = 'fold refs-fold';
  el.dataset.fold = 'References';
  el.innerHTML = `<summary><span class="chev" aria-hidden="true"></span><span class="ico">${FOLDER}</span><span class="fold-t">References</span></summary><ul><li class="pg-empty">Loading…</li></ul>`;
  const list = el.querySelector('ul')!;
  let groups: Group[] = [];
  let loading: Promise<void> | null = null;

  const row = (g: number, i: number, d: Entry, strip?: RegExp) =>
    `<li><a class="pg" href="${esc(d.url)}" data-ref-g="${g}" data-ref-i="${i}"><span class="ico">${BOOK}</span><span class="pg-t">${esc(strip ? d.title.replace(strip, '') : d.title)}</span></a></li>`;

  const load = () => (loading ??= fetch(new URL('library/index.json', new URL(base, location.href)))
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then((lib: Entry[]) => {
      const { faa, web, other } = groupsOf(lib);
      groups = [...faa, ...web, ...(other.length ? [{ key: 'other', title: 'Other', items: other }] : [])];
      const html = (g: Group) => g.items.map((d, i) => row(groups.indexOf(g), i, d, g.strip)).join('');
      list.innerHTML = [
        ...faa.map((g) => fold(`References / ${g.key}`, g.title, html(g), g.items.length)),
        web.length ? fold('References / web', 'Web sources', web.map((g) => fold(`References / ${g.key}`, g.title, html(g), g.items.length)).join(''), web.reduce((n, g) => n + g.items.length, 0)) : '',
        other.length ? fold('References / other', 'Other', html(groups[groups.length - 1]), other.length) : '',
      ].join('') || '<li class="pg-empty">No references yet</li>';
      onFolds();
    })
    .catch(() => {
      loading = null;
      list.innerHTML = '<li class="pg-empty">Couldn’t load the references. Check your connection and open the folder again.</li>';
    }));

  el.addEventListener('toggle', () => { if (el.open) load(); });
  if (el.open) load();
  // Warm the list once the page is idle, so the folder opens already filled.
  const idle = (window as any).requestIdleCallback || ((f: () => void) => setTimeout(f, 800));
  idle(() => load());

  list.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-ref-g]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return; // modifier-click still opens the original site
    const g = groups[Number(a.dataset.refG)];
    if (!g) return;
    e.preventDefault();
    openReader(g.items.map((d) => ({ doc: d.id, page: 0, label: d.title, href: d.url, q: '' })), Number(a.dataset.refI));
  });
  return el;
}
