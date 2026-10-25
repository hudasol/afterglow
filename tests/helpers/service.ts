import { RecoveryService } from '../../src/application/recovery-service.js';
import {
  ProviderError,
  type PoolRequest,
  type ProviderContext,
  type RankRequest,
  type RankResponse,
  type TasteProvider,
} from '../../src/application/ports.js';
import type { Candidate } from '../../src/domain/venue.js';
import type { ResolutionKind, TasteResolution } from '../../src/domain/case.js';
import { Database } from '../../src/infrastructure/database.js';
import { SqliteCaseRepository } from '../../src/infrastructure/sqlite-case-repository.js';
import { SimulatedTasteProvider } from '../../src/simulation/provider.js';

export function makeService(options: { live?: TasteProvider; demo?: TasteProvider } = {}) {
  const db = new Database(':memory:');
  db.migrate('migrations');
  const unconfiguredLive: TasteProvider = {
    descriptor: { mode: 'live', label: 'Qloo hackathon API', configured: false },
    async resolve(): Promise<TasteResolution> {
      throw new ProviderError('QLOO_NOT_CONFIGURED', 'No key');
    },
    async fetchPool(): Promise<Candidate[]> {
      throw new ProviderError('QLOO_NOT_CONFIGURED', 'No key');
    },
    async rank(): Promise<RankResponse> {
      throw new ProviderError('QLOO_NOT_CONFIGURED', 'No key');
    },
  };
  let counter = 0;
  const service = new RecoveryService({
    repo: new SqliteCaseRepository(db),
    providers: {
      demo: options.demo ?? new SimulatedTasteProvider(),
      live: options.live ?? unconfiguredLive,
    },
    caseTtlHours: 48,
    clock: () => new Date('2026-10-24T10:00:00Z'),
    newCaseId: () => `case-${(counter += 1)}`,
  });
  return { service, db };
}

/** A demo provider whose individual operations can be made to fail. */
export class FlakyProvider implements TasteProvider {
  readonly inner = new SimulatedTasteProvider();
  readonly descriptor = this.inner.descriptor;
  failPool = false;
  failRank = false;
  calls = { resolve: 0, fetchPool: 0, rank: 0 };
  lastRank: RankRequest | null = null;

  resolve(kind: ResolutionKind, input: string, ctx: ProviderContext) {
    this.calls.resolve += 1;
    return this.inner.resolve(kind, input, ctx);
  }

  async fetchPool(request: PoolRequest, ctx: ProviderContext) {
    this.calls.fetchPool += 1;
    if (this.failPool) throw new ProviderError('QLOO_UPSTREAM', 'Pool unavailable', true);
    return this.inner.fetchPool(request, ctx);
  }

  async rank(request: RankRequest, ctx: ProviderContext) {
    this.calls.rank += 1;
    this.lastRank = request;
    if (this.failRank) throw new ProviderError('QLOO_RATE_LIMIT', 'Rate limited', true);
    return this.inner.rank(request, ctx);
  }
}
