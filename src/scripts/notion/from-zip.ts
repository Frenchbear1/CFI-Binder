// Reads a Notion export (.zip, "Markdown & CSV" or "HTML", with sub-pages in folders) right here on the device
// and turns it into ImportPage trees (see types.ts for the html vocabulary).
//
// No libraries: the zip's central directory is parsed by hand (ZIP64 too), entries are read lazily with
// Blob.slice, and deflate goes through DecompressionStream('deflate-raw'). Outer zips that wrap
// "Export-…-Part-N.zip" files are opened and merged.
import type { ImportImage, ImportPage, Progress } from './types';

/* ============================================================ utilities */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™', deg: '°' };
function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return all; }
    }
    return NAMED[e.toLowerCase()] ?? all;
  });
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s.replace(/%20/g, ' '); }
}

const dirname = (p: string) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const extOf = (p: string) => { const b = basename(p); const i = b.lastIndexOf('.'); return i <= 0 ? '' : b.slice(i + 1).toLowerCase(); };
const stripExt = (p: string) => { const e = extOf(p); return e ? p.slice(0, p.length - e.length - 1) : p; };

function normPath(p: string): string {
  const out: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop(); else out.push(seg);
  }
  return out.join('/');
}

function hashId(s: string): string {
  let out = '';
  for (let k = 0; k < 4; k++) {
    let h = (0x811c9dc5 ^ Math.imul(k + 1, 0x9e3779b9)) >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  return out;
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff', 'ico']);
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff', ico: 'image/x-icon',
  pdf: 'application/pdf', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/mp4',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', txt: 'text/plain', csv: 'text/csv',
  json: 'application/json', zip: 'application/zip', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kml: 'application/vnd.google-earth.kml+xml',
};
const PAGE_EXT = new Set(['md', 'markdown', 'html', 'htm']);

function youTubeId(u: string): string | null {
  const m = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/i.exec(u);
  return m ? m[1] : null;
}

/** A link that stands on its own: YouTube → video, anything else → bookmark. */
function mediaFromUrl(url: string, title: string): string {
  const t = title && title !== url ? ` data-title="${esc(title)}"` : '';
  const yt = youTubeId(url);
  if (yt) return `<div data-kind="video" data-yt="${yt}"${t}></div>`;
  return `<div data-kind="bookmark" data-url="${esc(url)}"${t}></div>`;
}

const EMOJI_RE = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|⃣|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic}|\p{Regional_Indicator})*)\s*/u;

/** Picks a callout's data-k from its Notion icon (an emoji, or an icon image's name). */
export function calloutKind(icon: string): string {
  const e = icon.replace(/[️‍]/g, '');
  if (/[⚠❗❕‼🚨⛔🛑❌]/u.test(e) || /warn|alert|caution|danger|error|exclam/i.test(e)) return 'warn';
  if (/[✈🛩🛫🛬🚁]/u.test(e) || /airplane|plane|flight|aircraft/i.test(e)) return 'fleet';
  if (/[🎓📚📖📘📗📙]/u.test(e) || /graduat|book|school|teach|learn/i.test(e)) return 'teach';
  if (/[✅☑✔]/u.test(e) || /check/i.test(e)) return 'acs';
  return 'note';
}

/* ============================================================ zip reading */

type Entry = { path: string; size: number; read: (type?: string) => Promise<Blob> };

async function view(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}
const u64 = (dv: DataView, o: number) => Number(dv.getBigUint64(o, true));
const utf8 = new TextDecoder('utf-8');

/** Lists a zip's file entries from its central directory. Nothing but the directory is read. */
export async function listZip(blob: Blob): Promise<Entry[]> {
  const size = blob.size;
  if (size < 22) throw new Error('This file is not a .zip.');
  const tailStart = Math.max(0, size - 65557);
  const tail = await view(blob, tailStart, size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file is not a .zip (or it is damaged).');
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOff = tail.getUint32(eocd + 16, true);
  const eocdAbs = tailStart + eocd;
  if ((count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) && eocdAbs >= 20) {
    const loc = await view(blob, eocdAbs - 20, eocdAbs);
    if (loc.getUint32(0, true) === 0x07064b50) {
      const at = u64(loc, 8);
      const rec = await view(blob, at, at + 56);
      if (rec.getUint32(0, true) === 0x06064b50) { count = u64(rec, 32); cdSize = u64(rec, 40); cdOff = u64(rec, 48); }
    }
  }
  let cd = await view(blob, cdOff, cdOff + cdSize);
  let shift = 0;
  if (cd.byteLength < 4 || cd.getUint32(0, true) !== 0x02014b50) {
    // data was prepended to the zip: the directory sits right before the end record
    shift = eocdAbs - cdSize - cdOff;
    cd = await view(blob, cdOff + shift, cdOff + shift + cdSize);
    if (cd.byteLength < 4 || cd.getUint32(0, true) !== 0x02014b50) throw new Error('Could not read the .zip directory.');
  }
  const out: Entry[] = [];
  let p = 0;
  while (p + 46 <= cd.byteLength && cd.getUint32(p, true) === 0x02014b50) {
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    let csize = cd.getUint32(p + 20, true);
    let usize = cd.getUint32(p + 24, true);
    const nlen = cd.getUint16(p + 28, true), xlen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
    let offset = cd.getUint32(p + 42, true);
    const name = utf8.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
    // ZIP64 extra field
    let x = p + 46 + nlen;
    const xend = x + xlen;
    while (x + 4 <= xend) {
      const id = cd.getUint16(x, true), len = cd.getUint16(x + 2, true);
      if (id === 0x0001) {
        let q = x + 4;
        if (usize === 0xffffffff && q + 8 <= x + 4 + len) { usize = u64(cd, q); q += 8; }
        if (csize === 0xffffffff && q + 8 <= x + 4 + len) { csize = u64(cd, q); q += 8; }
        if (offset === 0xffffffff && q + 8 <= x + 4 + len) { offset = u64(cd, q); q += 8; }
      }
      x += 4 + len;
    }
    p += 46 + nlen + xlen + clen;
    if (flags & 1) continue; // encrypted
    const path = normPath(name);
    if (!path || name.endsWith('/') || name.endsWith('\\')) continue;
    const at = offset + shift;
    out.push({
      path, size: usize,
      read: async (type = '') => {
        const lh = await view(blob, at, at + 30);
        if (lh.getUint32(0, true) !== 0x04034b50) throw new Error(`Damaged zip entry: ${path}`);
        const start = at + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
        const raw = blob.slice(start, start + csize, type);
        if (method === 0) return raw;
        if (method === 8) {
          const stream = raw.stream().pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
          return await new Response(stream, type ? { headers: { 'content-type': type } } : undefined).blob();
        }
        throw new Error(`Unsupported compression (method ${method}) for ${path}`);
      },
    });
  }
  if (!out.length && count > 0) throw new Error('Could not read the .zip directory.');
  return out;
}

async function collectEntries(blob: Blob, into: Map<string, Entry>, progress: Progress, depth: number): Promise<void> {
  const list = await listZip(blob);
  for (const e of list) {
    if (/(^|\/)(__MACOSX|\.DS_Store)(\/|$)/.test(e.path) || basename(e.path).startsWith('._')) continue;
    if (extOf(e.path) === 'zip' && depth < 3) {
      progress(`Opening ${basename(e.path)}…`);
      try { await collectEntries(await e.read('application/zip'), into, progress, depth + 1); continue; }
      catch { /* not a readable zip: keep it as a plain file */ }
    }
    if (!into.has(e.path)) into.set(e.path, e);
  }
}

/* ============================================================ the page tree */

export type TreeNode = {
  key: string;        // path without extension; also the path of the page's sub-page folder
  file?: string;      // the .md/.html file, if any
  csv?: string;       // the database .csv (prefers "_all.csv"), if any
  title: string;      // from the filename (the page's own title replaces it when read)
  id: string;         // 32 hex
  hasId: boolean;
  virtual: boolean;   // a folder of rows with no file of its own (a database inside a page)
  parent: TreeNode | null;
  children: TreeNode[];
};

/** "Title 0123…cdef" → { title, id }. Without an id, the id is a stable hash of `key`. */
export function parseNotionName(base: string, key = base): { title: string; id: string; hasId: boolean } {
  const m = /^(.*?)[\s_-]*([0-9a-f]{32})$/i.exec(base);
  if (m) return { title: m[1].trim() || 'Untitled', id: m[2].toLowerCase(), hasId: true };
  return { title: base.trim() || 'Untitled', id: hashId(key), hasId: false };
}

/** Builds the page/database tree from the paths in an export. */
export function buildTree(paths: string[]): { roots: TreeNode[]; nodes: TreeNode[]; byKey: Map<string, TreeNode> } {
  const byKey = new Map<string, TreeNode>();
  const nodes: TreeNode[] = [];
  const node = (key: string, virtual = false) => {
    let n = byKey.get(key);
    if (!n) {
      const nm = parseNotionName(basename(key), key);
      n = { key, title: nm.title, id: nm.id, hasId: nm.hasId, virtual, parent: null, children: [] };
      byKey.set(key, n); nodes.push(n);
    }
    return n;
  };
  const sorted = [...paths].map(normPath).sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : a > b ? 1 : 0));
  for (const p of sorted) {
    const ext = extOf(p);
    if (PAGE_EXT.has(ext)) {
      if (/^index\.html?$/i.test(p)) continue; // workspace export's index
      let key = stripExt(p);
      const d = dirname(key);
      if (d && basename(d) === basename(key)) key = d; // "Page/Page.md" layout
      const n = node(key);
      if (!n.file || (extOf(n.file) !== 'md' && ext === 'md')) n.file = p;
    } else if (ext === 'csv') {
      const raw = stripExt(p);
      const all = /_all$/.test(raw);
      const n = node(all ? raw.slice(0, -4) : raw);
      if (!n.csv || all) n.csv = p;
    }
  }
  // folders of pages with no file of their own (e.g. an inline database's rows in the HTML export)
  const dirs = new Set<string>();
  for (const n of nodes) { const d = dirname(n.key); if (d) dirs.add(d); }
  for (const d of [...dirs].sort((a, b) => a.length - b.length)) {
    if (byKey.has(d)) continue;
    let anc = dirname(d), hasAnc = false;
    while (anc) { if (byKey.has(anc)) { hasAnc = true; break; } anc = dirname(anc); }
    if (hasAnc || parseNotionName(basename(d)).hasId) node(d, true);
  }
  const roots: TreeNode[] = [];
  for (const n of nodes) {
    let d = dirname(n.key);
    while (d && !byKey.has(d)) d = dirname(d);
    const parent = d ? byKey.get(d)! : null;
    n.parent = parent;
    (parent ? parent.children : roots).push(n);
  }
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const byTitle = (a: TreeNode, b: TreeNode) => coll.compare(a.title, b.title);
  for (const n of nodes) n.children.sort(byTitle);
  roots.sort(byTitle);
  return { roots, nodes, byKey };
}

