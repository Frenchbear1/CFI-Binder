// Binder → Notion: one top-level MDX block (as mdx.ts writes it, or the page editor) turned into Notion API block
// objects ready for PATCH /blocks/{page}/children. Returns null when the block can't be shown in Notion the same
// way (a binder-only component, a picture that lives on the private site…): the caller then leaves Notion alone
// for that block.

/* eslint-disable @typescript-eslint/no-explicit-any */
type NBlock = Record<string, any>;
type Ann = { bold?: boolean; italic?: boolean; strikethrough?: boolean; underline?: boolean; code?: boolean };
type RT = { type: 'text'; text: { content: string; link?: { url: string } }; annotations?: Ann };

class Unsupported extends Error {}
const MAX_RT = 2000;
const MAX_DEPTH = 2; // Notion takes children of children in one request, nothing deeper

const ICON: Record<string, string> = { teach: '🎓', fleet: '✈️', warn: '⚠️', acs: '✅', note: '💡' };
const LANGS = new Set(['abap', 'arduino', 'bash', 'basic', 'c', 'clojure', 'coffeescript', 'c++', 'c#', 'css', 'dart', 'diff', 'docker', 'elixir', 'elm', 'erlang', 'flow', 'fortran', 'f#', 'gherkin', 'glsl', 'go', 'graphql', 'groovy', 'haskell', 'html', 'java', 'javascript', 'json', 'julia', 'kotlin', 'latex', 'less', 'lisp', 'livescript', 'lua', 'makefile', 'markdown', 'markup', 'matlab', 'mermaid', 'nix', 'objective-c', 'ocaml', 'pascal', 'perl', 'php', 'plain text', 'powershell', 'prolog', 'protobuf', 'python', 'r', 'reason', 'ruby', 'rust', 'sass', 'scala', 'scheme', 'scss', 'shell', 'sql', 'swift', 'typescript', 'vb.net', 'verilog', 'vhdl', 'visual basic', 'webassembly', 'xml', 'yaml']);
const LANG_ALIAS: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'shell', yml: 'yaml', md: 'markdown', text: 'plain text', txt: 'plain text', cpp: 'c++', cs: 'c#' };

const unent = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function attrs(s: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const m of s.matchAll(/([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|\{([^}]*)\})/g)) o[m[1]] = m[2] !== undefined ? unent(m[2]) : m[3].trim();
  return o;
}
const isHttp = (u: string) => /^https?:\/\//i.test(u);

