import type { SourceKind } from '../../../src/domain/evidence.js';

export type SourceKey = SourceKind | 'none';

const LABELS: Record<SourceKey, string> = {
  qloo: 'Qloo',
  simulation: 'Simulated',
  user: 'You said',
  user_attested: 'You checked',
  app: 'Calculated here',
  none: 'Not available',
};

const EXPLAIN: Record<SourceKey, string> = {
  qloo: 'Returned by the Qloo API in this session.',
  simulation: 'From the invented demo catalogue. Not real and not from Qloo.',
  user: 'Entered by you when you described the plan.',
  user_attested: 'Checked and confirmed by you.',
  app: 'Calculated by AFTERGLOW from other facts.',
  none: 'No source supplied this fact.',
};

function Glyph({ kind }: { kind: SourceKey }) {
  const common = { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true } as const;
  switch (kind) {
    case 'qloo':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="5" fill="currentColor" />
        </svg>
      );
    case 'simulation':
      return (
        <svg {...common}>
          <path
            d="M6 1 11 6 6 11 1 6Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeDasharray="2.2 1.6"
          />
        </svg>
      );
    case 'user':
      return (
        <svg {...common}>
          <rect x="1.5" y="1.5" width="9" height="9" fill="currentColor" />
        </svg>
      );
    case 'user_attested':
      return (
        <svg {...common}>
          <path d="M1.5 6.5 4.7 9.5 10.5 2.5" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
    case 'app':
      return (
        <svg {...common}>
          <path d="M6 1 11 10.5H1Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case 'none':
      return (
        <svg {...common}>
          <path d="M2 6h8" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
  }
}

export function Source({ kind }: { kind: SourceKey }) {
  return (
    <span className="source" title={EXPLAIN[kind]}>
      <Glyph kind={kind} />
      {LABELS[kind]}
    </span>
  );
}

export function sourceLabel(kind: SourceKey): string {
  return LABELS[kind];
}
