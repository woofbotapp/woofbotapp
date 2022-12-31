import { Schema, model } from 'mongoose';

import { TimeFields } from '../helpers/mongo';

interface SettingsFields {
  migrationVersion: number;
  adminPasswordHash?: string;
  telegramToken?: string;
  maxUsers?: number;
  bestBlockHeight: number;
  analyzedBlockHashes: string[];
}

const schema = new Schema<SettingsFields & TimeFields>({
  migrationVersion: { type: Number, required: true },
  adminPasswordHash: { type: String, required: false },
  telegramToken: { type: String, required: false },
  maxUsers: { type: Number, required: false },
  bestBlockHeight: { type: Number, required: true },
  analyzedBlockHashes: { type: [String], required: false },
}, { timestamps: true });

export const defaultSettings: SettingsFields = {
  migrationVersion: 1,
  maxUsers: 10,
  bestBlockHeight: 0,
  analyzedBlockHashes: [],
};

export const SettingsModel = model('settings', schema);
