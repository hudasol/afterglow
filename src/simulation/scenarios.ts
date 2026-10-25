/**
 * Scenarios over the invented catalogue. They serve the demo presets, the automated tests and
 * the offline evaluation. They are authored by hand, so results on them show how the pipeline
 * behaves. They say nothing about how well Qloo predicts what real people enjoy.
 */
import type { Disruption } from '../domain/plan.js';
import type { IntentAnchor } from '../domain/intent.js';
import { SIMULATED_CITY } from './catalogue.js';

export interface ScenarioSpec {
  id: string;
  title: string;
  summary: string;
  /** Shown as a preset in the interface. */
  featured: boolean;
  anchor: IntentAnchor;
  disruption: Disruption;
  /** For scenarios that include an ambiguous signal: the id to pick, keyed by the input text. */
  choices?: Record<string, string>;
  /** What the offline evaluation expects, checked by tests. */
  expectation?: { noFeasibleOption?: boolean };
}

const base = {
  city: SIMULATED_CITY,
  durationMinutes: 120,
  useOriginalVenueAsSignal: true,
  tasteEntities: [] as string[],
  tasteTags: [] as string[],
  hardConstraints: [] as IntentAnchor['hardConstraints'],
};

function anchor(
  partial: Partial<IntentAnchor> &
    Pick<
      IntentAnchor,
      'title' | 'occasion' | 'partySize' | 'planStart' | 'category' | 'originalVenue' | 'preserve'
    >,
): IntentAnchor {
  return { ...base, ...partial } as IntentAnchor;
}

const at = (time: string) => `2026-11-07T${time}:00+04:00`;

