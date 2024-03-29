import { Schema, model, HydratedDocument } from 'mongoose';

import { TimeFields } from '../helpers/mongo';

export interface UserFields {
  telegramFromId: number;
  telegramUsername: string;
  telegramChatId: number;
  watchReboot: boolean;
  watchNewBlocks: boolean;
  watchPriceChange?: number;
  watchMempoolClear: boolean;
  watchLightningChannelsOpened: boolean;
  watchLightningChannelsClosed: boolean;
  watchLightningForwards: boolean;
  watchLightningInvoicesCreated: boolean;
  watchLightningInvoicesPaid: boolean;
  permissionGroups: string[];
}

const schema = new Schema<UserFields & TimeFields>({
  telegramFromId: { type: Number, required: true, unique: true },
  telegramUsername: { type: String, required: true },
  telegramChatId: { type: Number, required: true },
  watchReboot: { type: Boolean, required: true, index: true },
  watchNewBlocks: { type: Boolean, required: true, index: true },
  watchPriceChange: { type: Number, required: false, index: true },
  watchMempoolClear: { type: Boolean, required: true, index: true },
  watchLightningChannelsOpened: { type: Boolean, required: true, index: true },
  watchLightningChannelsClosed: { type: Boolean, required: true, index: true },
  watchLightningForwards: { type: Boolean, required: true, index: true },
  watchLightningInvoicesCreated: { type: Boolean, required: true, index: true },
  watchLightningInvoicesPaid: { type: Boolean, required: true, index: true },
  permissionGroups: { type: [String], required: true, index: true },
}, { timestamps: true });

schema.index({ createdAt: 1 });

export const defaultUserProperties: Omit<
  UserFields, 'telegramFromId' | 'telegramUsername' | 'telegramChatId'
> = {
  watchReboot: false,
  watchNewBlocks: false,
  watchMempoolClear: false,
  watchLightningChannelsOpened: false,
  watchLightningChannelsClosed: false,
  watchLightningForwards: false,
  watchLightningInvoicesCreated: false,
  watchLightningInvoicesPaid: false,
  permissionGroups: [],
};

export const UsersModel = model('users', schema);

export type UserDocument = HydratedDocument<UserFields & TimeFields>;
