export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

export function statusForProviderCode(code: string): number {
  switch (code) {
    case 'QLOO_NOT_CONFIGURED':
      return 503;
    case 'QLOO_RATE_LIMIT':
    case 'QLOO_BUDGET_EXHAUSTED':
      return 429;
    default:
      return 502;
  }
}
