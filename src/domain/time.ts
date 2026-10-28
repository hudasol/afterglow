/**
 * Plan times are ISO strings with an explicit offset. Opening windows are compared in the
 * local clock of that offset, so a plan at 19:30 +02:00 is compared as 19:30.
 */
const OFFSET_PATTERN = /(Z|[+-]\d{2}:\d{2})$/u;

export function offsetMinutes(iso: string): number {
  const match = OFFSET_PATTERN.exec(iso);
  const value = match?.[1];
  if (!value || value === 'Z') return 0;
  const sign = value.startsWith('-') ? -1 : 1;
  const hours = Number(value.slice(1, 3));
  const minutes = Number(value.slice(4, 6));
  return sign * (hours * 60 + minutes);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatOffset(minutes: number): string {
  if (minutes === 0) return 'Z';
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Adds minutes to an ISO time and keeps the original offset. */
export function shiftIso(iso: string, minutes: number): string {
  const offset = offsetMinutes(iso);
  const shifted = new Date(new Date(iso).getTime() + minutes * 60_000 + offset * 60_000);
  const text =
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
  return `${text}${formatOffset(offset)}`;
}

/** Minutes since local midnight for the given ISO time. */
export function localMinuteOfDay(iso: string): number {
  const offset = offsetMinutes(iso);
  const local = new Date(new Date(iso).getTime() + offset * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** Local calendar day number, used to detect a plan that runs across midnight. */
export function localDayNumber(iso: string): number {
  const offset = offsetMinutes(iso);
  return Math.floor((new Date(iso).getTime() + offset * 60_000) / 86_400_000);
}

export function formatMinuteOfDay(minute: number): string {
  const normalised = ((minute % 1440) + 1440) % 1440;
  return `${pad(Math.floor(normalised / 60))}:${pad(normalised % 60)}`;
}

/** Local day of the week for the given ISO time, 0 for Sunday through 6 for Saturday. */
export function localWeekday(iso: string): number {
  const offset = offsetMinutes(iso);
  return new Date(new Date(iso).getTime() + offset * 60_000).getUTCDay();
}

/** Offset of an IANA time zone from UTC at an instant, in minutes. DST is taken into account. */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(at);
  const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /^GMT([+-])(\d{2}):(\d{2})$/u.exec(name);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * The next time the given weekday (0 for Sunday) comes round at hour:minute on the clock of a
 * time zone, as an ISO time with that zone's offset on that day. Today never counts, so the
 * result is always at least a day away.
 */
export function nextLocalOccurrence(
  now: Date,
  timeZone: string,
  weekday: number,
  hour: number,
  minute: number,
): string {
  const localNow = new Date(now.getTime() + zoneOffsetMinutes(timeZone, now) * 60_000);
  let ahead = (weekday - localNow.getUTCDay() + 7) % 7;
  if (ahead === 0) ahead = 7;
  const day = new Date(
    Date.UTC(
      localNow.getUTCFullYear(),
      localNow.getUTCMonth(),
      localNow.getUTCDate() + ahead,
      hour,
      minute,
    ),
  );
  // The offset can differ between now and that day, so it is read at the day itself.
  let offset = zoneOffsetMinutes(
    timeZone,
    new Date(day.getTime() - zoneOffsetMinutes(timeZone, now) * 60_000),
  );
  offset = zoneOffsetMinutes(timeZone, new Date(day.getTime() - offset * 60_000));
  return `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}T${pad(hour)}:${pad(minute)}:00${formatOffset(offset)}`;
}
