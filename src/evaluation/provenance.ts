/**
 * Where a results file came from. A run inside a GitHub Actions workflow records the commit it ran
 * on and the address of the run, so a reader can check the code and the time against the
 * registration. A run on a person's own machine records nothing, because nothing can vouch for it.
 */
export interface RunProvenance {
  commit: string;
  runUrl: string;
}

export function runProvenance(env: NodeJS.ProcessEnv = process.env): RunProvenance | null {
  const commit = env['GITHUB_SHA'];
  const runId = env['GITHUB_RUN_ID'];
  const repository = env['GITHUB_REPOSITORY'];
  if (!commit || !runId || !repository) return null;
  const server = env['GITHUB_SERVER_URL'] ?? 'https://github.com';
  return { commit, runUrl: `${server}/${repository}/actions/runs/${runId}` };
}

/** Lines for a generated report. Empty when the run recorded no provenance. */
export function provenanceLines(file: {
  startedAt?: string;
  provenance?: RunProvenance;
}): string[] {
  const lines: string[] = [];
  if (file.startedAt) lines.push(`- Started at: ${file.startedAt}`);
  if (file.provenance) {
    lines.push(`- Commit: ${file.provenance.commit}`);
    lines.push(`- Workflow run: ${file.provenance.runUrl}`);
  }
  return lines;
}
