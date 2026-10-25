import type { FormEvent } from 'react';
import type { Disruption } from '../../../src/domain/plan.js';
import { DisruptionFields, disruptionFrom, useDisruptionDraft } from './DisruptionFields';

export function DisruptionForm({
  busy,
  currentParty,
  onSubmit,
}: {
  busy: boolean;
  currentParty: number;
  onSubmit: (disruption: Disruption) => void;
}) {
  const [draft, setDraft] = useDisruptionDraft(null, currentParty);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(disruptionFrom(draft));
  };
  return (
    <form className="panel" onSubmit={submit} aria-labelledby="disrupt-title">
      <h3 id="disrupt-title">Something else changed</h3>
      <p className="small muted-text" style={{ marginBottom: '0.8rem' }}>
        Record a new disruption and AFTERGLOW searches again. Your original intent is never edited.
      </p>
      <DisruptionFields idPrefix="disrupt" draft={draft} onChange={setDraft} />
      <div className="button-row" style={{ marginTop: '1rem' }}>
        <button type="submit" className="btn primary" disabled={busy}>
          Record and search again
        </button>
      </div>
    </form>
  );
}
