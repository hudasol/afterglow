import { createHash } from 'node:crypto';

/**
 * Cases are scoped to a session. Only a hash of the session token is stored, so a database dump
 * does not reveal a token that could be replayed.
 */
export function sessionKeyFromToken(token: string): string {
  return createHash('sha256').update(`afterglow-session:${token}`).digest('hex');
}
