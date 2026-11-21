// The exact .mdx each lesson page was built from. The editor maps your changes onto it.
import { getCollection } from 'astro:content';
import { readFileSync } from 'node:fs';
export async function getStaticPaths() {
  return (await getCollection('lessons')).map((l) => ({ params: { slug: l.id }, props: { file: l.filePath } }));
}
export const GET = ({ props }: { props: { file: string } }) => new Response(readFileSync(props.file, 'utf8'), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
