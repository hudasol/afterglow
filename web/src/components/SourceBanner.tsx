import type { CaseMode } from '../../../src/domain/case.js';

export function SourceBanner({ mode, label }: { mode: CaseMode; label?: string }) {
  if (mode === 'demo') {
    return (
      <div className="source-banner demo" role="note">
        <div>
          <strong>Demo mode.</strong> The city of Harbourvale, its venues, their facts and the taste
          scores are all simulated. Nothing on this screen came from Qloo or describes a real place.
        </div>
      </div>
    );
  }
  return (
    <div className="source-banner live" role="note">
      <div>
        <strong>Live Qloo.</strong> Results from {label ?? 'the taste provider'} describe what
        groups of people tend to like. They are not a prediction about any individual. Facts Qloo
        does not supply stay unverified until you check them.
      </div>
    </div>
  );
}
