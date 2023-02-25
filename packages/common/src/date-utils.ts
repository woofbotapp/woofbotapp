const isoRegex = /^([^T]*)T([^Z]*)Z$/;

export function prettyDate(isoString: string): string {
  const [, dateString, timeString] = isoString.match(isoRegex) ?? [];
  return `${dateString ?? 'unknown'} ${timeString ?? 'unknown'} UTC`;
}
