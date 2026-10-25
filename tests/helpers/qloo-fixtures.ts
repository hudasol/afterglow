/**
 * SYNTHETIC responses shaped like the Qloo API as documented by the official harness. They are
 * invented for unit tests of the adapter and never shown in the product. They say nothing about
 * what the live service returns. The live shapes are recorded by `npm run qloo:smoke`.
 */
export const syntheticPlaceResponse = {
  results: {
    entities: [
      {
        entity_id: 'p-1',
        name: 'Fixture Bistro',
        subtype: 'urn:entity:place',
        popularity: 0.91,
        query: { affinity: 0.82, explainability: [{ description: 'Matches tag jazz' }] },
        location: { lat: 10.01, lon: 10.0 },
        properties: {
          address: '1 Fixture Lane',
          price_level: 2,
          description: 'A bistro that exists only in tests',
        },
        tags: [{ name: 'Jazz' }, { name: 'Candlelit' }],
      },
      {
        entity_id: 'p-2',
        name: 'Fixture Grill',
        subtype: 'urn:entity:place',
        popularity: 0.7,
        query: { affinity: 0.31 },
        properties: { price_level: 4 },
      },
      {
        entity_id: 'p-3',
        name: 'Fixture Cafe',
        subtype: 'urn:entity:place',
        properties: { geocode: [10.5, 10.5], price_level: 0 },
      },
    ],
  },
};

export const syntheticTagResponse = {
  results: {
    tags: [
      {
        id: 'urn:tag:genre:media:jazz',
        name: 'Jazz',
        type: 'urn:tag:genre:media',
        parents: [{ type: 'urn:entity:artist' }],
      },
      {
        id: 'urn:tag:genre:place:jazz',
        name: 'Jazz',
        type: 'urn:tag:genre:place',
        parents: [{ type: 'urn:entity:place' }],
      },
      {
        id: 'urn:tag:genre:media:blues',
        name: 'Blues',
        type: 'urn:tag:genre:media',
        parents: [{ type: 'urn:entity:artist' }],
      },
    ],
  },
};

export const syntheticSearchResponse = {
  results: [
    { entity_id: 'e-1', name: 'Test Artist', types: ['urn:entity:artist'], popularity: 0.5 },
    { entity_id: 'e-2', name: 'Test Artist Quartet', types: ['urn:entity:artist'] },
  ],
};

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

/**
 * RECORDED taxonomy, not venue data. These tag ids, names, types and parent types were read from
 * a live Qloo response on 25 October 2026 (the first twelve results for the phrase "restaurant",
 * without a parent filter). They show that one phrase can exist under several taxonomies, and that
 * only some of them apply to places.
 */
export const recordedRestaurantTags = {
  results: {
    tags: [
      [
        'urn:tag:product_service:qloo:restaurant_dining',
        'Restaurant Dining',
        'urn:tag:product_service:qloo',
        'brand',
      ],
      [
        'urn:tag:product_service:qloo:restaurant',
        'Restaurant',
        'urn:tag:product_service:qloo',
        'brand',
      ],
      ['urn:tag:amenity:qloo:restaurant', 'Restaurant', 'urn:tag:amenity:qloo', 'place'],
      ['urn:tag:genre:place:restaurant', 'Restaurant', 'urn:tag:genre:place', 'place'],
      [
        'urn:tag:amenity:qloo:restaurant_dining',
        'Restaurant Dining',
        'urn:tag:amenity:qloo',
        'place',
      ],
      [
        'urn:tag:dining_option:qloo:restaurant',
        'Restaurant',
        'urn:tag:dining_option:qloo',
        'place',
      ],
      ['urn:tag:amenities:place:restaurant', 'Restaurant', 'urn:tag:amenities:place', 'place'],
      ['urn:tag:amenity:qloo:eatery', 'Eatery', 'urn:tag:amenity:qloo', 'place'],
    ].map(([id, name, type, parent]) => ({
      id,
      name,
      type,
      parents: [{ type: `urn:entity:${parent}` }],
    })),
  },
};

/** RECORDED taxonomy: "jazz" with the parent filter urn:entity:place returned exactly one tag. */
export const recordedJazzPlaceTags = {
  results: {
    tags: [
      {
        id: 'urn:tag:interests:qloo:jazz',
        name: 'Jazz',
        type: 'urn:tag:interests:qloo',
        parents: [
          { type: 'urn:entity:place' },
          { type: 'urn:entity:movie' },
          { type: 'urn:entity:tv_show' },
        ],
      },
    ],
  },
};

