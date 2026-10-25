import type { CaseView } from '../../../src/domain/case-view.js';

/**
 * Compares the order without taste (left) with the order with taste (right) for the same
 * eligible places. Lines connect the same place, so changes in order are visible at a glance.
 */
export function SlopeChart({ view }: { view: CaseView }) {
  const eligible = view.options.filter(
    (o) => o.feasibility !== 'rejected' && o.tasteOffPosition !== null,
  );
  const rows = eligible
    .filter((o) => o.tasteOn !== null)
    .sort((a, b) => (a.tasteOffPosition ?? 0) - (b.tasteOffPosition ?? 0))
    .slice(0, 8);
  if (rows.length === 0) return null;

  const width = 640;
  const rowHeight = 34;
  const top = 44;
  const left = 190;
  const right = width - 190;
  const height = top + rowHeight * rows.length + 12;

  const onOrder = [...rows].sort((a, b) => (a.tasteOn?.position ?? 0) - (b.tasteOn?.position ?? 0));
  const yOff = (index: number) => top + index * rowHeight + 12;
  const trim = (name: string) => (name.length > 26 ? `${name.slice(0, 25)}…` : name);

  const description = rows
    .map(
      (o) =>
        `${o.candidate.name}: without taste ${rows.indexOf(o) + 1}, with taste ${onOrder.indexOf(o) + 1}`,
    )
    .join('. ');

  return (
    <figure style={{ margin: 0 }}>
      <svg
        className="slope"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Order of the top ${rows.length} eligible places without and with taste. ${description}.`}
      >
        <text className="col-title" x={left - 12} y={22} textAnchor="end">
          Without taste
        </text>
        <text className="col-title" x={right + 12} y={22} textAnchor="start">
          With taste
        </text>
        {rows.map((option, index) => {
          const onIndex = onOrder.indexOf(option);
          const moved = onIndex !== index;
          return (
            <g key={option.candidate.id}>
              <line
                x1={left}
                y1={yOff(index)}
                x2={right}
                y2={yOff(onIndex)}
                stroke={moved ? 'var(--dusk-3)' : 'var(--line-strong)'}
                strokeWidth={moved ? 2.5 : 1.5}
              />
              <circle cx={left} cy={yOff(index)} r={4} fill="var(--ink)" />
              <circle cx={right} cy={yOff(onIndex)} r={4} fill="var(--ink)" />
              <text x={left - 12} y={yOff(index) + 4} textAnchor="end">
                {index + 1}. {trim(option.candidate.name)}
              </text>
              <text x={right + 12} y={yOff(onIndex) + 4} textAnchor="start">
                {onIndex + 1}. {trim(onOrder[onIndex]?.candidate.name ?? '')}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="small muted-text">
        Both columns list the same eligible places, so only the order differs. A pink line marks a
        place that moved.
      </figcaption>
    </figure>
  );
}
