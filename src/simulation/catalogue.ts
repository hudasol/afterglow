/**
 * The demo catalogue. Everything in this file is invented: the city, the venues, the artists and
 * every fact about them. It exists so the full recovery loop can be run and tested without a Qloo
 * key. It is always labelled as simulated in the interface and is never presented as Qloo data.
 */
import { known } from '../domain/evidence.js';
import type { DietaryRequirement, VenueCategory } from '../domain/intent.js';
import type { Candidate } from '../domain/venue.js';

export const SIMULATED_CITY = 'Harbourvale';
export const SIMULATION_LABEL = 'Simulated demo catalogue (not Qloo data, not real venues)';

const CENTER = { lat: 31.0, lon: -140.0 };
const KM_PER_DEGREE = 111.195;

function point(eastKm: number, northKm: number) {
  return {
    lat: CENTER.lat + northKm / KM_PER_DEGREE,
    lon: CENTER.lon + eastKm / (KM_PER_DEGREE * Math.cos((CENTER.lat * Math.PI) / 180)),
  };
}

const DIET: Record<string, DietaryRequirement> = {
  veg: 'vegetarian',
  vgn: 'vegan',
  hal: 'halal',
  kos: 'kosher',
  glu: 'gluten_free',
  nut: 'nut_free',
};

