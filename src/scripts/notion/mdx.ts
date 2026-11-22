// Turns an imported page's clean html (the vocabulary in types.ts) into the binder's MDX, written the same way
// the page editor writes it (Figure, Callout, Toggle, Columns, Bookmark, Embed, FileLink, Video), so imported
// pages open and edit like any other page.

export type Resolve = {
  image: (ref: string) => string;               // @@IMG:<ref>@@ → the picture's site path (written into the MDX)
  preview: (ref: string) => string;             // @@IMG:<ref>@@ → something the browser can show now (a data: URL)
  page: (id: string) => string | null;          // Notion page id → binder slug, if it was imported too
  base: string;                                 // the site's base path, e.g. "/"
};
/** One top-level block: its MDX, and how it looks on the page until the site rebuilds.
 *  comp: the component name when the block is a component (the editor can move/delete it but not type in it). */
export type Block = { md: string; html: string; comp?: string; ids?: string[] }; // ids: the Notion blocks it came from (links only)

const mdText = (t: string) => t.replace(/ /g, ' ').replace(/\\/g, '\\\\').replace(/([*_`[\]{}<>~|])/g, '\\$1');
const attr = (t: string) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const capOf = (t: string) => (/^[^\s/]+\.(png|jpe?g|gif|webp|svg|heic|bmp|tiff?)$/i.test(t.trim()) ? '' : t); // a bare file name isn't a caption
const oneLine = (t: string) => t.replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ').trim();
const wrap = (m: string, inner: string) => {
  const [, a, body, b] = inner.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  return body ? `${a}${m}${body}${m}${b}` : inner;
};
// A line that would read as a heading, list or quote is escaped so it stays plain text.
const safeStart = (t: string) => t.replace(/^(\s*)(#{1,6}\s|[-+]\s|\d+[.)]\s|=+\s*$)/, (_m, s, x) => `${s}\\${x}`);

export function toBlocks(html: string, r: Resolve): Block[] {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><head></head><body>${html}</body></html>`, 'text/html');
  const src = (v: string | null) => {
    const m = (v || '').match(/^@@IMG:(.+)@@$/);
    return m ? r.image(m[1]) : v || '';
  };

  function inline(node: Node): string {
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) { out += mdText(n.textContent || ''); return; }
      if (n.nodeType !== 1) return;
      const el = n as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (tag === 'br') { out += ' '; return; }
      if (tag === 'input') return;
      if (tag === 'code') { const c = (el.textContent || '').replace(/`/g, "'"); out += c ? '`' + c + '`' : ''; return; }
      const inner = inline(el);
      if (!inner.trim()) { out += inner; return; }
      if (tag === 'strong' || tag === 'b') out += wrap('**', inner);
      else if (tag === 'em' || tag === 'i') out += wrap('*', inner);
      else if (tag === 's' || tag === 'del' || tag === 'strike') out += wrap('~~', inner);
      else if (tag === 'u') out += `<u>${inner}</u>`;
      else if (tag === 'sub' || tag === 'sup') out += `<${tag}>${inner}</${tag}>`;
      else if (tag === 'a') {
        const pid = el.dataset.notionPage;
        if (pid !== undefined) { const slug = r.page(pid); out += slug ? `<PageLink to="${attr(slug)}" />` : inner; return; }
        const href = src(el.getAttribute('href'));
        out += href && !/^javascript:/i.test(href) ? `[${inner}](${href.replace(/[()\s<>]/g, encodeURIComponent)})` : inner;
      } else out += inner;
    });
    return out;
  }
  const text = (el: Element) => safeStart(oneLine(inline(el)));

  function list(el: Element, depth = 0): string {
    const ordered = el.tagName === 'OL';
    const todo = el.classList.contains('todo');
    const pad = '   '.repeat(depth);
    let i = 0;
    return [...el.children].filter((li) => li.tagName === 'LI').map((li) => {
      const own = doc.createElement('span');
      const subs: string[] = [];
      const cb = li.querySelector<HTMLInputElement>(':scope > input[type="checkbox"]');
      li.childNodes.forEach((n) => {
        if (n.nodeType === 1 && /^(UL|OL)$/.test((n as Element).tagName)) subs.push(list(n as Element, depth + 1));
        else if (n.nodeType === 1 && /^(P|DIV|H[1-6]|BLOCKQUOTE)$/.test((n as Element).tagName)) { own.append(' '); own.append(...[...n.childNodes].map((c) => c.cloneNode(true))); own.append(' '); }
        else own.append(n.cloneNode(true));
      });
      const t = oneLine(inline(own));
      if (!t && !subs.length) return '';
      const box = todo || cb ? `[${cb?.hasAttribute('checked') || cb?.checked ? 'x' : ' '}] ` : '';
      return `${pad}${ordered ? `${++i}.` : '-'} ${box}${t || '…'}${subs.filter(Boolean).length ? '\n' + subs.filter(Boolean).join('\n') : ''}`;
    }).filter(Boolean).join('\n');
  }

  function table(el: Element): string {
    const trs = [...el.querySelectorAll('tr')];
    if (!trs.length) return '';
    const width = Math.max(...trs.map((tr) => tr.children.length));
    const row = (tr: Element) => {
      const cells = [...tr.children].map((c) => oneLine(inline(c)) || ' ');
      while (cells.length < width) cells.push(' ');
      return `| ${cells.join(' | ')} |`;
    };
    const rows = trs.map(row);
    rows.splice(1, 0, `| ${Array(width).fill('---').join(' | ')} |`);
    return rows.join('\n');
  }

  const inside = (el: Element) => blocks(el) || '…';
  function block(el: Element): string {
    const tag = el.tagName.toLowerCase();
    const kind = (el as HTMLElement).dataset?.kind;
    const d = (el as HTMLElement).dataset || {};
    if (kind === 'image') {
      const img = el.querySelector('img');
      const cap = capOf(oneLine(el.querySelector('figcaption')?.textContent || img?.getAttribute('alt') || ''));
      const s = src(img?.getAttribute('src') || '');
      return s ? `<Figure caption="${attr(cap)}">\n  <img src="${attr(s)}" alt="${attr(cap)}" />\n</Figure>` : '';
    }
    if (kind === 'video') return d.yt ? `<Video youtube="${attr(d.yt)}" title="${attr(d.title || 'Video')}" />` : '';
    if (kind === 'bookmark') return d.url ? `<Bookmark href="${attr(d.url)}"${d.title ? ` title="${attr(d.title)}"` : ''} />` : '';
    if (kind === 'embed') return d.url ? `<Embed src="${attr(d.url)}"${d.title ? ` title="${attr(d.title)}"` : ''} />` : '';
    if (kind === 'file') { const u = src(d.url || ''); return u ? `<FileLink href="${attr(u)}"${d.name ? ` name="${attr(d.name)}"` : ''} />` : ''; }
    if (kind === 'callout') {
      const k = ['note', 'teach', 'fleet', 'warn', 'acs'].includes(d.k || '') ? d.k : 'note';
      return `<Callout kind="${k}"${d.title ? ` title="${attr(d.title)}"` : ''}>\n\n${inside(el)}\n\n</Callout>`;
    }
    if (kind === 'toggle' || tag === 'details') {
      const sum = el.querySelector(':scope > summary');
      const title = oneLine(sum?.textContent || '') || 'More';
      const body = doc.createElement('div');
      [...el.childNodes].forEach((n) => { if (n !== sum) body.append(n.cloneNode(true)); });
      const h = /^[123]$/.test(d.h || '') ? ` heading={${d.h}}` : '';
      return `<Toggle title="${attr(title)}"${h}>\n\n${inside(body)}\n\n</Toggle>`;
    }
    if (kind === 'columns') {
      const cols = [...el.children].filter((c) => (c as HTMLElement).dataset.kind === 'col').slice(0, 4);
      if (cols.length < 2) return cols.map((c) => blocks(c)).join('\n\n');
      return `<Columns n={${cols.length}}>\n${cols.map((c) => `<Col>\n\n${inside(c)}\n\n</Col>`).join('\n')}\n</Columns>`;
    }
    if (/^h[1-6]$/.test(tag)) {
      const n = Math.min(4, Math.max(2, Number(tag[1]))); // h2–h4 are the binder's three heading sizes
      const t = oneLine(inline(el));
      return t ? `${'#'.repeat(n)} ${t}` : '';
    }
    if (tag === 'p') return text(el);
    if (tag === 'ul' || tag === 'ol') return list(el);
    if (tag === 'blockquote') {
      const inner = blocks(el) || text(el);
      return inner ? inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n') : '';
    }
    if (tag === 'pre') {
      const code = (el.textContent || '').replace(/\n$/, '');
      const fence = code.includes('```') ? '~~~~' : '```';
      return `${fence}\n${code}\n${fence}`;
    }
    if (tag === 'hr') return '---';
    if (tag === 'table') return table(el);
    if (tag === 'figure' || tag === 'div' || tag === 'section' || tag === 'aside') return blocks(el);
    if (tag === 'img') {
      const s = src(el.getAttribute('src')), cap = capOf(oneLine(el.getAttribute('alt') || ''));
      return s ? `<Figure caption="${attr(cap)}">\n  <img src="${attr(s)}" alt="${attr(cap)}" />\n</Figure>` : '';
    }
    return text(el);
  }

  // Loose inline content between blocks becomes its own paragraph.
  function blocks(parent: Element): string {
    const out: string[] = [];
    let loose = doc.createElement('p');
    const flush = () => { const t = text(loose); if (t) out.push(t); loose = doc.createElement('p'); };
    parent.childNodes.forEach((n) => {
      const isBlock = n.nodeType === 1 && /^(P|H[1-6]|UL|OL|BLOCKQUOTE|PRE|HR|TABLE|FIGURE|DIV|SECTION|ASIDE|DETAILS|IMG)$/.test((n as Element).tagName);
      if (!isBlock) { loose.append(n.cloneNode(true)); return; }
      flush();
      const b = block(n as Element);
      if (b.trim()) out.push(b);
    });
    flush();
    return out.join('\n\n');
  }

  /* ---------- how a block looks until the site rebuilds (close to what the components render) ---------- */
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const pv = (v: string | null) => { const m = (v || '').match(/^@@IMG:(.+)@@$/); return m ? r.preview(m[1]) : v || ''; };
  function look(el: Element): string {
    const c = el.cloneNode(true) as Element;
    c.querySelectorAll('img').forEach((i) => i.setAttribute('src', pv(i.getAttribute('src'))));
    c.querySelectorAll<HTMLElement>('a[data-notion-page]').forEach((a) => {
      const slug = r.page(a.dataset.notionPage || '');
      if (slug) { a.setAttribute('href', r.base + slug + '/'); a.removeAttribute('data-notion-page'); } else a.replaceWith(...a.childNodes);
    });
    c.querySelectorAll('a[href]').forEach((a) => a.setAttribute('href', pv(a.getAttribute('href'))));
    c.querySelectorAll<HTMLElement>('[data-kind]').forEach((k) => { const h = compLook(k); if (h != null) k.outerHTML = h; });
    return c.outerHTML;
  }
  const inner = (el: Element) => { const c = look(el); return c.slice(c.indexOf('>') + 1, c.lastIndexOf('<')); };
  const ICON: Record<string, string> = { teach: '🎓', fleet: '✈️', warn: '⚠️', acs: '✅', note: '💡' };
  function compLook(el: HTMLElement): string | null {
    const d = el.dataset, kind = d.kind;
    const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
    if (kind === 'image') {
      const img = el.querySelector('img');
      const cap = capOf(oneLine(el.querySelector('figcaption')?.textContent || img?.getAttribute('alt') || ''));
      return `<figure class="figure"><div class="figure-art"><img src="${esc(pv(img?.getAttribute('src') || ''))}" alt="${esc(cap)}"></div><figcaption>${esc(cap)}</figcaption></figure>`;
    }
    if (kind === 'video') return `<figure class="video"><div class="video-frame" style="background:#000 url(https://i.ytimg.com/vi/${esc(d.yt || '')}/hqdefault.jpg) center/cover"></div><figcaption><strong>${esc(d.title || 'Video')}</strong></figcaption></figure>`;
    if (kind === 'bookmark') return `<a class="bookmark" href="${esc(d.url || '')}"><span class="bm-t">${esc(d.title || host(d.url || ''))}</span><span class="bm-h">${esc(host(d.url || ''))}</span></a>`;
    if (kind === 'embed') return `<figure class="embed"><a href="${esc(d.url || '')}" target="_blank" rel="noopener">${esc(d.title || host(d.url || '') || 'Embedded page')}</a></figure>`;
    if (kind === 'file') return `<a class="filelink" href="${esc(pv(d.url || ''))}" target="_blank" rel="noopener"><span>${esc(d.name || 'File')}</span></a>`;
    if (kind === 'callout') { const k = ICON[d.k || ''] ? d.k! : 'note'; return `<aside class="callout ${k}"><span class="callout-icon" aria-hidden="true">${ICON[k]}</span><div class="callout-body">${d.title ? `<p class="callout-title">${esc(d.title)}</p>` : ''}${inner(el)}</div></aside>`; }
    if (kind === 'toggle') {
      const sum = el.querySelector(':scope > summary');
      const body = el.cloneNode(true) as Element; body.querySelector(':scope > summary')?.remove();
      return `<details class="toggle${/^[123]$/.test(d.h || '') ? ` toggle-h${d.h}` : ''}"><summary>${esc(oneLine(sum?.textContent || '') || 'More')}</summary><div class="toggle-body">${inner(body)}</div></details>`;
    }
    if (kind === 'columns') { const cols = [...el.children].filter((c) => (c as HTMLElement).dataset.kind === 'col'); return `<div class="columns" style="--cols:${cols.length}">${cols.map((c) => `<div class="col">${inner(c)}</div>`).join('')}</div>`; }
    if (kind === 'col') return null;
    return null;
  }
  const COMP: Record<string, string> = { image: 'Figure', video: 'Video', bookmark: 'Bookmark', embed: 'Embed', file: 'FileLink', callout: 'Callout', toggle: 'Toggle', columns: 'Columns' };

  /* ---------- the page, one top-level block at a time (plain wrappers are opened up) ---------- */
  const out: Block[] = [];
  const BLOCK = /^(P|H[1-6]|UL|OL|BLOCKQUOTE|PRE|HR|TABLE|FIGURE|DIV|SECTION|ASIDE|DETAILS|IMG|HEADER|ARTICLE|MAIN)$/;
  function walk(parent: Element) {
    let loose = doc.createElement('p');
    const flush = () => { const t = text(loose); if (t) out.push({ md: t, html: look(loose) }); loose = doc.createElement('p'); };
    parent.childNodes.forEach((n) => {
      if (n.nodeType !== 1 || !BLOCK.test((n as Element).tagName)) { loose.append(n.cloneNode(true)); return; }
      flush();
      const el = n as HTMLElement;
      const kind = el.dataset.kind;
      if (!kind && /^(DIV|SECTION|FIGURE|ASIDE|HEADER|ARTICLE|MAIN)$/.test(el.tagName)) { walk(el); return; }
      const md = block(el).trim();
      if (!md) return;
      if (kind === 'columns' && !md.startsWith('<Columns')) { walk(el.querySelector('[data-kind="col"]') || el); return; }
      const comp = (kind && COMP[kind]) || (el.tagName === 'DETAILS' ? 'Toggle' : el.tagName === 'IMG' ? 'Figure' : undefined);
      if (el.tagName === 'IMG') { const f = doc.createElement('figure'); f.dataset.kind = 'image'; f.append(el.cloneNode(true)); out.push({ md, html: compLook(f)!, comp }); return; }
      if (el.tagName === 'DETAILS' && !kind) el.dataset.kind = 'toggle';
      const ids = (el.dataset.nid || '').split(/\s+/).filter(Boolean);
      out.push({ md, html: (comp ? compLook(el) || look(el) : look(el)).replace(/ data-nid="[^"]*"/g, ''), comp, ...(ids.length ? { ids } : {}) });
    });
    flush();
  }
  walk(doc.body);
  return out;
}

/** Just the MDX, blocks separated by blank lines. */
export const toMdx = (html: string, r: Resolve) => toBlocks(html, r).map((b) => b.md).join('\n\n');
