import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const lessons = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/lessons' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    area: z.string(),            // e.g. "Technical Subject Areas"
    acs: z.array(z.string()).default([]), // ACS codes this lesson supports
    levels: z.array(z.enum(['pa', 'ir', 'ca'])).default(['pa', 'ir', 'ca']),
    order: z.number().default(0),
    updated: z.string().optional(),
  }),
});

export const collections = { lessons };
