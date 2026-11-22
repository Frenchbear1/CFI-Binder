// Changes to pages that came in from a Notion link go back to Notion when you press Upload (never before).
// src/data/notion-sync.json remembers, for each such page, its Notion page and which Notion blocks each of
// its blocks came from. On Upload we compare the page's blocks with that list: blocks you deleted are deleted
// in Notion, blocks you added or changed are written there in the same spot, and blocks you didn't touch are
// left alone (so Notion's comments and anything the binder can't show stay put).
// Pages that came from a .zip export aren't linked, so they don't sync.
import { stage, readLocal, isStaged } from '../outbox';
import built from '../../data/notion-sync.json';

export const SYNC_FILE = 'src/data/notion-sync.json';
export type SyncBlock = { md: string; ids: string[] };
export type SyncMap = { _about?: string; _at?: number; pages: Record<string, { page: string; blocks: SyncBlock[] }> };
const LS = 'cfi.notionSync';
const base = document.body.dataset.base || '/';
const api = () => new URL(`${base}api/notion`, document.baseURI).href;

/** The map as it stands: what's waiting on this device, else the newest of the built copy and the last uploaded one. */
export async function loadMap(): Promise<SyncMap> {
  if (isStaged(SYNC_FILE)) { const t = await readLocal(SYNC_FILE); if (t) return JSON.parse(t); }
  let mine: SyncMap | null = null;
  try { mine = JSON.parse(localStorage.getItem(LS) || 'null'); } catch {}
  const b = built as SyncMap;
  const pick = mine && (mine._at || 0) > (b._at || 0) ? mine : b;
  return structuredClone({ pages: {}, ...pick });
}
const fileOf = (m: SyncMap) => JSON.stringify({ ...m, _about: 'Which Notion page and blocks each imported page came from. Written by the app (src/scripts/notion/sync.ts); edits go back to Notion on Upload.', _at: Date.now() }, null, 2) + '\n';
export const mapFile = (m: SyncMap) => ({ path: SYNC_FILE, content: fileOf(m) });

