import { z } from 'zod';
import { dietaryRequirementSchema } from './intent.js';
import { factSchema } from './evidence.js';

const pointSchema = z.object({ lat: z.number(), lon: z.number() });

/** Opening window in minutes since local midnight. closesAt may exceed 1440 for late venues. */
const openWindowSchema = z.object({
  opensAt: z.number().int().min(0).max(1439),
  closesAt: z.number().int().min(1).max(2160),
  /** True when the venue is shut for the whole day of the plan. The times are then meaningless. */
  closedAllDay: z.boolean().optional(),
});

export const candidateSchema = z.object({
  id: z.string().min(1).max(200),
  /** qloo: returned by the live API. simulation: part of the labelled demo catalogue. */
  source: z.enum(['qloo', 'simulation']),
  name: z.string().min(1).max(200),
  description: z.string().max(600).optional(),
  imageUrl: z.string().max(500).optional(),
  facts: z.object({
    address: factSchema(z.string()),
    location: factSchema(pointSchema),
    priceLevel: factSchema(z.number().int().min(1).max(4)),
    dietary: factSchema(z.array(dietaryRequirementSchema)),
    stepFree: factSchema(z.boolean()),
    openWindow: factSchema(openWindowSchema),
    groupCapacity: factSchema(z.number().int().min(1).max(500)),
    covered: factSchema(z.boolean()),
  }),
  /** Values supplied by the taste provider. They describe what groups tend to like, not a person. */
  taste: z.object({
    popularity: z.number().optional(),
    tagNames: z.array(z.string().max(100)).max(40).optional(),
  }),
});
export type Candidate = z.infer<typeof candidateSchema>;
export type OpenWindow = z.infer<typeof openWindowSchema>;

/** What the taste provider said about one candidate for one ranking request. */
export const tasteScoreSchema = z.object({
  candidateId: z.string(),
  /** Provider rank, 1 is best. */
  rank: z.number().int().min(1),
  /** Affinity as returned by the provider. Absent when the provider did not return one. */
  affinity: z.number().optional(),
  explanation: z.array(z.string().max(300)).max(10).optional(),
});
export type TasteScore = z.infer<typeof tasteScoreSchema>;

export function normaliseName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
