import { Types } from 'mongoose';

export interface TimeFields {
  createdAt: Date;
  updatedAt: Date;
}

export const zeroObjectId = new Types.ObjectId('000000000000000000000000');
