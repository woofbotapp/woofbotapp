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
