// Shared shape for the one-way Notion import. Two readers fill it in:
//   from-api.ts  — a Notion link, read through /api/notion with the NOTION_TOKEN set on Vercel
//   from-zip.ts  — a Notion export (.zip, "Markdown & CSV" or "HTML"), read right here on the device
// import.ts then turns each page into a binder page (MDX via mdx.ts) and stages it on the device.
//
// `html` uses a small, clean vocabulary (nothing else; unknown things become <p> text):
//   blocks : <h2> <h3> <h4> (Notion's Heading 1/2/3; the page title is not repeated), <p>, <ul>/<ol>/<li> (nested lists
//            inside the <li>), <ul class="todo"><li><input type="checkbox" checked?>text</li></ul>, <blockquote>,
//            <pre><code>…</code></pre>, <hr>, <table><tr><th|td>…</td></tr></table> (no thead/tbody needed)
//   inline : <strong> <em> <s> <u> <code> <a href="…"> <br>
//            <a data-notion-page="<32-hex page id, no dashes>">Title</a>  — a link/mention of another Notion page
//   media  : <figure data-kind="image"><img src="@@IMG:<ref>@@" alt="…"><figcaption>…</figcaption></figure>
//            (<ref> is an ImportImage.ref of this page; an outside image URL can be used as src directly)
//            <div data-kind="video" data-yt="<YouTube id>" data-title="…"></div>  (other video → bookmark)
//            <div data-kind="bookmark" data-url="…" data-title="…"></div>
//            <div data-kind="embed" data-url="…" data-title="…"></div>
//            <div data-kind="file" data-url="…" data-name="…"></div>   (data-url may be @@IMG:<ref>@@ for an uploaded file)
//   boxes  : <aside data-kind="callout" data-k="note|teach|fleet|warn|acs" data-title="…optional">…blocks…</aside>
//            (pick data-k from the Notion icon: ⚠️❗🚨→warn, ✈️🛩→fleet, 🎓📚→teach, ✅☑️→acs, else note)
//            <details data-kind="toggle" data-h="1|2|3 (only for toggle headings)"><summary>…</summary>…blocks…</details>
//            <div data-kind="columns"><div data-kind="col">…blocks…</div><div data-kind="col">…</div></div>
export type ImportImage = {
  ref: string;          // unique within the page, e.g. "img1"
  ext: string;          // png | jpg | gif | webp | svg | pdf | …
  load: () => Promise<Blob>; // fetches the bytes when the import is saved
};
export type ImportPage = {
  id: string;           // Notion page id (32 hex, no dashes) when known, else something unique
  title: string;
  html: string;         // the page body in the vocabulary above
  images: ImportImage[];
  children: ImportPage[]; // sub-pages (and database rows), in Notion order
};
export type Progress = (msg: string) => void;
