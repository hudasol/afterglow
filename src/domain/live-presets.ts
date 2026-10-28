import type { IntentAnchor } from './intent.js';
import type { Disruption } from './plan.js';
import { nextLocalOccurrence } from './time.js';

/** A ready made plan for a live case. Its inputs name no one and are the same for every visitor. */
export interface LivePreset {
  id: string;
  city: string;
  title: string;
  summary: string;
  anchor: IntentAnchor;
  disruption: Disruption;
}

interface CityPlan {
  id: string;
  city: string;
  timeZone: string;
  /** A well known restaurant that Qloo lists once, so no choice is needed to open the case. */
  originalVenue: string;
  vibes: [string, string];
}

/**
 * The restaurants are the ones of the Saturday plan in evaluation/live-scenarios.json. Their
 * names, and the vibes, resolved on live Qloo without a question to the person when checked with
 * `npm run eval:preflight` on 25 October 2026. The artists of that plan are left out because two
 * of them are ambiguous, and a one press example should not ask a question.
 */
const CITY_PLANS: readonly CityPlan[] = [
  {
    id: 'new-york',
    city: 'New York',
    timeZone: 'America/New_York',
    originalVenue: 'Keens Steakhouse',
    vibes: ['cozy', 'live music'],
  },
  {
    id: 'london',
    city: 'London',
    timeZone: 'Europe/London',
    originalVenue: 'St. John',
    vibes: ['cozy', 'craft cocktails'],
  },
  {
    id: 'paris',
    city: 'Paris',
    timeZone: 'Europe/Paris',
    originalVenue: 'Le Procope',
    vibes: ['cozy', 'jazz'],
  },
  {
    id: 'tokyo',
    city: 'Tokyo',
    timeZone: 'Asia/Tokyo',
    originalVenue: 'Tempura Kondo',
    vibes: ['cozy', 'jazz'],
  },
  {
    id: 'dubai',
    city: 'Dubai',
    timeZone: 'Asia/Dubai',
    originalVenue: 'Pierchic',
    vibes: ['cozy', 'live music'],
  },
];

const SATURDAY = 6;

/** One plan, a vegetarian dinner for four that is cancelled, in each city, set for the next Saturday evening there. */
export function livePresets(now: Date): LivePreset[] {
  return CITY_PLANS.map((plan) => ({
    id: `live-${plan.id}-vegetarian-dinner`,
    city: plan.city,
    title: `A vegetarian dinner for four is cancelled in ${plan.city}`,
    summary: `Four friends booked ${plan.originalVenue}. The restaurant cancelled, so the new place must serve vegetarian food, be open at the time, and be within 8 km. The group likes ${plan.vibes.join(' and ')}.`,
    anchor: {
      title: 'Dinner with friends',
      occasion: 'friends',
      partySize: 4,
      city: plan.city,
      planStart: nextLocalOccurrence(now, plan.timeZone, SATURDAY, 19, 30),
      durationMinutes: 120,
      category: 'restaurant',
      originalVenue: { name: plan.originalVenue },
      useOriginalVenueAsSignal: true,
      preserve: ['Good vegetarian choices for everyone', 'Relaxed and social'],
      tasteEntities: [],
      tasteTags: [...plan.vibes],
      hardConstraints: [
        { kind: 'dietary', requirement: 'vegetarian' },
        { kind: 'open_at_plan_time' },
        { kind: 'max_distance_km', km: 8 },
      ],
    },
    disruption: { kind: 'venue_unavailable', note: 'The restaurant cancelled the booking.' },
  }));
}
