import { Schema, model } from 'mongoose';

import { TimeFields } from '../helpers/mongo';

interface SettingsFields {
  migrationVersion: number;
  adminPasswordHash?: string;
  telegramToken?: string;
  maxUsers?: number;
  usersWhitelist?: string[];
  bestBlockHeight: number;
  analyzedBlockHashes: string[];
  mempoolUrlPrefix: string;
}

const schema = new Schema<SettingsFields & TimeFields>({
  migrationVersion: { type: Number, required: true },
  adminPasswordHash: { type: String, required: false },
  telegramToken: { type: String, required: false },
  maxUsers: { type: Number, required: false },
  usersWhitelist: { type: [String], required: false, default: undefined },
  bestBlockHeight: { type: Number, required: true },
  analyzedBlockHashes: { type: [String], required: true },
  mempoolUrlPrefix: { type: String, required: true },
}, { timestamps: true });

export const defaultSettings: Omit<SettingsFields, 'migrationVersion'> = {
  maxUsers: 10,
  bestBlockHeight: 0,
  analyzedBlockHashes: [],
  mempoolUrlPrefix: 'https://mempool.space',
};

export const SettingsModel = model('settings', schema);
