import logger from './helpers/logger';
import { zeroObjectId } from './helpers/mongo';
import { SettingsModel } from './models/settings';
import { UsersModel } from './models/users';

async function migrateV0(): Promise<void> {
  logger.info('migrateV0: started');
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
  logger.info('migrateV0: finished');
}

export async function migrate(): Promise<void> {
  logger.info('migrate: started');
  const settings = await SettingsModel.findById(zeroObjectId);
  if (!settings) {
    throw new Error('Failed to find settings');
  }
  if (settings.migrationVersion < 1) {
    await migrateV0();
    await SettingsModel.updateOne(
      { _id: zeroObjectId },
      {
        $set: {
          migrationVersion: 1,
        },
      },
    );
  }
  logger.info('migrate: finished');
}