export const scenarios: ScenarioSpec[] = [
  {
    id: 's01-anniversary-venue-closed',
    title: 'Anniversary dinner, the restaurant closes',
    summary:
      'A quiet candlelit dinner for two. The booked restaurant cannot host. Step free access and a vegetarian menu are required.',
    featured: true,
    anchor: anchor({
      title: 'Anniversary dinner',
      occasion: 'date',
      partySize: 2,
      planStart: at('19:30'),
      category: 'restaurant',
      originalVenue: { name: 'The Lantern Room' },
      preserve: [
        'Quiet enough to talk',
        'Candlelit and romantic',
        'A little live jazz in the background',
      ],
      tasteEntities: ['Odessa Vale'],
      tasteTags: ['candlelit', 'quiet'],
      hardConstraints: [
        { kind: 'max_distance_km', km: 3 },
        { kind: 'dietary', requirement: 'vegetarian' },
        { kind: 'step_free_access' },
        { kind: 'open_at_plan_time' },
      ],
    }),
    disruption: { kind: 'venue_unavailable', note: 'The restaurant cancelled the booking.' },
  },
  {
    id: 's00-jazz-needs-a-choice',
    title: 'Jazz night, one signal needs a choice',
    summary:
      'The word jazz matches two simulated tags. The person chooses which one is meant before the search runs.',
    featured: true,
    anchor: anchor({
      title: 'Jazz evening with friends',
      occasion: 'friends',
      partySize: 4,
      planStart: at('20:00'),
      category: 'live_music',
      originalVenue: { name: 'Blue Hour Hall' },
      preserve: ['Live jazz', 'Seated, so we can talk between sets'],
      tasteTags: ['jazz'],
      hardConstraints: [{ kind: 'open_at_plan_time' }, { kind: 'fits_party_size' }],
    }),
    disruption: { kind: 'venue_unavailable' },
    choices: { jazz: 'sim-tag-jazz' },
  },
  {
    id: 's02-vegan-date-budget',
    title: 'Vegan dinner on a budget',
    summary:
      'Two people, a vegan menu and a price ceiling. The tasting menu counter they booked is unavailable.',
    featured: true,
    anchor: anchor({
      title: 'Vegan dinner for two',
      occasion: 'date',
      partySize: 2,
      planStart: at('19:00'),
      category: 'restaurant',
      originalVenue: { name: 'Umber & Oak' },
      preserve: ['Plant based menu', 'Calm and unhurried'],
      tasteEntities: ['Saffron Hours'],
      tasteTags: ['quiet', 'garden'],
      hardConstraints: [
        { kind: 'dietary', requirement: 'vegan' },
        { kind: 'max_price_level', level: 2 },
        { kind: 'open_at_plan_time' },
      ],
    }),
    disruption: { kind: 'venue_unavailable' },
  },
  {
    id: 's03-rain-birthday-bar',
    title: 'Birthday drinks, rain forces the group indoors',
    summary:
      'Six friends planned a rooftop bar. Rain arrives, so the new place must be covered and seat six.',
    featured: true,
    anchor: anchor({
      title: 'Birthday drinks',
      occasion: 'celebration',
      partySize: 6,
      planStart: at('20:00'),
      category: 'bar',
      originalVenue: { name: 'Meridian Roof' },
      preserve: ['Lively energy', 'Good cocktails', 'Room for the whole group'],
      tasteEntities: ['The Night Cartographers'],
      tasteTags: ['lively', 'craft cocktails'],
      hardConstraints: [{ kind: 'fits_party_size' }, { kind: 'open_at_plan_time' }],
    }),
    disruption: { kind: 'weather', condition: 'rain' },
  },
  {
    id: 's04-late-arrival-live-music',
    title: 'Running late to a live music night',
    summary:
      'The group is ninety minutes behind. The new venue must still be open for the whole evening.',
    featured: false,
    anchor: anchor({
      title: 'Live music night',
      occasion: 'friends',
      partySize: 2,
      planStart: at('20:00'),
      category: 'live_music',
      originalVenue: { name: 'Blue Hour Hall' },
      preserve: ['Live music', 'A seat with a view of the stage'],
      tasteEntities: ['Lin Marsh Trio'],
      tasteTags: ['live music'],
      hardConstraints: [{ kind: 'open_at_plan_time' }, { kind: 'step_free_access' }],
    }),
    disruption: { kind: 'running_late', minutes: 90 },
  },
  {
    id: 's05-family-lunch-halal',
    title: 'Family lunch for eight, halal',
    summary:
      'A large family lunch with a halal requirement and step free access for a grandparent.',
    featured: false,
    anchor: anchor({
      title: 'Family lunch',
      occasion: 'family',
      partySize: 8,
      planStart: at('12:30'),
      durationMinutes: 90,
      category: 'restaurant',
      originalVenue: { name: 'Copper Kettle Grill' },
      preserve: ['Relaxed and family friendly', 'Everyone seated together'],
      tasteTags: ['family friendly', 'lively'],
      hardConstraints: [
        { kind: 'dietary', requirement: 'halal' },
        { kind: 'fits_party_size' },
        { kind: 'step_free_access' },
        { kind: 'max_distance_km', km: 6 },
        { kind: 'open_at_plan_time' },
      ],
    }),
    disruption: { kind: 'venue_unavailable' },
  },
  {
    id: 's06-quiet-cafe-gluten-free',
    title: 'Quiet morning cafe, gluten free',
    summary: 'A calm place to meet a colleague, with gluten free options and a modest price.',
    featured: false,
    anchor: anchor({
      title: 'Morning catch up',
      occasion: 'work',
      partySize: 2,
      planStart: at('10:00'),
      durationMinutes: 90,
      category: 'cafe',
      originalVenue: { name: 'The Slow Pour' },
      preserve: ['Quiet enough to hear each other', 'Space to open a notebook'],
      tasteTags: ['quiet', 'bookish'],
      hardConstraints: [
        { kind: 'dietary', requirement: 'gluten_free' },
        { kind: 'max_price_level', level: 2 },
        { kind: 'open_at_plan_time' },
      ],
    }),
    disruption: { kind: 'venue_unavailable' },
  },
  {
    id: 's07-dessert-after-the-show',
    title: 'Dessert after the show, late start',
    summary: 'An hour behind, the dessert stop must still be open when the group arrives.',
    featured: false,
    anchor: anchor({
      title: 'Dessert after the show',
      occasion: 'date',
      partySize: 2,
      planStart: at('21:00'),
      durationMinutes: 60,
      category: 'dessert',
      originalVenue: { name: 'Honey Ledger Patisserie' },
      preserve: ['Romantic and quiet', 'Something worth lingering over'],
      tasteTags: ['romantic', 'quiet', 'candlelit'],
      hardConstraints: [{ kind: 'open_at_plan_time' }, { kind: 'step_free_access' }],
    }),
    disruption: { kind: 'running_late', minutes: 60 },
  },
  {
    id: 's08-gallery-afternoon',
    title: 'Gallery afternoon for four',
    summary: 'A quiet cultural afternoon for four people, one of whom needs step free access.',
    featured: false,
    anchor: anchor({
      title: 'Gallery afternoon',
      occasion: 'friends',
      partySize: 4,
      planStart: at('15:00'),
      durationMinutes: 120,
      category: 'museum_or_gallery',
      originalVenue: { name: 'Glasshouse Gallery' },
      preserve: ['Design and architecture', 'Quiet rooms'],
      tasteTags: ['minimalist', 'art deco'],
      hardConstraints: [
        { kind: 'step_free_access' },
        { kind: 'open_at_plan_time' },
        { kind: 'fits_party_size' },
      ],
    }),
    disruption: { kind: 'venue_unavailable' },
  },
  {
    id: 's09-celebration-budget-cut',
    title: 'Celebration dinner after the budget drops',
    summary: 'Five people planned a waterfront dinner. The budget is cut to a mid price level.',
    featured: false,
    anchor: anchor({
      title: 'Team celebration',
      occasion: 'celebration',
      partySize: 5,
      planStart: at('19:30'),
      category: 'restaurant',
      originalVenue: { name: 'Nine Fathoms Oyster House' },
      preserve: ['Lively and social', 'A view of the water'],
      tasteTags: ['waterfront', 'lively'],
      hardConstraints: [{ kind: 'fits_party_size' }, { kind: 'open_at_plan_time' }],
    }),
    disruption: { kind: 'budget_reduced', maxPriceLevel: 2 },
  },
  {
    id: 's10-no-feasible-option',
    title: 'Constraints too tight, nothing fits',
    summary:
      'A halal, vegan, gluten free and nut free dinner at the lowest price. No place satisfies every requirement, so the product offers ways forward and waits for the person.',
    featured: true,
    anchor: anchor({
      title: 'Dinner with strict requirements',
      occasion: 'family',
      partySize: 3,
      planStart: at('19:00'),
      category: 'restaurant',
      originalVenue: { name: 'The Lantern Room' },
      preserve: ['Everyone can eat everything on the menu'],
      tasteTags: ['quiet'],
      hardConstraints: [
        { kind: 'dietary', requirement: 'halal' },
        { kind: 'dietary', requirement: 'vegan' },
        { kind: 'dietary', requirement: 'gluten_free' },
        { kind: 'dietary', requirement: 'nut_free' },
        { kind: 'max_price_level', level: 1 },
      ],
    }),
    disruption: { kind: 'venue_unavailable' },
    expectation: { noFeasibleOption: true },
  },
  {
    id: 's11-outdoor-gig-rain',
    title: 'Open air gig, rain arrives',
    summary:
      'Four friends planned an outdoor stage. With rain forecast, the replacement must be covered.',
    featured: false,
    anchor: anchor({
      title: 'Gig night',
      occasion: 'friends',
      partySize: 4,
      planStart: at('19:30'),
      category: 'live_music',
      originalVenue: { name: 'Harbour Annex Stage' },
      preserve: ['Loud, lively, standing room is fine'],
      tasteEntities: ['The Night Cartographers'],
      tasteTags: ['live music', 'lively'],
      hardConstraints: [{ kind: 'open_at_plan_time' }],
    }),
    disruption: { kind: 'weather', condition: 'rain' },
  },
  {
    id: 's12-tasting-menu-no-stairs',
    title: 'Tasting menu without stairs',
    summary:
      'A refined evening for two with step free access and a price ceiling, which rules out the original counter.',
    featured: false,
    anchor: anchor({
      title: 'Tasting menu evening',
      occasion: 'date',
      partySize: 2,
      planStart: at('19:00'),
      category: 'restaurant',
      originalVenue: { name: 'Umber & Oak' },
      preserve: ['A set menu', 'Minimal and calm'],
      tasteEntities: ['Paper Lanterns'],
      tasteTags: ['tasting menu', 'minimalist'],
      hardConstraints: [
        { kind: 'step_free_access' },
        { kind: 'max_price_level', level: 3 },
        { kind: 'open_at_plan_time' },
      ],
    }),
    disruption: { kind: 'venue_unavailable' },
  },
  {
    id: 's13-late-bar-record-fans',
    title: 'Late bar for record collectors',
    summary: 'Two hours late, the group still wants a vinyl bar that is open and accessible.',
    featured: false,
    anchor: anchor({
      title: 'Late drinks',
      occasion: 'friends',
      partySize: 3,
      planStart: at('21:00'),
      category: 'bar',
      originalVenue: { name: 'Salt & Static' },
      preserve: ['A bar built around records', 'Late night'],
      tasteEntities: ['Lin Marsh Trio'],
      tasteTags: ['vinyl', 'late night'],
      hardConstraints: [{ kind: 'open_at_plan_time' }, { kind: 'step_free_access' }],
    }),
    disruption: { kind: 'running_late', minutes: 120 },
  },
  {
    id: 's14-party-grows-to-fourteen',
    title: 'The dinner grows to fourteen',
    summary:
      'A dinner for six becomes a dinner for fourteen. The place must seat everyone together.',
    featured: false,
    anchor: anchor({
      title: 'Group dinner',
      occasion: 'celebration',
      partySize: 6,
      planStart: at('19:30'),
      category: 'restaurant',
      originalVenue: { name: 'Harbour Lamp Kitchen' },
      preserve: ['One long table', 'A quiet enough room to talk'],
      tasteTags: ['quiet', 'waterfront'],
      hardConstraints: [{ kind: 'open_at_plan_time' }],
    }),
    disruption: { kind: 'party_changed', partySize: 14 },
  },
  {
    id: 's15-nut-allergy-brunch',
    title: 'Nut free cafe meeting',
    summary: 'A garden style cafe that can serve a nut free menu.',
    featured: false,
    anchor: anchor({
      title: 'Garden cafe meeting',
      occasion: 'friends',
      partySize: 2,
      planStart: at('09:30'),
      durationMinutes: 90,
      category: 'cafe',
      originalVenue: { name: 'Foxglove Cafe' },
      preserve: ['Green and calm'],
      tasteTags: ['garden', 'quiet'],
      hardConstraints: [
        { kind: 'dietary', requirement: 'nut_free' },
        { kind: 'open_at_plan_time' },
      ],
    }),
    disruption: { kind: 'venue_unavailable' },
  },
  {
    id: 's16-original-not-located',
    title: 'Original venue cannot be located',
    summary:
      'The distance limit needs the original venue to be found. It is not in the catalogue, so distance stays unknown and the product asks the person to check.',
    featured: false,
    anchor: anchor({
      title: 'Dinner near home',
      occasion: 'family',
      partySize: 4,
      planStart: at('19:00'),
      category: 'restaurant',
      originalVenue: { name: 'A Venue That Is Not In The Catalogue' },
      preserve: ['Close to where we planned to be'],
      tasteTags: ['family friendly'],
      hardConstraints: [{ kind: 'max_distance_km', km: 2 }, { kind: 'open_at_plan_time' }],
    }),
    disruption: { kind: 'venue_unavailable' },
  },
];

export function scenarioById(id: string): ScenarioSpec | undefined {
  return scenarios.find((scenario) => scenario.id === id);
}
