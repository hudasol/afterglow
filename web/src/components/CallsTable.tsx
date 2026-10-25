import type { CallTrace } from '../../../src/domain/case.js';

export function CallsTable({ calls, caption }: { calls: readonly CallTrace[]; caption: string }) {
  if (calls.length === 0) return <p className="muted-text">No calls were recorded.</p>;
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="data">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Endpoint</th>
            <th scope="col">Parameters sent</th>
            <th scope="col">Outcome</th>
            <th scope="col" className="num">
              Time
            </th>
          </tr>
        </thead>
        <tbody>
          {calls.map((call, index) => (
            <tr key={`${call.endpoint}-${index}`}>
              <td>
                <code>{call.endpoint}</code>
              </td>
              <td>
                {Object.entries(call.params).map(([key, value]) => (
                  <div key={key}>
                    <code>
                      {key}={value}
                    </code>
                  </div>
                ))}
              </td>
              <td>
                {call.error ? (
                  <span className="pill bad">{call.error}</span>
                ) : (
                  <span className="pill ok">
                    {call.status ?? 'ok'}
                    {call.resultCount !== undefined ? `, ${call.resultCount} results` : ''}
                  </span>
                )}
                <div className="small muted-text">
                  {call.attempts} {call.attempts === 1 ? 'attempt' : 'attempts'}, cache {call.cache}
                </div>
              </td>
              <td className="num">{Math.round(call.durationMs)} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
