import type {
  PlaceFactsProvider,
  PlaceFactsResult,
  ProviderContext,
} from '../application/ports.js';
import { known, unknown, isKnown, type Fact, type Provenance } from '../domain/evidence.js';
import type { DietaryRequirement } from '../domain/intent.js';
import type { EffectivePlan } from '../domain/plan.js';
import { localMinuteOfDay, localWeekday } from '../domain/time.js';
import type { Candidate } from '../domain/venue.js';
import { matchElement } from './match.js';
import { OverpassError, pointKey, type OsmElement, type OverpassClient } from './overpass.js';
import { readTagFacts, type TagFact } from './tags.js';

const MAX_PLACES = 40;
const MATCH_RADIUS_M = 150;

interface Needs {
  hours: boolean;
  dietary: DietaryRequirement[];
  stepFree: boolean;
  capacity: boolean;
}

function needsOf(plan: EffectivePlan): Needs {
  const needs: Needs = { hours: false, dietary: [], stepFree: false, capacity: false };
  for (const constraint of plan.hardConstraints) {
    if (constraint.kind === 'open_at_plan_time') needs.hours = true;
    else if (constraint.kind === 'dietary') needs.dietary.push(constraint.requirement);
    else if (constraint.kind === 'step_free_access') needs.stepFree = true;
    else if (constraint.kind === 'fits_party_size') needs.capacity = true;
  }
  return needs;
}

const NO_PLACE = 'Qloo does not supply this and no matching OpenStreetMap place was found nearby';
const NO_TAG =
  'Qloo does not supply this and the matching OpenStreetMap place has no readable tag for it';

/**
 * Reads practical facts for the places Qloo returned from OpenStreetMap, which is community data
 * under the Open Database Licence. Only the public coordinates of venues are sent. Only facts that
 * the plan insists on are looked up, and only when the taste provider left them unknown.
 */
export class OsmPlaceFactsProvider implements PlaceFactsProvider {
  readonly label = 'OpenStreetMap contributors';
  readonly #client: OverpassClient;
  readonly #now: () => Date;

  constructor(client: OverpassClient, now: () => Date = () => new Date()) {
    this.#client = client;
    this.#now = now;
  }

  async enrich(
    candidates: readonly Candidate[],
    plan: EffectivePlan,
    ctx: ProviderContext,
  ): Promise<PlaceFactsResult> {
    const unchanged: PlaceFactsResult = {
      candidates: [...candidates],
      looked: 0,
      matched: 0,
      filled: 0,
    };
    const needs = needsOf(plan);
    if (!needs.hours && needs.dietary.length === 0 && !needs.stepFree && !needs.capacity) {
      return unchanged;
    }

    const eligible = candidates.filter(
      (candidate) =>
        candidate.source === 'qloo' &&
        isKnown(candidate.facts.location) &&
        this.#lacksAny(candidate, needs),
    );
    const wanted = eligible.slice(0, MAX_PLACES);
    if (wanted.length === 0) return unchanged;

    const points = wanted.flatMap((candidate) =>
      isKnown(candidate.facts.location) ? [candidate.facts.location.value] : [],
    );
    let nearby: Map<string, OsmElement[]>;
    try {
      nearby = await this.#client.nearby(points, MATCH_RADIUS_M, ctx.traces);
    } catch (error) {
      const code = error instanceof OverpassError ? error.code : 'OSM_NETWORK';
      return {
        ...unchanged,
        looked: wanted.length,
        note: `OpenStreetMap place facts were unavailable (${code}). Facts that depend on them stay unknown and are asked about instead.`,
      };
    }

    const retrievedAt = this.#now().toISOString();
    const context = {
      weekday: localWeekday(plan.planStart),
      startMinute: localMinuteOfDay(plan.planStart),
      dietaryNeeded: needs.dietary,
    };
    let matched = 0;
    let filled = 0;
    const byId = new Map<string, Candidate>();
    for (const candidate of wanted) {
      if (!isKnown(candidate.facts.location)) continue;
      const position = candidate.facts.location.value;
      const element = matchElement(candidate.name, position, nearby.get(pointKey(position)) ?? []);
      if (element) matched += 1;
      const tagFacts = element ? readTagFacts(element.tags, context) : {};
      const provenance = (what: string, fact: TagFact<unknown>): Provenance => ({
        source: 'openstreetmap',
        label: `OpenStreetMap ${what}`,
        detail: `${fact.evidence} on ${element?.ref ?? 'a matched place'}`.slice(0, 500),
        retrievedAt,
      });
      const reason = element ? NO_TAG : NO_PLACE;
      const next = { ...candidate.facts };
      const fill = <T>(
        wantedByPlan: boolean,
        current: Fact<T>,
        found: TagFact<T> | undefined,
        what: string,
      ): Fact<T> => {
        if (!wantedByPlan || isKnown(current)) return current;
        if (!found) return unknown(reason);
        filled += 1;
        return known(found.value, provenance(what, found));
      };
      next.openWindow = fill(
        needs.hours,
        candidate.facts.openWindow,
        tagFacts.openWindow,
        'opening hours',
      );
      next.dietary = fill(
        needs.dietary.length > 0,
        candidate.facts.dietary,
        tagFacts.dietary,
        'diet tags',
      );
      next.stepFree = fill(
        needs.stepFree,
        candidate.facts.stepFree,
        tagFacts.stepFree,
        'wheelchair tag',
      );
      next.groupCapacity = fill(
        needs.capacity,
        candidate.facts.groupCapacity,
        tagFacts.groupCapacity,
        'capacity tag',
      );
      byId.set(candidate.id, { ...candidate, facts: next });
    }

    return {
      candidates: candidates.map((candidate) => byId.get(candidate.id) ?? candidate),
      looked: wanted.length,
      matched,
      filled,
      ...(eligible.length > wanted.length
        ? { note: `OpenStreetMap was asked about the first ${MAX_PLACES} places only.` }
        : {}),
    };
  }

  #lacksAny(candidate: Candidate, needs: Needs): boolean {
    const { facts } = candidate;
    return (
      (needs.hours && !isKnown(facts.openWindow)) ||
      (needs.dietary.length > 0 && !isKnown(facts.dietary)) ||
      (needs.stepFree && !isKnown(facts.stepFree)) ||
      (needs.capacity && !isKnown(facts.groupCapacity))
    );
  }
}