/** A page's MDX as its top-level blocks (the same pieces mdx.ts and the page editor write). */
export function splitBlocks(text: string): string[] {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const out: string[] = [];
  let cur: string[] = [], fence = '', depth = 0;
  const push = () => { const b = cur.join('\n').trim(); if (b) out.push(b); cur = []; };
  for (const line of body.split('\n')) {
    if (fence) { cur.push(line); if (line.trim().startsWith(fence)) fence = ''; continue; }
    const f = line.match(/^\s*(```+|~~~+)/);
    if (f && !depth) { cur.push(line); fence = f[1]; continue; }
    if (!line.trim() && !depth) { push(); continue; }
    cur.push(line);
    // Components spread over several lines (<Callout>…</Callout>) are one block.
    const t = line.trim();
    const open = t.match(/^<([A-Z][\w.]*)\b/), close = t.match(/^<\/([A-Z][\w.]*)>/);
    if (close) depth = Math.max(0, depth - 1);
    else if (open && !/\/>\s*$/.test(t) && !new RegExp(`</${open[1]}>\\s*$`).test(t)) depth++;
  }
  push();
  return out;
}

/** Longest common run of unchanged blocks between the old list and the new one. */
function lcs(a: string[], b: string[]) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return pairs;
}

type Op = { op: 'delete'; ids: string[] } | { op: 'insert'; after: string | null; children: object[] };

/** Send this device's changes to linked pages to Notion and stage the updated map. Returns a note for the person. */
export async function syncToNotion(say: (t: string) => void = () => {}): Promise<string> {
  const map = await loadMap();
  const slugs = Object.keys(map.pages).filter((s) => isStaged(`src/content/lessons/${s}.mdx`));
  if (!slugs.length) return '';
  // The GitHub Pages copy has no server to reach Notion; the changes go next time you Upload from the Vercel site.
  if (/\.github\.io$/i.test(location.hostname)) return 'Notion wasn’t updated: this GitHub Pages copy can’t reach it. Upload from cfi-binder-coral.vercel.app to send those changes.';
  const { mdToNotion } = await import('./to-notion');
  const origin = location.origin;
  let changed = 0, kept = 0;
  const problems: string[] = [];
  for (const slug of slugs) {
    const entry = map.pages[slug];
    const text = await readLocal(`src/content/lessons/${slug}.mdx`);
    if (text == null) { delete map.pages[slug]; continue; } // deleted in the binder: Notion keeps its page
    const now = splitBlocks(text);
    const old = entry.blocks;
    const pairs = lcs(old.map((b) => b.md), now);
    const next: SyncBlock[] = [];
    const ops: Op[] = [], dels: string[] = [];
    // which new blocks each insert fills, and how many Notion blocks each one became
    const slots: { op: number; at: number; from: number; n: number }[] = [];
    let last: string | null = null; // the Notion block the next insert goes after
    let run: (Op & { op: 'insert' }) | null = null; // blocks added next to each other go in one insert, in order
    let i = 0, j = 0;
    const hunk = (iEnd: number, jEnd: number) => {
      const gone = old.slice(i, iEnd), added = now.slice(j, jEnd);
      for (let k = 0; k < added.length; k++) {
        const conv = mdToNotion(added[k], origin);
        if (!conv) {
          // Pair it with a removed block of the same sort (a changed picture replaces the old picture).
          const sort = (m: string) => m.match(/^<([A-Z]\w*)/)?.[1] || m.slice(0, 2);
          const gi = gone.findIndex((x) => x.ids.length && sort(x.md) === sort(added[k]));
          const g = gi >= 0 ? gone[gi] : undefined;
          // Notion can't hold this block (e.g. a picture from the binder): leave whatever was there alone.
          if (g) { next.push({ md: added[k], ids: g.ids }); last = g.ids[g.ids.length - 1]; gone[gi] = { md: '', ids: [] }; kept++; run = null; }
          else next.push({ md: added[k], ids: [] });
          continue;
        }
        next.push({ md: added[k], ids: [] });
        if (!conv.length) continue;
        if (!run) { run = { op: 'insert', after: last, children: [] }; ops.push(run); }
        slots.push({ op: ops.indexOf(run), at: next.length - 1, from: run.children.length, n: conv.length });
        run.children.push(...conv);
      }
      dels.push(...gone.flatMap((g) => g.ids));
      i = iEnd; j = jEnd;
    };
    for (const [pi, pj] of pairs) {
      hunk(pi, pj);
      next.push(old[pi]);
      if (old[pi].ids.length) { last = old[pi].ids[old[pi].ids.length - 1]; run = null; }
      i = pi + 1; j = pj + 1;
    }
    hunk(old.length, now.length);
    if (dels.length) ops.push({ op: 'delete', ids: dels });
    if (!ops.length) { entry.blocks = next; continue; }
    say(`Updating Notion: ${slug.split('/').pop()}…`);
    const r = await fetch(api(), { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'sync', page: entry.page, ops }) }).catch(() => null);
    const res: any = r ? await r.json().catch(() => null) : null;
    if (!r?.ok || !res?.results) { problems.push(res?.message || 'Notion didn’t answer, so your changes there will go next Upload'); continue; } // map unchanged: tries again next time
    for (const s of slots) {
      const o = res.results[s.op];
      if (o?.ok && Array.isArray(o.ids)) next[s.at].ids = o.ids.slice(s.from, s.from + s.n);
      else next[s.at].md = '\u0000not sent'; // shows as new next time, so it's tried again
    }
    // If Notion had to re-make the page's first block to insert above it, that block has a new id.
    for (const o of res.results) if (o?.moved?.from) next.forEach((b) => (b.ids = b.ids.map((id) => (id === o.moved.from ? o.moved.to : id))));
    const bad = res.results.find((o: any) => !o?.ok);
    if (bad) problems.push(bad.error || 'Notion refused a change');
    entry.blocks = next;
    changed++;
  }
  if (!changed && JSON.stringify(map) === JSON.stringify(await loadMap())) return '';
  map._at = Date.now();
  await stage([mapFile(map)], '');
  try { localStorage.setItem(LS, JSON.stringify(map)); } catch {}
  const parts = [];
  if (changed) parts.push(`Updated ${changed} page${changed === 1 ? '' : 's'} in Notion.`);
  if (kept) parts.push(`${kept} block${kept === 1 ? '' : 's'} Notion can’t show (like binder pictures) were left as they were there.`);
  if (problems.length) parts.push(`Notion: ${problems[0]}`);
  return parts.join(' ');
}
