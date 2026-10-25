import { describe, expect, it } from 'vitest';
import { OverpassClient } from '../../src/openstreetmap/overpass.js';
import { gridAround, runOsmSmoke } from '../../src/openstreetmap/smoke.js';

/* Invented responses. The real ones are recorded by `npm run osm:smoke`. */

const area = { lat: 40.758, lon: -73.9855, radiusM: 400 };
const NOW = new Date('2026-10-25T10:00:00Z');

function clientReturning(elements: unknown[] | Error) {
  return new OverpassClient({
    url: 'https://overpass.test/api/interpreter',
    timeoutMs: 1000,
    userAgent: 'afterglow-test',
    fetchImpl: (async () => {
      if (elements instanceof Error) throw elements;
      return new Response(JSON.stringify({ elements }), { status: 200 });
    }) as typeof fetch,
  });
}

const venue = (id: number, tags: Record<string, string>) => ({
  type: 'node',
  id,
  lat: area.lat,
  lon: area.lon,
  tags: { name: `Fixture ${id}`, ...tags },
});

describe('runOsmSmoke', () => {
  it('counts the tags that matter and keeps venue names out of the report', async () => {
    const report = await runOsmSmoke(
      clientReturning([
        venue(1, { opening_hours: 'Mo-Su 10:00-22:00', wheelchair: 'yes', capacity: '40' }),
        venue(2, { opening_hours: 'Apr-Sep Mo-Su 10:00-22:00', 'diet:vegan': 'yes' }),
        venue(3, { wheelchair: 'limited' }),
      ]),
      area,
      NOW,
    );
    expect(report.venues).toBe(3);
    expect(report.openingHours).toMatchObject({
      present: 2,
      read: 1,
      unreadExamples: ['Apr-Sep Mo-Su 10:00-22:00'],
    });
    expect(report.wheelchair).toEqual({ yes: 1, limited: 1 });
    expect(report.dietTagKeys).toEqual({ 'diet:vegan': 1 });
    expect(report.capacityPresent).toBe(1);
    expect(report.verdict).toBe('go');
    expect(JSON.stringify(report)).not.toContain('Fixture');
  });

  it('is conditional when the hours that exist are mostly not understood', async () => {
    const report = await runOsmSmoke(
      clientReturning([
        venue(1, { opening_hours: 'sunrise-sunset' }),
        venue(2, { opening_hours: 'Jan-Mar Mo 10:00-12:00' }),
        venue(3, { opening_hours: 'Mo-Su 10:00-22:00' }),
      ]),
      area,
      NOW,
    );
    expect(report.verdict).toBe('conditional');
  });

  it('is no go with a plain reason when no venue comes back', async () => {
    const report = await runOsmSmoke(clientReturning([]), area, NOW);
    expect(report.verdict).toBe('no_go');
    expect(report.reasons[0]).toMatch(/No named venues/u);
  });

  it('is no go when the service cannot be reached', async () => {
    const report = await runOsmSmoke(clientReturning(new TypeError('offline')), area, NOW);
    expect(report.verdict).toBe('no_go');
    expect(report.checks[0]).toMatchObject({ ok: false });
    expect(report.reasons[0]).toContain('OSM_NETWORK');
  });
});

describe('gridAround', () => {
  it('returns the requested number of distinct points around the centre', () => {
    const points = gridAround({ lat: 40.758, lon: -73.9855 }, 9, 300);
    expect(points).toHaveLength(9);
    expect(new Set(points.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`)).size).toBe(9);
    const meanLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
    expect(meanLat).toBeCloseTo(40.758, 4);
  });
});

describe('runOsmSmoke over several points', () => {
  it('merges venues seen from more than one point and reports how long it took', async () => {
    const report = await runOsmSmoke(
      clientReturning([venue(1, { opening_hours: 'Mo-Su 10:00-22:00' })]),
      { ...area, points: 4 },
      NOW,
    );
    expect(report.area.points).toBe(4);
    expect(report.venues).toBe(1);
    expect(report.durationMs).not.toBeNull();
    expect(report.checks.map((check) => check.name)).toContain('Answered in a reasonable time');
  });
});
