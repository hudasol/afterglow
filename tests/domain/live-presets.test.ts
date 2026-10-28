import { describe, expect, it } from 'vitest';
import { intentAnchorInputSchema } from '../../src/domain/intent.js';
import { livePresets } from '../../src/domain/live-presets.js';
import { disruptionSchema } from '../../src/domain/plan.js';
import { localWeekday } from '../../src/domain/time.js';

describe('live presets', () => {
  const now = new Date('2026-10-28T14:00:00Z');
  const presets = livePresets(now);

  it('offers one plan in each of five cities', () => {
    expect(presets.map((p) => p.city)).toEqual(['New York', 'London', 'Paris', 'Tokyo', 'Dubai']);
    expect(new Set(presets.map((p) => p.id)).size).toBe(5);
  });

  it('passes the same validation as a plan typed into the form', () => {
    for (const preset of presets) {
      expect(intentAnchorInputSchema.safeParse(preset.anchor).success, preset.id).toBe(true);
      expect(disruptionSchema.safeParse(preset.disruption).success, preset.id).toBe(true);
    }
  });

  it('sets each plan for a Saturday evening after now, on the clock of its city', () => {
    for (const preset of presets) {
      expect(localWeekday(preset.anchor.planStart), preset.id).toBe(6);
      expect(new Date(preset.anchor.planStart).getTime()).toBeGreaterThan(now.getTime());
      expect(preset.anchor.planStart, preset.id).toMatch(/T19:30:00/u);
    }
  });

  it('needs no choice to open: no artist or film name that Qloo lists more than once', () => {
    for (const preset of presets) expect(preset.anchor.tasteEntities, preset.id).toEqual([]);
  });

  it('asks Qloo for nothing about a person', () => {
    const text = JSON.stringify(presets);
    expect(text).not.toMatch(/@|\bhttps?:/u);
  });
});
