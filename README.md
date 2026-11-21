# CFI Binder

Static site (Astro + MDX) for teaching Private, Instrument and Commercial students in the C172 and PA-28-181.

- `npm install`, then `npm run dev` to write, `npm run build` for the production site in `dist/` (includes the Pagefind search index).
- Lessons live in `src/content/lessons/**.mdx`. Add the slug to `src/data/outline.ts` to mark it ready.
- Components for lessons: `<Level pa|ir|ca>`, `<Compare>` (C172 vs PA-28 cards), `<Specs>`, `<Callout kind="teach|fleet|warn|acs">`, `<Figure>`, `<Video youtube="…">` (click-to-load), `<Toggle>`, `<Refs>`, `<AC c172|pa28>`.
- Deploy: Vercel (framework preset Astro) or GitHub Pages (set `BASE=/repo-name/` and `SITE`).
- `node scripts/portable.mjs` makes `dist-portable/`, a relative-link copy for sandboxed previews.

## Source reader

Tap any short reference (e.g. `PHAK 5-19`) and the real handbook page opens in place, with the lesson's key terms highlighted. Swipe or use ‹ › to move through every source cited in that section; the expand button reads full-screen and the magnifier searches every page of every handbook in the library.

- Built on [Instant Search](https://github.com/Frenchbear1/Instant-Search): `src/lib/is/search.js` (search engine) and `src/lib/is/pdf.js` (page drawing + highlights) are copied from it, with pdf.js 3.11.174 in `public/vendor/`.
- The library is listed in `src/data/library.json`. `node scripts/fetch-sources.mjs` downloads each document only if it changed, checks it looks right (Instant Search's sanity check), and indexes every page's text into `public/library/`.
- GitHub Actions (`.github/workflows/deploy.yml`) runs that on every push and every Monday, then rebuilds and publishes the site to GitHub Pages, so the binder always carries the current FAA editions.
- In a lesson: `<R to="PHAK 5-19" q="dihedral" />`. `q` is what to highlight; without it the paragraph's bold words are used.
