import { PermissionKey } from '@woofbot/common';

import logger from './helpers/logger';
import { zeroObjectId } from './helpers/mongo';
import { SettingsModel } from './models/settings';
import { UsersModel } from './models/users';

async function migrateV0(): Promise<void> {
  await UsersModel.updateMany(
    {
      watchMempoolClear: {
        $exists: false,
      },
    },
    {
      $set: {
        watchMempoolClear: false,
      },
    },
  );
}

async function migrateV1(): Promise<void> {
  await SettingsModel.updateOne(
    {
      _id: zeroObjectId,
    },
    {
      $set: {
        mempoolUrlPrefix: 'https://mempool.space',
      },
    },
  );
}

async function migrateV2(): Promise<void> {
  await UsersModel.updateMany(
    {
      permissionGroups: {
        $exists: false,
      },
    },
    {
      $set: {
        permissionGroups: [],
      },
    },
  );
}

async function migrateV3(): Promise<void> {
  await SettingsModel.updateOne(
    {
      commandsPermissionGroups: {
        $exists: false,
      },
    },
    {
      $set: {
        commandsPermissionGroups: {},
      },
    },
  );
}

async function migrateV4(): Promise<void> {
  await UsersModel.updateMany(
    {
      watchLightningChannelsOpened: {
        $exists: false,
      },
    },
    {
      $set: {
        watchLightningChannelsOpened: false,
      },
    },
  );
  await UsersModel.updateMany(
    {
      watchLightningChannelsClosed: {
        $exists: false,
      },
    },
    {
      $set: {
        watchLightningChannelsClosed: false,
      },
    },
  );
}

async function migrateV5(): Promise<void> {
  await SettingsModel.updateOne(
    {
      _id: zeroObjectId,
    },
    {
      $set: {
        [`commandsPermissionGroups.${PermissionKey.WatchLightningChannelsOpened}`]: [],
        [`commandsPermissionGroups.${PermissionKey.WatchLightningChannelsClosed}`]: [],
      },
    },
  );
}

async function migrateV6(): Promise<void> {
  await UsersModel.updateMany(
    {
      watchMempoolClear: {
        $exists: false,
      },
    },
    {
      $set: {
        watchMempoolClear: false,
      },
    },
  );
}

async function migrateV7(): Promise<void> {
  await UsersModel.updateMany(
    {
      watchLightningForwards: {
        $exists: false,
      },
    },
    {
      $set: {
        watchLightningForwards: false,
      },
    },
  );
  await SettingsModel.updateOne(
    {
      _id: zeroObjectId,
    },
    {
      $set: {
        [`commandsPermissionGroups.${PermissionKey.WatchLightningForwards}`]: [],
      },
    },
  );
}

const migrations = [
  migrateV0, migrateV1, migrateV2, migrateV3, migrateV4, migrateV5, migrateV6, migrateV7,
];

export const migrationsLength = migrations.length;

export async function migrate(): Promise<void> {
  logger.info('migrate: started');
  const settings = await SettingsModel.findById(zeroObjectId);
  if (!settings) {
    throw new Error('Failed to find settings');
  }
  for (
    let { migrationVersion } = settings;
    migrationVersion < migrationsLength;
    migrationVersion += 1
  ) {
    const migration = migrations[migrationVersion];
    logger.info(`${migration.name}: started`);
    // eslint-disable-next-line no-await-in-loop
    await migration();
    logger.info(`${migration.name}: finished`);
    // eslint-disable-next-line no-await-in-loop
    await SettingsModel.updateOne(
      { _id: zeroObjectId },
      {
        $set: {
          migrationVersion: migrationVersion + 1,
        },
      },
    );
  }
  logger.info('migrate: finished');
}
