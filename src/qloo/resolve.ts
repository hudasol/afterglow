import type { ResolutionKind, ResolvedRef, TasteResolution } from '../domain/case.js';
import { normaliseName } from '../domain/venue.js';
import type { QlooClient } from './client.js';
import { resultArray, toEntityRef, toTagRef, type TagRef } from './normalize.js';
import type { CallTrace } from '../domain/case.js';

export const PLACE_TYPE = 'urn:entity:place';

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
  const response = await client.get(
    '/v2/tags',
    { 'filter.query': input, 'feature.semantic_search': true, take: 20 },
    traces,
  );
  const ranked = resultArray(response, 'tags')
    .map(toTagRef)
    .filter((tag): tag is TagRef => tag !== undefined);

  const withParents = ranked.filter((tag) => tag.parentTypes.length > 0);
  const scoped =
    parentType && withParents.length > 0
      ? ranked.filter((tag) => tag.parentTypes.includes(parentType))
      : ranked;
  const warnings: string[] =
    parentType && withParents.length === 0 && ranked.length > 0
      ? [`Qloo did not return parent types, so tags could not be limited to ${parentType}.`]
      : [];

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
