// Vets YouTube videos with the YouTube Data API (needs YOUTUBE_API_KEY; skipped without it).
// 1. Every <Video youtube="…"> in the lessons gets its views, likes, comments and channel size saved to
//    public/library/videos.json; the video card shows them so you can see why a video was picked.
// 2. Each search in src/data/video-search.json is run once (cached) and its top results are ranked by
//    engagement and printed to the build log with a few top comments, for choosing new videos.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const KEY = process.env.YOUTUBE_API_KEY;
const OUT = 'public/library/videos.json';
mkdirSync('public/library', { recursive: true });
const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { videos: {}, searches: {} };
cache.searches ||= {};
if (!KEY) { console.log('video stats: no YOUTUBE_API_KEY, keeping', Object.keys(cache.videos || {}).length, 'saved'); process.exit(0); }

const api = async (path, params) => {
  const u = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries({ ...params, key: KEY })) u.searchParams.set(k, v);
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
};
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const n = (x) => Number(x || 0);
const fmt = (x) => (x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? Math.round(x / 1e3) + 'K' : String(x));

async function stats(ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const v = await api('videos', { part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(',') });
    const chIds = [...new Set(v.items.map((x) => x.snippet.channelId))];
    const ch = chIds.length ? await api('channels', { part: 'statistics', id: chIds.join(',') }) : { items: [] };
    const subs = Object.fromEntries(ch.items.map((c) => [c.id, n(c.statistics.subscriberCount)]));
    for (const x of v.items) out[x.id] = {
      title: x.snippet.title, channel: x.snippet.channelTitle, published: x.snippet.publishedAt.slice(0, 10),
      duration: x.contentDetails.duration.replace(/^PT/, '').toLowerCase(),
      views: n(x.statistics.viewCount), likes: n(x.statistics.likeCount), comments: n(x.statistics.commentCount),
      subs: subs[x.snippet.channelId] || 0, checked: new Date().toISOString().slice(0, 10),
    };
  }
  return out;
}
async function topComments(id, k = 4) {
  try {
    const c = await api('commentThreads', { part: 'snippet', videoId: id, order: 'relevance', maxResults: k, textFormat: 'plainText' });
    return c.items.map((t) => `      “${t.snippet.topLevelComment.snippet.textDisplay.replace(/\s+/g, ' ').slice(0, 140)}” (${t.snippet.topLevelComment.snippet.likeCount} likes)`);
  } catch { return ['      (comments off)']; }
}
const line = (id, s) => `${fmt(s.views).padStart(6)} views ${fmt(s.likes).padStart(5)} likes ${(s.views ? (100 * s.likes / s.views).toFixed(1) : '0').padStart(4)}% ${fmt(s.comments).padStart(5)} comments | ${s.channel} (${fmt(s.subs)} subs) | ${s.title} | ${s.duration} | ${s.published} | ${id}`;

// 1. Videos in use
const used = new Set();
for (const f of walk('src/content/lessons')) for (const m of readFileSync(f, 'utf8').matchAll(/youtube="([\w-]{11})"/g)) used.add(m[1]);
try {
  cache.videos = await stats([...used]);
  console.log(`\n== Videos in the lessons (${used.size}) ==`);
  for (const id of used) {
    const s = cache.videos[id];
    if (!s) { console.log(`  MISSING (deleted or private): ${id}`); continue; }
    console.log('  ' + line(id, s));
    (await topComments(id)).forEach((c) => console.log(c));
  }
} catch (e) { console.warn('video stats failed:', e.message); }

// 2. Candidate searches
const searches = existsSync('src/data/video-search.json') ? JSON.parse(readFileSync('src/data/video-search.json', 'utf8')) : [];
for (const q of searches) {
  try {
    if (!cache.searches[q]) {
      const r = await api('search', { part: 'id', q, type: 'video', maxResults: 15, relevanceLanguage: 'en', videoEmbeddable: 'true' });
      const st = await stats(r.items.map((x) => x.id.videoId));
      cache.searches[q] = Object.entries(st).map(([id, s]) => ({ id, ...s }));
    }
    // Rank: reach (log views) plus approval (likes per view) plus a trusted channel size.
    const rank = (s) => Math.log10(s.views + 1) + 20 * (s.likes / Math.max(s.views, 1)) + 0.5 * Math.log10(s.subs + 1);
    const list = [...cache.searches[q]].sort((a, b) => rank(b) - rank(a));
    console.log(`\n== Search: ${q} ==`);
    for (const [i, s] of list.entries()) {
      console.log('  ' + line(s.id, s));
      if (i < 3) (await topComments(s.id, 3)).forEach((c) => console.log(c));
    }
  } catch (e) { console.warn(`search "${q}" failed:`, e.message); }
}
writeFileSync(OUT, JSON.stringify(cache));