// ---- inline markdown → Notion rich text ----
function richText(md: string, origin: string): RT[] {
  const out: RT[] = [];
  const push = (content: string, ann: Ann, link?: string) => {
    if (!content) return;
    const a: Ann = {};
    (Object.keys(ann) as (keyof Ann)[]).forEach((k) => { if (ann[k]) a[k] = true; });
    for (let i = 0; i < content.length; i += MAX_RT) {
      const item: RT = { type: 'text', text: { content: content.slice(i, i + MAX_RT) } };
      if (link) item.text.link = { url: link };
      if (Object.keys(a).length) item.annotations = a;
      out.push(item);
    }
  };
  const fixLink = (href: string) => {
    const h = unent(href.trim()).replace(/%28/gi, '(').replace(/%29/gi, ')');
    if (isHttp(h) || /^mailto:/i.test(h)) return h;
    if (h.startsWith('/')) return origin.replace(/\/$/, '') + h;
    return undefined;
  };

  // Returns the index after `close` (or s.length when close is ''), or -1 when `close` never comes.
  function run(s: string, i: number, ann: Ann, close: string, link?: string): number {
    let buf = '';
    const flush = () => { push(buf, ann, link); buf = ''; };
    while (i < s.length) {
      if (close && s.startsWith(close, i) && !(close === '*' && s.startsWith('**', i) && opensBold(s, i))) { flush(); return i + close.length; }
      const c = s[i];
      if (c === '\\' && i + 1 < s.length) { buf += s[i + 1]; i += 2; continue; }
      if (c === '`') {
        const j = s.indexOf('`', i + 1);
        if (j > i) { flush(); push(s.slice(i + 1, j), { ...ann, code: true }, link); i = j + 1; continue; }
      }
      const tryWrap = (mark: string, extra: Ann) => {
        flush();
        const save = out.length;
        const j = run(s, i + mark.length, { ...ann, ...extra }, mark, link);
        if (j < 0) { out.length = save; return false; }
        i = j; return true;
      };
      if (s.startsWith('**', i) && tryWrap('**', { bold: true })) continue;
      if (s.startsWith('~~', i) && tryWrap('~~', { strikethrough: true })) continue;
      if (c === '*' && !s.startsWith('**', i) && tryWrap('*', { italic: true })) continue;
      if (c === '[' && !link) {
        flush();
        const save = out.length;
        // the link text runs to "]", then "(url)"
        const j = run(s, i + 1, ann, ']', '\u0000');
        const probe = out.splice(save);
        if (j > 0 && s[j] === '(') {
          const k = s.indexOf(')', j);
          if (k > j) {
            const url = fixLink(s.slice(j + 1, k));
            for (const it of probe) { if (url) it.text.link = { url }; else delete it.text.link; out.push(it); }
            i = k + 1; continue;
          }
        }
      }
      if (c === '<') {
        const m = s.slice(i).match(/^<(\/?)([A-Za-z][\w.]*)\b([^>]*?)(\/?)>/);
        if (!m) throw new Unsupported();
        const [whole, slash, name, rest, self] = m;
        if (slash && close === `</${name}>`) { flush(); return i + whole.length; }
        if (name === 'PageLink' && self) {
          flush();
          const to = attrs(rest).to || '';
          push(to.replace(/\/+$/, '').split('/').pop()!.replace(/[-_]+/g, ' '), ann, link);
          i += whole.length; continue;
        }
        if (!slash && !self && (name === 'u' || name === 'sub' || name === 'sup')) {
          flush();
          const j = run(s, i + whole.length, name === 'u' ? { ...ann, underline: true } : ann, `</${name}>`, link);
          if (j < 0) throw new Unsupported();
          i = j; continue;
        }
        throw new Unsupported();
      }
      if (c === '{') throw new Unsupported(); // an MDX expression
      buf += c; i++;
    }
    if (close) return -1;
    flush();
    return i;
  }
  const opensBold = (s: string, i: number) => /\S/.test(s[i + 2] || '') && s.indexOf('**', i + 2) > 0;
  run(md, 0, {}, '');
  // A link's text was gathered with a placeholder link; clear any left (unclosed brackets).
  for (const it of out) if (it.text.link?.url === '\u0000') delete it.text.link;
  return out;
}

// ---- splitting MDX into its blocks (blank lines, but not inside a fence or a component) ----
export function splitBlocks(md: string): string[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  let depth = 0;
  for (const line of lines) {
    if (fence) { cur.push(line); if (line.trim().startsWith(fence)) fence = null; continue; }
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) { fence = f[1]; cur.push(line); continue; }
    const t = line.trim();
    if (!t && depth === 0) { if (cur.length) out.push(cur.join('\n')); cur = []; continue; }
    cur.push(line);
    const open = t.match(/^<([A-Z][\w.]*)\b[^>]*?(\/?)>$/) || t.match(/^<([A-Z][\w.]*)\b(?![^>]*>)/);
    if (open && !(open[2] === '/')) {
      if (!new RegExp(`</${open[1]}>\\s*$`).test(t)) depth++;
    } else if (/^<\/[A-Z][\w.]*>$/.test(t)) depth = Math.max(0, depth - 1);
  }
  if (cur.length) out.push(cur.join('\n'));
  return out.filter((b) => b.trim());
}

// ---- one block ----
const plainRT = (t: string): RT[] => {
  const out: RT[] = [];
  for (let i = 0; i < t.length; i += MAX_RT) out.push({ type: 'text', text: { content: t.slice(i, i + MAX_RT) } });
  return out;
};
const para = (rt: RT[]): NBlock => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt } });

