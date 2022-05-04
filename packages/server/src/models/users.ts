import { Schema, model, HydratedDocument } from 'mongoose';

import { TimeFields } from '../helpers/mongo';

interface UserFields {
  telegramFromId: number;
  telegramUsername: string;
  telegramChatId: number;
  watchReboot: boolean;
  watchNewBlocks: boolean;
}

const schema = new Schema<UserFields & TimeFields>({
  telegramFromId: { type: Number, required: true, unique: true },
  telegramUsername: { type: String, required: true },
  telegramChatId: { type: Number, required: true },
  watchReboot: { type: Boolean, required: true, index: true },
  watchNewBlocks: { type: Boolean, required: true, index: true },
}, { timestamps: true });

schema.index({ createdAt: 1 });

export const defaultUserProperties: Omit<
  UserFields, 'telegramFromId' | 'telegramUsername' | 'telegramChatId'
> = {
  watchReboot: true,
  watchNewBlocks: false,
};

export const UsersModel = model('users', schema);

export type UserDocument = HydratedDocument<UserFields & TimeFields>;
