// Makes a copy of dist/ that works from any folder (relative links, explicit index.html).
// Used for private previews; the real site deploys dist/ as-is.
import { cpSync, rmSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
const src = 'dist', out = 'dist-portable';
rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
  const rel = relative(dirname(file), out) || '.';
  const prefix = rel === '.' ? './' : rel + '/';
  let html = readFileSync(file, 'utf8');
  html = html.replace(/(href|src)="\/(?!\/)([^"]*)"/g, (_, a, p) => {
    let [path, hash] = p.split('#');
    if (path === '' || path.endsWith('/')) path += 'index.html';
    return `${a}="${prefix}${path}${hash !== undefined ? '#' + hash : ''}"`;
  });
  html = html.replace('data-base="/"', `data-base="${prefix}" data-portable`);
  writeFileSync(file, html);
}
// Sandboxed previews can't serve Pagefind's binary index, so also write a small JSON section index.
const strip = (h) => h.replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
const index = [];
for (const file of walk(out).filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(file, 'utf8');
  const body = html.match(/data-pagefind-body[^>]*>([\s\S]*?)<\/article>/);
  if (!body) continue;
  const title = strip((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '');
  const url = relative(out, file).replace(/\\/g, '/');
  const parts = body[1].split(/(?=<h[23][^>]*id=")/);
  for (const part of parts) {
    const m = part.match(/^<h[23][^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h[23]>/);
    index.push({ url: url + (m ? '#' + m[1] : ''), page: title, section: m ? strip(m[2]) : title, text: strip(m ? part.slice(m[0].length) : part) });
  }
}
writeFileSync(join(out, 'search-index.json'), JSON.stringify(index));
console.log('portable build ready in', out, '·', index.length, 'search sections');
