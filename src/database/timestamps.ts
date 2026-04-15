// Mac Absolute Time epoch: 2001-01-01 00:00:00 UTC
// Offset from Unix epoch (1970-01-01) in seconds
export const MAC_EPOCH_OFFSET = 978307200;

// Notes timestamps are in seconds since 2001-01-01
export function macTimeToDate(macTime: number | null): Date {
  if (macTime == null) return new Date(0);
  return new Date((macTime + MAC_EPOCH_OFFSET) * 1000);
}

export function dateToMacTime(date: Date): number {
  return date.getTime() / 1000 - MAC_EPOCH_OFFSET;
}

// Messages timestamps are in nanoseconds since 2001-01-01
export function macNanosToDate(nanos: number | null): Date {
  if (nanos == null || nanos === 0) return new Date(0);
  return new Date((nanos / 1e9 + MAC_EPOCH_OFFSET) * 1000);
}

export function dateToMacNanos(date: Date): number {
  return (date.getTime() / 1000 - MAC_EPOCH_OFFSET) * 1e9;
}
