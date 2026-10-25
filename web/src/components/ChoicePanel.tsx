import { useState } from 'react';
import type { CaseView } from '../../../src/domain/case-view.js';

type Pending = CaseView['pendingChoices'][number];

const KIND_LABEL: Record<string, string> = {
  entity: 'a name you like',
  tag: 'a vibe or genre',
  original_venue: 'the original venue',
};

function ChoiceItem({
  pending,
  busy,
  onChoose,
}: {
  pending: Pending;
  busy: boolean;
  onChoose: (key: string, chosenId: string | null) => void;
}) {
  const [picked, setPicked] = useState<string>('');
  const candidates = pending.candidates ?? [];
  const name = `choice-${pending.key}`;
  return (
    <fieldset className="panel">
      <legend className="visually-hidden">Choose a match for {pending.input}</legend>
      <h3>Which one did you mean by &ldquo;{pending.input}&rdquo;?</h3>
      <p className="small muted-text">
        This is {KIND_LABEL[pending.kind] ?? 'a signal'}. Several entries matched, and AFTERGLOW
        will not guess because the choice changes the ranking.
      </p>
      <div className="choice-set">
        {candidates.map((candidate) => (
          <label key={candidate.id}>
            <input
              type="radio"
              name={name}
              value={candidate.id}
              checked={picked === candidate.id}
              onChange={() => setPicked(candidate.id)}
            />
            <span>{candidate.name}</span>
            <span className="desc">
              {[candidate.type, candidate.description].filter(Boolean).join('. ') ||
                'No further description returned.'}
            </span>
          </label>
        ))}
      </div>
      <div className="button-row">
        <button
          type="button"
          className="btn primary"
          disabled={busy || picked === ''}
          onClick={() => onChoose(pending.key, picked)}
        >
          Use this match
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => onChoose(pending.key, null)}
        >
          Skip this signal
        </button>
      </div>
    </fieldset>
  );
}

export function ChoicePanel({
  view,
  busy,
  onChoose,
}: {
  view: CaseView;
  busy: boolean;
  onChoose: (key: string, chosenId: string | null) => void;
}) {
  if (view.pendingChoices.length === 0) return null;
  return (
    <section aria-labelledby="choices-title" className="stack">
      <h2 id="choices-title">Your input is needed before options appear</h2>
      {view.pendingChoices.map((pending) => (
        <ChoiceItem key={pending.key} pending={pending} busy={busy} onChoose={onChoose} />
      ))}
    </section>
  );
}
