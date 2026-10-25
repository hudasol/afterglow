import { useState } from 'react';
import type { Disruption } from '../../../src/domain/plan.js';

type Kind = Disruption['kind'];

export const DISRUPTION_KINDS: { value: Kind; label: string }[] = [
  { value: 'venue_unavailable', label: 'The original venue is unavailable' },
  { value: 'running_late', label: 'The group is running late' },
  { value: 'weather', label: 'The weather changed' },
  { value: 'budget_reduced', label: 'The budget went down' },
  { value: 'party_changed', label: 'The party size changed' },
];

export interface DisruptionDraft {
  kind: Kind;
  minutes: number;
  condition: 'rain' | 'extreme_heat' | 'cold';
  price: number;
  party: number;
  note: string;
}

export function draftFrom(disruption: Disruption | null, party: number): DisruptionDraft {
  const draft: DisruptionDraft = {
    kind: disruption?.kind ?? 'venue_unavailable',
    minutes: 30,
    condition: 'rain',
    price: 2,
    party,
    note: '',
  };
  if (!disruption) return draft;
  switch (disruption.kind) {
    case 'venue_unavailable':
      draft.note = disruption.note ?? '';
      break;
    case 'running_late':
      draft.minutes = disruption.minutes;
      break;
    case 'weather':
      draft.condition = disruption.condition;
      break;
    case 'budget_reduced':
      draft.price = disruption.maxPriceLevel;
      break;
    case 'party_changed':
      draft.party = disruption.partySize;
      break;
  }
  return draft;
}

export function disruptionFrom(draft: DisruptionDraft): Disruption {
  switch (draft.kind) {
    case 'venue_unavailable':
      return draft.note.trim()
        ? { kind: 'venue_unavailable', note: draft.note.trim() }
        : { kind: 'venue_unavailable' };
    case 'running_late':
      return { kind: 'running_late', minutes: draft.minutes };
    case 'weather':
      return { kind: 'weather', condition: draft.condition };
    case 'budget_reduced':
      return { kind: 'budget_reduced', maxPriceLevel: draft.price };
    case 'party_changed':
      return { kind: 'party_changed', partySize: draft.party };
  }
}

export function useDisruptionDraft(initial: Disruption | null, party: number) {
  return useState<DisruptionDraft>(() => draftFrom(initial, party));
}

/** The fields for one disruption. The parent owns the draft so it can submit it with a form. */
export function DisruptionFields({
  idPrefix,
  draft,
  onChange,
}: {
  idPrefix: string;
  draft: DisruptionDraft;
  onChange: (next: DisruptionDraft) => void;
}) {
  const patch = (partial: Partial<DisruptionDraft>) => onChange({ ...draft, ...partial });
  return (
    <div className="form-grid">
      <div className="field">
        <label htmlFor={`${idPrefix}-kind`}>What happened</label>
        <select
          id={`${idPrefix}-kind`}
          value={draft.kind}
          onChange={(e) => patch({ kind: e.target.value as Kind })}
        >
          {DISRUPTION_KINDS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      {draft.kind === 'venue_unavailable' ? (
        <div className="field">
          <label htmlFor={`${idPrefix}-note`}>Note (optional)</label>
          <input
            id={`${idPrefix}-note`}
            type="text"
            maxLength={200}
            value={draft.note}
            onChange={(e) => patch({ note: e.target.value })}
          />
        </div>
      ) : null}
      {draft.kind === 'running_late' ? (
        <div className="field">
          <label htmlFor={`${idPrefix}-minutes`}>Minutes late</label>
          <input
            id={`${idPrefix}-minutes`}
            type="number"
            min={5}
            max={240}
            step={5}
            value={draft.minutes}
            onChange={(e) => patch({ minutes: Number(e.target.value) })}
          />
        </div>
      ) : null}
      {draft.kind === 'weather' ? (
        <div className="field">
          <label htmlFor={`${idPrefix}-weather`}>Conditions</label>
          <select
            id={`${idPrefix}-weather`}
            value={draft.condition}
            onChange={(e) => patch({ condition: e.target.value as DisruptionDraft['condition'] })}
          >
            <option value="rain">Rain</option>
            <option value="extreme_heat">Extreme heat</option>
            <option value="cold">Cold</option>
          </select>
        </div>
      ) : null}
      {draft.kind === 'budget_reduced' ? (
        <div className="field">
          <label htmlFor={`${idPrefix}-price`}>New highest price level</label>
          <select
            id={`${idPrefix}-price`}
            value={draft.price}
            onChange={(e) => patch({ price: Number(e.target.value) })}
          >
            {[1, 2, 3, 4].map((level) => (
              <option key={level} value={level}>
                {level} of 4
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {draft.kind === 'party_changed' ? (
        <div className="field">
          <label htmlFor={`${idPrefix}-party`}>New party size</label>
          <input
            id={`${idPrefix}-party`}
            type="number"
            min={1}
            max={30}
            value={draft.party}
            onChange={(e) => patch({ party: Number(e.target.value) })}
          />
        </div>
      ) : null}
    </div>
  );
}
