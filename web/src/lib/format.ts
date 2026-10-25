const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Formats an ISO time using its own clock values, so the offset does not shift the display. */
export function formatPlanTime(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/u.exec(iso);
  if (!match) return iso;
  const [, y, m, d, hh, mm] = match as unknown as [string, string, string, string, string, string];
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return `${WEEKDAYS[date.getUTCDay()]} ${Number(d)} ${MONTHS[Number(m) - 1]}, ${hh}:${mm}`;
}

export function formatClock(minuteOfDay: number): string {
  const normal = ((minuteOfDay % 1440) + 1440) % 1440;
  const hh = String(Math.floor(normal / 60)).padStart(2, '0');
  const mm = String(normal % 60).padStart(2, '0');
  return `${hh}:${mm}${minuteOfDay >= 1440 ? ' next day' : ''}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : `${hours} h ${rest} min`;
}

export function formatAffinity(value: number | null | undefined): string {
  return value === null || value === undefined ? 'not returned' : value.toFixed(2);
}

export function formatKm(km: number | null): string {
  return km === null ? 'distance unknown' : `${km.toFixed(1)} km`;
}

export function priceText(level: number): string {
  return `${level} of 4`;
}

export function formatStamp(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/u.exec(iso);
  if (!match) return iso;
  const [, , m, d, hh, mm] = match as unknown as [string, string, string, string, string, string];
  return `${Number(d)} ${MONTHS[Number(m) - 1]}, ${hh}:${mm} UTC`;
}

export function toOffsetIso(localValue: string): string {
  const date = new Date(localValue);
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  const base = localValue.length === 16 ? `${localValue}:00` : localValue;
  return `${base}${sign}${hh}:${mm}`;
}

export function toLocalInput(iso: string): string {
  return iso.slice(0, 16);
}

const ENTRY_KINDS: Record<string, string> = {
  'urn:entity:artist': 'Artist',
  'urn:entity:person': 'Person',
  'urn:entity:album': 'Album',
  'urn:entity:author': 'Author',
  'urn:entity:book': 'Book',
  'urn:entity:movie': 'Film',
  'urn:entity:tv_show': 'Television show',
  'urn:entity:podcast': 'Podcast',
  'urn:entity:videogame': 'Video game',
  'urn:entity:brand': 'Brand',
  'urn:entity:destination': 'Destination',
  'urn:entity:place': 'Place',
};

/** Turns a Qloo type such as urn:entity:artist into words a person can read. */
export function entryKind(type: string | undefined): string | undefined {
  if (!type) return undefined;
  const known = ENTRY_KINDS[type];
  if (known) return known;
  const last = type.split(':').pop() ?? '';
  const words = last.replace(/_/gu, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : undefined;
}

export interface ChoiceCandidate {
  id: string;
  name: string;
  type?: string | undefined;
  description?: string | undefined;
}

export interface GroupedChoice {
  id: string;
  name: string;
  kinds: string[];
  description: string | undefined;
}

/**
 * Qloo can list one entity under two types with the same identifier, as it does for a band that is
 * also listed as a person. Choosing either is the same choice, so they are shown as one entry that
 * names both types. Entries with different identifiers stay separate.
 */
export function groupChoices(candidates: readonly ChoiceCandidate[]): GroupedChoice[] {
  const groups = new Map<string, GroupedChoice>();
  for (const candidate of candidates) {
    const kind = entryKind(candidate.type);
    const existing = groups.get(candidate.id);
    if (!existing) {
      groups.set(candidate.id, {
        id: candidate.id,
        name: candidate.name,
        kinds: kind ? [kind] : [],
        description: candidate.description,
      });
      continue;
    }
    if (kind && !existing.kinds.includes(kind)) existing.kinds.push(kind);
    existing.description ??= candidate.description;
  }
  return [...groups.values()];
}
