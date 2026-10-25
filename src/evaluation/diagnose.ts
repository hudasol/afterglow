import type { TasteProvider } from '../application/ports.js';
import type { CallTrace } from '../domain/case.js';
import { resolutionKey } from '../domain/case.js';
import type { ScenarioSpec } from '../simulation/scenarios.js';
import { openCaseView } from './runner.js';

/*
 * A read only look at one scenario, for finding out why a result came out as it did. It records
 * nothing in the results file. Every value printed is a redacted trace, a public name or a count.
 */

export interface ScenarioDiagnosis {
  id: string;
  tasteStatus: string;
  tasteNote: string | null;
  failedCalls: Array<{
    endpoint: string;
    status: number | null;
    attempts: number;
    error: string | null;
    parameters: Record<string, string>;
  }>;
  originalVenue: {
    input: string;
    status: string;
    method: string | null;
    selected: { name: string; type: string | null; location: string | null; note: string | null };
    candidates: number;
  };
  pool: {
    size: number;
    withDistance: number;
    distanceKm: { min: number | null; median: number | null; max: number | null };
    sample: Array<{ name: string; address: string | null; distanceKm: number | null }>;
  };
  rejectionReasons: Array<{ reason: string; places: number }>;
  signals: Array<{
    kind: string;
    input: string;
    status: string;
    method: string | null;
    used: number;
  }>;
}

function shorten(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function summariseParameters(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      value.includes(',')
        ? `${value.split(',').length} values, ${value.length} characters`
        : shorten(value, 80),
    ]),
  );
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const low = sorted[middle - 1];
  const high = sorted[middle];
  if (high === undefined) return null;
  return sorted.length % 2 === 1 || low === undefined ? high : (low + high) / 2;
}

export async function diagnoseScenario(
  provider: TasteProvider,
  spec: ScenarioSpec,
): Promise<ScenarioDiagnosis> {
  const opened = await openCaseView(provider, spec);
  try {
    const { view } = opened;
    const traces: CallTrace[] = [...view.resolutionTraces, ...(view.run?.traces ?? [])];
    const venueInput = spec.anchor.originalVenue.name;
    const venue = view.resolutions.find(
      (r) => resolutionKey(r.kind, r.input) === resolutionKey('original_venue', venueInput),
    );
    const distances = view.options
      .map((o) => o.distanceKm)
      .filter((d): d is number => typeof d === 'number');
    const reasons = new Map<string, number>();
    for (const option of view.options) {
      for (const reason of option.rejectionReasons) {
        const key = shorten(reason, 90);
        reasons.set(key, (reasons.get(key) ?? 0) + 1);
      }
    }
    return {
      id: spec.id,
      tasteStatus: view.run?.tasteStatus ?? 'no run',
      tasteNote: view.run?.tasteNote ?? null,
      failedCalls: traces
        .filter((t) => t.error !== undefined || (t.status !== undefined && t.status >= 400))
        .map((t) => ({
          endpoint: t.endpoint,
          status: t.status ?? null,
          attempts: t.attempts,
          error: t.error ? shorten(t.error, 200) : null,
          parameters: summariseParameters(t.params),
        })),
      originalVenue: {
        input: venueInput,
        status: venue?.status ?? 'not resolved',
        method: venue?.method ?? null,
        selected: {
          name: venue?.selected?.name ?? 'none',
          type: venue?.selected?.type ?? null,
          location: venue?.selected?.location
            ? `${venue.selected.location.lat.toFixed(4)}, ${venue.selected.location.lon.toFixed(4)}`
            : null,
          note: venue?.selected?.description ? shorten(venue.selected.description, 120) : null,
        },
        candidates: venue?.candidates?.length ?? 0,
      },
      pool: {
        size: view.options.length,
        withDistance: distances.length,
        distanceKm: {
          min: distances.length ? Math.min(...distances) : null,
          median: median(distances),
          max: distances.length ? Math.max(...distances) : null,
        },
        sample: view.options.slice(0, 4).map((o) => ({
          name: o.candidate.name,
          address:
            o.candidate.facts.address.status === 'known'
              ? shorten(o.candidate.facts.address.value, 80)
              : null,
          distanceKm: o.distanceKm,
        })),
      },
      rejectionReasons: [...reasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([reason, places]) => ({ reason, places })),
      signals: view.resolutions
        .filter((r) => r.kind === 'entity' || r.kind === 'tag')
        .map((r) => ({
          kind: r.kind,
          input: r.input,
          status: r.status,
          method: r.method ?? null,
          used: 1 + (r.alsoUsed?.length ?? 0),
        })),
    };
  } finally {
    opened.close();
  }
}
