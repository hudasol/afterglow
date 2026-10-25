import type { HistoryEntry } from '../../../src/domain/case-view.js';
import { formatStamp } from '../lib/format';

export function Timeline({ entries }: { entries: readonly HistoryEntry[] }) {
  return (
    <ol className="timeline" aria-label="Case history">
      {entries.map((entry) => (
        <li key={entry.seq}>
          <time dateTime={entry.at}>{formatStamp(entry.at)}</time>
          {entry.text}
        </li>
      ))}
    </ol>
  );
}
