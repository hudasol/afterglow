import type { ResolutionKind, ResolvedRef, TasteResolution } from '../domain/case.js';
import { normaliseName } from '../domain/venue.js';
import type { QlooClient } from './client.js';
import { resultArray, toEntityRef, toTagRef, type TagRef } from './normalize.js';
import type { CallTrace } from '../domain/case.js';

export const PLACE_TYPE = 'urn:entity:place';

/**
 * Qloo files a venue category such as "Restaurant" under several taxonomies at once: amenity,
 * dining option, cuisine and place genre. The place genre tag is the one that says what kind of
 * place a venue is, so a category lookup prefers it. The others describe something a place offers.
 */
export const CATEGORY_TAG_TYPE = 'urn:tag:genre:place';

function stripTag(tag: TagRef): ResolvedRef {
  const ref: ResolvedRef = { id: tag.id, name: tag.name };
  if (tag.type !== undefined) ref.type = tag.type;
  return ref;
}

function outcome(
  kind: ResolutionKind,
  input: string,
  status: TasteResolution['status'],
  extra: Partial<TasteResolution> = {},
): TasteResolution {
  return { kind, input, status, ...extra };
}

/**
 * Narrows a set of equally named places using the city the person gave. Returns a single match
 * only when exactly one candidate mentions the city. Otherwise the person chooses.
 */
function narrowByCity(candidates: ResolvedRef[], city: string): ResolvedRef | undefined {
  const needle = normaliseName(city);
  if (!needle) return undefined;
  const mentioning = candidates.filter((candidate) =>
    normaliseName(`${candidate.description ?? ''}`).includes(needle),
  );
  return mentioning.length === 1 ? mentioning[0] : undefined;
}

export async function resolveEntity(
  client: QlooClient,
  kind: 'entity' | 'original_venue',
  input: string,
  city: string,
  traces: CallTrace[],
): Promise<TasteResolution> {
  const response = await client.get(
    '/search',
    { query: input, take: 5, ...(kind === 'original_venue' ? { types: PLACE_TYPE } : {}) },
    traces,
  );
  const candidates = resultArray(response, 'entities')
    .map(toEntityRef)
    .filter((ref): ref is ResolvedRef => ref !== undefined);
  if (candidates.length === 0) return outcome(kind, input, 'not_found');

  const wanted = normaliseName(input);
  const exact = candidates.filter((candidate) => normaliseName(candidate.name) === wanted);
  if (exact.length === 1 && exact[0]) {
    return outcome(kind, input, 'resolved', { selected: exact[0], method: 'exact' });
  }
  if (kind === 'original_venue' && exact.length > 1) {
    const narrowed = narrowByCity(exact, city);
    if (narrowed) {
      return outcome(kind, input, 'resolved', {
        selected: narrowed,
        method: 'exact',
        warnings: [`Several places share this name. The one that mentions ${city} was selected.`],
      });
    }
  }
  return outcome(kind, input, 'ambiguous', {
    candidates: (exact.length > 0 ? exact : candidates).slice(0, 5),
    warnings:
      exact.length === 0
        ? ['No result matched the name exactly. Choose the intended entry or skip this signal.']
        : ['Several entries share this name. Choose the intended entry.'],
  });
}

export async function resolveTag(
  client: QlooClient,
  kind: 'tag' | 'category',
  input: string,
  traces: CallTrace[],
  parentType?: string,
): Promise<TasteResolution> {
  const search = async (scope: string | undefined): Promise<TagRef[]> => {
    const response = await client.get(
      '/v2/tags',
      {
        'filter.query': input,
        'feature.semantic_search': true,
        take: 20,
        ...(scope ? { 'filter.parents.types': scope } : {}),
      },
      traces,
    );
    return resultArray(response, 'tags')
      .map(toTagRef)
      .filter((tag): tag is TagRef => tag !== undefined);
  };

  let ranked = await search(parentType);
  const warnings: string[] = [];
  // A phrase with no tag that applies to places may still exist in another domain. Qloo relates
  // domains to each other, so the wider search is tried once and the person is told.
  if (ranked.length === 0 && parentType && kind === 'tag') {
    ranked = await search(undefined);
    if (ranked.length > 0) {
      warnings.push(
        'Qloo has no tag with this name that applies to places. A tag from another domain was found instead.',
      );
    }
  }

  const withParents = ranked.filter((tag) => tag.parentTypes.length > 0);
  const scoped =
    parentType && withParents.length > 0 && warnings.length === 0
      ? ranked.filter((tag) => tag.parentTypes.includes(parentType))
      : ranked;

  if (scoped.length === 0) {
    return outcome(kind, input, 'not_found', {
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  }
  const wanted = normaliseName(input);
  const exact = scoped.filter((tag) => normaliseName(tag.name) === wanted);
  if (exact.length === 1 && exact[0]) {
    return outcome(kind, input, 'resolved', {
      selected: stripTag(exact[0]),
      method: 'exact',
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  }
  if (kind === 'category' && exact.length > 1) {
    const genre = exact.filter((tag) => tag.type === CATEGORY_TAG_TYPE);
    if (genre.length === 1 && genre[0]) {
      return outcome(kind, input, 'resolved', {
        selected: stripTag(genre[0]),
        method: 'exact',
        warnings: [
          ...warnings,
          `${exact.length} tags are called "${genre[0].name}". The place genre tag was used because it says what kind of place a venue is.`,
        ],
      });
    }
  }
  if (kind === 'tag' && exact.length > 1 && exact[0]) {
    // Entries that carry the same name in different taxonomies name the same idea. Every one of
    // them is used, so nothing is chosen on the person's behalf and nothing is left out.
    const [first, ...rest] = exact.slice(0, 5);
    return outcome(kind, input, 'resolved', {
      selected: stripTag(first as TagRef),
      alsoUsed: rest.map(stripTag),
      method: 'same_name_group',
      warnings: [
        ...warnings,
        `${exact.length} Qloo tags are called "${exact[0].name}" in different taxonomies. All of them are used together.`,
      ],
    });
  }
  return outcome(kind, input, 'ambiguous', {
    candidates: (exact.length > 0 ? exact : scoped).slice(0, 5).map(stripTag),
    warnings: [
      ...warnings,
      exact.length === 0
        ? 'Qloo returned ranked candidates without a calibrated relevance score. Choose one or skip this signal.'
        : 'Several tags share this name. Choose the intended one.',
    ],
  });
}
