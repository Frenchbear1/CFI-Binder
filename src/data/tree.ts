// The binder's folders can hold pages and more folders, as deep as you like. A folder is anything with
// `topics`; a page has `levels` (and `slug` once it's written). The top level of outline.json (`areas`)
// is always folders. Shared by the build (home page, side menu) and the app (home.ts, editor.ts).
export type Page = { title: string; slug?: string; levels: string[] };
export type Folder = { title: string; topics: Node[] };
export type Node = Page | Folder;

export const isFolder = (n: Node): n is Folder => Array.isArray((n as Folder).topics);

/** Every page inside these nodes, at any depth, in order. */
export const pagesIn = (nodes: Node[]): Page[] => nodes.flatMap((n) => (isFolder(n) ? pagesIn(n.topics) : [n]));

/** The folders above a page, top first (empty if it isn't in the list). */
export function foldersOf(areas: Folder[], slug: string): string[] {
  const walk = (nodes: Node[], path: string[]): string[] | null => {
    for (const n of nodes) {
      if (isFolder(n)) { const r = walk(n.topics, [...path, n.title]); if (r) return r; }
      else if (n.slug === slug) return path;
    }
    return null;
  };
  return walk(areas, []) || [];
}

/** A node by its place in the tree, e.g. "2.0.3" (the 4th item of the 1st item of the 3rd folder). */
export function nodeAt(areas: Folder[], at: string): Node | undefined {
  let list: Node[] = areas, n: Node | undefined;
  for (const i of at.split('.').map(Number)) { n = list[i]; if (!n) return undefined; list = isFolder(n) ? n.topics : []; }
  return n;
}
/** The list a node sits in. */
export function listOf(areas: Folder[], at: string): Node[] | undefined {
  const p = at.split('.'); if (p.length === 1) return areas;
  const parent = nodeAt(areas, p.slice(0, -1).join('.'));
  return parent && isFolder(parent) ? parent.topics : undefined;
}

/** Every folder, in order, with its place and how deep it is (for "where should this go?" lists). */
export function allFolders(areas: Folder[]): { at: string; title: string; path: string[]; depth: number }[] {
  const out: { at: string; title: string; path: string[]; depth: number }[] = [];
  const walk = (nodes: Node[], pre: string, path: string[]) => nodes.forEach((n, i) => {
    if (!isFolder(n)) return;
    const at = pre ? `${pre}.${i}` : String(i), p = [...path, n.title];
    out.push({ at, title: n.title, path: p, depth: path.length });
    walk(n.topics, at, p);
  });
  walk(areas, '', []);
  return out;
}

const LV_ALL = 'pa ir ca';
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const PAGE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>';
const FOLDER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

export interface TreeOpts {
  base: string;
  /** Where a page's link goes (default: its page on the site). */
  href?: (slug: string) => string;
  /** A small tag after a page's name ("Edited", "On this device"), or 'building' while it's being published. */
  tag?: (slug: string) => string | 'building' | '';
}

/** The home page's folder list as HTML: folders open and close; each row knows its place (data-node) for dragging. */
export function treeHtml(areas: Folder[], o: TreeOpts): string {
  const href = o.href || ((s: string) => `${o.base}${s}/`);
  const page = (p: Page, at: string, path: string[]) => {
    const lv = (p.levels || []).join(' ');
    if (!p.slug) return `<li data-node="${at}" data-for="${lv}"><button type="button" class="pg planned" data-plan="${esc(p.title)}" data-in="${at.split('.').slice(0, -1).join('.')}" data-levels="${lv}"><span class="ico">${PAGE}</span><span class="pg-t">${esc(p.title)}</span><small>Planned</small></button></li>`;
    const tag = o.tag?.(p.slug) || '';
    if (tag === 'building') return `<li data-node="${at}" data-for="${lv}"><span class="pg building" data-slug="${esc(p.slug)}"><span class="ico">${PAGE}</span><span class="pg-t">${esc(p.title)}</span><small>Publishing…</small></span></li>`;
    return `<li data-node="${at}" data-for="${lv}"><a class="pg" href="${href(p.slug)}"><span class="ico">${PAGE}</span><span class="pg-t">${esc(p.title)}</span>${tag ? `<small class="is-local">${esc(tag)}</small>` : ''}</a></li>`;
  };
  const folder = (f: Folder, at: string, path: string[]): string => {
    const all = pagesIn(f.topics), ready = all.filter((p) => p.slug).length;
    const lv = [...new Set(all.flatMap((p) => p.levels || []))].join(' ') || LV_ALL;
    const key = [...path, f.title].join(' / ');
    const items = f.topics.map((n, i) => (isFolder(n) ? `<li class="sub" data-for="${[...new Set(pagesIn(n.topics).flatMap((p) => p.levels || []))].join(' ') || LV_ALL}">${folder(n, `${at}.${i}`, [...path, f.title])}</li>` : page(n, `${at}.${i}`, [...path, f.title]))).join('');
    const count = all.length ? (ready === all.length ? String(ready) : `${ready} of ${all.length}`) : '';
    return `<details class="fold" data-node="${at}" data-fold="${esc(key)}" data-for="${lv}"${ready ? ' open' : ''}><summary><span class="chev" aria-hidden="true"></span><span class="ico">${FOLDER}</span><span class="fold-t">${esc(f.title)}</span><span class="fold-n">${count}</span><button type="button" class="fold-add" data-new-in="${at}" aria-label="Add to ${esc(f.title)}" title="Add a page or folder here">+</button></summary><ul>${items || '<li class="pg-empty">Empty</li>'}</ul></details>`;
  };
  return areas.map((a, i) => folder(a, String(i), [])).join('');
}