function listBlocks(md: string, origin: string): NBlock[] {
  type Item = { indent: number; kind: string; checked: boolean; text: string; kids: Item[] };
  const root: Item[] = [];
  const stack: Item[] = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^(\s*)(?:([-*+])|(\d+)[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/);
    if (!m) {
      if (!stack.length || !line.trim()) throw new Unsupported();
      stack[stack.length - 1].text += ' ' + line.trim();
      continue;
    }
    const indent = m[1].replace(/\t/g, '   ').length;
    const it: Item = { indent, kind: m[4] !== undefined ? 'to_do' : m[2] ? 'bulleted_list_item' : 'numbered_list_item', checked: /x/i.test(m[4] || ''), text: m[5], kids: [] };
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    (stack.length ? stack[stack.length - 1].kids : root).push(it);
    stack.push(it);
  }
  const conv = (it: Item): NBlock => {
    const text = it.text === '…' ? '' : it.text;
    const body: any = { rich_text: richText(text, origin) };
    if (it.kind === 'to_do') body.checked = it.checked;
    if (it.kids.length) body.children = it.kids.map(conv);
    return { object: 'block', type: it.kind, [it.kind]: body };
  };
  return root.map(conv);
}

function tableBlock(md: string, origin: string): NBlock {
  const lines = md.split('\n').map((l) => l.trim());
  const cells = (l: string) => {
    const s = l.replace(/^\|/, '').replace(/\|$/, '');
    const out: string[] = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; }
      if (s[i] === '|') { out.push(cur.trim()); cur = ''; continue; }
      cur += s[i];
    }
    out.push(cur.trim());
    return out;
  };
  const rows = lines.filter((l, i) => !(i === 1 && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(l))).map(cells);
  const width = Math.max(...rows.map((r) => r.length));
  return {
    object: 'block', type: 'table',
    table: {
      table_width: width, has_column_header: true, has_row_header: false,
      children: rows.map((r) => ({ object: 'block', type: 'table_row', table_row: { cells: Array.from({ length: width }, (_, i) => richText((r[i] || '').trim(), origin)) } })),
    },
  };
}

function inner(md: string, origin: string): NBlock[] {
  const body = md.trim();
  if (!body || body === '…') return [];
  return splitBlocks(body).flatMap((b) => {
    const r = one(b, origin);
    if (!r) throw new Unsupported();
    return r;
  });
}