/* ============================================================ CSV */

export function parseCsv(src: string): string[][] {
  src = src.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [], f = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

/* ============================================================ Markdown → html */

export type Resolved = { kind: 'page'; id: string } | { kind: 'asset'; ref: string } | null;
/** Gets a link target: a URL-decoded path relative to the page file, or an absolute http(s) URL. */
export type Resolver = (path: string) => Resolved;
type Block = { t: string; h: string; inner?: string };
type Cx = { resolve: Resolver };

const joinBlocks = (bs: Block[]) => bs.map(b => b.h).join('');
/** List item content: paragraphs become <br>-separated lines, other blocks stay. */
const liJoin = (bs: Block[], lead = false) => {
  let s = '', prevInline = lead;
  for (const b of bs) {
    if (b.t === 'p') { s += (prevInline ? '<br>' : '') + b.inner; prevInline = true; }
    else { s += b.h; prevInline = false; }
  }
  return s;
};

function resolveHref(href: string, cx: Cx): { r: Resolved; path: string } {
  href = href.trim();
  if (/^https?:\/\//i.test(href)) return { r: cx.resolve(href), path: href };
  const path = safeDecode(href.split('#')[0].split('?')[0]);
  if (!path) return { r: null, path };
  return { r: cx.resolve(path), path };
}

function linkOut(href: string, inner: string, cx: Cx): string {
  href = (href || '').trim();
  if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return inner;
  if (/^(mailto|tel):/i.test(href)) return `<a href="${esc(href)}">${inner}</a>`;
  const { r } = resolveHref(href, cx);
  if (r && r.kind === 'page') return `<a data-notion-page="${esc(r.id)}">${inner}</a>`;
  if (r) return inner;
  if (/^https?:\/\//i.test(href)) return `<a href="${esc(href)}">${inner}</a>`;
  return inner;
}

function looksLikeFilename(s: string) { return /\.[a-z0-9]{2,5}$/i.test(s.trim()) || /^untitled$/i.test(s.trim()); }

/** An image / file reference standing as a block. */
function mediaBlock(src: string, alt: string, captionHtml: string, cx: Cx, name = ''): string {
  src = (src || '').trim();
  if (!src || src.startsWith('data:')) return '';
  const cap = captionHtml ? `<figcaption>${captionHtml}</figcaption>` : '';
  if (/^https?:\/\//i.test(src)) {
    const r = cx.resolve(src);
    if (r && r.kind === 'page') return `<p><a data-notion-page="${esc(r.id)}">${esc(alt || name || 'Page')}</a></p>`;
    if (IMAGE_EXT.has(extOf(src.split(/[?#]/)[0])) || !name) return `<figure data-kind="image"><img src="${esc(src)}" alt="${esc(alt)}">${cap}</figure>`;
    return mediaFromUrl(src, name);
  }
  const { r, path } = resolveHref(src, cx);
  if (!r) return '';
  if (r.kind === 'page') return `<p><a data-notion-page="${esc(r.id)}">${esc(alt || name || basename(path))}</a></p>`;
  if (IMAGE_EXT.has(extOf(path))) return `<figure data-kind="image"><img src="@@IMG:${r.ref}@@" alt="${esc(alt)}">${cap}</figure>`;
  return `<div data-kind="file" data-url="@@IMG:${r.ref}@@" data-name="${esc(name || alt || basename(path))}"></div>`;
}

type LinkTok = { text: string; href: string; end: number };
/** Parses `[text](href "title")` starting at s[i] === '['. */
function parseLink(s: string, i: number): LinkTok | null {
  if (s[i] !== '[') return null;
  let depth = 0, k = i;
  for (; k < s.length; k++) {
    const c = s[k];
    if (c === '\\') { k++; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) break; }
  }
  if (k >= s.length || s[k + 1] !== '(') return null;
  const text = s.slice(i + 1, k);
  let j = k + 2, href = '';
  while (s[j] === ' ') j++;
  if (s[j] === '<') {
    const e = s.indexOf('>', j);
    if (e < 0) return null;
    href = s.slice(j + 1, e); j = e + 1;
  } else {
    let pd = 0; const st = j;
    for (; j < s.length; j++) {
      const c = s[j];
      if (c === '\\') { j++; continue; }
      if (c === '(') pd++;
      else if (c === ')') { if (pd === 0) break; pd--; }
      else if (c === ' ' && pd === 0) {
        // either a title follows or the path has a raw space
        const rest = s.slice(j).trimStart();
        if (rest[0] === '"' || rest[0] === "'") break;
      }
    }
    href = s.slice(st, j);
  }
  while (s[j] === ' ') j++;
  if (s[j] === '"' || s[j] === "'") { const e = s.indexOf(s[j], j + 1); if (e < 0) return null; j = e + 1; while (s[j] === ' ') j++; }
  if (s[j] !== ')') return null;
  return { text, href: href.trim(), end: j + 1 };
}

function findCode(s: string, i: number): number {
  let k = i; while (s[k] === '`') k++;
  const run = k - i;
  let j = k;
  while (j < s.length) {
    const e = s.indexOf('`'.repeat(run), j);
    if (e < 0) return -1;
    let r = e; while (s[r] === '`') r++;
    if (r - e === run) return e;
    j = r;
  }
  return -1;
}

function findClose(s: string, d: string, from: number): number {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === '`') { const e = findCode(s, j); if (e >= 0) { let r = e; while (s[r] === '`') r++; j = r - 1; continue; } }
    if (s.startsWith(d, j)) {
      if (d.length === 1 && s[j + 1] === d) { let r = j; while (s[r] === d) r++; if (r - j === 3 || r - j === 1) return r - 1; j = r - 1; continue; }
      if (/\s/.test(s[j - 1] || ' ')) continue;
      if (d[0] === '_' && /[\p{L}\p{N}]/u.test(s[j + d.length] || '')) continue;
      return j;
    }
  }
  return -1;
}

const INLINE_TAG: Record<string, string> = { b: 'strong', strong: 'strong', i: 'em', em: 'em', s: 's', del: 's', strike: 's', u: 'u', code: 'code' };
const DROP_TAG = new Set(['span', 'div', 'mark', 'font', 'sup', 'sub', 'small', 'big', 'p', 'img', 'a', 'figure', 'figcaption', 'aside', 'details', 'summary', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'blockquote', 'pre', 'hr', 'section', 'article', 'header', 'nav', 'time', 'cite', 'kbd', 'samp', 'var', 'abbr', 'center', 'video', 'audio', 'source', 'iframe', 'svg', 'path', 'input', 'label']);

function inline(s: string, cx: Cx): string {
  let out = '', text = '', i = 0;
  const stack: string[] = [];
  const flush = () => { if (text) { out += esc(decodeEntities(text)); text = ''; } };
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '\\' && i + 1 < n && /[!-/:-@[-`{-~]/.test(s[i + 1])) { text += s[i + 1]; i += 2; continue; }
    if (c === '`') {
      const e = findCode(s, i);
      let k = i; while (s[k] === '`') k++;
      if (e >= 0) {
        flush();
        let code = s.slice(k, e);
        if (code.length > 1 && code[0] === ' ' && code[code.length - 1] === ' ') code = code.slice(1, -1);
        out += `<code>${esc(code)}</code>`; i = e + (k - i); continue;
      }
      text += s.slice(i, k); i = k; continue;
    }
    if (c === '!' && s[i + 1] === '[') {
      const L = parseLink(s, i + 1);
      if (L) {
        flush();
        const alt = decodeEntities(L.text);
        if (/^https?:\/\//i.test(L.href)) out += `<a href="${esc(L.href)}">${esc(alt || L.href)}</a>`;
        else if (alt && !looksLikeFilename(alt)) out += esc(alt);
        i = L.end; continue;
      }
    }
    if (c === '[') {
      const L = parseLink(s, i);
      if (L) { flush(); out += linkOut(L.href, inline(L.text, cx), cx); i = L.end; continue; }
    }
    if (c === '*' || c === '_' || c === '~') {
      let k = i; while (s[k] === c) k++;
      const run = k - i;
      const prev = s[i - 1] || ' ';
      const okOpen = !/\s/.test(s[k] || ' ') && !(c === '_' && /[\p{L}\p{N}]/u.test(prev));
      if (okOpen && c !== '~' && run >= 3) {
        const e = findClose(s, c.repeat(3), k);
        if (e > k) { flush(); out += `<strong><em>${inline(s.slice(k, e), cx)}</em></strong>`; i = e + 3; continue; }
      }
      if (okOpen && (run === 2 || (run >= 3 && c !== '~'))) {
        const d = c + c, st = i + 2;
        const e = findClose(s, d, st);
        if (e > st) { flush(); out += c === '~' ? `<s>${inline(s.slice(st, e), cx)}</s>` : `<strong>${inline(s.slice(st, e), cx)}</strong>`; i = e + 2; continue; }
      }
      if (okOpen && c !== '~' && run === 1) {
        const e = findClose(s, c, i + 1);
        if (e > i + 1) { flush(); out += `<em>${inline(s.slice(i + 1, e), cx)}</em>`; i = e + 1; continue; }
      }
      text += s.slice(i, k); i = k; continue;
    }
    if (c === '<') {
      const auto = /^<(https?:\/\/[^>\s]+)>/i.exec(s.slice(i));
      if (auto) { flush(); out += linkOut(auto[1], esc(auto[1]), cx); i += auto[0].length; continue; }
      const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b(?:[^>"']|"[^"]*"|'[^']*')*?\/?>/.exec(s.slice(i));
      if (m) {
        const tag = m[2].toLowerCase();
        if (tag === 'br') { flush(); out += '<br>'; i += m[0].length; continue; }
        const mapped = INLINE_TAG[tag];
        if (mapped) {
          flush();
          if (!m[1]) { stack.push(mapped); out += `<${mapped}>`; }
          else if (stack.length && stack[stack.length - 1] === mapped) { stack.pop(); out += `</${mapped}>`; }
          i += m[0].length; continue;
        }
        if (DROP_TAG.has(tag)) { i += m[0].length; continue; }
      }
    }
    if ((c === 'h' || c === 'H') && /^https?:\/\//i.test(s.slice(i, i + 8)) && !/[\w/]/.test(s[i - 1] || ' ')) {
      const m = /^https?:\/\/[^\s<>"]*[^\s<>"().,;:!?'*_~\]]/i.exec(s.slice(i));
      if (m) {
        let url = m[0];
        while (s[i + url.length] === ')' && (url.match(/\(/g) || []).length > (url.match(/\)/g) || []).length) url += ')';
        flush(); out += linkOut(url, esc(url), cx); i += url.length; continue;
      }
    }
    text += c; i++;
  }
  flush();
  while (stack.length) out += `</${stack.pop()}>`;
  return out;
}

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])(?:\s+(.*))?$/;
const HR_RE = /^([-*_])(?:\s*\1){2,}\s*$/;
const HEAD_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const TSEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

const indentOf = (l: string) => { let k = 0; while (l[k] === ' ') k++; return k; };
const dedent = (lines: string[]) => {
  let min = Infinity;
  for (const l of lines) if (l.trim()) min = Math.min(min, indentOf(l));
  if (!isFinite(min) || !min) return lines;
  return lines.map(l => l.slice(Math.min(min, indentOf(l))));
};

function isBlockStart(lines: string[], i: number): boolean {
  const l = lines[i], t = l.trim();
  return HEAD_RE.test(t) || FENCE_RE.test(l) || HR_RE.test(t) || t.startsWith('>') || LIST_RE.test(l) || t === '$$' ||
    /^<(aside|details|table)\b/i.test(t) || /^!\[[^\]]*\]\(.*\)$/.test(t) ||
    (t.startsWith('|') && i + 1 < lines.length && TSEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-'));
}

function collectTag(lines: string[], i: number, tag: string): { inner: string; next: number } {
  const reO = new RegExp(`<${tag}\\b[^>]*>`, 'gi'), reC = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 0, j = i;
  const buf: string[] = [];
  for (; j < lines.length; j++) {
    buf.push(lines[j]);
    depth += (lines[j].match(reO) || []).length - (lines[j].match(reC) || []).length;
    if (depth <= 0) { j++; break; }
  }
  let text = buf.join('\n').replace(new RegExp(`^\\s*<${tag}\\b[^>]*>`, 'i'), '');
  const m = new RegExp(`</${tag}\\s*>\\s*$`, 'i').exec(text);
  if (m) text = text.slice(0, m.index);
  return { inner: text, next: j };
}

function splitRow(row: string): string[] {
  let t = row.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  const cells: string[] = [];
  let cur = '', code = false;
  for (let k = 0; k < t.length; k++) {
    const c = t[k];
    if (c === '\\' && t[k + 1] === '|') { cur += '|'; k++; continue; }
    if (c === '`') code = !code;
    if (c === '|' && !code) { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function htmlTableFromString(src: string, cx: Cx): string {
  let out = '';
  for (const r of src.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    let row = '';
    for (const c of r[1].matchAll(/<(t[hd])\b[^>]*>([\s\S]*?)<\/t[hd]\s*>/gi)) {
      const t = c[1].toLowerCase();
      const inner = c[2].replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n');
      const lines = inner.split('\n').map(l => inline(l.trim(), cx)).filter(Boolean);
      row += `<${t}>${lines.join('<br>')}</${t}>`;
    }
    if (row) out += `<tr>${row}</tr>`;
  }
  return out ? `<table>${out}</table>` : '';
}

function standaloneLine(t: string, cx: Cx): string | null {
  // ![alt](src)
  if (t.startsWith('![')) {
    const L = parseLink(t, 1);
    if (L && L.end === t.length) {
      const alt = decodeEntities(L.text);
      const cap = alt && !looksLikeFilename(alt) ? esc(alt) : '';
      return mediaBlock(L.href, alt, cap, cx);
    }
  }
  // [text](href)
  if (t.startsWith('[')) {
    const L = parseLink(t, 0);
    if (L && L.end === t.length) {
      const text = decodeEntities(L.text.replace(/\\(.)/g, '$1'));
      const href = L.href;
      if (/^https?:\/\//i.test(href)) {
        const r = cx.resolve(href);
        if (r && r.kind === 'page') return `<p><a data-notion-page="${esc(r.id)}">${inline(L.text, cx)}</a></p>`;
        return mediaFromUrl(href, text);
      }
      if (/^(mailto|tel):|^#/i.test(href)) return null;
      const { r, path } = resolveHref(href, cx);
      if (!r) return `<p>${inline(L.text, cx)}</p>`;
      if (r.kind === 'page') return `<p><a data-notion-page="${esc(r.id)}">${inline(L.text, cx)}</a></p>`;
      return mediaBlock(href, '', '', cx, text || basename(path));
    }
  }
  const bare = /^<?(https?:\/\/[^\s<>]+?)>?$/i.exec(t);
  if (bare) {
    const r = cx.resolve(bare[1]);
    if (r && r.kind === 'page') return `<p><a data-notion-page="${esc(r.id)}">${esc(bare[1])}</a></p>`;
    return mediaFromUrl(bare[1], '');
  }
  return null;
}

function parseList(lines: string[], i: number, cx: Cx): { html: string; next: number } {
  const base = indentOf(lines[i]);
  const kindOf = (m: RegExpExecArray) => /\d/.test(m[2]) ? 'ol' : /^\[( |x|X)\](\s|$)/.test(m[3] || '') ? 'todo' : 'ul';
  const kind = kindOf(LIST_RE.exec(lines[i])!);
  let items = '';
  while (i < lines.length) {
    const m = LIST_RE.exec(lines[i]);
    if (!m || indentOf(lines[i]) > base + 1 || indentOf(lines[i]) < base || HR_RE.test(lines[i].trim()) || kindOf(m) !== kind) break;
    let text = m[3] || '';
    let checked = false;
    if (kind === 'todo') { checked = /^\[[xX]\]/.test(text); text = text.replace(/^\[( |x|X)\]\s*/, ''); }
    const child: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      if (!lines[j].trim()) {
        let k = j + 1; while (k < lines.length && !lines[k].trim()) k++;
        if (k < lines.length && indentOf(lines[k]) > base) { while (j < k) child.push(lines[j++]); continue; }
        break;
      }
      if (indentOf(lines[j]) > base) { child.push(lines[j++]); continue; }
      if (!child.length && !isBlockStart(lines, j)) { text += '\n' + lines[j++].trim(); continue; } // lazy continuation
      break;
    }
    const head = text.split('\n').map(l => inline(l, cx)).join('<br>');
    const body = head + liJoin(parseBlocks(dedent(child), cx), !!head);
    items += kind === 'todo' ? `<li><input type="checkbox"${checked ? ' checked' : ''}>${body}</li>` : `<li>${body}</li>`;
    i = j;
    // blank lines between items of the same list
    let k = i; while (k < lines.length && !lines[k].trim()) k++;
    if (k > i && k < lines.length) {
      const m2 = LIST_RE.exec(lines[k]);
      if (m2 && indentOf(lines[k]) === base && kindOf(m2) === kind && !HR_RE.test(lines[k].trim())) { i = k; continue; }
      break;
    }
  }
  const html = kind === 'ol' ? `<ol>${items}</ol>` : kind === 'todo' ? `<ul class="todo">${items}</ul>` : `<ul>${items}</ul>`;
  return { html, next: i };
}

function parseBlocks(lines: string[], cx: Cx): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i], t = line.trim();
    if (!t) { i++; continue; }
    let m: RegExpExecArray | null;
    // fenced code
    if ((m = FENCE_RE.exec(line)) && !(m[2][0] === '`' && m[3].includes('`'))) {
      const fence = m[2], ind = m[1].length;
      const body: string[] = [];
      i++;
      const isClose = (s: string) => { const x = s.trim(); return x.length >= fence.length && [...x].every(ch => ch === fence[0]); };
      while (i < lines.length && !isClose(lines[i])) { body.push(lines[i].slice(Math.min(ind, indentOf(lines[i])))); i++; }
      i++;
      out.push({ t: 'pre', h: `<pre><code>${esc(body.join('\n'))}</code></pre>` });
      continue;
    }
    // block equation
    if (t.startsWith('$$')) {
      if (t.length > 4 && t.endsWith('$$')) { out.push({ t: 'pre', h: `<pre><code>${esc(t.slice(2, -2).trim())}</code></pre>` }); i++; continue; }
      if (t === '$$') {
        const body: string[] = []; i++;
        while (i < lines.length && lines[i].trim() !== '$$') body.push(lines[i++]);
        i++;
        out.push({ t: 'pre', h: `<pre><code>${esc(body.join('\n').trim())}</code></pre>` });
        continue;
      }
    }
    // <aside> callout
    if (/^<aside\b/i.test(t)) {
      const { inner, next } = collectTag(lines, i, 'aside');
      i = next;
      let body = inner.replace(/^\s*\n/, '').replace(/^\s+/, '');
      let icon = '';
      const img = /^<img\b[^>]*>/i.exec(body);
      if (img) { icon = (/alt="([^"]*)"/i.exec(img[0])?.[1] || '') + ' ' + (/src="([^"]*)"/i.exec(img[0])?.[1] || ''); body = body.slice(img[0].length); }
      else { const e = EMOJI_RE.exec(body); if (e) { icon = e[1]; body = body.slice(e[0].length); } }
      const blocks = joinBlocks(parseBlocks(body.split('\n'), cx));
      out.push({ t: 'aside', h: `<aside data-kind="callout" data-k="${calloutKind(icon)}">${blocks}</aside>` });
      continue;
    }
    // <details><summary> toggle
    if (/^<details\b/i.test(t)) {
      const { inner, next } = collectTag(lines, i, 'details');
      i = next;
      let summary = '', rest = inner;
      const sm = /^\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(inner);
      if (sm) { summary = sm[1]; rest = inner.slice(sm[0].length); }
      let h = '';
      let st = summary.trim();
      const hm = /^(#{1,3})\s+/.exec(st) || /^<h([1-3])\b[^>]*>/i.exec(st);
      if (hm) { h = hm[1].startsWith('#') ? String(hm[1].length) : hm[1]; st = st.replace(/^#{1,3}\s+/, ''); }
      const sHtml = st.split('\n').map(l => inline(l.trim(), cx)).filter(Boolean).join('<br>');
      const body = joinBlocks(parseBlocks(dedent(rest.split('\n')), cx));
      out.push({ t: 'details', h: `<details data-kind="toggle"${h ? ` data-h="${h}"` : ''}><summary>${sHtml}</summary>${body}</details>` });
      continue;
    }
    // html table
    if (/^<table\b/i.test(t)) {
      const { inner, next } = collectTag(lines, i, 'table');
      i = next;
      const h = htmlTableFromString(inner, cx);
      if (h) out.push({ t: 'table', h });
      continue;
    }
    // heading
    if ((m = HEAD_RE.exec(t))) {
      const lvl = Math.min(4, m[1].length + 1);
      const inner = inline(m[2], cx);
      if (inner) out.push({ t: 'h', h: `<h${lvl}>${inner}</h${lvl}>` });
      i++; continue;
    }
    if (HR_RE.test(t)) { out.push({ t: 'hr', h: '<hr>' }); i++; continue; }
    // quote
    if (t.startsWith('>')) {
      const q: string[] = [];
      while (i < lines.length && lines[i].trim() && (lines[i].trim().startsWith('>') || !isBlockStart(lines, i))) {
        q.push(lines[i].trim().replace(/^>\s?/, '')); i++;
      }
      out.push({ t: 'blockquote', h: `<blockquote>${joinBlocks(parseBlocks(q, cx))}</blockquote>` });
      continue;
    }
    // list
    if (LIST_RE.test(line)) {
      const r = parseList(lines, i, cx);
      out.push({ t: 'list', h: r.html });
      i = r.next; continue;
    }
    // pipe table
    if (t.startsWith('|') && i + 1 < lines.length && TSEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(t);
      i += 2;
      let rows = `<tr>${head.map(c => `<th>${inline(c, cx)}</th>`).join('')}</tr>`;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = splitRow(lines[i]);
        while (cells.length < head.length) cells.push('');
        rows += `<tr>${cells.map(c => `<td>${inline(c, cx)}</td>`).join('')}</tr>`;
        i++;
      }
      out.push({ t: 'table', h: `<table>${rows}</table>` });
      continue;
    }
    // a link / image / URL alone on its line
    const solo = standaloneLine(t, cx);
    if (solo !== null) {
      if (solo) out.push(solo.startsWith('<p>') ? { t: 'p', h: solo, inner: solo.slice(3, -4) } : { t: 'media', h: solo });
      i++; continue;
    }
    // paragraph
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines, i))) {
      para.push(lines[i].trim().replace(/\s{2,}$/, '').replace(/\\$/, '')); i++;
    }
    const inner = para.map(l => inline(l, cx)).join('<br>');
    if (inner.replace(/<br>/g, '').trim()) out.push({ t: 'p', h: `<p>${inner}</p>`, inner });
  }
  return out;
}

const PROP_RE = /^([^\s:#>|`*\-[!<$][^:]{0,60}?):\s+(.+)$/;

function prepMd(md: string): string[] {
  return md.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')
    .map(l => l.replace(/^[\t ]+/, ws => ws.replace(/\t/g, '    ')));
}

/** Markdown (as Notion exports it) → { title, html }. The first "# Title" line is taken as the title. */
export function convertMd(md: string, resolve: Resolver, opts: { isRow?: boolean } = {}): { title: string; html: string } {
  const lines = prepMd(md);
  const cx: Cx = { resolve };
  let i = 0, title = '';
  while (i < lines.length && !lines[i].trim()) i++;
  const tm = i < lines.length ? /^#\s+(.*?)\s*#*\s*$/.exec(lines[i].trim()) : null;
  if (tm) { title = decodeEntities(tm[1].replace(/\\(.)/g, '$1')).trim(); i++; }
  let html = '';
  if (tm) {
    // property lines right under the title ("Status: Done") → a 2-column table
    let k = i; while (k < lines.length && !lines[k].trim()) k++;
    const props: RegExpExecArray[] = [];
    let e = k;
    while (e < lines.length && lines[e].trim()) {
      const pm = PROP_RE.exec(lines[e].trim());
      if (!pm) { props.length = 0; break; }
      props.push(pm); e++;
    }
    if (props.length && (props.length >= 2 || opts.isRow)) {
      html += `<table>${props.map(p => `<tr><th>${inline(p[1].trim(), cx)}</th><td>${inline(p[2].trim(), cx)}</td></tr>`).join('')}</table>`;
      i = e;
    }
  }
  html += joinBlocks(parseBlocks(lines.slice(i), cx));
  return { title, html };
}

/** Markdown → html in the import vocabulary (the "# Title" line is dropped). */
export function mdToHtml(md: string, resolve: Resolver, opts: { isRow?: boolean } = {}): string {
  return convertMd(md, resolve, opts).html;
}

/* ============================================================ Notion HTML export → html */

const BLOCK_TAGS = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'dd', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul', 'summary', 'div', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'video', 'audio', 'iframe', 'script', 'style', 'noscript', 'template', 'head', 'title', 'meta', 'link']);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'head', 'title', 'meta', 'link', 'svg', 'input', 'button', 'summary']);

const tagOf = (el: Element) => el.tagName.toLowerCase();
const clsOf = (el: Element) => (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
const hasCls = (el: Element, c: string) => clsOf(el).includes(c);
const kids = (el: Element) => Array.from(el.children) as Element[];
const textOf = (n: Node | null | undefined) => (n?.textContent || '').replace(/\s+/g, ' ').trim();

function iconOf(el: Element): string {
  const ic = el.querySelector('.icon');
  if (!ic) return '';
  if (tagOf(ic) === 'img') return (ic.getAttribute('alt') || '') + ' ' + (ic.getAttribute('src') || '');
  const img = ic.querySelector('img');
  return textOf(ic) || (img ? (img.getAttribute('alt') || '') + ' ' + (img.getAttribute('src') || '') : '');
}

function inlineKids(el: Node, cx: Cx): string {
  let s = '';
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 1 && BLOCK_TAGS.has(tagOf(c as Element)) && !SKIP_TAGS.has(tagOf(c as Element))) {
      const v = inlineOf(c, cx);
      if (v) s += (s && !s.endsWith('<br>') ? '<br>' : '') + v;
    } else s += inlineOf(c, cx);
  }
  return s;
}

function inlineOf(node: Node, cx: Cx): string {
  if (node.nodeType === 3) return esc((node.textContent || '').replace(/[\n\t ]+/g, ' '));
  if (node.nodeType !== 1) return '';
  const el = node as Element, tag = tagOf(el);
  if (SKIP_TAGS.has(tag) || tag === 'img' || hasCls(el, 'icon') || hasCls(el, 'checkbox')) return '';
  if (tag === 'br') return '<br>';
  const wrap = (t: string) => { const v = inlineKids(el, cx); return v.trim() ? `<${t}>${v}</${t}>` : v; };
  const mapped = INLINE_TAG[tag];
  if (mapped === 'code') return `<code>${esc(el.textContent || '')}</code>`;
  if (mapped) return wrap(mapped);
  if (tag === 'a') return linkOut(el.getAttribute('href') || '', inlineKids(el, cx), cx);
  if (tag === 'span') {
    if (hasCls(el, 'notion-text-equation-token')) {
      const ann = el.querySelector('annotation');
      return `<code>${esc(ann ? ann.textContent || '' : textOf(el))}</code>`;
    }
    if (/border-bottom:\s*0\.05em\s+solid/i.test(el.getAttribute('style') || '')) return wrap('u');
  }
  return inlineKids(el, cx);
}

function listKind(el: Element): 'ul' | 'ol' | 'todo' | 'toggle' | null {
  const tag = tagOf(el);
  if (tag === 'ol') return 'ol';
  if (tag !== 'ul') return null;
  if (hasCls(el, 'to-do-list')) return 'todo';
  if (hasCls(el, 'toggle')) return 'toggle';
  return 'ul';
}

function toggleHtml(det: Element, cx: Cx): string {
  const summary = kids(det).find(k => tagOf(k) === 'summary');
  let h = '';
  if (summary) {
    const hd = summary.querySelector('h1,h2,h3');
    if (hd) h = tagOf(hd).slice(1);
    else {
      const fs = /font-size:\s*([\d.]+)em/i.exec(summary.getAttribute('style') || '');
      if (fs) { const v = parseFloat(fs[1]); h = v >= 1.7 ? '1' : v >= 1.4 ? '2' : v >= 1.15 ? '3' : ''; }
    }
  }
  const s = summary ? inlineKids(summary, cx).trim() : '';
  return `<details data-kind="toggle"${h ? ` data-h="${h}"` : ''}><summary>${s}</summary>${joinBlocks(blocksOf(det, cx))}</details>`;
}

function tableHtml(tbl: Element, cx: Cx): string {
  let rows = '';
  for (const tr of Array.from(tbl.querySelectorAll('tr'))) {
    if (tr.closest('table') !== tbl) continue;
    let r = '';
    for (const c of kids(tr)) {
      const t = tagOf(c);
      if (t !== 'td' && t !== 'th') continue;
      r += `<${t}>${inlineKids(c, cx).trim()}</${t}>`;
    }
    if (r) rows += `<tr>${r}</tr>`;
  }
  return rows ? `<table>${rows}</table>` : '';
}

function figureHtml(fig: Element, cx: Cx): string {
  const capEl = kids(fig).find(k => tagOf(k) === 'figcaption');
  const cap = capEl ? inlineKids(capEl, cx).trim() : '';
  if (hasCls(fig, 'callout')) {
    const icon = iconOf(fig);
    const parts = kids(fig);
    const content = parts.filter(p => !(p.querySelector('.icon') || hasCls(p, 'icon')) || parts.length === 1);
    const blocks = content.map(p => joinBlocks(blocksOf(p, cx))).join('');
    return `<aside data-kind="callout" data-k="${calloutKind(icon)}">${blocks}</aside>`;
  }
  if (hasCls(fig, 'equation')) {
    const ann = fig.querySelector('annotation');
    return `<pre><code>${esc((ann ? ann.textContent : fig.textContent) || '').trim()}</code></pre>`;
  }
  if (hasCls(fig, 'link-to-page')) {
    const a = fig.querySelector('a');
    if (!a) return '';
    const inner = inlineKids(a, cx).trim() || 'Untitled';
    const link = linkOut(a.getAttribute('href') || '', inner, cx);
    return `<p>${link}</p>`;
  }
  const bm = fig.querySelector('a.bookmark');
  if (bm) {
    const url = bm.getAttribute('href') || '';
    const t = textOf(bm.querySelector('.bookmark-title'));
    return /^https?:/i.test(url) ? mediaFromUrl(url, t) : '';
  }
  const img = fig.querySelector('img');
  if (img && (hasCls(fig, 'image') || !fig.querySelector('.source'))) {
    const a = img.closest('a');
    let src = img.getAttribute('src') || '';
    if (a && !/^https?:/i.test(a.getAttribute('href') || '') && a.getAttribute('href')) src = a.getAttribute('href')!;
    return mediaBlock(src, img.getAttribute('alt') || '', cap, cx);
  }
  const iframe = fig.querySelector('iframe');
  if (iframe) {
    const src = iframe.getAttribute('src') || '';
    const yt = youTubeId(src);
    if (yt) return `<div data-kind="video" data-yt="${yt}"></div>`;
    if (/^https?:/i.test(src)) return `<div data-kind="embed" data-url="${esc(src)}"></div>`;
  }
  const media = fig.querySelector('video[src],audio[src],source[src]');
  const a = fig.querySelector('.source a, a[href]') || null;
  const href = media ? media.getAttribute('src') || '' : a ? a.getAttribute('href') || '' : '';
  if (href) {
    const name = a ? textOf(a) : '';
    if (/^https?:/i.test(href)) {
      const r = cx.resolve(href);
      if (r && r.kind === 'page') return `<p><a data-notion-page="${esc(r.id)}">${esc(name || href)}</a></p>`;
      return mediaFromUrl(href, name);
    }
    const out = mediaBlock(href, '', cap, cx, name || basename(safeDecode(href)));
    if (out) return out;
  }
  return joinBlocks(blocksOf(fig, cx)) ;
}

function liHtml(li: Element, kind: 'ul' | 'ol' | 'todo', cx: Cx): string {
  const body = liJoin(blocksOf(li, cx));
  if (kind !== 'todo') return `<li>${body}</li>`;
  const checked = !!li.querySelector('.checkbox-on') || !!li.querySelector('input[checked]');
  return `<li><input type="checkbox"${checked ? ' checked' : ''}>${body}</li>`;
}

function blockEl(el: Element, cx: Cx): Block[] {
  const tag = tagOf(el);
  if (SKIP_TAGS.has(tag) || tag === 'header' || tag === 'nav' || hasCls(el, 'checkbox')) return [];
  if (/^h[1-6]$/.test(tag)) {
    if (hasCls(el, 'page-title')) return [];
    const lvl = Math.min(4, +tag[1] + 1);
    const inner = inlineKids(el, cx).trim();
    return inner ? [{ t: 'h', h: `<h${lvl}>${inner}</h${lvl}>` }] : [];
  }
  switch (tag) {
    case 'p': {
      const inner = inlineKids(el, cx).trim();
      if (!inner || inner === '<br>') return [];
      return [{ t: 'p', h: `<p>${inner}</p>`, inner }];
    }
    case 'blockquote': return [{ t: 'blockquote', h: `<blockquote>${joinBlocks(blocksOf(el, cx))}</blockquote>` }];
    case 'pre': return [{ t: 'pre', h: `<pre><code>${esc(el.textContent || '')}</code></pre>` }];
    case 'hr': return [{ t: 'hr', h: '<hr>' }];
    case 'figure': { const h = figureHtml(el, cx); return h ? [{ t: 'media', h }] : []; }
    case 'table': { if (hasCls(el, 'properties')) return []; const h = tableHtml(el, cx); return h ? [{ t: 'table', h }] : []; }
    case 'details': return [{ t: 'details', h: toggleHtml(el, cx) }];
    case 'img': { const h = mediaBlock(el.getAttribute('src') || '', el.getAttribute('alt') || '', '', cx); return h ? [{ t: 'media', h }] : []; }
    case 'iframe': {
      const src = el.getAttribute('src') || '';
      const yt = youTubeId(src);
      if (yt) return [{ t: 'media', h: `<div data-kind="video" data-yt="${yt}"></div>` }];
      return /^https?:/i.test(src) ? [{ t: 'media', h: `<div data-kind="embed" data-url="${esc(src)}"></div>` }] : [];
    }
  }
  if (tag === 'div' && hasCls(el, 'column-list')) {
    const cols = kids(el).filter(k => hasCls(k, 'column'));
    if (cols.length) return [{ t: 'columns', h: `<div data-kind="columns">${cols.map(c => `<div data-kind="col">${joinBlocks(blocksOf(c, cx))}</div>`).join('')}</div>` }];
  }
  if (tag === 'div' && hasCls(el, 'collection-content')) {
    // inline database: keep the table, drop the repeated title
    return blocksOf(el, cx).filter(b => b.t !== 'h');
  }
  return blocksOf(el, cx);
}

function blocksOf(parent: Element, cx: Cx): Block[] {
  const out: Block[] = [];
  let inl = '';
  let list: { kind: 'ul' | 'ol' | 'todo'; items: string } | null = null;
  const flushInl = () => {
    const t = inl.replace(/^(\s|<br>)+|(\s|<br>)+$/g, '');
    if (t) out.push({ t: 'p', h: `<p>${t}</p>`, inner: t });
    inl = '';
  };
  const flushList = () => {
    if (!list) return;
    const h = list.kind === 'ol' ? `<ol>${list.items}</ol>` : list.kind === 'todo' ? `<ul class="todo">${list.items}</ul>` : `<ul>${list.items}</ul>`;
    out.push({ t: 'list', h }); list = null;
  };
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === 3) {
      const v = node.textContent || '';
      if (v.trim()) { flushList(); inl += esc(v.replace(/[\n\t ]+/g, ' ')); }
      else if (inl) inl += ' ';
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as Element, tag = tagOf(el);
    if (!BLOCK_TAGS.has(tag)) {
      const v = inlineOf(el, cx);
      if (v.trim()) { flushList(); inl += v; }
      continue;
    }
    if (tag === 'summary') continue;
    flushInl();
    const lk = listKind(el);
    if (lk === 'toggle') {
      flushList();
      for (const li of kids(el)) {
        const det = kids(li).find(k => tagOf(k) === 'details');
        if (det) out.push({ t: 'details', h: toggleHtml(det, cx) });
        else out.push(...blocksOf(li, cx));
      }
      continue;
    }
    if (lk) {
      if (!list || list.kind !== lk) { flushList(); list = { kind: lk, items: '' }; }
      for (const li of kids(el)) if (tagOf(li) === 'li') list.items += liHtml(li, lk, cx);
      continue;
    }
    flushList();
    out.push(...blockEl(el, cx));
  }
  flushInl(); flushList();
  return out;
}

/** Notion's HTML export of one page → { title, html }. Needs DOMParser (the browser has it). */
export function convertNotionHtml(src: string, resolve: Resolver): { title: string; html: string } {
  const P = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (!P) throw new Error('DOMParser is not available.');
  const doc = new P().parseFromString(src, 'text/html');
  const cx: Cx = { resolve };
  const title = textOf(doc.querySelector('.page-title')) || textOf(doc.querySelector('title'));
  let html = '';
  const props = doc.querySelector('header table.properties') || doc.querySelector('table.properties');
  if (props) {
    let rows = '';
    for (const tr of Array.from(props.querySelectorAll('tr'))) {
      const th = tr.querySelector('th'), td = tr.querySelector('td');
      if (!th) continue;
      const v = td ? inlineKids(td, cx).trim() : '';
      rows += `<tr><th>${inlineKids(th, cx).trim()}</th><td>${v}</td></tr>`;
    }
    if (rows) html += `<table>${rows}</table>`;
  }
  const body = doc.querySelector('.page-body') || doc.querySelector('article') || doc.body;
  if (body) html += joinBlocks(blocksOf(body as Element, cx));
  return { title, html };
}

export function notionHtmlToHtml(src: string, resolve: Resolver): string {
  return convertNotionHtml(src, resolve).html;
}

/* ============================================================ putting it together */

const linkedIds = (html: string) => [...html.matchAll(/data-notion-page="([^"]+)"/g)].map(m => m[1]);
const normTitle = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/** Reads a Notion export .zip and returns its top-level pages (usually one), with sub-pages as children. */
export async function readNotionZip(file: File | Blob, progress: Progress): Promise<ImportPage[]> {
  progress('Opening the export…');
  const entries = new Map<string, Entry>();
  await collectEntries(file, entries, progress, 0);
  const { roots, nodes, byKey } = buildTree([...entries.keys()]);
  if (!nodes.length) throw new Error("This .zip doesn't look like a Notion export: no pages were found in it.");
  progress(`Found ${nodes.length} page${nodes.length === 1 ? '' : 's'}.`);

  const byId = new Map<string, TreeNode>();
  for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n);
  const byFile = new Map<string, TreeNode>();
  for (const n of nodes) { if (n.file) byFile.set(n.file, n); if (n.csv) byFile.set(n.csv, n); }
  const folded = new Map<string, string>();
  for (const p of entries.keys()) folded.set(p.normalize('NFC').toLowerCase(), p);
  const findEntry = (p: string) => entries.get(p) || entries.get(folded.get(p.normalize('NFC').toLowerCase()) || '');

  const nodeForPath = (full: string): TreeNode | undefined => {
    const ext = extOf(full);
    if (ext && !PAGE_EXT.has(ext) && ext !== 'csv') return undefined;
    const k = ext ? stripExt(full) : full;
    return byFile.get(full) || byKey.get(k) || byKey.get(k.replace(/_all$/, '')) ||
      (dirname(k) && basename(dirname(k)) === basename(k) ? byKey.get(dirname(k)) : undefined);
  };

  type Done = { title: string; html: string; images: ImportImage[]; csv?: string[][] };
  const done = new Map<TreeNode, Done>();

  const makeResolver = (pageFile: string, images: ImportImage[]): Resolver => {
    const dir = dirname(pageFile);
    const refs = new Map<string, string>();
    return (p: string) => {
      if (/^https?:\/\//i.test(p)) {
        if (/^https?:\/\/([\w-]+\.)*notion\.(so|site)\//i.test(p)) {
          const path = p.split(/[?#]/)[0];
          const m = /([0-9a-f]{32})\/?$/i.exec(path.replace(/-/g, '')) ;
          const n = m && byId.get(m[1].toLowerCase());
          if (n) return { kind: 'page', id: n.id };
        }
        return null;
      }
      const full = normPath(p.startsWith('/') ? p : dir ? `${dir}/${p}` : p);
      const n = nodeForPath(full) || nodeForPath(normPath(p));
      if (n) return { kind: 'page', id: n.id };
      const ext = extOf(full);
      if (!PAGE_EXT.has(ext) && ext !== 'csv') {
        const actual = findEntry(full) ? full : findEntry(normPath(p)) ? normPath(p) : '';
        const e = actual ? findEntry(actual) : undefined;
        if (e) {
          let ref = refs.get(e.path);
          if (!ref) {
            ref = `img${images.length + 1}`;
            refs.set(e.path, ref);
            const x = extOf(e.path) === 'jpeg' ? 'jpg' : extOf(e.path) || 'bin';
            const mime = MIME[extOf(e.path)] || 'application/octet-stream';
            images.push({ ref, ext: x, load: () => e.read(mime) });
          }
          return { kind: 'asset', ref };
        }
      }
      const m = /([0-9a-f]{32})(?:_all)?(?:\.(?:md|markdown|html?|csv))?$/i.exec(p);
      const byIdNode = m && byId.get(m[1].toLowerCase());
      if (byIdNode) return { kind: 'page', id: byIdNode.id };
      return null;
    };
  };

  let count = 0;
  for (const n of nodes) {
    count++;
    progress(`Reading page ${count} of ${nodes.length}…`);
    const images: ImportImage[] = [];
    const d: Done = { title: n.title, html: '', images };
    try {
      if (n.csv) {
        const e = entries.get(n.csv);
        if (e) d.csv = parseCsv(await (await e.read('text/csv')).text());
      }
      if (n.file) {
        const e = entries.get(n.file)!;
        const src = await (await e.read()).text();
        const resolve = makeResolver(n.file, images);
        const ext = extOf(n.file);
        const isRow = !!n.parent && (!!n.parent.csv || n.parent.virtual);
        const r = ext === 'html' || ext === 'htm' ? convertNotionHtml(src, resolve) : convertMd(src, resolve, { isRow });
        d.html = r.html;
        if (r.title) d.title = r.title;
      }
    } catch (err) {
      d.html = `<p>${esc(`Couldn't read this page from the export (${(err as Error)?.message || err}).`)}</p>`;
    }
    done.set(n, d);
  }

  progress('Putting the pages in order…');
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  for (const n of nodes) {
    const d = done.get(n)!;
    const pos = new Map<string, number>();
    const note = (html: string, base: number) => linkedIds(html).forEach((id, k) => { if (!pos.has(id)) pos.set(id, base + k); });
    if (d.csv && d.csv.length > 1) {
      // database: rows in CSV order (matched by title), then the rest
      const pool = [...n.children];
      const ordered: TreeNode[] = [];
      const rowLink: (TreeNode | null)[] = [];
      for (const row of d.csv.slice(1)) {
        const t = normTitle(row[0] || '');
        const k = pool.findIndex(c => normTitle(done.get(c)!.title) === t || normTitle(c.title) === t);
        if (k >= 0) { ordered.push(pool[k]); rowLink.push(pool[k]); pool.splice(k, 1); } else rowLink.push(null);
      }
      pool.sort((a, b) => coll.compare(done.get(a)!.title, done.get(b)!.title));
      n.children = [...ordered, ...pool];
      if (!n.file) {
        const [head, ...rows] = d.csv;
        let t = `<tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr>`;
        rows.forEach((r, k) => {
          const link = rowLink[k];
          t += `<tr>${head.map((_, c) => {
            const v = esc(r[c] ?? '');
            return `<td>${c === 0 && link ? `<a data-notion-page="${link.id}">${v || 'Untitled'}</a>` : v}</td>`;
          }).join('')}</tr>`;
        });
        d.html = `<table>${t}</table>`;
      }
      continue;
    }
    note(d.html, 0);
    if (n.parent) note(done.get(n.parent)!.html, 1e6);
    n.children.sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity) || coll.compare(done.get(a)!.title, done.get(b)!.title));
    if (!n.file && !d.html && n.children.length) {
      d.html = `<ul>${n.children.map(c => `<li><a data-notion-page="${c.id}">${esc(done.get(c)!.title)}</a></li>`).join('')}</ul>`;
    }
  }

  // Exports made without "Create folders for subpages" are flat: hang each top-level page under the page that links it.
  let top = [...roots];
  if (top.length > 1) {
    const rootIds = new Map(roots.map(r => [r.id, r] as const));
    const inDeg = new Map<TreeNode, number>();
    for (const n of nodes) for (const id of new Set(linkedIds(done.get(n)!.html))) {
      const r = rootIds.get(id);
      if (r && r !== n) inDeg.set(r, (inDeg.get(r) || 0) + 1);
    }
    const placed = new Set<TreeNode>();
    const queue: TreeNode[] = roots.filter(r => !inDeg.get(r));
    if (!queue.length) {
      const out = (r: TreeNode) => linkedIds(done.get(r)!.html).filter(id => rootIds.has(id) && id !== r.id).length;
      queue.push([...roots].sort((a, b) => (inDeg.get(a) || 0) - (inDeg.get(b) || 0) || out(b) - out(a))[0]);
    }
    queue.forEach(r => placed.add(r));
    const walk = (start: TreeNode[]) => {
      // breadth-first over the links, so each page lands under the nearest page that links it
      const q = [...start];
      while (q.length) {
        const n = q.shift()!;
        const ids = linkedIds(done.get(n)!.html);
        for (const id of ids) {
          const r = rootIds.get(id);
          if (!r || placed.has(r) || r === n) continue;
          placed.add(r);
          r.parent = n; n.children.push(r);
          q.push(r);
        }
        for (const c of n.children) if (!q.includes(c) && !placed.has(c)) { placed.add(c); q.push(c); }
        if (n.children.some(c => ids.includes(c.id))) {
          n.children.sort((a, b) => {
            const ia = ids.indexOf(a.id), ib = ids.indexOf(b.id);
            return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib) || coll.compare(done.get(a)!.title, done.get(b)!.title);
          });
        }
      }
    };
    walk(queue);
    for (const r of roots) if (!placed.has(r)) { placed.add(r); queue.push(r); walk([r]); }
    top = roots.filter(r => !r.parent);
  }

  const toPage = (n: TreeNode): ImportPage => {
    const d = done.get(n)!;
    return { id: n.id, title: d.title || 'Untitled', html: d.html, images: d.images, children: n.children.map(toPage) };
  };
  return top.map(toPage);
}
