export function errorString(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error}`;
  }
  return `${error}`;
}
