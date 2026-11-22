// One-way Notion import, the server half. The browser (src/scripts/notion/from-api.ts) sends a Notion link; this
// reads that page and everything inside it (sub-pages, database rows, nested blocks) with the NOTION_TOKEN set on
// Vercel, and returns one raw tree. Signed-in only (middleware.js).
//
//   POST {url}            → {root}   root = {id, type:'page'|'database', title, icon, row?, properties?, blocks, children}
//   POST {action:'sync', page, ops} → {results}  (binder edits written back to Notion; see sync() below)
//   GET  ?file=<url>      → the bytes of a Notion-hosted file (its signed links are short-lived and not readable cross-origin)
//
// Vercel's hobby plan stops a function at 60 s, so a very large workspace may need importing a sub-page at a time.
// The 60 s limit is set in vercel.json (functions → api/notion.js). This file exports only GET and POST,
// like the other api/ routes: other exports here kept the route from being served (the app got 404/405).

const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
const MAX_BLOCKS = 20000;
const MAX_DEPTH = 12;
const MAX_INFLIGHT = 3;
const TIME_BUDGET = 52_000;      // ms; leaves room to send the answer before Vercel's 60 s
const MAX_RESPONSE = 4_300_000;  // bytes; Vercel refuses responses over 4.5 MB
const MAX_FILE = 25 * 1024 * 1024;
const FILE_HOSTS = ['amazonaws.com', 'notion.so', 'notion-static.com', 'notionusercontent.com', 'notion.site'];

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const SETUP = { error: 'setup', message: 'Add NOTION_TOKEN in Vercel → Settings → Environment Variables, then redeploy.' };
const SHARE = { error: 'share', message: 'Notion can’t see that page yet. In Notion, open the page → ••• → Connections (or the integration’s Access tab) and add the binder’s integration, then try again.' };

class NotionError extends Error {
  constructor(status, code, message) { super(message || code || `Notion answered ${status}`); this.status = status; this.code = code; }
}
class Friendly extends Error {}

// ---- the page or database id in a link ----
function notionId(input) {
  const s = String(input || '').trim();
  let path = s;
  try {
    const u = new URL(s);
    const p = u.searchParams.get('p');           // a page "peeked" open on top of another
    if (p && /^[0-9a-f-]{32,36}$/i.test(p)) path = p;
    else path = u.pathname;
  } catch { /* a bare id */ }
  const seg = path.split('/').filter(Boolean).pop() || '';
  const m = seg.replace(/-/g, '').match(/([0-9a-f]{32})$/i);
  return m ? m[1].toLowerCase() : null;
}
const dashed = (id) => id.replace(/-/g, '').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
const bare = (id) => String(id || '').replace(/-/g, '').toLowerCase();

