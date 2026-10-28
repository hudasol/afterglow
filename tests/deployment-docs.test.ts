import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function windowOf(workflow: string): { start: string; end: string } {
  const start = /date -u -d '(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/u.exec(workflow);
  const end = /end=\$\(date -u -d '(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/u.exec(workflow);
  if (!start || !end) throw new Error('The keepalive workflow has no readable window.');
  const words = (match: RegExpExecArray) => {
    const [year, month, day] = (match[1] ?? '').split('-').map(Number);
    return `${day} ${MONTHS[(month ?? 1) - 1]} ${year} ${match[2]} UTC`;
  };
  return { start: words(start), end: words(end) };
}

describe('the deployment guide and the keepalive workflow', () => {
  it('state the same window', () => {
    const { start, end } = windowOf(read('.github/workflows/keepalive.yml'));
    const guide = read('docs/DEPLOYMENT.md');
    expect(guide).toContain(`between ${start} and ${end}`);
  });

  it('list every environment variable that the render blueprint sets', () => {
    const blueprint = read('render.yaml');
    const guide = read('docs/DEPLOYMENT.md');
    const keys = [...blueprint.matchAll(/- key: ([A-Z_]+)/gu)].map((m) => m[1] ?? '');
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) expect(guide, key).toContain(key);
  });
});
