const KEY = 'afterglow.session';
let memory: string | null = null;

function randomSession(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

/**
 * The session identifier is a random capability that scopes cases to this browser. Storage can
 * be unavailable, so a value kept in memory is the fallback and cases then last for the visit.
 */
export function getSession(): string {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored && /^[A-Za-z0-9_-]{22,64}$/u.test(stored)) return stored;
    const created = randomSession();
    window.localStorage.setItem(KEY, created);
    return created;
  } catch {
    memory ??= randomSession();
    return memory;
  }
}
