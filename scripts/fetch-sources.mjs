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

const index = [];
for (const doc of docs) {
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
