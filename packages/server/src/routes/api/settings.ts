import Router from 'express';

import { asyncHandler } from '../../helpers/express';
import { SettingsModel } from '../../models/settings';
import { bitcoindWatcher } from '../../helpers/bitcoind-watcher';
import { isSafeNonNegativeInteger, isShortString } from '../../helpers/validations';
import telegramManager from '../../helpers/telegram';
import { zeroObjectId } from '../../helpers/mongo';
import { UsersModel } from '../../models/users';

const apiSettingsRouter = Router();

apiSettingsRouter.get('/general', asyncHandler(async (req, res) => {
  const settings = await SettingsModel.findById(zeroObjectId);
  if (!settings) {
    throw new Error('Could not find settings document');
  }
  res.json({
    maxUsers: settings.maxUsers,
    usersWhitelist: settings.usersWhitelist,
    bestBlockHeight: settings.bestBlockHeight,
    bestBlockId: settings.analyzedBlockHashes.slice(-1)[0] ?? '',
    bitcoindWatcherTasks: bitcoindWatcher.countTasks(),
    mempoolWeight: bitcoindWatcher.getMempoolWeight(),
  });
}));

apiSettingsRouter.post('/general', asyncHandler(async (req, res) => {
  // No patches - just replace all.
  const { maxUsers, usersWhitelist } = req.body ?? {};
  if (maxUsers !== undefined) {
    if (usersWhitelist !== undefined) {
      res.status(400).json({
        error: 'Only one of usersWhitelist, maxUsers should be defined.',
      });
      return;
    }
    if (!isSafeNonNegativeInteger(maxUsers)) {
      res.status(400).json({
        error: 'maxUsers should be a safe non-negative integer.',
      });
      return;
    }
  } else if (usersWhitelist !== undefined) {
    if (!Array.isArray(usersWhitelist) || (usersWhitelist.length > 100)
      || (new Set(usersWhitelist).size !== usersWhitelist.length)
      || usersWhitelist.some((
        user: string,
      ) => (typeof user !== 'string') || (user.length === 0) || (user.length > 100))
    ) {
      res.status(400).json({
        error: 'Invalid usersWhitelist, must be an array of strings up to 100 elements.',
      });
      return;
    }
  } else {
    res.status(400).json({
      error: 'At least one of usersWhitelist, maxUsers should be defined.',
    });
    return;
  }
  await SettingsModel.updateOne(
    { _id: zeroObjectId },
    {
      $set: {
        ...(maxUsers !== undefined) && { maxUsers },
        ...(usersWhitelist !== undefined) && { usersWhitelist },
      },
      $unset: {
        ...(maxUsers === undefined) && { maxUsers: 1 },
        ...(usersWhitelist === undefined) && { usersWhitelist: 1 },
      },
    },
  );
  res.json({
    ok: true,
  });
}));

apiSettingsRouter.get('/telegram', asyncHandler(async (req, res) => {
  const numberOfUsers = await UsersModel.countDocuments({});
  const botInfo = telegramManager.bot?.botInfo;
  res.json({
    status: telegramManager.status,
    numberOfUsers,
    botUsername: botInfo?.username,
    botName: [
      botInfo?.first_name, botInfo?.last_name,
    ].filter((value) => typeof value === 'string').join(' '),
  });
}));

let telegramPostLock = false;

apiSettingsRouter.post('/telegram', asyncHandler(async (req, res) => {
  if (telegramPostLock) {
    res.status(409).json({
      error: 'Concurrency attempts to change the telegram settings',
    });
    return;
  }
  telegramPostLock = true;
  try {
    // No patches - just replace all.
    const { token } = req.body ?? {};
    if (
      (token !== undefined) && !isShortString(token)
    ) {
      res.status(400).json({
        error: 'Invalid body',
      });
      return;
    }

    const settings = await SettingsModel.findById(zeroObjectId);
    if (!settings) {
      throw new Error('Could not load settings');
    }
    const isNewBot = (
      ((settings.telegramToken ?? '').split(':')[0] !== token.split(':')[0])
    );
    if (isNewBot && await UsersModel.findOne({}, {})) {
      if (await UsersModel.findOne({})) {
        res.status(409).json({
          error: token
            ? `Please remove all existing users before changing the Telegram token to a
            different bot.`
            : 'Please remove all existing users before unsetting the Telegram token.',
        });
        return;
      }
    }

    await telegramManager.optimisticStopBot();
    if (isNewBot) {
      telegramManager.clearMessageQueue();
    }

    if (isNewBot && await UsersModel.findOne({}, {})) {
      // crazy race condition
      res.status(409).json({
        error: 'Race condition: users where created while stopping old bot.',
      });
      return;
    }

    await SettingsModel.updateOne(
      { _id: zeroObjectId },
      token
        ? {
          $set: {
            telegramToken: token,
          },
        }
        : {
          $unset: {
            telegramToken: 1,
          },
        },
    );
    if (token) {
      await telegramManager.startBot(token);
    }
    res.json({
      ok: true,
    });
  } finally {
    telegramPostLock = false;
  }
}));

export default apiSettingsRouter;
