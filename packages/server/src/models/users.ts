import { Schema, model, HydratedDocument } from 'mongoose';

import { TimeFields } from '../helpers/mongo';

interface UserFields {
  telegramFromId: number;
  telegramUsername: string;
  telegramChatId: number;
  watchReboot: boolean;
}

const schema = new Schema<UserFields & TimeFields>({
  telegramFromId: { type: Number, required: true, unique: true },
  telegramUsername: { type: String, required: true },
  telegramChatId: { type: Number, required: true },
  watchReboot: { type: Boolean, required: true, index: true },
}, { timestamps: true });

export const defaultUserProperties: Omit<
  UserFields, 'telegramFromId' | 'telegramUsername' | 'telegramChatId'
> = {
  watchReboot: true,
};

export const UsersModel = model('users', schema);

export type UserDocument = HydratedDocument<UserFields & TimeFields>;
