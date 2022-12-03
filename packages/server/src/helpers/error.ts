export function errorString(error: unknown): string {
  try {
    if (error instanceof Error) {
      return error.stack ?? `${error}`;
    }
    return `${error}`;
  } catch (_error) {
    return 'Failed to convert error to string';
  }
}
