// Tags each editable markdown block (paragraph, heading, list, table, quote) with where it sits in the
// .mdx file, as data-src="start-end" (character offsets). The in-page editor uses this to write a change
// back into exactly that spot of the lesson's source.
import { visit, SKIP } from 'unist-util-visit';
import { readFileSync } from 'node:fs';

const BLOCKS = new Set(['paragraph', 'heading', 'list', 'table', 'blockquote']);
export default function remarkSourcePos() {
  return (tree, file) => {
    // Astro hands MDX the file without its frontmatter; shift offsets so they index the whole file.
    const full = file.value ? String(file.value) : '';
    let shift = 0;
    try {
      const raw = file.path ? readFileSync(file.path, 'utf8') : full;
      shift = raw.indexOf(full) >= 0 ? raw.indexOf(full) : 0;
    } catch {}
    const JSX = new Set(['li', 'p', 'h2', 'h3', 'h4', 'td', 'th', 'dd', 'dt']);
    visit(tree, (node, _i, parent) => {
      if (!node.position) return;
      // Plain HTML written straight into the .mdx (like the key points list): tag one-line ones too.
      if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && JSX.has(node.name)) {
        const raw = full.slice(node.position.start.offset, node.position.end.offset);
        const open = raw.match(/^<\w+([^>]*)>/);
        if (!raw.includes('\n') && open && !/[{}]/.test(open[1])) {
          const s = node.position.start.offset + shift, e = node.position.end.offset + shift;
          node.attributes.push({ type: 'mdxJsxAttribute', name: 'data-src', value: `${s}-${e}` }, { type: 'mdxJsxAttribute', name: 'data-jsx', value: open[1] });
          if (parent?.type === 'paragraph') parent.data = { ...(parent.data || {}), noTag: true };
          return SKIP;
        }
        return;
      }
      if (!BLOCKS.has(node.type) || node.data?.noTag) return;
      const s = node.position.start.offset + shift, e = node.position.end.offset + shift;
      node.data ||= {};
      node.data.hProperties = { ...(node.data.hProperties || {}), 'data-src': `${s}-${e}` };
      // A list, table or quote is edited as one unit, so don't tag what's inside it.
      if (node.type !== 'paragraph' && node.type !== 'heading') return SKIP;
    });
  };
}
