# Aviation Binder

Static site (Astro + MDX) for teaching Private, Instrument and Commercial students in the C172 and PA-28-181.

- `npm install`, then `npm run dev` to write, `npm run build` for the production site in `dist/` (includes the Pagefind search index).
- Lessons live in `src/content/lessons/**.mdx`. Add the slug to `src/data/outline.ts` to mark it ready.
- Components for lessons: `<Level pa|ir|ca>`, `<Compare>` (C172 vs PA-28 cards), `<Specs>`, `<Callout kind="teach|fleet|warn|acs">`, `<Figure>`, `<Video youtube="…">` (click-to-load), `<Toggle>`, `<Refs>`, `<AC c172|pa28>`.
- Deploy: Vercel project `cfi-binder` (builds on every push to main, see `vercel.json`).
- Sign-in: `middleware.js` + `api/login.js`. Signed out you only get the Interactives; the lessons need the instructor's sign-in (Google, see below; `CFI_USER` / `CFI_PASS` until Firebase is set up). `CFI_SECRET` (Vercel environment variable) signs the cookie; changing it signs everyone out. Sign out at `/api/login?out=1`.
- `node scripts/portable.mjs` makes `dist-portable/`, a relative-link copy for sandboxed previews.

## Source reader

Tap any short reference (e.g. `PHAK 5-19`) and the real handbook page opens in place, with the lesson's key terms highlighted. Swipe or use ‹ › to move through every source cited in that section; the expand button reads full-screen and the magnifier searches every page of every handbook in the library.

- Built on [Instant Search](https://github.com/Frenchbear1/Instant-Search): `src/lib/is/search.js` (search engine) and `src/lib/is/pdf.js` (page drawing + highlights) are copied from it, with pdf.js 3.11.174 in `public/vendor/`.
- The library is listed in `src/data/library.json`. `node scripts/fetch-sources.mjs` downloads each document only if it changed, checks it looks right (Instant Search's sanity check), and indexes every page's text into `public/library/`.
- GitHub Actions (`.github/workflows/deploy.yml`) runs that on every push and every Monday, then rebuilds and publishes the site to GitHub Pages, so the binder always carries the current FAA editions.
- In a lesson: `<R to="PHAK 5-19" q="dihedral" />`. `q` is what to highlight; without it the paragraph's bold words are used.

## Firebase: where the content lives

Once `src/data/firebase.json` has the project's web config, the app runs on Firebase (`src/scripts/cloud.ts`, `live.ts`):

- **Google sign-in** (Firebase Auth). `api/login.js` shows the Google token to Firestore; if Firestore lets that account read the binder, it sets the usual sign-in cookie. Who that is lives only in the Firestore rules (`firestore.rules`, pasted into the Firebase console with the owner's Google address).
- **Lessons, the folder list, pictures added in the editor** are in Firestore (layout at the top of `cloud.ts`). Every save lands on the device first and syncs to the other devices in about a second; it works offline. There's no Upload button.
- The first sign-in copies the built lessons and folder list into Firestore, and each device carries over anything that was still waiting for Upload.
- The **big sources** (FAA PDFs, saved web pages in `public/library/`) stay on the site, not in Firebase. Each device keeps every one it opens (`public/sw.js`, cache `cfi-library-v1`), and References > "Keep every source on this device" saves them all for offline use.
- A page stores its source (`mdx`), how it looks (`html`, rendered by the site build) and `base` (the source that `html`'s block offsets point into, which the editor patches).

**Claude's side** (`scripts/binder.mjs`, needs `FIREBASE_SERVICE_ACCOUNT` with the service-account key JSON):

1. `node scripts/binder.mjs pull` copies Firestore into `src/content/lessons/` and `src/data/outline.json`.
2. Write or edit the `.mdx` files as before (and the outline for new pages).
3. `node scripts/binder.mjs push <slug…>` builds the site and sends each lesson's source and rendered page up; `push --outline` sends the folder list. Push refuses a page that changed in the app since the pull.
4. After changing a component (Callout, Compare…), `push --all` re-renders every page. `render` re-renders pages whose source was edited by hand in the app.
5. Commit the repo copy too: it's the fallback the site is built from, and the backup.
