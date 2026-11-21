// Brings the Aviation Interactives sims into the binder (public/sims/), so they're part of the site:
// same address, the binder's theme and fonts (via sim-theme.js / sim-theme.css), no outside fonts.
// Run again after changing a sim in the Aviation Interactives repo:
//   node scripts/import-sims.mjs ../aviation-interactives
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const src = join(process.argv[2] || '../aviation-interactives', 'sims');
const out = 'public/sims';
mkdirSync(out, { recursive: true });
for (const f of readdirSync(src)) {
  let t = readFileSync(join(src, f), 'utf8');
  if (f.endsWith('.html')) {
    t = t
      // the theme layer goes first, so it's in place before the sim draws anything
      .replace(/<head>/i, '<head>\n<script src="sim-theme.js"></script>')
      // the binder's fonts instead of Google Fonts; no separate app icons or manifest
      .replace(/<link rel="(?:preconnect|icon|apple-touch-icon|manifest)"[^>]*>\n?/g, '')
      .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>\n?/g, '')
      .replace(/<meta name="claude:[^>]*>\n?/g, '')
      .replace(/<\/head>/i, '<link rel="stylesheet" href="sim-theme.css">\n</head>');
  }
  writeFileSync(join(out, f), t);
  console.log('sims/' + f);
}
