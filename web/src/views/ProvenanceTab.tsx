import { useEffect, useState } from 'react';
import { CallsTable } from '../components/CallsTable';
import { api, ApiError, type Provenance } from '../lib/api';
import { formatStamp } from '../lib/format';

export function ProvenanceTab({ caseId, refreshKey }: { caseId: string; refreshKey: string }) {
  const [data, setData] = useState<Provenance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .provenance(caseId)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setError(
            caught instanceof ApiError ? caught.message : 'The evidence could not be loaded.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, refreshKey]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted-text">Loading the evidence.</p>;

  const sent = data.sentToProvider;
  return (
    <div className="stack">
      <section className="panel" aria-labelledby="ev-sent">
        <h2 id="ev-sent">What was sent to {data.providerLabel}</h2>
        <dl className="anchor-summary">
          <dt>Location query</dt>
          <dd>{sent.locationQuery}</dd>
          <dt>Category phrase</dt>
          <dd>{sent.categoryPhrase}</dd>
          <dt>Names the group likes</dt>
          <dd>{sent.entityNames.length > 0 ? sent.entityNames.join(', ') : 'None'}</dd>
          <dt>Vibe phrases</dt>
          <dd>{sent.tagPhrases.length > 0 ? sent.tagPhrases.join(', ') : 'None'}</dd>
          <dt>Original venue name</dt>
          <dd>{sent.originalVenueName ?? 'Not sent'}</dd>
        </dl>
        {data.sentToPlaceFacts ? (
          <>
            <h3>Also sent to OpenStreetMap</h3>
            <p>
              {data.sentToPlaceFacts.source}: {data.sentToPlaceFacts.sent} (
              {data.sentToPlaceFacts.places} places in the latest search.)
            </p>
          </>
        ) : null}
        <h3>Kept on this server only</h3>
        <ul>
          {data.keptLocal.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="panel" aria-labelledby="ev-choices">
        <h2 id="ev-choices">How each name and phrase was matched</h2>
        {data.choices.length === 0 ? (
          <p className="muted-text">No names or phrases were matched in this case.</p>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Matching decisions">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">You entered</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Matched to</th>
                  <th scope="col">How</th>
                </tr>
              </thead>
              <tbody>
                {data.choices.map((choice) => (
                  <tr key={`${choice.kind}-${choice.input}`}>
                    <td>{choice.input}</td>
                    <td>{choice.kind.replace('_', ' ')}</td>
                    <td>{choice.status.replace('_', ' ')}</td>
                    <td>
                      {choice.selected?.name ?? 'Nothing'}
                      {choice.alsoUsed.length > 0 ? (
                        <div className="small muted-text">
                          {choice.alsoUsed.length + 1} Qloo tags share this name and are used
                          together.
                        </div>
                      ) : null}
                      {choice.alternativesConsidered.length > 0 ? (
                        <div className="small muted-text">
                          Also considered:{' '}
                          {choice.alternativesConsidered.map((a) => a.name).join(', ')}
                        </div>
                      ) : null}
                    </td>
                    <td>{choice.method ? choice.method.replace('_', ' ') : 'Not applicable'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="ev-calls">
        <h2 id="ev-calls">Requests made, with the credential removed</h2>
        <h3>Matching</h3>
        <CallsTable calls={data.calls.resolution} caption="Matching requests" />
        <h3 style={{ marginTop: '1.25rem' }}>Latest search</h3>
        <CallsTable calls={data.calls.latestSearch} caption="Latest search requests" />
      </section>

      <section className="panel" aria-labelledby="ev-result">
        <h2 id="ev-result">What came back</h2>
        {data.result ? (
          <>
            <p>
              Search {data.result.runId} returned {data.result.poolSize} places. Taste ranking:{' '}
              {data.result.tasteStatus}.{data.result.tasteNote ? ` ${data.result.tasteNote}` : ''}
            </p>
            {data.result.placeFacts ? (
              <p>
                OpenStreetMap was asked about {data.result.placeFacts.looked} places, matched{' '}
                {data.result.placeFacts.matched} by name and position, and filled in{' '}
                {data.result.placeFacts.filled} facts.
                {data.result.placeFacts.note ? ` ${data.result.placeFacts.note}` : ''}
              </p>
            ) : null}
            <div
              className="table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Shortlist with provider scores"
            >
              <table className="data" style={{ marginTop: '0.8rem' }}>
                <thead>
                  <tr>
                    <th scope="col">Shortlisted place</th>
                    <th scope="col" className="num">
                      Provider rank
                    </th>
                    <th scope="col" className="num">
                      Provider affinity
                    </th>
                    <th scope="col">Gate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.result.shortlist.map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td className="num">{row.providerRank ?? 'none'}</td>
                      <td className="num">
                        {row.providerAffinity === null
                          ? 'not returned'
                          : row.providerAffinity.toFixed(2)}
                      </td>
                      <td>{row.feasibility.replace('_', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="muted-text">No search has completed yet.</p>
        )}
        <p className="small muted-text" style={{ marginTop: '0.8rem' }}>
          {data.note} Generated {formatStamp(data.generatedAt)}.
        </p>
      </section>
    </div>
  );
}
