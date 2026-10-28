import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skipped = new Set([
  'node_modules',
  '.git',
  'dist',
  'var',
  'playwright-report',
  'test-results',
]);

function markdownFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (skipped.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...markdownFiles(path));
    else if (entry.endsWith('.md')) found.push(path);
  }
  return found;
}

function localLinks(text: string): string[] {
  const withoutCode = text.replace(/```[\s\S]*?```/gu, '').replace(/`[^`\n]*`/gu, '');
  const links: string[] = [];
  for (const match of withoutCode.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
    const target = match[1];
    if (!target || /^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith('#')) continue;
    links.push(target);
  }
  return links;
}

describe('links between the repository documents', () => {
  const files = markdownFiles(root);

  it('finds the documents', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((file) => [relative(root, file), file] as const))(
    '%s points only at files that exist',
    (_name, file) => {
      const missing = localLinks(readFileSync(file, 'utf8'))
        .map((link) => link.split('#')[0] ?? '')
        .filter((path) => path !== '')
        .filter((path) => !existsSync(resolve(dirname(file), decodeURIComponent(path))));
      expect(missing).toEqual([]);
    },
  );
});
