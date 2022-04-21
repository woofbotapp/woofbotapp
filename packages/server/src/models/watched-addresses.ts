import {
  Schema, model, ObjectId, Types,
} from 'mongoose';

import { TimeFields } from '../helpers/mongo';

interface WatchedAddressFields {
  userId: ObjectId;
  address: string;
  nickname?: string;
}

const schema = new Schema<WatchedAddressFields & TimeFields>({
  userId: { type: Types.ObjectId, required: true, ref: 'users' },
  address: { type: String, required: true, index: true },
  nickname: { type: String, required: false },
}, { timestamps: true });

export const WatchedAddressesModel = model('watched_addresses', schema);
