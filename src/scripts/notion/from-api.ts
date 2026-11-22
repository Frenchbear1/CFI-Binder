// One-way Notion import, read from a Notion link through /api/notion (the NOTION_TOKEN lives on Vercel).
// The server sends one raw tree of Notion blocks; convertTree turns it into ImportPages in the html vocabulary
// described in types.ts. Notion-hosted files are fetched later, through the same function's ?file= proxy.
import type { ImportImage, ImportPage, Progress } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any;
export type RawNode = {
  id: string;
  type: 'page' | 'database';
  title: string;
  icon?: string | null;
  row?: boolean;
  properties?: Record<string, Raw>;
  blocks: Raw[];
  children: RawNode[];
};

const VERCEL_SITE = 'cfi-binder-coral.vercel.app';

function apiUrl(): string {
  return new URL(`${document.body.dataset.base || '/'}api/notion`, document.baseURI).href;
}

export async function readNotionLink(url: string, progress: Progress): Promise<ImportPage> {
  // The GitHub Pages copy of the binder is only files: it has no server, so it can't reach Notion.
  if (/\.github\.io$/i.test(location.hostname)) throw new Error(`This is the GitHub Pages copy of the binder, which can’t reach Notion. Open ${VERCEL_SITE} and import there.`);
  progress('Reading Notion…');
  const endpoint = apiUrl();
  let r: Response;
  try {
    r = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }), credentials: 'same-origin' });
  } catch {
    throw new Error('Couldn’t reach the binder’s server. Check the connection and try again.');
  }
  // Some setups refuse the POST before it reaches the route (405): ask again the plain way.
  if (r.status === 405) {
    try { r = await fetch(`${endpoint}?url=${encodeURIComponent(url)}`, { credentials: 'same-origin' }); } catch { /* keep the 405 */ }
  }
  let j: any = null;
  const raw = await r.clone().text().catch(() => '');
  try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok || !j?.root) {
    if (r.status === 401 || r.redirected) throw new Error('Sign in first, then try again.');
    if (j?.message) throw new Error(j.message);
    if (r.status === 404) throw new Error(`This copy of the binder has no Notion connection. Open ${VERCEL_SITE} and import there.`);
    // Say exactly what came back, so a failure can be traced.
    const why = r.headers.get('x-vercel-error') || raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    throw new Error(`Reading Notion failed (${r.status}${why ? `: ${why}` : ''}).`);
  }
  const n = countNodes(j.root);
  progress(`Converting ${n} Notion page${n === 1 ? '' : 's'}…`);
  const page = convertTree(j.root, endpoint);
  progress('Notion page read.');
  return page;
}

const countNodes = (n: RawNode): number => 1 + (n.children || []).reduce((a, c) => a + countNodes(c), 0);

