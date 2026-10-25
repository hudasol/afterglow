import { z } from 'zod';

/**
 * Every fact the product shows or relies on carries its origin. The origin decides how the
 * interface labels it and whether the feasibility gate may rely on it.
 *
 * - user: stated by the person when describing the plan.
 * - user_attested: checked by the person after the fact (for example "I called and it is open").
 * - qloo: returned by the Qloo API in a live session.
 * - openstreetmap: tags that OpenStreetMap contributors added to a place that was matched by name
 *   and position. It is community data, so it can be wrong or out of date, and the person can
 *   always override it by checking the fact.
 * - app: calculated by AFTERGLOW from other facts (distance, composite score).
 * - simulation: part of the labelled demo catalogue. It is never presented as live data.
 */
export const sourceKindSchema = z.enum([
  'user',
  'user_attested',
  'qloo',
  'openstreetmap',
  'app',
  'simulation',
]);
export type SourceKind = z.infer<typeof sourceKindSchema>;

export const provenanceSchema = z.object({
  source: sourceKindSchema,
  label: z.string().min(1).max(200),
  detail: z.string().max(500).optional(),
  retrievedAt: z.string().max(40).optional(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

export function factSchema<T extends z.ZodType>(value: T) {
  return z.discriminatedUnion('status', [
    z.object({ status: z.literal('known'), value, provenance: provenanceSchema }),
    z.object({ status: z.literal('unknown'), reason: z.string().max(300) }),
  ]);
}

export type Fact<T> =
  { status: 'known'; value: T; provenance: Provenance } | { status: 'unknown'; reason: string };

export function known<T>(value: T, provenance: Provenance): Fact<T> {
  return { status: 'known', value, provenance };
}

export function unknown<T = never>(reason: string): Fact<T> {
  return { status: 'unknown', reason };
}

export function isKnown<T>(
  fact: Fact<T>,
): fact is { status: 'known'; value: T; provenance: Provenance } {
  return fact.status === 'known';
}