function one(md: string, origin: string): NBlock[] | null {
  const s = md.replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
  if (!s) return [];
  const first = s.split('\n')[0];

  // fenced code
  const fence = s.match(/^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n?\1\s*$/);
  if (fence) {
    const raw = fence[2].trim().toLowerCase();
    const lang = LANG_ALIAS[raw] || (LANGS.has(raw) ? raw : 'plain text');
    const code = fence[3];
    const rt: RT[] = [];
    for (let i = 0; i < code.length; i += MAX_RT) rt.push({ type: 'text', text: { content: code.slice(i, i + MAX_RT) } });
    return [{ object: 'block', type: 'code', code: { rich_text: rt, language: lang } }];
  }
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(s)) return [{ object: 'block', type: 'divider', divider: {} }];

  const h = s.match(/^(#{1,6})\s+(.*)$/);
  if (h && !s.includes('\n')) {
    const n = Math.min(3, Math.max(1, h[1].length - 1)); // ## → heading_1, ### → heading_2, #### → heading_3
    const t = `heading_${n}`;
    return [{ object: 'block', type: t, [t]: { rich_text: richText(h[2].replace(/\s+#+\s*$/, ''), origin) } }];
  }

  // components
  const comp = s.match(/^<([A-Z][\w.]*)\b/);
  if (comp) {
    const name = comp[1];
    const self = s.match(/^<([A-Z][\w.]*)\b([\s\S]*?)\/>$/);
    if (self && self[1] === name && !s.slice(0, -2).includes('<', 1)) {
      const a = attrs(self[2]);
      const cap = (t?: string) => plainRT(t || '');
      if (name === 'Video') return a.youtube ? [{ object: 'block', type: 'video', video: { type: 'external', external: { url: `https://www.youtube.com/watch?v=${a.youtube}` } } }] : null;
      if (name === 'Bookmark') return isHttp(a.href || '') ? [{ object: 'block', type: 'bookmark', bookmark: { url: a.href, caption: cap(a.title) } }] : null;
      if (name === 'Embed') return isHttp(a.src || '') ? [{ object: 'block', type: 'embed', embed: { url: a.src } }] : null;
      if (name === 'FileLink') return isHttp(a.href || '') ? [{ object: 'block', type: 'file', file: { type: 'external', external: { url: a.href }, caption: cap(a.name) } }] : null;
      return null;
    }
    const wrapped = s.match(/^<([A-Z][\w.]*)\b([^>]*)>\n?([\s\S]*?)\n?<\/\1>$/);
    if (!wrapped || wrapped[1] !== name) return null;
    const a = attrs(wrapped[2]);
    const body = wrapped[3];
    if (name === 'Figure') {
      const img = body.match(/<img\b([^>]*?)\/?>/);
      const src = img ? attrs(img[1]).src || '' : '';
      if (!isHttp(src)) return null;
      const capText = a.caption || (img ? attrs(img[1]).alt : '') || '';
      return [{ object: 'block', type: 'image', image: { type: 'external', external: { url: src }, caption: plainRT(capText) } }];
    }
    if (name === 'Callout') {
      const kids = inner(body, origin);
      let rt: RT[] = [];
      if (kids[0]?.type === 'paragraph') rt = kids.shift()!.paragraph.rich_text;
      if (a.title) rt = [{ type: 'text', text: { content: a.title.slice(0, MAX_RT) }, annotations: { bold: true } }, ...(rt.length ? [{ type: 'text', text: { content: '\n' } } as RT] : []), ...rt];
      const k = ICON[a.kind] ? a.kind : 'note';
      return [{ object: 'block', type: 'callout', callout: { rich_text: rt, icon: { type: 'emoji', emoji: ICON[k] }, ...(kids.length ? { children: kids } : {}) } }];
    }
    if (name === 'Toggle') {
      const kids = inner(body, origin);
      const rt = plainRT(a.title || '');
      const n = Number(a.heading);
      if (n >= 1 && n <= 3) {
        const t = `heading_${n}`;
        return [{ object: 'block', type: t, [t]: { rich_text: rt, is_toggleable: true, ...(kids.length ? { children: kids } : {}) } }];
      }
      return [{ object: 'block', type: 'toggle', toggle: { rich_text: rt, ...(kids.length ? { children: kids } : {}) } }];
    }
    return null; // Columns, Compare, Level, Specs, Interactive, …
  }
  if (/^<[a-z]/.test(s)) return null; // raw html

  if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(first)) return listBlocks(s, origin);
  if (first.trim().startsWith('|')) return [tableBlock(s, origin)];
  if (first.startsWith('>')) {
    const body = s.split('\n').map((l) => l.replace(/^>\s?/, '')).join('\n');
    const kids = inner(body, origin);
    let rt: RT[] = [];
    if (kids[0]?.type === 'paragraph') rt = kids.shift()!.paragraph.rich_text;
    return [{ object: 'block', type: 'quote', quote: { rich_text: rt, ...(kids.length ? { children: kids } : {}) } }];
  }
  return [para(richText(s.split('\n').map((l) => l.trim()).join(' '), origin))];
}

// Children deeper than Notion takes in one request move up to sit after their parent (at the deepest allowed level).
function limitDepth(blocks: NBlock[], depth = 0): NBlock[] {
  const out: NBlock[] = [];
  for (const b of blocks) {
    const body = b[b.type];
    const kids: NBlock[] | undefined = body?.children;
    if (!kids?.length || b.type === 'table') { out.push(b); continue; }
    if (depth >= MAX_DEPTH) { delete body.children; out.push(b, ...limitDepth(kids, depth)); continue; }
    body.children = limitDepth(kids, depth + 1);
    out.push(b);
  }
  return out;
}

/** One top-level binder MDX block → Notion blocks to append, or null when it can't be represented in Notion.
 *  siteOrigin (e.g. "https://binder.example.com") makes the binder's own links (/path) absolute. */
export function mdToNotion(md: string, siteOrigin: string): object[] | null {
  try {
    const r = one(md, siteOrigin);
    return r ? limitDepth(r) : null;
  } catch (e) {
    if (e instanceof Unsupported) return null;
    throw e;
  }
}
