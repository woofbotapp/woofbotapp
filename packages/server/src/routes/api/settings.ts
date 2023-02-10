import { permissionGroupNameRegex, telegramCommands } from '@woofbot/common';
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
    mempoolUrlPrefix: settings.mempoolUrlPrefix,
  });
}));

apiSettingsRouter.post('/general', asyncHandler(async (req, res) => {
  // No patches - just replace all.
  const { maxUsers, usersWhitelist, mempoolUrlPrefix } = req.body ?? {};
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
  if (
    typeof mempoolUrlPrefix !== 'string'
    || mempoolUrlPrefix.length > 1000
    || !/^https?:\/\/\S+/.test(mempoolUrlPrefix)
  ) {
    res.status(400).json({
      error: 'Mempool url must begin with http:// or https:// and contain no spaces',
    });
    return;
  }
  await SettingsModel.updateOne(
    { _id: zeroObjectId },
    {
      $set: {
        ...(maxUsers !== undefined) && { maxUsers },
        ...(usersWhitelist !== undefined) && { usersWhitelist },
        mempoolUrlPrefix,
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

apiSettingsRouter.get('/commands-permission-groups', asyncHandler(async (req, res) => {
  const settings = await SettingsModel.findById(zeroObjectId);
  if (!settings) {
    throw new Error('Could not find settings document');
  }
  res.json(settings.commandsPermissionGroups);
}));

const permissionGroupsCommands = new Set<string>(
  telegramCommands.filter(({ alwaysPermitted }) => !alwaysPermitted).map(({ name }) => name),
);

apiSettingsRouter.post('/commands-permission-groups', asyncHandler(async (req, res) => {
  // No patches - just replace all.
  const { body } = req;
  if (
    !body || typeof body !== 'object' || Array.isArray(body)
    || Object.entries(body).some(([key, value]) => (
      !permissionGroupsCommands.has(key)
      || !Array.isArray(value)
      || value.length > 100
      || value.some((groupName) => (
        typeof groupName !== 'string' || !permissionGroupNameRegex.test(groupName)
      ))
    ))
  ) {
    res.status(400).json({
      error: 'Invalid body',
    });
    return;
  }
  await SettingsModel.updateOne(
    { _id: zeroObjectId },
    {
      $set: {
        commandsPermissionGroups: body,
      },
    },
  );
  res.json({
    ok: true,
  });
}));

export default apiSettingsRouter;
