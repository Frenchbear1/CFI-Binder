# CFI Binder

Static site (Astro + MDX) for teaching Private, Instrument and Commercial students in the C172 and PA-28-181.

- `npm install`, then `npm run dev` to write, `npm run build` for the production site in `dist/` (includes the Pagefind search index).
- Lessons live in `src/content/lessons/**.mdx`. Add the slug to `src/data/outline.ts` to mark it ready.
- Components for lessons: `<Level pa|ir|ca>`, `<Compare>` (C172 vs PA-28 cards), `<Specs>`, `<Callout kind="teach|fleet|warn|acs">`, `<Figure>`, `<Video youtube="…">` (click-to-load), `<Toggle>`, `<Refs>`, `<AC c172|pa28>`.
- Deploy: Vercel (framework preset Astro) or GitHub Pages (set `BASE=/repo-name/` and `SITE`).
- `node scripts/portable.mjs` makes `dist-portable/`, a relative-link copy for sandboxed previews.
