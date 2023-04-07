import { Types } from 'mongoose';

export const isSafeNonNegativeInteger = (
  value: unknown,
): value is number => (typeof value === 'number') && Number.isSafeInteger(value) && (value >= 0);

export const isShortString = (
  value: unknown,
): value is string => (typeof value === 'string') && (value.length < 100);

export const isValidObjectIdString = (
  value: unknown,
): value is string => (typeof value === 'string') && Types.ObjectId.isValid(value);

export const isTransactionId = (
  value: string,
) => (value.length === 64) && /^[0-9a-f]{64}$/.test(value);

export function mergeDescriptionToTransactionId(args: string[]): string[] {
  const result: string[] = [];
  let lastArg: string | undefined;
  for (const arg of args) {
    if (lastArg === undefined) {
      lastArg = arg;
      continue;
    }
    if (isTransactionId(arg) && lastArg.endsWith(':')) {
      result.push(`${lastArg}${arg}`);
      lastArg = undefined;
      continue;
    }
    result.push(lastArg);
    lastArg = arg;
  }
  if (lastArg !== undefined) {
    result.push(lastArg);
  }
  return result;
}
