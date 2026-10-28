import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../web/src/styles.css'),
  'utf8',
);

type Tokens = Record<string, string>;

function tokensIn(block: string): Tokens {
  const found: Tokens = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    const [, name, value] = match;
    if (name && value) found[name] = value;
  }
  return found;
}

const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const light = tokensIn(css.slice(0, darkStart));
const dark = { ...light, ...tokensIn(css.slice(darkStart, css.indexOf('*,', darkStart))) };

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const channel = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('the %s theme', (_name, theme) => {
  const grounds = ['paper', 'surface', 'surface-2'] as const;
  const at = (token: string): string => {
    const value = theme[token];
    if (!value) throw new Error(`Missing token --${token}`);
    return value;
  };

  it.each(grounds)('keeps body text at 4.5:1 or more on %s', (ground) => {
    for (const text of ['ink', 'ink-2', 'ink-3']) {
      expect(ratio(at(text), at(ground)), `${text} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(grounds)('keeps the borders of controls at 3:1 or more on %s', (ground) => {
    expect(ratio(at('control-line'), at(ground))).toBeGreaterThanOrEqual(3);
  });

  it.each(grounds)('keeps the focus ring at 3:1 or more on %s', (ground) => {
    expect(ratio(at('focus'), at(ground))).toBeGreaterThanOrEqual(3);
  });

  it('keeps status text at 4.5:1 or more on its own background', () => {
    for (const status of ['ok', 'warn', 'bad', 'info']) {
      expect(ratio(at(status), at(`${status}-bg`)), status).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps button text at 4.5:1 or more on the accent', () => {
    expect(ratio(at('accent-ink'), at('accent'))).toBeGreaterThanOrEqual(4.5);
  });
});