/** RECORDED taxonomy: "jazz" without a parent filter, where every tag but one is for artists. */
export const recordedJazzAnyTags = {
  results: {
    tags: [
      ['urn:tag:genre:qloo:jazz', 'urn:tag:genre:qloo'],
      ['urn:tag:genre:music:jazz', 'urn:tag:genre:music'],
      ['urn:tag:music:qloo:jazz', 'urn:tag:music:qloo'],
    ].map(([id, type]) => ({ id, name: 'Jazz', type, parents: [{ type: 'urn:entity:artist' }] })),
  },
};

/**
 * RECORDED shape: a search for a musician's name returns one entry per kind of thing that carries
 * the name. The names are public figures; no other field is kept.
 */
export const recordedMusicianSearch = {
  results: [
    { entity_id: 'recorded-artist', name: 'Miles Davis', type: 'urn:entity:artist' },
    { entity_id: 'recorded-person', name: 'Miles Davis', type: 'urn:entity:person' },
  ],
};

const closedDay = { closed: true, opens: null, closes: null };
const openDay = (opens: string, closes: string) => ({ closed: false, opens, closes });

/**
 * RECORDED SHAPE, INVENTED VALUES. Every key, nesting level and value type below was seen on a
 * place entity in a live Qloo response on 25 October 2026: weekly hours keyed by lower case day
 * name with a list of slots, clock times written as "T10:00:00", and tags that carry an id, a name
 * and a type. The venue, its address and its hours are invented for tests.
 */
export function recordedPlaceEntity(
  overrides: { hours?: unknown; tags?: Array<{ id: string; name: string }> } = {},
) {
  return {
    entity_id: 'recorded-place-1',
    name: 'Recorded Shape Bistro',
    type: 'urn:entity:place',
    subtype: 'urn:entity:place',
    popularity: 0.93,
    disambiguation: '1 Fixture Lane, Testville',
    location: { geohash: 'xx0xx0x0x0xx', lat: 40.7, lon: -73.9 },
    query: { distance: 120, measurements: { audience_growth: 0.1 } },
    properties: {
      address: '1 Fixture Lane, Testville',
      business_rating: 4.4,
      is_closed: false,
      price_level: 2,
      hours:
        'hours' in overrides
          ? overrides.hours
          : {
              monday: [closedDay],
              tuesday: [closedDay],
              wednesday: [openDay('T11:00:00', 'T22:00:00')],
              thursday: [openDay('T11:00:00', 'T22:00:00')],
              friday: [openDay('T10:00:00', 'T23:00:00')],
              saturday: [openDay('T18:00:00', 'T02:00:00')],
              sunday: [closedDay],
            },
    },
    tags: overrides.tags ?? [
      {
        id: 'urn:tag:genre:place:restaurant',
        name: 'Restaurant',
        type: 'urn:tag:genre:place',
        weight: null,
      },
      {
        id: 'urn:tag:accessibility:place:wheelchair_accessible_entrance',
        name: 'Wheelchair accessible entrance',
        type: 'urn:tag:accessibility:place',
        weight: null,
      },
      {
        id: 'urn:tag:dietary_option:qloo:vegetarian',
        name: 'Vegetarian',
        type: 'urn:tag:dietary_option:qloo',
        weight: null,
      },
      {
        id: 'urn:tag:dietary_option:qloo:gluten_free',
        name: 'Gluten free',
        type: 'urn:tag:dietary_option:qloo',
        weight: null,
      },
    ],
  };
}

/**
 * RECORDED names: the phrase "lively" returned four place tags, and none of them is called just
 * "Lively". The ids here are invented. The names and the taxonomy types were recorded on
 * 25 October 2026.
 */
export const recordedLivelyTags = {
  results: {
    tags: [
      ['Lively Vibe', 'urn:tag:ambience:qloo'],
      ['Lively Atmosphere', 'urn:tag:good_for:qloo'],
      ['Lively-Loud', 'urn:tag:ambience:qloo'],
      ['Lively with live entertainment', 'urn:tag:ambience:qloo'],
    ].map(([name, type], index) => ({
      id: `${type}:invented_${index}`,
      name,
      type,
      parents: [{ type: 'urn:entity:place' }],
    })),
  },
};
