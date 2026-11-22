// Downloads the reader's source documents into public/library/ and indexes their text.
// Runs before every build (and weekly on GitHub), so the binder always has the current editions.
// Unchanged files aren't re-downloaded: we ask the server first (ETag / Last-Modified).
// Env LIBRARY_LOCAL=id=path,id=path uses local files instead (for offline development).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const pdfjs = createRequire(import.meta.url)('pdfjs-dist/legacy/build/pdf.js');
import { textFromItems } from '../src/lib/is/pdf.js';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const OUT = 'public/library';
mkdirSync(OUT, { recursive: true });
const { docs } = JSON.parse(readFileSync('src/data/library.json', 'utf8'));

// Every other web page a lesson links to (Boldmethod, CFI Notebook, SKYbrary…) is snapshotted too, so it
// opens in the reader like a PDF. Links are found by scanning the lessons and the named sources, so a link
// added in the editor gets picked up on the next build.
const SKIP_HOSTS = /(^|\.)(faa\.gov|ecfr\.gov|youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|github\.com)$/;
const normUrl = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch { return null; } };
const webId = (u) => 'web-' + createHash('sha1').update(u).digest('hex').slice(0, 10);
function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])); }
const linked = new Set();
for (const f of [...walk('src/content/lessons').filter((f) => /\.mdx?$/.test(f)), 'src/data/sources.ts', 'src/sims/kit.js']) {
  for (const m of readFileSync(f, 'utf8').matchAll(/https?:\/\/[^\s"'`)<>\]]+/g)) {
    const u = normUrl(m[0].replace(/[.,;]+$/, ''));
    if (u && !SKIP_HOSTS.test(new URL(u).hostname)) linked.add(u);
  }
}
const known = new Set(docs.map((d) => normUrl(d.url)));
for (const u of linked) if (!known.has(u)) docs.push({ id: webId(u), url: u, type: 'web', auto: true });

const metaPath = join(OUT, 'meta.json');
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
const local = Object.fromEntries((process.env.LIBRARY_LOCAL || '').split(',').filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
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
  const file = local[doc.id] || local[doc.url];
  if (file && doc.type === 'web') { const raw = readFileSync(file, 'utf8'); return { ...webDoc(doc, raw, doc.url), raw, finalUrl: doc.url }; }
  const ua = doc.type === 'web' ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' : UA;
  const res = await fetch(doc.type === 'ecfr' ? await ecfrUrl(doc) : doc.url, { headers: { 'user-agent': ua, accept: 'text/html,application/xhtml+xml,*/*' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  const labels = [], pages = [];
  if (doc.type === 'web') return { ...webDoc(doc, body, res.url || doc.url), raw: body, finalUrl: res.url || doc.url };
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
    // Appendices (e.g. Part 91 Appendix D) are pages too, labelled by their heading.
    for (const m of body.matchAll(/<DIV9[^>]*N="([^"]+)"[^>]*TYPE="APPENDIX"[^>]*>([\s\S]*?)<\/DIV9>/g)) {
      labels.push(m[1]);
      pages.push(htmlText(m[2].replace(/<\/HEAD>/g, '\n\n').replace(/<\/P>/g, '\n\n')));
    }
  }
  if (!pages.length) throw new Error('no paragraphs found');
  return { labels, pages, raw: doc.type === 'aim' ? body : null, finalUrl: res.url || doc.url };
}
// A web article becomes one "page" per heading. Everything visual is kept as a marker line the reader draws:
// [[img url|caption]] for photos, figures and diagrams, [[embed url|caption]] for YouTube/Vimeo players,
// [[video url|caption]] and [[audio url|caption]] for media files, and [[table]] blocks (one row per line, cells split by tabs).
const FILL = ' Picture or player kept from the original page so the binder reader can show it here.';
const TOKEN = /⟦media (\d+)⟧(?: Picture or player kept from the original page so the binder reader can show it here\.)?/g;
const VIDEO_HOST = /(youtube(-nocookie)?\.com|youtu\.be|player\.vimeo\.com|vimeo\.com|wistia\.(com|net)|loom\.com|dailymotion\.com|streamable\.com)/i;
function bestSrc(el) {
  if (!el?.getAttribute) return '';
  const set = el.getAttribute('data-srcset') || el.getAttribute('data-lazy-srcset') || el.getAttribute('srcset');
  if (set) {
    // largest candidate wins ("a.jpg 400w, b.jpg 1200w" or "a.jpg 1x, b.jpg 2x")
    const c = set.split(/,\s+(?=\S)/).map((x) => x.trim().split(/\s+/)).filter((x) => x[0] && !x[0].startsWith('data:'))
      .map(([u, d]) => [u, parseFloat(d) * (/x$/.test(d || '') ? 1000 : 1) || 1]).sort((a, b) => b[1] - a[1]);
    if (c[0]) return c[0][0];
  }
  for (const a of ['data-src', 'data-lazy-src', 'data-original', 'data-url', 'data-hi-res-src', 'data-full-src', 'data-lazy', 'src']) {
    const v = el.getAttribute(a);
    if (v && !v.startsWith('data:') && !/^(about:|javascript:)/.test(v)) return v;
  }
  return '';
}
const embedUrl = (u) => {
  try {
    const x = new URL(u);
    const yt = x.hostname.includes('youtu') && (x.searchParams.get('v') || x.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{6,})/)?.[1] || (x.hostname === 'youtu.be' && x.pathname.slice(1)));
    if (yt) return `https://www.youtube-nocookie.com/embed/${yt}`;
    const vm = x.hostname.includes('vimeo') && x.pathname.match(/(\d{6,})/)?.[1];
    if (vm) return `https://player.vimeo.com/video/${vm}`;
    return x.href;
  } catch { return ''; }
};
// Before Readability runs: wake lazy images, unwrap <noscript> fallbacks, and swap players, videos, audio and
// diagrams for plain <img> stand-ins (Readability keeps pictures, but throws players and SVG away).
function prepMedia(document, finalUrl) {
  const abs = (u) => { try { return new URL(u, finalUrl).href; } catch { return ''; } };
  const keep = [];
  // Pictures written by a small inline script (Boldmethod: showResponsiveImage_Switch('<img small>', '<img large>', 550)).
  // Take the last (largest) piece of markup in its strings and put it in the page where the script was.
  for (const sc of [...document.querySelectorAll('script')]) {
    const code = sc.textContent || '';
    if (code.length > 4000 || !/<(img|iframe|video|picture)\b/i.test(code)) continue;
    const bits = [...code.matchAll(/'((?:[^'\\]|\\.)*<(?:img|iframe|video|picture)\b(?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*<(?:img|iframe|video|picture)\b(?:[^"\\]|\\.)*)"/gi)].map((m) => (m[1] ?? m[2]).replace(/\\(['"\/])/g, '$1'));
    if (!bits.length) continue;
    const t = document.createElement('div'); t.innerHTML = bits[bits.length - 1];
    sc.replaceWith(...t.childNodes);
  }
  // A stand-in is a plain paragraph of text, because Readability judges blocks by their text: a wrapper holding just a
  // picture and a credit link looks like clutter to it and gets thrown away (that is how pictures were lost before).
  const MEDIA = 'img, picture, video, audio, iframe, svg, lite-youtube, lite-vimeo, [data-keep]';
  const count = (el) => (el.matches?.(MEDIA) ? 1 : 0) + el.querySelectorAll(MEDIA).length;
  const ownText = (el) => [...el.childNodes].map((c) => (c.nodeType === 3 ? c.textContent : c.tagName === 'A' ? '' : ownText(c))).join('').replace(/\s+/g, ' ').trim();
  const stand = (el, kind, url, cap = '') => {
    if (!url) return;
    let target = el;
    for (let p = el.parentElement; p && !/^(BODY|MAIN|ARTICLE|HTML)$/.test(p.tagName) && count(p) === count(target) && ownText(p).length < 140; p = p.parentElement) target = p;
    const fc = target.querySelector?.('figcaption') || (target.matches?.('figure') ? null : target.parentElement?.closest('figure')?.querySelector('figcaption'));
    let caption = (fc?.textContent || cap || '').replace(/\s+/g, ' ').trim();
    if (/^[\w-]*\d[\w-]*$|^(small|large|primary|image|img|photo|picture|thumbnail|blank)$/i.test(caption)) caption = ''; // file names, not captions
    const p = document.createElement('p');
    p.setAttribute('data-keep', String(keep.length));
    p.textContent = `⟦media ${keep.length}⟧${FILL}`;
    keep.push({ kind, url, cap: caption });
    target.replaceWith(p);
  };
  for (const ns of [...document.querySelectorAll('noscript')]) {
    const inner = ns.innerHTML.includes('<') ? ns.innerHTML : ns.textContent;
    if (!/<(img|picture|iframe|video)/i.test(inner || '')) { ns.remove(); continue; }
    const prev = ns.previousElementSibling;
    if (prev?.tagName === 'IMG' && !bestSrc(prev)) prev.remove();
    const t = document.createElement('div'); t.innerHTML = inner; ns.replaceWith(...t.childNodes);
  }
  for (const pic of [...document.querySelectorAll('picture')]) {
    const img = pic.querySelector('img');
    const srcs = [...pic.querySelectorAll('source')];
    const src = srcs.map(bestSrc).find(Boolean) || (img && bestSrc(img)); // <source> sets usually carry the big versions
    if (src) { const n = img || document.createElement('img'); n.setAttribute('src', src); n.removeAttribute('srcset'); if (!img) pic.appendChild(n); }
  }
  const junk = /(icon|logo|avatar|sprite|badge|emoji|spinner|pixel|tracking|gravatar|\/social\/|\/menu\/|\/ads?\/)/i;
  const chrome = 'nav, header, footer, aside, form, button, [role="navigation"], [class*="share"], [class*="social"], [class*="related"], [class*="author"], [class*="comment"]';
  for (const img of [...document.querySelectorAll('img')]) {
    if (!img.isConnected) continue;
    const src = bestSrc(img);
    const svgData = !src && (img.getAttribute('src') || '').startsWith('data:image/svg') && img.getAttribute('src').length < 150000;
    const url = src ? abs(src) : svgData ? img.getAttribute('src') : '';
    const w = parseFloat(img.getAttribute('width')) || 0, h = parseFloat(img.getAttribute('height')) || 0;
    if (!url || junk.test(url) || (w && w < 60) || (h && h < 60) || img.closest(chrome)) { img.remove(); continue; }
    // a picture that links to another article is a "read next" thumbnail, not part of this one
    const a = img.closest('a[href]');
    if (a && !/\.(jpe?g|png|gif|webp|avif|svg)(\?|$)/i.test(a.getAttribute('href')) && abs(a.getAttribute('href')).split('#')[0] !== finalUrl.split('#')[0]) { img.remove(); continue; }
    stand(img.closest('picture') || img, 'img', url, img.getAttribute('alt') || img.getAttribute('title') || '');
  }
  // pictures drawn as CSS backgrounds
  for (const el of [...document.querySelectorAll('[style*="background-image"], [data-bg], [data-background], [data-background-image], [data-bg-src]')]) {
    if (!el.isConnected || el.closest(chrome) || ownText(el).length > 20) continue;
    const raw = el.getAttribute('data-bg') || el.getAttribute('data-background') || el.getAttribute('data-background-image') || el.getAttribute('data-bg-src') || (el.getAttribute('style') || '').match(/background-image\s*:\s*url\(\s*['"]?([^'")]+)/i)?.[1] || '';
    const u = raw.replace(/^url\(\s*['"]?|['"]?\s*\)$/g, '');
    if (u && !u.startsWith('data:') && !junk.test(u)) stand(el, 'img', abs(u), el.getAttribute('aria-label') || el.getAttribute('title') || '');
  }
  for (const el of [...document.querySelectorAll('iframe, lite-youtube, lite-vimeo, [data-youtube-id], [data-video-id][data-provider]')]) {
    const tag = el.tagName.toLowerCase();
    let u = '';
    if (tag === 'iframe') u = el.getAttribute('src') || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || '';
    else if (tag === 'lite-youtube' || el.getAttribute('data-youtube-id')) u = `https://youtu.be/${el.getAttribute('videoid') || el.getAttribute('data-youtube-id')}`;
    else if (tag === 'lite-vimeo') u = `https://vimeo.com/${el.getAttribute('videoid')}`;
    u = abs(u);
    if (u && VIDEO_HOST.test(u)) stand(el, 'embed', embedUrl(u), el.getAttribute('title') || '');
    else el.remove();
  }
  for (const v of [...document.querySelectorAll('video')]) {
    const src = v.getAttribute('src') || v.getAttribute('data-src') || [...v.querySelectorAll('source')].map((s) => s.getAttribute('src') || s.getAttribute('data-src')).find(Boolean);
    stand(v, 'video', src ? abs(src) : '', v.getAttribute('title') || v.getAttribute('aria-label') || '');
    if (!src) v.remove();
  }
  for (const a of [...document.querySelectorAll('audio')]) {
    const src = a.getAttribute('src') || [...a.querySelectorAll('source')].map((s) => s.getAttribute('src')).find(Boolean);
    if (src) stand(a, 'audio', abs(src), a.getAttribute('title') || ''); else a.remove();
  }
  // Diagrams drawn as inline SVG: keep the bigger ones (icons and logos are small) as SVG pictures.
  for (const svg of [...document.querySelectorAll('svg')]) {
    if (svg.parentElement?.closest('svg')) continue;
    const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const w = parseFloat(svg.getAttribute('width')) || vb[2] || 0, h = parseFloat(svg.getAttribute('height')) || vb[3] || 0;
    const markup = svg.outerHTML;
    if (w < 120 || h < 80 || markup.length > 150000 || svg.closest('nav, header, footer, button, a')) { continue; }
    if (!/xmlns=/.test(markup.slice(0, 200))) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    stand(svg, 'img', 'data:image/svg+xml;base64,' + Buffer.from(svg.outerHTML).toString('base64'), svg.querySelector('title')?.textContent || svg.getAttribute('aria-label') || '');
  }
  return keep;
}
function webDoc(doc, html, finalUrl) {
  const { document } = parseHTML(html);
  const site = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || new URL(finalUrl).hostname.replace(/^www\./, '');
  const keep = prepMedia(document, finalUrl);
  const art = new Readability(document, { charThreshold: 300, keepClasses: false }).parse();
  if (!art?.content) throw new Error('no article text found');
  const { document: d } = parseHTML(`<!doctype html><html><body>${art.content}</body></html>`);
  const labels = [], pages = [];
  let cur = { label: 'Intro', text: [] };
  const flush = () => { const t = cur.text.join('\n\n').trim(); if (t) { labels.push(cur.label); pages.push(t); } };
  const clean = (t) => t.replace(/\s+/g, ' ').trim();
  const capOf = (n, img) => clean(n.querySelector?.('figcaption')?.textContent || img?.getAttribute('alt') || img?.getAttribute('title') || '').replace(/[|\]\[]/g, ' ');
  const seen = new Set();
  const put = (m) => {
    if (!m?.url || seen.has(m.url)) return;
    seen.add(m.url);
    cur.text.push(`[[${m.kind} ${m.url}|${clean(m.cap || '').replace(/[|\]\[]/g, ' ')}]]`);
  };
  const media = (n, img) => {
    let url = img.getAttribute('src') || '';
    if (!url.startsWith('data:')) { try { url = new URL(url, finalUrl).href; } catch { return; } }
    put({ kind: 'img', url, cap: capOf(n, img) });
  };
  // text with stand-ins in it: the words first, then the pictures/players it held
  const said = (t) => {
    const ids = [...t.matchAll(TOKEN)].map((x) => +x[1]);
    const words = clean(t.replace(TOKEN, ' '));
    return { words, ms: ids.map((i) => keep[i]) };
  };
  const visit = (el) => {
    for (const n of el.children) {
      const tag = n.tagName.toLowerCase();
      if (/^h[1-4]$/.test(tag)) { flush(); cur = { label: clean(n.textContent).slice(0, 60) || 'Section', text: [clean(n.textContent)] }; }
      else if (tag === 'img') media(n, n);
      else if (tag === 'figure' || tag === 'picture') {
        const imgs = [...n.querySelectorAll('img')];
        if (imgs.length) for (const img of imgs) media(n, img);
        else { const { words, ms } = said(n.textContent); if (words) cur.text.push(words); ms.forEach(put); }
      }
      else if (tag === 'table') {
        const tms = said(n.textContent).ms;
        const rows = [...n.querySelectorAll('tr')].map((tr) => [...tr.children].filter((c) => /^t[dh]$/i.test(c.tagName)).map((c) => said(c.textContent).words.replace(/\t/g, ' '))).filter((r) => r.some(Boolean));
        if (rows.length > 1 && rows.some((r) => r.length > 1)) cur.text.push('[[table]]\n' + rows.map((r) => r.join('\t')).join('\n'));
        else for (const r of rows) { const t = r.join(' '); if (t) cur.text.push(t); }
        tms.forEach(put);
        for (const img of n.querySelectorAll('img')) media(n, img);
      }
      else if (tag === 'li') { const { words, ms } = said(n.textContent); if (words) cur.text.push('• ' + words); ms.forEach(put); for (const img of n.querySelectorAll('img')) media(n, img); }
      else if (/^(p|blockquote|pre|figcaption|dt|dd)$/.test(tag)) { const { words, ms } = said(n.textContent); if (words) cur.text.push(words); ms.forEach(put); for (const img of n.querySelectorAll('img')) media(n, img); }
      else visit(n);
    }
  };
  visit(d.body);
  flush();
  if (!pages.length) throw new Error('no article text found');
  doc.title = doc.title || clean(art.title || finalUrl);
  doc.short = doc.short || clean(site);
  return { labels, pages };
}
async function ecfrUrl(doc) {
  const titles = await (await fetch('https://www.ecfr.gov/api/versioner/v1/titles.json', { headers: { 'user-agent': UA } })).json();
  const t = titles.titles.find((x) => x.number === doc.title_no);
  const date = doc.date || t.up_to_date_as_of || t.latest_issue_date; // date: an older edition (e.g. pre-2017 Part 23)
  return `https://www.ecfr.gov/api/versioner/v1/full/${date}/title-${doc.title_no}.xml?part=${doc.part}`;
}

// ---- The page as it looks on its own site ----
// Besides the text (for search), each web source is saved as a copy of the real page: its own HTML, styles and
// pictures (still loaded from the site), so the reader shows it exactly as the site does. Scripts are taken out
// (the reader also shows it in a sandbox that can't run any), lazy pictures are woken up, and links open the site.
const SNAP_CSS = `mark.cfi-hl{background:rgba(255,210,0,.55)!important;color:inherit!important;border-radius:2px;padding:0 1px}
mark.cfi-hl.cfi-cur{background:rgba(255,150,0,.75)!important}
[data-aos],.aos-init,.wow,.reveal,.fade-in,.lazyload,.lazyloading{opacity:1!important;transform:none!important;visibility:visible!important}
html,body{overflow-x:hidden}`;
function snapshot(html, finalUrl) {
  const { document } = parseHTML(html);
  const abs = (u) => { try { return new URL(u, finalUrl).href; } catch { return ''; } };
  // Pictures written by an inline script (Boldmethod) go back where the script was.
  for (const sc of document.querySelectorAll('script')) {
    const strs = [...(sc.textContent || '').matchAll(/(['"])((?:\\.|(?!\1).)*<img\b(?:\\.|(?!\1).)*)\1/g)].map((m) => m[2].replace(/\\(['"\/])/g, '$1'));
    if (strs.length) { const t = document.createElement('span'); t.innerHTML = strs[strs.length - 1]; sc.replaceWith(...t.childNodes); }
  }
  // <noscript> often holds the real picture behind a lazy loader: keep its pictures, drop the rest.
  for (const ns of document.querySelectorAll('noscript')) {
    const t = document.createElement('div'); t.innerHTML = ns.innerHTML.includes('<') ? ns.innerHTML : ns.textContent;
    const imgs = [...t.querySelectorAll('img')];
    const prev = ns.previousElementSibling;
    if (imgs.length && prev?.tagName === 'IMG' && !/^https?:/.test(prev.getAttribute('src') || '')) prev.replaceWith(imgs[0]);
    else if (imgs.length && !(prev?.tagName === 'IMG')) ns.replaceWith(...imgs);
    ns.remove();
  }
  document.querySelectorAll('script, iframe[src*="googletagmanager"], object, embed, applet, base, link[rel="preload"], link[rel="modulepreload"], link[rel="prefetch"], link[rel="manifest"], link[rel="serviceworker"], meta[http-equiv]').forEach((n) => n.remove());
  // Players and other frames can't run in the reader: a plain link to the video instead.
  for (const f of document.querySelectorAll('iframe')) {
    const src = abs(f.getAttribute('src') || f.getAttribute('data-src') || '');
    const a = document.createElement('a');
    a.setAttribute('href', src || finalUrl); a.setAttribute('style', 'display:block;padding:14px;border:1px solid #ccc;border-radius:8px;text-align:center;font:600 15px system-ui,sans-serif;color:#1d5fd1');
    a.textContent = /youtu|vimeo|wistia|loom/i.test(src) ? '▶ Play this video on the original site' : 'Open this part on the original site';
    f.replaceWith(a);
  }
  for (const el of document.querySelectorAll('*')) {
    for (const at of [...el.attributes]) {
      const n = at.name.toLowerCase();
      if (n.startsWith('on') || n === 'srcdoc' || n === 'formaction' || (/^(href|src|action|xlink:href|data)$/.test(n) && /^\s*(javascript|vbscript|data:text\/html)/i.test(at.value))) el.removeAttribute(at.name);
    }
    if (el.tagName === 'IMG' || el.tagName === 'SOURCE') {
      const src = ['data-src', 'data-lazy-src', 'data-original', 'data-url', 'data-hi-res-src', 'data-full-src', 'data-lazy'].map((a) => el.getAttribute(a)).find((v) => v && !v.startsWith('data:'));
      if (src) el.setAttribute(el.tagName === 'IMG' ? 'src' : 'srcset', src);
      const set = el.getAttribute('data-srcset') || el.getAttribute('data-lazy-srcset');
      if (set) el.setAttribute('srcset', set);
      if (el.tagName === 'IMG') { el.removeAttribute('loading'); el.classList.remove('lazyload', 'lazy'); }
    }
  }
  for (const f of document.querySelectorAll('form')) f.removeAttribute('action');
  const head = document.head || document.documentElement;
  const meta = (h) => { const t = document.createElement('div'); t.innerHTML = h; head.prepend(...t.childNodes); };
  if (!document.querySelector('meta[name="viewport"]')) meta('<meta name="viewport" content="width=device-width, initial-scale=1">');
  meta(`<meta charset="utf-8"><base href="${finalUrl.replace(/"/g, '&quot;')}" target="_blank"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'self' ${new URL(finalUrl).origin}">`);
  const st = document.createElement('style'); st.textContent = SNAP_CSS; head.append(st);
  return '<!doctype html>\n' + document.documentElement.outerHTML;
}
// eCFR: the regulation's own reading view (the HTML ecfr.gov shows), with a stylesheet close to the site's.
const ECFR_CSS = `body{margin:0;background:#fff;color:#1b1b1b;font:17px/1.6 "Source Serif Pro",Georgia,"Times New Roman",serif}
.cfi-ecfr{max-width:46rem;margin:0 auto;padding:18px 16px 60px}
.cfi-ecfr-top{font:600 13px/1.3 system-ui,sans-serif;color:#fff;background:#112e51;margin:-18px -16px 18px;padding:12px 16px}
h1,h2,h3,h4,h5{font-family:"Public Sans",system-ui,sans-serif;line-height:1.25;color:#112e51}
h1{font-size:1.5rem}h2{font-size:1.25rem}h3{font-size:1.1rem}h4,h5{font-size:1rem}
.section{margin:0 0 2em;padding-top:.5em;border-top:1px solid #dfe1e2}
p{margin:0 0 .8em}.indent-1{margin-left:1.5em}.indent-2{margin-left:3em}.indent-3{margin-left:4.5em}.indent-4{margin-left:6em}
.citation,.source,.authority{font-size:.85em;color:#565c65}table{border-collapse:collapse}td,th{border:1px solid #a9aeb1;padding:4px 6px}`;
async function ecfrSnapshot(doc) {
  const titles = await (await fetch('https://www.ecfr.gov/api/versioner/v1/titles.json', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) })).json();
  const t = titles.titles.find((x) => x.number === doc.title_no);
  const date = doc.date || t.up_to_date_as_of || t.latest_issue_date;
  const res = await fetch(`https://www.ecfr.gov/api/renderer/v1/content/enhanced/${date}/title-${doc.title_no}?part=${doc.part}`, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`renderer HTTP ${res.status}`);
  const body = await Promise.race([res.text(), new Promise((_, no) => setTimeout(() => no(new Error('renderer too slow')), 25000))]);
  if (!/<(div|p|h\d)\b/i.test(body)) throw new Error('renderer gave no HTML');
  return snapshot(`<!doctype html><html><head><title>${doc.title || ''}</title><style>${ECFR_CSS}</style></head><body><div class="cfi-ecfr"><div class="cfi-ecfr-top">eCFR · Title ${doc.title_no} · Part ${doc.part}${doc.date ? ` (as of ${doc.date})` : ''}</div>${body}</div></body></html>`, doc.url);
}

const index = [];
for (const doc of docs) {
  if (doc.type !== 'pdf') {
    try {
      const { labels, pages, raw, finalUrl } = await textDoc(doc);
      const old = meta[doc.id];
      if (old?.pages && pages.length < old.pages * 0.5) throw new Error(`only ${pages.length} sections, had ${old.pages}; keeping the old copy`);
      // The real page too; if that fails the reader falls back to the text.
      let snap = false;
      try {
        const page = doc.type === 'ecfr' ? await ecfrSnapshot(doc) : raw ? snapshot(raw, finalUrl) : '';
        if (page) { writeFileSync(join(OUT, `${doc.id}.html`), page); snap = true; }
      } catch (e) { console.warn(`no page copy for ${doc.id}: ${e.message}`); }
      if (!snap && existsSync(join(OUT, `${doc.id}.html`))) snap = true; // keep last week's copy
      const json = JSON.stringify({ id: doc.id, title: doc.title, short: doc.short, url: doc.url, kind: 'text', snap, labels, pages });
      const prevJson = existsSync(join(OUT, `${doc.id}.json`)) ? readFileSync(join(OUT, `${doc.id}.json`), 'utf8') : '';
      const changed = json !== prevJson;
      writeFileSync(join(OUT, `${doc.id}.json`), json);
      meta[doc.id] = { pages: pages.length, checked: new Date().toISOString(), updated: changed ? new Date().toISOString() : old?.updated };
      index.push({ id: doc.id, title: doc.title, short: doc.short, url: doc.url, pages: pages.length, updated: meta[doc.id].updated });
      console.log(`${changed ? 'updated ' : 'current '} ${doc.id} (${pages.length} sections, ${(json.match(/\[\[(img|embed|video|audio) /g) || []).length} media)`);
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
// url -> doc, so any ordinary link in a lesson can open in the reader.
const links = {};
for (const d of docs) if (existsSync(join(OUT, `${d.id}.json`))) links[normUrl(d.url)] = d.id;
writeFileSync(join(OUT, 'links.json'), JSON.stringify(links));