function clock(text: string): number {
  const [h, m] = text.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

interface Row {
  id: string;
  name: string;
  category: VenueCategory;
  tags: string;
  price: 1 | 2 | 3 | 4;
  at: [number, number];
  diet: string;
  stepFree: boolean;
  hours: [string, number | string];
  capacity: number;
  covered: boolean;
  blurb: string;
}

// closes may be given as hours past midnight, for example 26 means 02:00 the next day.
function closing(value: number | string): number {
  return typeof value === 'number' ? value * 60 : clock(value);
}

const rows: Row[] = [
  {
    id: 'sim-lantern-room',
    name: 'The Lantern Room',
    category: 'restaurant',
    tags: 'candlelit quiet romantic jazz',
    price: 3,
    at: [0, 0],
    diet: 'veg',
    stepFree: true,
    hours: ['17:00', 23],
    capacity: 40,
    covered: true,
    blurb: 'Low lit dining room with a small jazz trio on weekends.',
  },
  {
    id: 'sim-quillfeather',
    name: 'Quillfeather Supper Room',
    category: 'restaurant',
    tags: 'candlelit quiet romantic bookish',
    price: 3,
    at: [0.8, 0.6],
    diet: 'veg vgn glu',
    stepFree: true,
    hours: ['17:30', '22:30'],
    capacity: 30,
    covered: true,
    blurb: 'Library themed supper room with shared shelves and a short menu.',
  },
  {
    id: 'sim-tidewrack',
    name: 'Tidewrack Social',
    category: 'restaurant',
    tags: 'lively waterfront street-food late-night',
    price: 2,
    at: [1.9, -1.2],
    diet: 'veg vgn hal',
    stepFree: true,
    hours: ['12:00', 26],
    capacity: 80,
    covered: false,
    blurb: 'Open air quayside kitchen with long communal tables.',
  },
  {
    id: 'sim-umber-oak',
    name: 'Umber & Oak',
    category: 'restaurant',
    tags: 'tasting-menu minimalist quiet',
    price: 4,
    at: [0.4, -0.9],
    diet: 'veg glu',
    stepFree: false,
    hours: ['18:00', '22:00'],
    capacity: 24,
    covered: true,
    blurb: 'Counter seating and a single tasting menu on the first floor.',
  },
  {
    id: 'sim-saffron-courtyard',
    name: 'Saffron Courtyard',
    category: 'restaurant',
    tags: 'garden candlelit romantic',
    price: 2,
    at: [1.4, 1.1],
    diet: 'veg vgn hal',
    stepFree: true,
    hours: ['17:00', 23],
    capacity: 36,
    covered: false,
    blurb: 'Lantern strung courtyard garden behind a spice merchant.',
  },
  {
    id: 'sim-harbour-lamp',
    name: 'Harbour Lamp Kitchen',
    category: 'restaurant',
    tags: 'waterfront quiet wine-bar',
    price: 3,
    at: [2.8, -0.4],
    diet: 'veg vgn glu nut',
    stepFree: true,
    hours: ['17:00', '23:30'],
    capacity: 50,
    covered: true,
    blurb: 'Glass fronted dining room facing the working harbour.',
  },
  {
    id: 'sim-nine-fathoms',
    name: 'Nine Fathoms Oyster House',
    category: 'restaurant',
    tags: 'waterfront lively',
    price: 3,
    at: [3.6, 0.5],
    diet: 'glu',
    stepFree: true,
    hours: ['16:00', 24],
    capacity: 60,
    covered: true,
    blurb: 'Raw bar and grill on the old fish pier.',
  },
  {
    id: 'sim-paper-crane',
    name: 'Paper Crane Noodle Bar',
    category: 'restaurant',
    tags: 'street-food lively minimalist',
    price: 1,
    at: [0.3, 0.4],
    diet: 'veg vgn hal',
    stepFree: true,
    hours: ['11:30', 22],
    capacity: 28,
    covered: true,
    blurb: 'Fast counter service and a rotating broth list.',
  },
  {
    id: 'sim-verdant-table',
    name: 'The Verdant Table',
    category: 'restaurant',
    tags: 'vegan-kitchen garden quiet candlelit',
    price: 2,
    at: [1.1, -0.3],
    diet: 'veg vgn glu nut',
    stepFree: true,
    hours: ['17:00', '22:30'],
    capacity: 32,
    covered: true,
    blurb: 'Plant based kitchen with a glasshouse dining area.',
  },
  {
    id: 'sim-copper-kettle',
    name: 'Copper Kettle Grill',
    category: 'restaurant',
    tags: 'lively family-friendly',
    price: 2,
    at: [5.5, 2.0],
    diet: 'veg hal',
    stepFree: true,
    hours: ['11:00', 22],
    capacity: 90,
    covered: true,
    blurb: 'Large family dining hall on the edge of the city.',
  },

  {
    id: 'sim-velvet-ledger',
    name: 'The Velvet Ledger',
    category: 'bar',
    tags: 'jazz craft-cocktails candlelit late-night',
    price: 3,
    at: [0.6, -0.2],
    diet: 'veg',
    stepFree: false,
    hours: ['19:00', 26],
    capacity: 45,
    covered: true,
    blurb: 'Basement cocktail bar with a resident pianist.',
  },
  {
    id: 'sim-salt-static',
    name: 'Salt & Static',
    category: 'bar',
    tags: 'vinyl lively late-night craft-cocktails',
    price: 2,
    at: [1.7, 0.9],
    diet: 'veg',
    stepFree: true,
    hours: ['18:00', 26],
    capacity: 60,
    covered: true,
    blurb: 'Listening bar built around a record collection.',
  },
  {
    id: 'sim-meridian-roof',
    name: 'Meridian Roof',
    category: 'bar',
    tags: 'rooftop lively craft-cocktails',
    price: 3,
    at: [0.9, 1.6],
    diet: 'veg vgn',
    stepFree: true,
    hours: ['17:00', 25],
    capacity: 70,
    covered: false,
    blurb: 'Open rooftop terrace above the old customs house.',
  },
  {
    id: 'sim-low-tide-wine',
    name: 'Low Tide Wine Room',
    category: 'bar',
    tags: 'wine-bar quiet candlelit jazz',
    price: 3,
    at: [2.3, -0.6],
    diet: 'veg glu',
    stepFree: true,
    hours: ['17:00', 24],
    capacity: 26,
    covered: true,
    blurb: 'Small wine room with low lighting and a stack of jazz records.',
  },
  {
    id: 'sim-dockside-taps',
    name: 'Dockside Taps',
    category: 'bar',
    tags: 'lively waterfront family-friendly',
    price: 1,
    at: [3.1, -1.4],
    diet: 'veg hal',
    stepFree: true,
    hours: ['14:00', 24],
    capacity: 80,
    covered: false,
    blurb: 'Outdoor taproom by the ferry landing.',
  },
  {
    id: 'sim-reading-lounge',
    name: 'The Reading Lounge',
    category: 'bar',
    tags: 'bookish quiet wine-bar',
    price: 2,
    at: [0.2, 1.3],
    diet: 'veg vgn nut',
    stepFree: true,
    hours: ['16:00', 23],
    capacity: 30,
    covered: true,
    blurb: 'Armchairs, bookshelves and a short wine list.',
  },

  {
    id: 'sim-foxglove',
    name: 'Foxglove Cafe',
    category: 'cafe',
    tags: 'garden quiet bookish',
    price: 1,
    at: [0.7, 0.9],
    diet: 'veg vgn glu',
    stepFree: true,
    hours: ['08:00', 18],
    capacity: 25,
    covered: true,
    blurb: 'Greenhouse cafe with a lending shelf.',
  },
  {
    id: 'sim-ember-bean',
    name: 'Ember & Bean',
    category: 'cafe',
    tags: 'lively vinyl minimalist',
    price: 1,
    at: [1.5, -0.7],
    diet: 'veg vgn',
    stepFree: false,
    hours: ['07:00', 20],
    capacity: 30,
    covered: true,
    blurb: 'Roastery cafe with stairs to the seating loft.',
  },
  {
    id: 'sim-slow-pour',
    name: 'The Slow Pour',
    category: 'cafe',
    tags: 'quiet minimalist bookish',
    price: 2,
    at: [0.1, -1.4],
    diet: 'veg vgn glu nut',
    stepFree: true,
    hours: ['09:00', 19],
    capacity: 22,
    covered: true,
    blurb: 'Filter coffee bar with a no laptop rule.',
  },
  {
    id: 'sim-sunroom',
    name: 'Sunroom Collective',
    category: 'cafe',
    tags: 'garden family-friendly',
    price: 1,
    at: [2.4, 1.8],
    diet: 'veg vgn hal',
    stepFree: true,
    hours: ['08:00', 17],
    capacity: 40,
    covered: false,
    blurb: 'Garden cafe with a play corner.',
  },
  {
    id: 'sim-night-owl',
    name: 'Night Owl Espresso',
    category: 'cafe',
    tags: 'late-night lively vinyl',
    price: 1,
    at: [1.0, 0.2],
    diet: 'veg vgn',
    stepFree: true,
    hours: ['16:00', 26],
    capacity: 20,
    covered: true,
    blurb: 'Late opening espresso bar with a turntable.',
  },

  {
    id: 'sim-blue-hour',
    name: 'Blue Hour Hall',
    category: 'live_music',
    tags: 'jazz live-music candlelit quiet',
    price: 3,
    at: [1.2, 0.5],
    diet: 'veg',
    stepFree: true,
    hours: ['19:00', 24],
    capacity: 120,
    covered: true,
    blurb: 'Seated concert room with two sets a night.',
  },
  {
    id: 'sim-cartographers',
    name: 'Cartographers Club',
    category: 'live_music',
    tags: 'live-music lively late-night',
    price: 2,
    at: [2.0, -0.1],
    diet: 'veg hal',
    stepFree: true,
    hours: ['20:00', 27],
    capacity: 200,
    covered: true,
    blurb: 'Standing room venue for touring bands.',
  },
  {
    id: 'sim-lamplighter',
    name: 'Lamplighter Stage',
    category: 'live_music',
    tags: 'acoustic live-music quiet romantic',
    price: 2,
    at: [0.5, 0.8],
    diet: 'veg vgn glu',
    stepFree: false,
    hours: ['18:30', 23],
    capacity: 60,
    covered: true,
    blurb: 'Intimate acoustic room above a bookshop.',
  },
  {
    id: 'sim-harbour-annex',
    name: 'Harbour Annex Stage',
    category: 'live_music',
    tags: 'live-music waterfront lively',
    price: 2,
    at: [3.9, -1.0],
    diet: 'veg',
    stepFree: true,
    hours: ['17:00', 23],
    capacity: 300,
    covered: false,
    blurb: 'Open air stage beside the harbour wall.',
  },
  {
    id: 'sim-cinder-reed',
    name: 'Cinder & Reed',
    category: 'live_music',
    tags: 'jazz live-music vinyl lively',
    price: 2,
    at: [1.8, 1.4],
    diet: 'veg vgn',
    stepFree: true,
    hours: ['19:30', '25:30'],
    capacity: 90,
    covered: true,
    blurb: 'Late night jam sessions and a record shop at the front.',
  },

  {
    id: 'sim-honey-ledger',
    name: 'Honey Ledger Patisserie',
    category: 'dessert',
    tags: 'romantic quiet candlelit',
    price: 2,
    at: [0.6, 0.3],
    diet: 'veg glu',
    stepFree: true,
    hours: ['12:00', 22],
    capacity: 28,
    covered: true,
    blurb: 'Plated desserts and dessert wine in a small salon.',
  },
  {
    id: 'sim-midnight-scoop',
    name: 'Midnight Scoop',
    category: 'dessert',
    tags: 'lively family-friendly late-night',
    price: 1,
    at: [1.3, -1.1],
    diet: 'veg vgn',
    stepFree: true,
    hours: ['13:00', 24],
    capacity: 40,
    covered: false,
    blurb: 'Late opening ice cream counter with outdoor benches.',
  },
  {
    id: 'sim-salted-fig',
    name: 'Salted Fig Atelier',
    category: 'dessert',
    tags: 'tasting-menu minimalist quiet',
    price: 3,
    at: [0.9, -0.6],
    diet: 'veg vgn glu nut',
    stepFree: false,
    hours: ['16:00', 22],
    capacity: 16,
    covered: true,
    blurb: 'Six course dessert counter, one seating per night.',
  },

  {
    id: 'sim-glasshouse',
    name: 'Glasshouse Gallery',
    category: 'museum_or_gallery',
    tags: 'minimalist quiet art-deco',
    price: 2,
    at: [1.0, 1.1],
    diet: '',
    stepFree: true,
    hours: ['10:00', 21],
    capacity: 100,
    covered: true,
    blurb: 'Rotating exhibitions in a restored glass hall.',
  },
  {
    id: 'sim-old-signal',
    name: 'Old Signal Museum',
    category: 'museum_or_gallery',
    tags: 'art-deco family-friendly',
    price: 1,
    at: [2.6, 0.9],
    diet: '',
    stepFree: true,
    hours: ['10:00', 18],
    capacity: 150,
    covered: true,
    blurb: 'Telegraph and radio history in a deco building.',
  },
  {
    id: 'sim-print-room',
    name: 'Courtyard Print Room',
    category: 'museum_or_gallery',
    tags: 'garden bookish quiet',
    price: 1,
    at: [0.4, 1.9],
    diet: '',
    stepFree: false,
    hours: ['11:00', 20],
    capacity: 30,
    covered: false,
    blurb: 'Letterpress studio and gallery around a courtyard.',
  },
];

/**
 * Invented general popularity, from 0 to 1, for each venue. It is authored by hand and does not
 * depend on the taste tags. It stands in for the non personalised popularity a real provider
 * returns, so the demo can show a popularity ordered list next to the taste ordered one.
 */
const simulatedPopularity: Record<string, number> = {
  'sim-tidewrack': 0.92,
  'sim-copper-kettle': 0.88,
  'sim-meridian-roof': 0.86,
  'sim-midnight-scoop': 0.85,
  'sim-ember-bean': 0.83,
  'sim-harbour-lamp': 0.81,
  'sim-dockside-taps': 0.79,
  'sim-nine-fathoms': 0.77,
  'sim-lantern-room': 0.74,
  'sim-paper-crane': 0.71,
  'sim-harbour-annex': 0.69,
  'sim-sunroom': 0.68,
  'sim-blue-hour': 0.66,
  'sim-honey-ledger': 0.64,
  'sim-night-owl': 0.62,
  'sim-salted-fig': 0.58,
  'sim-cartographers': 0.57,
  'sim-umber-oak': 0.55,
  'sim-slow-pour': 0.52,
  'sim-salt-static': 0.49,
  'sim-foxglove': 0.47,
  'sim-lamplighter': 0.46,
  'sim-saffron-courtyard': 0.44,
  'sim-low-tide-wine': 0.43,
  'sim-verdant-table': 0.41,
  'sim-glasshouse': 0.39,
  'sim-quillfeather': 0.38,
  'sim-velvet-ledger': 0.35,
  'sim-cinder-reed': 0.33,
  'sim-reading-lounge': 0.31,
  'sim-old-signal': 0.28,
  'sim-print-room': 0.25,
};

const SIM_PROVENANCE = {
  source: 'simulation' as const,
  label: 'Simulated demo catalogue',
  detail: 'Invented for the demo. Not a real venue.',
};

export interface SimulatedVenue {
  candidate: Candidate;
  category: VenueCategory;
  tags: string[];
}

function tagName(slug: string): string {
  return slug.replace(/-/gu, ' ');
}

export const catalogue: SimulatedVenue[] = rows.map((row) => {
  const [openText, close] = row.hours;
  const closesAt = closing(close);
  const tags = row.tags.split(' ').map(tagName);
  const dietary = row.diet
    .split(' ')
    .filter((code) => code.length > 0)
    .map((code) => DIET[code] as DietaryRequirement);
  const candidate: Candidate = {
    id: row.id,
    source: 'simulation',
    name: row.name,
    description: row.blurb,
    facts: {
      address: known(`Simulated address in ${SIMULATED_CITY}`, SIM_PROVENANCE),
      location: known(point(row.at[0], row.at[1]), SIM_PROVENANCE),
      priceLevel: known(row.price, SIM_PROVENANCE),
      dietary: known(dietary, SIM_PROVENANCE),
      stepFree: known(row.stepFree, SIM_PROVENANCE),
      openWindow: known({ opensAt: clock(openText), closesAt }, SIM_PROVENANCE),
      groupCapacity: known(row.capacity, SIM_PROVENANCE),
      covered: known(row.covered, SIM_PROVENANCE),
    },
    taste: { popularity: simulatedPopularity[row.id] ?? 0.5, tagNames: tags },
  };
  return { candidate, category: row.category, tags };
});

export interface SimulatedEntity {
  id: string;
  name: string;
  type: string;
  description: string;
  /** Tags this invented entity is associated with. Used by the simulated affinity only. */
  associatedTags: string[];
}

export const simulatedEntities: SimulatedEntity[] = [
  {
    id: 'sim-ent-odessa-vale',
    name: 'Odessa Vale',
    type: 'urn:entity:artist',
    description: 'Invented jazz vocalist',
    associatedTags: ['jazz', 'quiet', 'candlelit', 'romantic'],
  },
  {
    id: 'sim-ent-lin-marsh',
    name: 'Lin Marsh Trio',
    type: 'urn:entity:artist',
    description: 'Invented jazz trio',
    associatedTags: ['jazz', 'wine bar', 'vinyl'],
  },
  {
    id: 'sim-ent-night-cartographers',
    name: 'The Night Cartographers',
    type: 'urn:entity:artist',
    description: 'Invented touring band',
    associatedTags: ['lively', 'live music', 'late night'],
  },
  {
    id: 'sim-ent-paper-lanterns',
    name: 'Paper Lanterns',
    type: 'urn:entity:movie',
    description: 'Invented romantic drama film',
    associatedTags: ['romantic', 'quiet', 'minimalist'],
  },
  {
    id: 'sim-ent-saffron-hours',
    name: 'Saffron Hours',
    type: 'urn:entity:book',
    description: 'Invented novel',
    associatedTags: ['bookish', 'garden', 'quiet'],
  },
  {
    id: 'sim-ent-nova-singer',
    name: 'Nova',
    type: 'urn:entity:artist',
    description: 'Invented acoustic singer songwriter',
    associatedTags: ['acoustic', 'quiet', 'romantic'],
  },
  {
    id: 'sim-ent-nova-film',
    name: 'Nova',
    type: 'urn:entity:movie',
    description: 'Invented science fiction film',
    associatedTags: ['lively', 'rooftop', 'vinyl'],
  },
];

export interface SimulatedTag {
  id: string;
  name: string;
  type: string;
  description: string;
}

const tagVocabulary = [
  'jazz',
  'candlelit',
  'quiet',
  'lively',
  'rooftop',
  'waterfront',
  'vinyl',
  'craft cocktails',
  'tasting menu',
  'street food',
  'vegan kitchen',
  'wine bar',
  'live music',
  'acoustic',
  'art deco',
  'minimalist',
  'bookish',
  'garden',
  'late night',
  'family friendly',
  'romantic',
];

export const simulatedTags: SimulatedTag[] = [
  ...tagVocabulary.map((name) => ({
    id: `sim-tag-${name.replace(/ /gu, '-')}`,
    name,
    type: 'simulated:venue-vibe',
    description: 'Invented venue vibe tag',
  })),
  // A second tag with the same name, to show how an ambiguous tag is resolved by the person.
  {
    id: 'sim-tag-jazz-genre',
    name: 'jazz',
    type: 'simulated:music-genre',
    description: 'Invented music genre tag',
  },
];

/** Category tags the simulated provider can resolve. */
export const categoryTagIds: Record<VenueCategory, { id: string; name: string }> = {
  restaurant: { id: 'sim-cat-restaurant', name: 'restaurant' },
  bar: { id: 'sim-cat-bar', name: 'bar' },
  cafe: { id: 'sim-cat-cafe', name: 'cafe' },
  live_music: { id: 'sim-cat-live-music', name: 'live music venue' },
  dessert: { id: 'sim-cat-dessert', name: 'dessert shop' },
  museum_or_gallery: { id: 'sim-cat-art-gallery', name: 'art gallery' },
};
