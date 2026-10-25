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
