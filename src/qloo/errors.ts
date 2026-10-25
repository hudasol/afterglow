export type QlooErrorCode =
  | 'QLOO_NOT_CONFIGURED'
  | 'QLOO_AUTH'
  | 'QLOO_RATE_LIMIT'
  | 'QLOO_UPSTREAM'
  | 'QLOO_TIMEOUT'
  | 'QLOO_NETWORK'
  | 'QLOO_BAD_REQUEST'
  | 'QLOO_NOT_FOUND'
  | 'QLOO_BAD_RESPONSE'
  | 'QLOO_BUDGET_EXHAUSTED';

export class QlooError extends Error {
  readonly code: QlooErrorCode;
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(
    code: QlooErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'QlooError';
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}