// ---- escaping ----
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s: unknown) => esc(s).replace(/"/g, '&quot;');
const bare = (id: unknown) => String(id || '').replace(/-/g, '').toLowerCase();
const plain = (list: Raw[] | undefined) => (Array.isArray(list) ? list.map((t) => t?.plain_text || '').join('') : '');

// ---- rich text → inline html ----
export function richHtml(list: Raw[] | undefined): string {
  if (!Array.isArray(list)) return '';
  return list.map((t) => {
    const text = esc(t?.plain_text ?? '').replace(/\r?\n/g, '<br>');
    if (t?.type === 'mention') {
      const m = t.mention || {};
      if (m.type === 'page' || m.type === 'database') return `<a data-notion-page="${attr(bare(m[m.type]?.id))}">${text}</a>`;
      if ((m.type === 'link_preview' || m.type === 'link_mention') && m[m.type]?.url) return `<a href="${attr(m[m.type].url)}">${text}</a>`;
      return text; // date, user, template mention…
    }
    if (t?.type === 'equation') return `<code>${esc(t.equation?.expression ?? t.plain_text ?? '')}</code>`;
    let h = text;
    const a = t?.annotations || {};
    if (a.code) h = `<code>${h}</code>`;
    if (a.bold) h = `<strong>${h}</strong>`;
    if (a.italic) h = `<em>${h}</em>`;
    if (a.strikethrough) h = `<s>${h}</s>`;
    if (a.underline) h = `<u>${h}</u>`;
    const href = t?.href || t?.text?.link?.url;
    if (href) {
      const pageId = notionPageHref(href);
      h = pageId ? `<a data-notion-page="${pageId}">${h}</a>` : `<a href="${attr(href)}">${h}</a>`;
    }
    return h;
  }).join('');
}

// A plain link that points at another Notion page (Notion writes these as "/<id>" or a notion.so URL).
function notionPageHref(href: string): string | null {
  const m = href.match(/^\/([0-9a-f]{32})(?:[?#].*)?$/i);
  if (m) return m[1].toLowerCase();
  try {
    const u = new URL(href);
    if (!/(^|\.)notion\.(so|site)$/.test(u.hostname)) return null;
    const seg = u.pathname.split('/').filter(Boolean).pop() || '';
    const mm = seg.replace(/-/g, '').match(/([0-9a-f]{32})$/i);
    return mm ? mm[1].toLowerCase() : null;
  } catch { return null; }
}

// ---- callouts ----
function calloutKind(emoji: string | null | undefined): string {
  const e = String(emoji || '');
  if (/⚠|❗|❕|🚨|‼|⛔|🛑/.test(e)) return 'warn';
  if (/✈|🛩|🛫|🛬/.test(e)) return 'fleet';
  if (/🎓|📚|📖|🧑‍🏫|👨‍🏫|👩‍🏫/.test(e)) return 'teach';
  if (/✅|☑|✔/.test(e)) return 'acs';
  return 'note';
}

// ---- files ----
const IMG_EXT = /^(png|jpe?g|gif|webp|svg|avif|bmp|tiff?|heic)$/i;
function extFromUrl(url: string): string {
  try {
    const seg = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    const m = seg.match(/\.([a-z0-9]{1,5})$/i);
    return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : '';
  } catch { return ''; }
}
function nameFromUrl(url: string): string {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || 'file'; } catch { return 'file'; }
}
const TYPE_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif',
  'application/pdf': 'pdf', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav',
};

function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\.|^m\./, '');
    let id: string | null = null;
    if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com' || h === 'music.youtube.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else { const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/); if (m) id = m[1]; }
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

// ---- one page's conversion ----
type Ctx = { images: ImportImage[]; proxy: string; titles: Map<string, string> };

function hosted(ctx: Ctx, url: string, image: boolean): string {
  const ref = `img${ctx.images.length + 1}`;
  const img: ImportImage = {
    ref,
    ext: extFromUrl(url) || (image ? 'png' : 'bin'),
    load: async () => {
      const r = await fetch(`${ctx.proxy}?file=${encodeURIComponent(url)}`, { credentials: 'same-origin' });
      if (!r.ok) {
        let msg = '';
        try { msg = (await r.json())?.message; } catch { /* not JSON */ }
        throw new Error(msg || `Couldn’t download a Notion file (${r.status}).`);
      }
      const blob = await r.blob();
      if (!extFromUrl(url)) { const t = TYPE_EXT[blob.type.split(';')[0]]; if (t) img.ext = t; }
      return blob;
    },
  };
  ctx.images.push(img);
  return `@@IMG:${ref}@@`;
}
const fileUrl = (v: Raw): { url: string; hostedFile: boolean } | null => {
  if (!v) return null;
  if (v.type === 'external' && v.external?.url) return { url: v.external.url, hostedFile: false };
  if (v.type === 'file' && v.file?.url) return { url: v.file.url, hostedFile: true };
  if (v.file_upload?.url) return { url: v.file_upload.url, hostedFile: true };
  return null;
};

// Marks the first element of an html string with the Notion block id(s) it came from (for writing edits back).
const tag = (html: string, ids: string[]) => (html && ids.length ? html.replace(/^<([a-z0-9]+)/, `<$1 data-nid="${ids.map(bare).join(' ')}"`) : html);

function blocksHtml(list: Raw[] | undefined, ctx: Ctx, top = false): string {
  if (!Array.isArray(list)) return '';
  let out = '';
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    const t = b?.type;
    if (t === 'bulleted_list_item' || t === 'numbered_list_item' || t === 'to_do') {
      const run: Raw[] = [];
      while (i < list.length && list[i]?.type === t) run.push(list[i++]);
      i--;
      const ids = top ? run.map((x) => x.id) : [];
      if (t === 'to_do') {
        out += tag(`<ul class="todo">${run.map((x) => `<li><input type="checkbox"${x.to_do?.checked ? ' checked' : ''}>${richHtml(x.to_do?.rich_text)}${blocksHtml(x.children, ctx)}</li>`).join('')}</ul>`, ids);
      } else {
        const el = t === 'bulleted_list_item' ? 'ul' : 'ol';
        out += tag(`<${el}>${run.map((x) => `<li>${richHtml(x[t]?.rich_text)}${blocksHtml(x.children, ctx)}</li>`).join('')}</${el}>`, ids);
      }
      continue;
    }
    out += blockHtml(b, ctx, top);
  }
  return out;
}

