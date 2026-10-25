import { describe, expect, it } from 'vitest';
import { entryKind } from '../../web/src/lib/format.js';

describe('entryKind', () => {
  it('names the entry types that Qloo returns for a person to choose between', () => {
    expect(entryKind('urn:entity:artist')).toBe('Artist');
    expect(entryKind('urn:entity:person')).toBe('Person');
    expect(entryKind('urn:entity:album')).toBe('Album');
    expect(entryKind('urn:entity:place')).toBe('Place');
  });

  it('reads an unlisted type from its last part', () => {
    expect(entryKind('urn:entity:board_game')).toBe('Board game');
  });

  it('gives nothing when there is no type', () => {
    expect(entryKind(undefined)).toBeUndefined();
    expect(entryKind('')).toBeUndefined();
  });
});
