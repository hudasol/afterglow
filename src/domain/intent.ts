import { z } from 'zod';
import { constraintKey } from './constraint-text.js';

export { constraintKey, describeConstraint } from './constraint-text.js';

export const dietaryRequirementSchema = z.enum([
  'vegetarian',
  'vegan',
  'halal',
  'kosher',
  'gluten_free',
  'nut_free',
]);
export type DietaryRequirement = z.infer<typeof dietaryRequirementSchema>;

/**
 * Hard constraints are pass or fail. A candidate that fails one is rejected and is never
 * ranked, however well it matches the taste signals. Soft preferences never appear here.
 */
export const hardConstraintSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('max_price_level'), level: z.number().int().min(1).max(4) }),
  z.object({ kind: z.literal('max_distance_km'), km: z.number().min(0.1).max(100) }),
  z.object({ kind: z.literal('dietary'), requirement: dietaryRequirementSchema }),
  z.object({ kind: z.literal('step_free_access') }),
  z.object({ kind: z.literal('open_at_plan_time') }),
  z.object({ kind: z.literal('fits_party_size') }),
  z.object({ kind: z.literal('covered_space') }),
]);
export type HardConstraint = z.infer<typeof hardConstraintSchema>;

export const venueCategorySchema = z.enum([
  'restaurant',
  'bar',
  'cafe',
  'live_music',
  'dessert',
  'museum_or_gallery',
]);
export type VenueCategory = z.infer<typeof venueCategorySchema>;

/** The phrase used to look up the category tag. It is a product concept, never personal data. */
export const categoryTagPhrase: Record<VenueCategory, string> = {
  restaurant: 'restaurant',
  bar: 'bar',
  cafe: 'cafe',
  live_music: 'live music',
  dessert: 'dessert',
  museum_or_gallery: 'art gallery',
};

export const occasionSchema = z.enum(['date', 'friends', 'family', 'celebration', 'work', 'solo']);
export type Occasion = z.infer<typeof occasionSchema>;

const shortText = (max: number) => z.string().trim().min(2).max(max);

/**
 * The Intent Anchor records what the plan was for. It is written once when the case opens and
 * never edited. Disruptions and approved relaxations are layered on top of it.
 */
export const intentAnchorSchema = z.object({
  title: shortText(120),
  occasion: occasionSchema,
  partySize: z.number().int().min(1).max(30),
  /** City or neighbourhood level only. This is the one location value sent to Qloo. */
  city: shortText(80),
  planStart: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().min(15).max(720),
  category: venueCategorySchema,
  originalVenue: z.object({ name: shortText(120) }),
  /**
   * When true, the venue that fell through is also used as a taste signal, so the search looks for
   * places that share its audience. Its public name is then sent to the taste provider. Turn it
   * off to send nothing about the venue unless a distance limit needs its location.
   */
  useOriginalVenueAsSignal: z.boolean().default(true),
  /** What must survive the recovery, in the person's own words. Kept local and never sent to Qloo. */
  preserve: z.array(shortText(140)).min(1).max(5),
  /** Public cultural names the group likes (artists, films, places). Resolved through Qloo. */
  tasteEntities: z.array(shortText(100)).max(5),
  /** Vibe or genre phrases the group likes. Resolved through Qloo tag search. */
  tasteTags: z.array(shortText(60)).max(5),
  hardConstraints: z.array(hardConstraintSchema).max(10),
});
export type IntentAnchor = z.infer<typeof intentAnchorSchema>;

export const intentAnchorInputSchema = intentAnchorSchema.superRefine((anchor, ctx) => {
  const keys = anchor.hardConstraints.map(constraintKey);
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: 'custom', path: ['hardConstraints'], message: 'Duplicate constraints.' });
  }
  if (
    anchor.tasteEntities.length + anchor.tasteTags.length === 0 &&
    !anchor.useOriginalVenueAsSignal
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['tasteEntities'],
      message:
        'Add at least one taste signal, or use the original venue as one, so the taste ranking has something to work with.',
    });
  }
});
