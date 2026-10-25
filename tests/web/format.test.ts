import { describe, expect, it } from 'vitest';
import { entryKind, groupChoices } from '../../web/src/lib/format.js';

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

describe('groupChoices', () => {
  it('shows one entry when Qloo lists one entity under two types', () => {
    const grouped = groupChoices([
      { id: 'a', name: 'Fleetwood Mac', type: 'urn:entity:artist', description: 'A band.' },
      { id: 'b', name: 'Fleetwood Mac', type: 'urn:entity:album' },
      { id: 'a', name: 'Fleetwood Mac', type: 'urn:entity:person' },
    ]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({
      id: 'a',
      kinds: ['Artist', 'Person'],
      description: 'A band.',
    });
    expect(grouped[1]).toMatchObject({ id: 'b', kinds: ['Album'] });
  });

  it('keeps entries with different identifiers apart and tolerates a missing type', () => {
    const grouped = groupChoices([
      { id: 'x', name: 'One' },
      { id: 'y', name: 'One', type: 'urn:entity:place' },
    ]);
    expect(grouped.map((g) => g.id)).toEqual(['x', 'y']);
    expect(grouped[0]?.kinds).toEqual([]);
  });
});