// At the top of a page (`top`), each element gets data-nid; children Notion nests under a paragraph or plain
// heading are written after it as their own top-level elements (unmarked, so they don't sync). Never marked: links to
// sub-pages/databases, and synced blocks (their content may be shared with other pages).
function blockHtml(b: Raw, ctx: Ctx, top = false): string {
  const t: string = b?.type;
  const v: Raw = b?.[t] || {};
  const kids = () => blocksHtml(b.children, ctx);
  const own = (html: string) => (top ? tag(html, [b.id]) : html);
  // Unmarked: in Notion they sit inside this block, so they can't be an anchor for inserts at page level.
  const after = () => blocksHtml(b.children, ctx, false);
  const pageLink = (id: string, title?: string) => `<p><a data-notion-page="${attr(bare(id))}">${esc(title || ctx.titles.get(bare(id)) || 'Untitled')}</a></p>`;
  switch (t) {
    case 'paragraph': {
      const inner = richHtml(v.rich_text);
      return (inner ? own(`<p>${inner}</p>`) : '') + after();
    }
    case 'heading_1': case 'heading_2': case 'heading_3': {
      const n = t.slice(-1);
      const h = `h${Number(n) + 1}`;
      if (v.is_toggleable) return own(`<details data-kind="toggle" data-h="${n}"><summary>${richHtml(v.rich_text)}</summary>${kids()}</details>`);
      return own(`<${h}>${richHtml(v.rich_text)}</${h}>`) + after();
    }
    case 'toggle':
      return own(`<details data-kind="toggle"><summary>${richHtml(v.rich_text)}</summary>${kids()}</details>`);
    case 'quote': {
      const inner = richHtml(v.rich_text);
      const k = kids();
      return own(k ? `<blockquote>${inner ? `<p>${inner}</p>` : ''}${k}</blockquote>` : `<blockquote>${inner}</blockquote>`);
    }
    case 'callout': {
      const emoji = v.icon?.type === 'emoji' ? v.icon.emoji : '';
      const inner = richHtml(v.rich_text);
      return own(`<aside data-kind="callout" data-k="${calloutKind(emoji)}">${inner ? `<p>${inner}</p>` : ''}${kids()}</aside>`);
    }
    case 'code':
      return own(`<pre><code>${esc(plain(v.rich_text))}</code></pre>`);
    case 'equation':
      return own(`<pre><code>${esc(v.expression || '')}</code></pre>`);
    case 'divider':
      return own('<hr>');
    case 'table': {
      const rows: Raw[] = (b.children || []).filter((r: Raw) => r?.type === 'table_row');
      if (!rows.length) return '';
      return own(`<table>${rows.map((r, ri) => `<tr>${(r.table_row?.cells || []).map((c: Raw[], ci: number) => {
        const th = (ri === 0 && v.has_column_header) || (ci === 0 && v.has_row_header);
        return th ? `<th>${richHtml(c)}</th>` : `<td>${richHtml(c)}</td>`;
      }).join('')}</tr>`).join('')}</table>`);
    }
    case 'column_list':
      return own(`<div data-kind="columns">${(b.children || []).filter((c: Raw) => c?.type === 'column').map((c: Raw) => `<div data-kind="col">${blocksHtml(c.children, ctx)}</div>`).join('')}</div>`);
    case 'column':
      return after();
    case 'image': {
      const f = fileUrl(v);
      if (!f) return '';
      const cap = richHtml(v.caption);
      const src = f.hostedFile ? hosted(ctx, f.url, true) : f.url;
      return own(`<figure data-kind="image"><img src="${attr(src)}" alt="${attr(plain(v.caption))}">${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`);
    }
    case 'video': {
      const f = fileUrl(v);
      if (!f) return '';
      const title = plain(v.caption);
      if (f.hostedFile) return own(`<div data-kind="file" data-url="${attr(hosted(ctx, f.url, false))}" data-name="${attr(v.name || title || nameFromUrl(f.url))}"></div>`);
      const yt = youtubeId(f.url);
      if (yt) return own(`<div data-kind="video" data-yt="${yt}" data-title="${attr(title)}"></div>`);
      return own(`<div data-kind="bookmark" data-url="${attr(f.url)}" data-title="${attr(title)}"></div>`);
    }
    case 'file': case 'pdf': case 'audio': {
      const f = fileUrl(v);
      if (!f) return '';
      const name = v.name || plain(v.caption) || nameFromUrl(f.url);
      const url = f.hostedFile ? hosted(ctx, f.url, false) : f.url;
      return own(`<div data-kind="file" data-url="${attr(url)}" data-name="${attr(name)}"></div>`);
    }
    case 'embed': {
      if (!v.url) return '';
      const yt = youtubeId(v.url);
      if (yt) return own(`<div data-kind="video" data-yt="${yt}" data-title="${attr(plain(v.caption))}"></div>`);
      return own(`<div data-kind="embed" data-url="${attr(v.url)}" data-title="${attr(plain(v.caption))}"></div>`);
    }
    case 'bookmark': case 'link_preview':
      return v.url ? own(`<div data-kind="bookmark" data-url="${attr(v.url)}" data-title="${attr(plain(v.caption))}"></div>`) : '';
    case 'child_page':
      return pageLink(b.id, v.title);
    case 'child_database':
      return pageLink(b.id, v.title);
    case 'link_to_page': {
      const id = v.page_id || v.database_id;
      return id ? own(pageLink(id)) : '';
    }
    case 'synced_block':
      return kids();
    case 'table_of_contents': case 'breadcrumb': case 'unsupported': case 'template': case 'table_row':
      return '';
    default: {
      // Something new: keep its text, if it has any.
      const inner = richHtml(v.rich_text);
      return (inner ? own(`<p>${inner}</p>`) : '') + after();
    }
  }
}

