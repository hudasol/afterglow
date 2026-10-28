import type { CaseView } from '../../../src/domain/case-view.js';

export type SlopeBaseline = 'nearest' | 'popular';

const BASELINE_TITLE: Record<SlopeBaseline, string> = {
  nearest: 'Nearest first',
  popular: 'Most popular first',
};

/**
 * Compares a plain order (left) with the order with taste (right) for the same eligible places.
 * The plain order is either nearest first or most popular first. Lines connect the same place,
 * so changes in order are visible at a glance.
 */
export function SlopeChart({
  view,
  baseline = 'nearest',
}: {
  view: CaseView;
  baseline?: SlopeBaseline;
}) {
  const plainPosition = (o: CaseView['options'][number]): number | null =>
    baseline === 'popular' ? o.popularPosition : o.tasteOffPosition;
  const eligible = view.options.filter(
    (o) => o.feasibility !== 'rejected' && plainPosition(o) !== null,
  );
  const rows = eligible
    .filter((o) => o.tasteOn !== null)
    .sort((a, b) => (plainPosition(a) ?? 0) - (plainPosition(b) ?? 0))
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
        `${o.candidate.name}: ${BASELINE_TITLE[baseline].toLowerCase()} ${rows.indexOf(o) + 1}, with taste ${onOrder.indexOf(o) + 1}`,
    )
    .join('. ');

  return (
    <figure style={{ margin: 0 }}>
      <svg
        className="slope slope-wide"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Order of the top ${rows.length} eligible places, ${BASELINE_TITLE[baseline].toLowerCase()} against with taste. ${description}.`}
      >
        <text className="col-title" x={left - 12} y={22} textAnchor="end">
          {BASELINE_TITLE[baseline]}
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
      <div
        className="table-wrap slope-narrow"
        tabIndex={0}
        role="region"
        aria-label={`Order of the top ${rows.length} eligible places, ${BASELINE_TITLE[baseline].toLowerCase()} against with taste`}
      >
        <table className="data compact">
          <thead>
            <tr>
              <th scope="col">Place</th>
              <th scope="col">{BASELINE_TITLE[baseline]}</th>
              <th scope="col">With taste</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((option, index) => {
              const onIndex = onOrder.indexOf(option);
              return (
                <tr key={option.candidate.id}>
                  <th scope="row">{option.candidate.name}</th>
                  <td>{index + 1}</td>
                  <td>
                    {onIndex + 1}
                    {onIndex === index ? '' : onIndex < index ? ', moved up' : ', moved down'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <figcaption className="small muted-text">
        Both columns list the same eligible places, so only the order differs. A pink line, or the
        words moved up and moved down, marks a place that moved.
      </figcaption>
    </figure>
  );
}
