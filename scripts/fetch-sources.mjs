// Downloads the reader's source documents into public/library/ and indexes their text.
// Runs before every build (and weekly on GitHub), so the binder always has the current editions.
// Unchanged files aren't re-downloaded: we ask the server first (ETag / Last-Modified).
// Env LIBRARY_LOCAL=id=path,id=path uses local files instead (for offline development).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const pdfjs = createRequire(import.meta.url)('pdfjs-dist/legacy/build/pdf.js');
import { textFromItems } from '../src/lib/is/pdf.js';

const OUT = 'public/library';
mkdirSync(OUT, { recursive: true });
const { docs } = JSON.parse(readFileSync('src/data/library.json', 'utf8'));
const metaPath = join(OUT, 'meta.json');
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
const local = Object.fromEntries((process.env.LIBRARY_LOCAL || '').split(',').filter(Boolean).map((p) => p.split('=')));
const UA = 'Mozilla/5.0 (compatible; CFI-Binder source updater)';

async function get(doc) {
  if (local[doc.id]) return { bytes: readFileSync(local[doc.id]), changed: true, info: { source: 'local' } };
  const prev = meta[doc.id] || {};
  const file = join(OUT, `${doc.id}.pdf`);
  const headers = { 'user-agent': UA };
  if (existsSync(file)) {
    if (prev.etag) headers['if-none-match'] = prev.etag;
    if (prev.lastModified) headers['if-modified-since'] = prev.lastModified;
  }
  const res = await fetch(doc.url, { headers, redirect: 'follow' });
  if (res.status === 304) return { bytes: readFileSync(file), changed: false, info: prev };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.subarray(0, 5).toString().startsWith('%PDF')) throw new Error('not a PDF (got an error page?)');
  return { bytes, changed: true, info: { etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') } };
}

// Text sources (AIM web pages, eCFR) become one "page" per numbered paragraph or section.
const decode = (t) => t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&[a-z]+;/g, ' ');
const htmlText = (h) => decode(h.replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr|table|section|ol|ul)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim();
async function textDoc(doc) {
  const res = await fetch(doc.type === 'ecfr' ? await ecfrUrl(doc) : doc.url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  const labels = [], pages = [];
  if (doc.type === 'aim') {
    const text = htmlText(body);
    const parts = text.split(/\n(?=\s*(?:\d+-\d+-\d+)\.\s)/);
    for (const part of parts) {
      const m = part.match(/^\s*(\d+-\d+-\d+)\./);
      if (m) { labels.push(m[1]); pages.push(part.trim()); }
    }
  } else {
    for (const m of body.matchAll(/<DIV8[^>]*N="([^"]+)"[^>]*TYPE="SECTION"[^>]*>([\s\S]*?)<\/DIV8>/g)) {
      labels.push(m[1]);
      pages.push(htmlText(m[2].replace(/<\/HEAD>/g, '\n\n').replace(/<\/P>/g, '\n\n')));
    }
  }
  if (!pages.length) throw new Error('no paragraphs found');
  return { labels, pages };
}
async function ecfrUrl(doc) {
  const titles = await (await fetch('https://www.ecfr.gov/api/versioner/v1/titles.json', { headers: { 'user-agent': UA } })).json();
  const t = titles.titles.find((x) => x.number === doc.title_no);
  const date = t.up_to_date_as_of || t.latest_issue_date;
  return `https://www.ecfr.gov/api/versioner/v1/full/${date}/title-${doc.title_no}.xml?part=${doc.part}`;
}

const index = [];
for (const doc of docs) {
  if (doc.type !== 'pdf') {
    try {
      const { labels, pages } = await textDoc(doc);
      const old = meta[doc.id];
      if (old?.pages && pages.length < old.pages * 0.5) throw new Error(`only ${pages.length} sections, had ${old.pages}; keeping the old copy`);
      const json = JSON.stringify({ id: doc.id, title: doc.title, short: doc.short, url: doc.url, kind: 'text', labels, pages });
      const prevJson = existsSync(join(OUT, `${doc.id}.json`)) ? readFileSync(join(OUT, `${doc.id}.json`), 'utf8') : '';
      const changed = json !== prevJson;
      writeFileSync(join(OUT, `${doc.id}.json`), json);
      meta[doc.id] = { pages: pages.length, checked: new Date().toISOString(), updated: changed ? new Date().toISOString() : old?.updated };
      index.push({ id: doc.id, title: doc.title, short: doc.short, url: doc.url, pages: pages.length, updated: meta[doc.id].updated });
      console.log(`${changed ? 'updated ' : 'current '} ${doc.id} (${pages.length} sections)`);
    } catch (e) {
      console.warn(`skipped  ${doc.id}: ${e.message}`);
      if (existsSync(join(OUT, `${doc.id}.json`))) index.push({ id: doc.id, title: doc.title, short: doc.short, url: doc.url, pages: meta[doc.id]?.pages, updated: meta[doc.id]?.updated });
    }
    continue;
  }
  try {
    const { bytes, changed, info } = await get(doc);
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false }).promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      pages.push(textFromItems((await page.getTextContent()).items).text);
      page.cleanup();
    }
    await pdf.destroy();
    // Sanity check (from Instant Search): a "new" version far smaller than the old one is probably wrong.
    const old = meta[doc.id];
    if (changed && old?.pages && pages.length < old.pages * 0.5) throw new Error(`only ${pages.length} pages, had ${old.pages}; keeping the old copy`);
    if (changed) writeFileSync(join(OUT, `${doc.id}.pdf`), bytes);
    const labels = pages.map((_, i) => (doc.labels?.chapter ? `${doc.labels.chapter}-${i + 1}` : String(i + 1)));
    writeFileSync(join(OUT, `${doc.id}.json`), JSON.stringify({ id: doc.id, title: doc.title, short: doc.short, url: doc.url, labels, pages }));
    meta[doc.id] = { ...info, pages: pages.length, checked: new Date().toISOString(), updated: changed ? new Date().toISOString() : old?.updated };
    index.push({ id: doc.id, title: doc.title, short: doc.short, url: doc.url, pages: pages.length, updated: meta[doc.id].updated });
    console.log(`${changed ? 'updated ' : 'current '} ${doc.id} (${pages.length} pages)`);
  } catch (e) {
    console.warn(`skipped  ${doc.id}: ${e.message}`);
    if (existsSync(join(OUT, `${doc.id}.json`))) index.push({ id: doc.id, title: doc.title, short: doc.short, url: doc.url, pages: meta[doc.id]?.pages, updated: meta[doc.id]?.updated });
  }
}
writeFileSync(metaPath, JSON.stringify(meta, null, 2));
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index));