// ---- a database row's other properties, as a little table ----
function propValue(p: Raw): string {
  const x = p?.[p?.type];
  switch (p?.type) {
    case 'select': case 'status': return x?.name ? esc(x.name) : '';
    case 'multi_select': return Array.isArray(x) ? esc(x.map((o: Raw) => o?.name).filter(Boolean).join(', ')) : '';
    case 'number': return x === null || x === undefined ? '' : esc(x);
    case 'date': return x?.start ? esc(x.end ? `${x.start} → ${x.end}` : x.start) : '';
    case 'checkbox': return x ? 'Yes' : '';
    case 'url': return x ? `<a href="${attr(x)}">${esc(x)}</a>` : '';
    case 'email': return x ? `<a href="mailto:${attr(x)}">${esc(x)}</a>` : '';
    case 'phone_number': return x ? esc(x) : '';
    case 'rich_text': return richHtml(x);
    default: return '';
  }
}
function propsTable(props: Record<string, Raw> | undefined): string {
  if (!props) return '';
  const rows = Object.entries(props)
    .filter(([, p]) => p?.type !== 'title')
    .map(([name, p]) => [name, propValue(p)] as const)
    .filter(([, val]) => val !== '');
  if (!rows.length) return '';
  return `<table>${rows.map(([name, val]) => `<tr><th>${esc(name)}</th><td>${val}</td></tr>`).join('')}</table>`;
}
function rowTitle(n: RawNode): string {
  for (const p of Object.values(n.properties || {})) if (p?.type === 'title') { const t = plain(p.title); if (t) return t; }
  return n.title || 'Untitled';
}

// ---- the whole tree ----
// `proxy` is the absolute /api/notion address that Notion-hosted files are fetched through.
export function convertTree(root: RawNode, proxy: string): ImportPage {
  const titles = new Map<string, string>();
  const walk = (n: RawNode) => { titles.set(bare(n.id), n.row ? rowTitle(n) : n.title); (n.children || []).forEach(walk); };
  walk(root);
  const conv = (n: RawNode): ImportPage => {
    const ctx: Ctx = { images: [], proxy, titles };
    const title = (n.row ? rowTitle(n) : n.title) || 'Untitled';
    let html: string;
    if (n.type === 'database') {
      html = n.children?.length
        ? `<ul>${n.children.map((c) => `<li><a data-notion-page="${attr(bare(c.id))}">${esc(titles.get(bare(c.id)) || 'Untitled')}</a></li>`).join('')}</ul>`
        : '';
    } else {
      html = (n.row ? propsTable(n.properties) : '') + blocksHtml(n.blocks, ctx, true);
    }
    return { id: bare(n.id), title, html, images: ctx.images, children: (n.children || []).map(conv) };
  };
  return conv(root);
}
