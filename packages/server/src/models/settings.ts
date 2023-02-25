import { BotCommandName, telegramCommands } from '@woofbot/common';
import { Schema, model } from 'mongoose';

import { TimeFields } from '../helpers/mongo';

type CommandsPermissionGroupsMap = Partial<Record<BotCommandName, string[]>>;

export interface LndChannelInformation {
  channelId: string; // "id" may conflict with mongodb stuff
  lastActiveAt?: Date;
}

interface SettingsFields {
  migrationVersion: number;
  adminPasswordHash?: string;
  telegramToken?: string;
  maxUsers?: number;
  usersWhitelist?: string[];
  bestBlockHeight: number;
  analyzedBlockHashes: string[];
  mempoolUrlPrefix: string;
  commandsPermissionGroups: CommandsPermissionGroupsMap;
  lndChannels?: LndChannelInformation[];
  lndLastForwardAt?: Date;
  lndLastForwardCount?: number;
}

const commandsPermissionGroupsSchema = new Schema<CommandsPermissionGroupsMap>(
  Object.fromEntries(
    telegramCommands.filter(({ alwaysPermitted }) => !alwaysPermitted).map(
      ({ name }) => [
        name,
        { type: [String], required: false, default: undefined },
      ],
    ),
  ),
  { _id: false },
);

const lndChannelSchema = new Schema<LndChannelInformation>(
  {
    channelId: { type: String, required: true },
    lastActiveAt: { type: Date, required: false },
  },
  {
    _id: false,
  },
);

const schema = new Schema<SettingsFields & TimeFields>({
  migrationVersion: { type: Number, required: true },
  adminPasswordHash: { type: String, required: false },
  telegramToken: { type: String, required: false },
  maxUsers: { type: Number, required: false },
  usersWhitelist: { type: [String], required: false, default: undefined },
  bestBlockHeight: { type: Number, required: true },
  analyzedBlockHashes: { type: [String], required: true },
  mempoolUrlPrefix: { type: String, required: true },
  commandsPermissionGroups: { type: commandsPermissionGroupsSchema, required: true },
  lndChannels: { type: [lndChannelSchema], required: false, default: undefined },
  lndLastForwardAt: { type: Date, required: false },
  lndLastForwardCount: { type: Number, required: false },
}, { timestamps: true });

export const defaultSettings: Omit<SettingsFields, 'migrationVersion'> = {
  maxUsers: 10,
  bestBlockHeight: 0,
  analyzedBlockHashes: [],
  mempoolUrlPrefix: 'https://mempool.space',
  commandsPermissionGroups: {
    // Commands that by default not allowed to anyone
    [BotCommandName.WatchLightningChannelsOpened]: [],
    [BotCommandName.WatchLightningChannelsClosed]: [],
    [BotCommandName.WatchLightningForwards]: [],
  },
};

export const SettingsModel = model('settings', schema);