// ---- one import run: talks to Notion with limits ----
function run(token) {
  const started = Date.now();
  let inflight = 0, blocks = 0;
  const queue = [];
  const acquire = () => new Promise((res) => { if (inflight < MAX_INFLIGHT) { inflight++; res(); } else queue.push(res); });
  const release = () => { const nx = queue.shift(); if (nx) nx(); else inflight--; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const checkTime = () => {
    if (Date.now() - started > TIME_BUDGET) throw new Friendly('That page is too big to read in one go (Vercel stops after 60 seconds). Import its sub-pages one at a time, or use a Notion export (.zip).');
  };

  async function call(method, path, body, version = VERSION) {
    for (let attempt = 0; ; attempt++) {
      checkTime();
      await acquire();
      let r;
      try {
        r = await fetch(API + path, {
          method,
          headers: { authorization: `Bearer ${token}`, 'Notion-Version': version, ...(body ? { 'content-type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
      } finally { release(); }
      if ((r.status === 429 || r.status >= 500) && attempt < 5) {
        const ra = Number(r.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 10) * 1000 : 500 * 2 ** attempt);
        continue;
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new NotionError(r.status, j.code, j.message);
      return j;
    }
  }

  async function paged(method, path, body) {
    const out = [];
    let cursor;
    do {
      let p = path, b = body;
      if (method === 'GET') p += `${path.includes('?') ? '&' : '?'}page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`;
      else b = { ...(body || {}), page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) };
      const j = await call(method, p, b);
      out.push(...(j.results || []));
      cursor = j.has_more ? j.next_cursor : null;
    } while (cursor);
    return out;
  }

  const count = (n) => {
    blocks += n;
    if (blocks > MAX_BLOCKS) throw new Friendly(`That page has more than ${MAX_BLOCKS.toLocaleString('en-US')} blocks. Import its sub-pages one at a time.`);
  };
  const tooDeep = (d) => { if (d > MAX_DEPTH) throw new Friendly(`That page nests more than ${MAX_DEPTH} levels deep. Import a deeper sub-page on its own.`); };

  // The children of one block or page, with their own children filled in. Sub-pages come back in `subs`.
  async function children(id, depth, subs) {
    tooDeep(depth);
    const list = await paged('GET', `/blocks/${id}/children`);
    count(list.length);
    return Promise.all(list.map(async (b) => {
      const s = strip(b);
      if (b.type === 'child_page') { subs.push({ kind: 'page', id: b.id, title: b.child_page?.title }); return s; }
      if (b.type === 'child_database') { subs.push({ kind: 'database', id: b.id, title: b.child_database?.title }); return s; }
      if (!b.has_children && b.type !== 'synced_block') return s;
      let from = b.id;
      if (b.type === 'synced_block' && b.synced_block?.synced_from?.block_id) from = b.synced_block.synced_from.block_id;
      try { s.children = await children(from, depth + 1, subs); }
      catch (e) {
        if (from !== b.id && e instanceof NotionError) s.children = await children(b.id, depth + 1, subs); // original not shared
        else if (!(e instanceof NotionError && (e.status === 404 || e.status === 400))) throw e;
        else s.children = [];
      }
      return s;
    }));
  }

  async function subNodes(subs, depth) {
    const nodes = await Promise.all(subs.map(async (c) => {
      try { return c.kind === 'page' ? await page(c.id, depth + 1) : await database(c.id, depth + 1, c.title); }
      catch (e) {
        // A linked database (a view of one elsewhere) or one not shared with the integration: keep going without it.
        if (c.kind === 'database' && e instanceof NotionError) return null;
        throw e;
      }
    }));
    return nodes.filter(Boolean);
  }

  async function page(id, depth, known) {
    tooDeep(depth);
    const p = known || await call('GET', `/pages/${id}`);
    const subs = [];
    const blocks = await children(p.id, depth, subs);
    const node = { id: bare(p.id), type: 'page', title: pageTitle(p), icon: icon(p.icon), blocks, children: await subNodes(subs, depth) };
    if (p.parent?.type === 'database_id') { node.row = true; node.properties = props(p.properties); }
    return node;
  }

  async function database(id, depth, fallbackTitle) {
    tooDeep(depth);
    const d = await call('GET', `/databases/${id}`);
    const rows = await paged('POST', `/databases/${id}/query`, {});
    count(rows.length);
    const kids = await Promise.all(rows.filter((r) => r.object === 'page').map((r) => page(r.id, depth + 1, r)));
    return { id: bare(d.id), type: 'database', title: plain(d.title) || fallbackTitle || 'Untitled', icon: icon(d.icon), blocks: [], children: kids };
  }

  return { call, page, database };
}

// ---- trimming Notion's objects down to what the converter reads ----
function rich(list) {
  if (!Array.isArray(list)) return [];
  return list.map((t) => {
    const o = { type: t.type, plain_text: t.plain_text };
    if (t.href) o.href = t.href;
    const a = {};
    for (const k of ['bold', 'italic', 'strikethrough', 'underline', 'code']) if (t.annotations?.[k]) a[k] = true;
    if (Object.keys(a).length) o.annotations = a;
    if (t.type === 'mention' && t.mention) {
      const m = t.mention, mt = m.type;
      o.mention = { type: mt };
      if (mt === 'page' || mt === 'database') o.mention[mt] = { id: m[mt]?.id };
      else if (mt === 'link_preview' || mt === 'link_mention') o.mention[mt] = { url: m[mt]?.url || m[mt]?.href };
    }
    if (t.type === 'equation') o.equation = { expression: t.equation?.expression };
    return o;
  });
}
function payload(v) {
  if (Array.isArray(v)) return v.map(payload);
  if (!v || typeof v !== 'object') return v;
  const o = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === 'color') continue;
    if ((k === 'rich_text' || k === 'caption' || k === 'title') && Array.isArray(x)) o[k] = rich(x);
    else if (k === 'cells' && Array.isArray(x)) o[k] = x.map(rich);
    else o[k] = payload(x);
  }
  return o;
}
function strip(b) {
  const s = { id: bare(b.id), type: b.type, has_children: !!b.has_children };
  if (b[b.type] !== undefined) s[b.type] = payload(b[b.type]);
  return s;
}
const plain = (list) => (Array.isArray(list) ? list.map((t) => t.plain_text || '').join('') : '');
function pageTitle(p) {
  for (const v of Object.values(p.properties || {})) if (v?.type === 'title') return plain(v.title) || 'Untitled';
  return 'Untitled';
}
const icon = (i) => (i?.type === 'emoji' ? i.emoji : null);
const SIMPLE = ['title', 'select', 'status', 'multi_select', 'number', 'date', 'checkbox', 'url', 'email', 'phone_number', 'rich_text'];
function props(p) {
  const out = {};
  for (const [name, v] of Object.entries(p || {})) {
    if (!v || !SIMPLE.includes(v.type)) continue;
    const x = v[v.type];
    let val = x;
    if (v.type === 'title' || v.type === 'rich_text') val = rich(x);
    else if (v.type === 'select' || v.type === 'status') val = x ? { name: x.name } : null;
    else if (v.type === 'multi_select') val = (x || []).map((o) => ({ name: o.name }));
    else if (v.type === 'date') val = x ? { start: x.start, end: x.end } : null;
    out[name] = { type: v.type, [v.type]: val };
  }
  return out;
}

// ---- handlers ----
export async function POST(req) {
  const token = process.env.NOTION_TOKEN;
  if (!token) return json(SETUP, 501);
  let url, input;
  try { input = await req.json(); ({ url } = input); } catch { return json({ error: 'input', message: 'Send {"url": "<a Notion link>"}.' }, 400); }
  if (input?.action === 'sync') return sync(token, input);
  return importPage(token, url);
}

async function importPage(token, url) {
  const id = notionId(url);
  if (!id) return json({ error: 'input', message: 'That doesn’t look like a Notion page link. In Notion use ••• → Copy link.' }, 400);
  const r = run(token);
  try {
    // A page first; if Notion says it isn't one (404/400), the same id as a database.
    let known = null, first = null;
    try { known = await r.call('GET', `/pages/${dashed(id)}`); }
    catch (e) { if (!(e instanceof NotionError && (e.status === 404 || e.status === 400))) throw e; first = e; }
    let root;
    if (known) root = await r.page(known.id, 0, known);
    else {
      try { await r.call('GET', `/databases/${dashed(id)}`); }
      catch (e2) { throw e2 instanceof NotionError && (e2.status === 404 || e2.status === 400) ? first : e2; }
      root = await r.database(dashed(id), 0);
    }
    const body = JSON.stringify({ root });
    if (body.length > MAX_RESPONSE) return json({ error: 'size', message: 'That page is too big to send in one go. Import its sub-pages one at a time, or use a Notion export (.zip).' }, 413);
    return new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch (e) {
    if (e instanceof Friendly) return json({ error: 'limit', message: e.message }, 413);
    if (e instanceof NotionError) {
      // Logged without the token, so a failed import can be traced in Vercel's logs.
      console.log(`notion import failed: ${e.status} ${e.code || ''}`);
      // Not 404: a 404 from here would look like the route itself was missing.
      if (e.status === 404 || e.code === 'object_not_found') return json(SHARE, 422);
      if (e.status === 401 || e.code === 'unauthorized') return json({ error: 'token', message: 'Notion refused the NOTION_TOKEN. Copy the integration secret again into Vercel, then redeploy.' }, 502);
      return json({ error: 'notion', message: `Notion: ${e.message}` }, 502);
    }
    return json({ error: 'server', message: e?.message || 'Something went wrong reading Notion.' }, 500);
  }
}

// ---- writing binder edits back to Notion ----
// {action:'sync', page, ops:[{op:'delete', ids:[…]} | {op:'insert', after: <block id>|null, children:[…Notion blocks…]}]}
// Ops run in order and stop at the first one that fails (the rest answer {ok:false, error:'skipped'}).
// → {results:[{ok, ids?: new top-level block ids, error?, message?, moved?}]}
//
// Inserting at the very start (after: null): Notion's append endpoint takes only `after` with 2022-06-28. Newer
// API versions added `position: {type:'start'}`, so that is tried first (that one request with a newer
// Notion-Version). If Notion refuses it: an empty page is simply appended to; otherwise, when the page's first block
// is a plain one with no children, the new blocks go after it and a copy of it goes after them, then the original is
// deleted, which gives the first block a new id, reported as moved:{from, to}. If the first block can't be copied
// (a sub-page, a block with children, a synced block…), the op fails with error:'start' and nothing is changed.
const WRITE_DENIED = 'Turn on "Update content" and "Insert content" for the binder connection in Notion (Settings → Connections).';
const START_VERSION = '2025-09-03';
const COPYABLE = ['paragraph', 'heading_1', 'heading_2', 'heading_3', 'quote', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'code', 'divider', 'equation', 'bookmark', 'embed', 'callout'];
const HEX = /^[0-9a-f]{32}$/;

function copyOf(b) {
  const t = b.type, v = b[t];
  if (!COPYABLE.includes(t) || b.has_children || !v) return null;
  const clean = (x) => {
    if (Array.isArray(x)) return x.map(clean);
    if (!x || typeof x !== 'object') return x;
    const o = {};
    for (const [k, y] of Object.entries(x)) {
      if (k === 'plain_text' || k === 'href') continue;
      if (k === 'mention' && y && typeof y === 'object' && 'user' in y) o[k] = { type: 'user', user: { id: y.user?.id } };
      else o[k] = clean(y);
    }
    return o;
  };
  const p = clean(v);
  if (t === 'callout' && p.icon && p.icon.type !== 'emoji') delete p.icon;
  return { object: 'block', type: t, [t]: p };
}

async function sync(token, input) {
  const page = bare(input.page);
  if (!HEX.test(page) || !Array.isArray(input.ops)) return json({ error: 'input', message: 'Send {action:"sync", page, ops:[…]}.' }, 400);
  const { call } = run(token);
  const pid = dashed(page);
  const results = [];
  let failed = false;
  const append = (children, extra, version) => call('PATCH', `/blocks/${pid}/children`, { children, ...extra }, version);

  for (const op of input.ops) {
    if (failed) { results.push({ ok: false, error: 'skipped' }); continue; }
    try {
      if (op?.op === 'delete') {
        for (const raw of op.ids || []) {
          const id = bare(raw);
          if (!HEX.test(id)) continue;
          try { await call('DELETE', `/blocks/${dashed(id)}`); }
          catch (e) {
            const gone = e instanceof NotionError && (e.status === 404 || (e.status === 400 && /archiv/i.test(e.message)));
            if (!gone) throw e;
          }
        }
        results.push({ ok: true });
      } else if (op?.op === 'insert') {
        const kids = Array.isArray(op.children) ? op.children : [];
        const ids = [];
        let after = op.after ? bare(op.after) : null;
        if (after && !HEX.test(after)) throw new Friendly('Bad block id in "after".');
        let moved;
        for (let i = 0; i < kids.length; i += 100) {
          const batch = kids.slice(i, i + 100);
          let res;
          if (after) res = await append(batch, { after: dashed(after) });
          else {
            const s = await insertAtStart(call, append, pid, batch);
            res = s.res; moved = s.moved;
            if (s.error) { results.push({ ok: false, error: 'start', message: s.error }); failed = true; break; }
          }
          const got = (res.results || []).map((b) => bare(b.id));
          ids.push(...got);
          if (got.length) after = got[got.length - 1];
        }
        if (!failed) results.push({ ok: true, ids, ...(moved ? { moved } : {}) });
      } else results.push({ ok: false, error: 'input', message: 'Unknown op.' });
    } catch (e) {
      failed = true;
      results.push({ ok: false, ...writeError(e) });
    }
  }
  return json({ results });
}

async function insertAtStart(call, append, pid, batch) {
  try { return { res: await append(batch, { position: { type: 'start' } }, START_VERSION) }; }
  catch (e) { if (!(e instanceof NotionError && e.status === 400)) throw e; }
  const first = (await call('GET', `/blocks/${pid}/children?page_size=1`)).results?.[0];
  if (!first) return { res: await append(batch, {}) };
  const copy = copyOf(first);
  if (!copy) return { error: 'Notion can’t put blocks before the first block on this page (it is a sub-page, has nested blocks, or is a synced block). Add a line at the top of the Notion page and upload again.' };
  const res = await append(batch, { after: first.id });
  const last = res.results?.[res.results.length - 1]?.id;
  const again = await append([copy], last ? { after: last } : {});
  await call('DELETE', `/blocks/${first.id}`);
  return { res, moved: { from: bare(first.id), to: bare(again.results?.[0]?.id) } };
}

function writeError(e) {
  if (e instanceof Friendly) return { error: 'limit', message: e.message };
  if (e instanceof NotionError) {
    if (e.status === 403 || e.code === 'restricted_resource' || e.code === 'insufficient_permissions') return { error: 'permission', message: WRITE_DENIED };
    if (e.status === 404 || e.code === 'object_not_found') return { error: 'share', message: SHARE.message };
    if (e.status === 401) return { error: 'token', message: 'Notion refused the NOTION_TOKEN. Copy the integration secret again into Vercel, then redeploy.' };
    return { error: 'notion', message: `Notion: ${e.message}` };
  }
  return { error: 'server', message: e?.message || 'Something went wrong writing to Notion.' };
}

const okHost = (h) => FILE_HOSTS.some((d) => h === d || h.endsWith('.' + d));

export async function GET(req) {
  // GET ?url=<Notion link> reads a page too (the app falls back to it if a POST is refused).
  const link = new URL(req.url).searchParams.get('url');
  if (link) { const token = process.env.NOTION_TOKEN; return token ? importPage(token, link) : json(SETUP, 501); }
  const raw = new URL(req.url).searchParams.get('file');
  let u;
  try { u = new URL(raw || ''); } catch { return json({ error: 'input', message: 'Missing ?file=' }, 400); }
  if (u.protocol !== 'https:' || !okHost(u.hostname)) return json({ error: 'input', message: 'Only Notion-hosted files.' }, 400);
  let r;
  try { r = await fetch(u, { redirect: 'follow' }); } catch { return json({ error: 'fetch', message: 'Couldn’t fetch that file.' }, 502); }
  try { const fu = new URL(r.url); if (fu.protocol !== 'https:' || !okHost(fu.hostname)) return json({ error: 'input', message: 'Only Notion-hosted files.' }, 400); } catch { /* no final url */ }
  if (!r.ok || !r.body) return json({ error: 'fetch', message: `The file link answered ${r.status} (Notion file links expire after an hour; read the page again).` }, 502);
  const len = Number(r.headers.get('content-length'));
  if (len > MAX_FILE) return json({ error: 'size', message: 'That file is over 25 MB.' }, 413);
  let seen = 0;
  const cap = new TransformStream({
    transform(chunk, ctl) {
      seen += chunk.byteLength;
      if (seen > MAX_FILE) ctl.error(new Error('too big'));
      else ctl.enqueue(chunk);
    },
  });
  const headers = { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'private, max-age=600' };
  if (len) headers['content-length'] = String(len);
  return new Response(r.body.pipeThrough(cap), { headers });
}
