import { describe, expect, it } from 'vitest';
import { provenanceLines, runProvenance } from '../../src/evaluation/provenance.js';

describe('runProvenance', () => {
  it('records nothing for a run outside a workflow', () => {
    expect(runProvenance({})).toBeNull();
    expect(runProvenance({ GITHUB_SHA: 'abc' })).toBeNull();
  });

  it('records the commit and the address of the run inside a workflow', () => {
    expect(
      runProvenance({
        GITHUB_SHA: '8a671524ea659e2840cc1f0f316fb8ad536249be',
        GITHUB_RUN_ID: '40707580529',
        GITHUB_REPOSITORY: 'hudasol/afterglow',
      }),
    ).toEqual({
      commit: '8a671524ea659e2840cc1f0f316fb8ad536249be',
      runUrl: 'https://github.com/hudasol/afterglow/actions/runs/40707580529',
    });
  });

  it('uses the server address the workflow reports', () => {
    expect(
      runProvenance({
        GITHUB_SHA: 'a',
        GITHUB_RUN_ID: '1',
        GITHUB_REPOSITORY: 'o/r',
        GITHUB_SERVER_URL: 'https://git.example',
      })?.runUrl,
    ).toBe('https://git.example/o/r/actions/runs/1');
  });
});

describe('provenanceLines', () => {
  it('adds nothing to files made before it was recorded', () => {
    expect(provenanceLines({})).toEqual([]);
  });

  it('lists the start, the commit and the run', () => {
    expect(
      provenanceLines({
        startedAt: '2026-10-28T14:36:17.000Z',
        provenance: { commit: 'abc', runUrl: 'https://example.test/run' },
      }),
    ).toEqual([
      '- Started at: 2026-10-28T14:36:17.000Z',
      '- Commit: abc',
      '- Workflow run: https://example.test/run',
    ]);
  });
});
