const isoRegex = /^([^T]*)T([^Z]*)Z$/;

export function prettyDate(isoString: string): string {
  const [, dateString, timeString] = isoString.match(isoRegex) ?? [];
  if (!dateString || !timeString) {
    return 'unknown date';
  }
  return `${dateString} ${timeString.replace(/\.000$/, '')} UTC`;
}
