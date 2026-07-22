import { AppVersion, PermissionKey, permissionGroupNameRegex } from '@woofbot/common';
import { Router } from 'express';
import { Types } from 'mongoose';
import { validate as validateBitcoinAddress } from 'bitcoin-address-validation';

import { asyncHandler } from '../../helpers/express';
import {
  bitcoindWatcher, BitcoindWatcherEventName, TransactionAnalysis,
} from '../../helpers/bitcoind-watcher';
import { errorString } from '../../helpers/error';
import logger from '../../helpers/logger';
import { priceWatcher } from '../../helpers/price-watcher';
import telegramManager from '../../helpers/telegram';
import { zeroObjectId } from '../../helpers/mongo';
import {
  isSafeNonNegativeInteger, isShortString, isTransactionId,
} from '../../helpers/validations';
import { SettingsModel } from '../../models/settings';
import { UsersModel } from '../../models/users';
import { WatchedAddressesModel } from '../../models/watched-addresses';
import { TransactionStatus, WatchedTransactionsModel } from '../../models/watched-transactions';

export const configurationFormat = 'woofbot-configuration';
export const configurationFormatVersion = 1;

const transactionAnalysisTimeoutMs = 300_000;
const maxImportedUsers = 10_000;
const maxWatchesPerUser = 1_000;

const permissionKeys = new Set<string>(Object.values(PermissionKey));

const userBooleanFields = [
  'watchReboot',
  'watchNewBlocks',
  'watchMempoolClear',
  'watchLightningChannelsOpened',
  'watchLightningChannelsClosed',
  'watchLightningForwards',
  'watchLightningInvoicesCreated',
  'watchLightningInvoicesPaid',
] as const;

interface ConfigurationWatchedAddress {
  address: string;
  nickname?: string;
}

interface ConfigurationWatchedTransaction {
  txid: string;
  nickname?: string;
}

interface ConfigurationUser extends Record<typeof userBooleanFields[number], boolean> {
  telegramFromId: number;
  telegramUsername: string;
  telegramChatId: number;
  watchPriceChange?: number;
  permissionGroups: string[];
  watchedAddresses: ConfigurationWatchedAddress[];
  watchedTransactions: ConfigurationWatchedTransaction[];
}

interface ConfigurationSettings {
  telegramToken?: string;
  maxUsers?: number;
  usersWhitelist?: string[];
  mempoolUrlPrefix: string;
  commandsPermissionGroups: Partial<Record<PermissionKey, string[]>>;
}

interface ConfigurationFile {
  format: typeof configurationFormat;
  formatVersion: typeof configurationFormatVersion;
  settings: ConfigurationSettings;
  users: ConfigurationUser[];
}

const apiConfigurationRouter = Router();

apiConfigurationRouter.get('/', asyncHandler(async (req, res) => {
  const settings = await SettingsModel.findById(zeroObjectId);
  if (!settings) {
    throw new Error('Could not find settings document');
  }
  const users = await UsersModel.find({}).sort({ createdAt: 1, _id: 1 });
  const watchedAddresses = await WatchedAddressesModel.find({});
  const watchedTransactions = await WatchedTransactionsModel.find({});
  const addressesByUserId = new Map<string, ConfigurationWatchedAddress[]>();
  for (const doc of watchedAddresses) {
    const userId = doc.userId.toString();
    addressesByUserId.set(userId, [
      ...addressesByUserId.get(userId) ?? [],
      {
        address: doc.address,
        ...(doc.nickname !== undefined) && { nickname: doc.nickname },
      },
    ]);
  }
  const transactionsByUserId = new Map<string, ConfigurationWatchedTransaction[]>();
  for (const doc of watchedTransactions) {
    const userId = doc.userId.toString();
    transactionsByUserId.set(userId, [
      ...transactionsByUserId.get(userId) ?? [],
      {
        txid: doc.txid,
        ...(doc.nickname !== undefined) && { nickname: doc.nickname },
      },
    ]);
  }
  res.json({
    format: configurationFormat,
    formatVersion: configurationFormatVersion,
    appVersion: AppVersion,
    exportedAt: new Date().toISOString(),
    settings: {
      ...(settings.telegramToken !== undefined) && { telegramToken: settings.telegramToken },
      ...(settings.maxUsers !== undefined) && { maxUsers: settings.maxUsers },
      ...(settings.usersWhitelist !== undefined) && { usersWhitelist: settings.usersWhitelist },
      mempoolUrlPrefix: settings.mempoolUrlPrefix,
      commandsPermissionGroups: settings.commandsPermissionGroups,
    },
    users: users.map((user) => ({
      telegramFromId: user.telegramFromId,
      telegramUsername: user.telegramUsername,
      telegramChatId: user.telegramChatId,
      ...Object.fromEntries(userBooleanFields.map((field) => [field, user[field]])),
      ...(user.watchPriceChange !== undefined) && { watchPriceChange: user.watchPriceChange },
      permissionGroups: user.permissionGroups,
      watchedAddresses: addressesByUserId.get(user.id) ?? [],
      watchedTransactions: transactionsByUserId.get(user.id) ?? [],
    })),
  });
}));

function validateConfigurationSettings(settings: unknown): string | undefined {
  if (!settings || (typeof settings !== 'object') || Array.isArray(settings)) {
    return 'The "settings" field must be an object.';
  }
  const {
    telegramToken, maxUsers, usersWhitelist, mempoolUrlPrefix, commandsPermissionGroups,
  } = settings as Record<string, unknown>;
  if ((telegramToken !== undefined) && (!isShortString(telegramToken) || !telegramToken)) {
    return 'Invalid telegramToken.';
  }
  if (maxUsers !== undefined) {
    if (usersWhitelist !== undefined) {
      return 'Only one of usersWhitelist, maxUsers should be defined.';
    }
    if (!isSafeNonNegativeInteger(maxUsers)) {
      return 'maxUsers should be a safe non-negative integer.';
    }
  } else if (usersWhitelist !== undefined) {
    if (!Array.isArray(usersWhitelist) || (usersWhitelist.length > 100)
      || (new Set(usersWhitelist).size !== usersWhitelist.length)
      || usersWhitelist.some((
        user,
      ) => (typeof user !== 'string') || (user.length === 0) || (user.length > 100))
    ) {
      return 'Invalid usersWhitelist, must be an array of strings up to 100 elements.';
    }
  } else {
    return 'At least one of usersWhitelist, maxUsers should be defined.';
  }
  if (
    (typeof mempoolUrlPrefix !== 'string')
    || (mempoolUrlPrefix.length > 1000)
    || !/^https?:\/\/\S+/.test(mempoolUrlPrefix)
  ) {
    return 'Mempool url must begin with http:// or https:// and contain no spaces.';
  }
  if (
    !commandsPermissionGroups || (typeof commandsPermissionGroups !== 'object')
    || Array.isArray(commandsPermissionGroups)
    || Object.entries(commandsPermissionGroups).some(([key, value]) => (
      !permissionKeys.has(key)
      || !Array.isArray(value)
      || (value.length > 100)
      || value.some((groupName) => (
        (typeof groupName !== 'string') || !permissionGroupNameRegex.test(groupName)
      ))
    ))
  ) {
    return 'Invalid commandsPermissionGroups.';
  }
  return undefined;
}

function validateConfigurationUser(user: unknown, userIndex: number): string | undefined {
  const errorPrefix = `Invalid user at index ${userIndex}:`;
  if (!user || (typeof user !== 'object') || Array.isArray(user)) {
    return `${errorPrefix} must be an object.`;
  }
  const {
    telegramFromId, telegramUsername, telegramChatId, watchPriceChange, permissionGroups,
    watchedAddresses, watchedTransactions,
  } = user as Record<string, unknown>;
  if (!Number.isSafeInteger(telegramFromId)) {
    return `${errorPrefix} telegramFromId must be a safe integer.`;
  }
  if (!isShortString(telegramUsername) || !telegramUsername) {
    return `${errorPrefix} telegramUsername must be a non-empty short string.`;
  }
  if (!Number.isSafeInteger(telegramChatId)) {
    return `${errorPrefix} telegramChatId must be a safe integer.`;
  }
  for (const field of userBooleanFields) {
    if (typeof (user as Record<string, unknown>)[field] !== 'boolean') {
      return `${errorPrefix} ${field} must be a boolean.`;
    }
  }
  if (
    (watchPriceChange !== undefined)
    && (!Number.isSafeInteger(watchPriceChange) || ((watchPriceChange as number) <= 0))
  ) {
    return `${errorPrefix} watchPriceChange must be a positive safe integer.`;
  }
  if (
    !Array.isArray(permissionGroups) || (permissionGroups.length > 100)
    || permissionGroups.some((groupName) => (
      (typeof groupName !== 'string') || !permissionGroupNameRegex.test(groupName)
    ))
  ) {
    return `${errorPrefix} invalid permissionGroups.`;
  }
  if (!Array.isArray(watchedAddresses) || (watchedAddresses.length > maxWatchesPerUser)) {
    return `${errorPrefix} watchedAddresses must be an array of up to ${maxWatchesPerUser} items.`;
  }
  for (const watchedAddress of watchedAddresses) {
    if (
      !watchedAddress || (typeof watchedAddress !== 'object') || Array.isArray(watchedAddress)
      || (typeof watchedAddress.address !== 'string') || !validateBitcoinAddress(
        watchedAddress.address,
      )
      || ((watchedAddress.nickname !== undefined) && (
        !isShortString(watchedAddress.nickname) || !watchedAddress.nickname
      ))
    ) {
      return `${errorPrefix} invalid watchedAddresses.`;
    }
  }
  if (!Array.isArray(watchedTransactions) || (watchedTransactions.length > maxWatchesPerUser)) {
    return `${
      errorPrefix
    } watchedTransactions must be an array of up to ${maxWatchesPerUser} items.`;
  }
  for (const watchedTransaction of watchedTransactions) {
    if (
      !watchedTransaction || (typeof watchedTransaction !== 'object')
      || Array.isArray(watchedTransaction)
      || (typeof watchedTransaction.txid !== 'string') || !isTransactionId(watchedTransaction.txid)
      || ((watchedTransaction.nickname !== undefined) && (
        !isShortString(watchedTransaction.nickname) || !watchedTransaction.nickname
      ))
    ) {
      return `${errorPrefix} invalid watchedTransactions.`;
    }
  }
  return undefined;
}

function validateConfiguration(body: unknown): string | undefined {
  if (!body || (typeof body !== 'object') || Array.isArray(body)) {
    return 'The configuration must be a JSON object.';
  }
  const {
    format, formatVersion, settings, users,
  } = body as Record<string, unknown>;
  if (format !== configurationFormat) {
    return `Unrecognized configuration file: the "format" field must be "${configurationFormat}".`;
  }
  if (formatVersion !== configurationFormatVersion) {
    return `Unsupported configuration format version: expected ${configurationFormatVersion}.`;
  }
  const settingsError = validateConfigurationSettings(settings);
  if (settingsError) {
    return settingsError;
  }
  if (!Array.isArray(users) || (users.length > maxImportedUsers)) {
    return `The "users" field must be an array of up to ${maxImportedUsers} users.`;
  }
  for (const [userIndex, user] of users.entries()) {
    const userError = validateConfigurationUser(user, userIndex);
    if (userError) {
      return userError;
    }
  }
  const telegramFromIds = users.map(({ telegramFromId }) => telegramFromId);
  if (new Set(telegramFromIds).size !== telegramFromIds.length) {
    return 'Duplicate telegramFromId found in users.';
  }
  return undefined;
}

// Watches a transaction that was just imported: waits for the initial analysis of the
// bitcoind-watcher and updates the imported documents with the results. This mimics the flow
// of the telegram /watch command.
function watchImportedTransaction(txid: string) {
  const eventName = `${BitcoindWatcherEventName.InitialTransactionAnalysis}:${txid}`;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const listener = (analysis: TransactionAnalysis) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    (async () => {
      if (analysis.status === TransactionStatus.FullConfirmation) {
        // Consistent with the telegram /watch command: fully confirmed transactions
        // do not need to be watched anymore.
        await WatchedTransactionsModel.deleteMany({ txid });
        bitcoindWatcher.unwatchTransaction(txid);
        return;
      }
      await WatchedTransactionsModel.updateMany(
        { txid },
        {
          $set: {
            status: analysis.status,
            blockHashes: [...analysis.blockHashes],
            confirmations: analysis.confirmations,
            ...analysis.conflictingTransactions && {
              conflictingTransactions: [...analysis.conflictingTransactions],
            },
            ...analysis.transactionInputKeys && {
              transactionInputKeys: [...analysis.transactionInputKeys],
            },
            ...(analysis.rawTransaction !== undefined) && {
              rawTransaction: JSON.stringify(analysis.rawTransaction),
            },
          },
        },
      );
    })().catch((error) => {
      logger.error(
        `Failed to update imported transaction ${txid}: ${errorString(error)}`,
      );
    });
  };
  timeout = setTimeout(() => {
    bitcoindWatcher.removeListener(eventName, listener);
    logger.error(
      `Timed out waiting for the initial analysis of imported transaction ${txid}`,
    );
  }, transactionAnalysisTimeoutMs);
  bitcoindWatcher.once(eventName, listener);
  bitcoindWatcher.watchNewTransaction(txid);
}

let importLock = false;

apiConfigurationRouter.post('/', asyncHandler(async (req, res) => {
  if (importLock) {
    res.status(409).json({
      error: 'Another configuration import is already in progress.',
    });
    return;
  }
  importLock = true;
  try {
    const validationError = validateConfiguration(req.body);
    if (validationError) {
      res.status(400).json({
        error: validationError,
      });
      return;
    }
    const { settings, users } = req.body as ConfigurationFile;
    logger.info('Configuration import: starting');

    // Stop the telegram bot and drop pending messages of the deleted users.
    await telegramManager.optimisticStopBot();
    telegramManager.clearMessageQueue();

    // Collect the existing configuration before deleting it, to unregister the watchers.
    const oldTransactions = await WatchedTransactionsModel.find({}, { txid: 1 });
    const oldAddresses = await WatchedAddressesModel.find({}, { address: 1 });
    const oldPriceWatchUsers = await UsersModel.find(
      { watchPriceChange: { $exists: true } },
      { _id: 1 },
    );

    // Delete all existing configuration.
    await UsersModel.deleteMany({});
    await WatchedAddressesModel.deleteMany({});
    await WatchedTransactionsModel.deleteMany({});
    for (const address of new Set(oldAddresses.map((doc) => doc.address))) {
      bitcoindWatcher.unwatchAddress(address);
    }
    for (const txid of new Set(oldTransactions.map((doc) => doc.txid))) {
      bitcoindWatcher.unwatchTransaction(txid);
    }
    for (const user of oldPriceWatchUsers) {
      priceWatcher.unwatchPriceChange(user._id.toString());
    }

    // Override the settings.
    await SettingsModel.updateOne(
      { _id: zeroObjectId },
      {
        $set: {
          ...(settings.telegramToken !== undefined) && { telegramToken: settings.telegramToken },
          ...(settings.maxUsers !== undefined) && { maxUsers: settings.maxUsers },
          ...(settings.usersWhitelist !== undefined) && {
            usersWhitelist: settings.usersWhitelist,
          },
          mempoolUrlPrefix: settings.mempoolUrlPrefix,
          commandsPermissionGroups: settings.commandsPermissionGroups,
        },
        $unset: {
          ...(settings.telegramToken === undefined) && { telegramToken: 1 },
          ...(settings.maxUsers === undefined) && { maxUsers: 1 },
          ...(settings.usersWhitelist === undefined) && { usersWhitelist: 1 },
        },
      },
    );

    // Recreate the users and their watches.
    const newAddresses = new Set<string>();
    const newTxids = new Set<string>();
    for await (const configurationUser of users) {
      const userId = new Types.ObjectId();
      await UsersModel.create({
        _id: userId,
        telegramFromId: configurationUser.telegramFromId,
        telegramUsername: configurationUser.telegramUsername,
        telegramChatId: configurationUser.telegramChatId,
        ...Object.fromEntries(
          userBooleanFields.map((field) => [field, configurationUser[field]]),
        ),
        ...(configurationUser.watchPriceChange !== undefined) && {
          watchPriceChange: configurationUser.watchPriceChange,
        },
        permissionGroups: configurationUser.permissionGroups,
      });
      if (configurationUser.watchedAddresses.length > 0) {
        await WatchedAddressesModel.insertMany(
          configurationUser.watchedAddresses.map(({ address, nickname }) => ({
            userId,
            address,
            ...(nickname !== undefined) && { nickname },
          })),
        );
        for (const { address } of configurationUser.watchedAddresses) {
          newAddresses.add(address);
        }
      }
      if (configurationUser.watchedTransactions.length > 0) {
        await WatchedTransactionsModel.insertMany(
          configurationUser.watchedTransactions.map(({ txid, nickname }) => ({
            userId,
            txid,
            ...(nickname !== undefined) && { nickname },
            status: TransactionStatus.Unpublished,
            blockHashes: [],
            confirmations: 0,
          })),
        );
        for (const { txid } of configurationUser.watchedTransactions) {
          newTxids.add(txid);
        }
      }
      if (configurationUser.watchPriceChange !== undefined) {
        await priceWatcher.watchPriceChange(
          userId.toString(),
          configurationUser.watchPriceChange,
        );
      }
    }
    for (const address of newAddresses) {
      bitcoindWatcher.watchAddress(address);
    }
    for (const txid of newTxids) {
      watchImportedTransaction(txid);
    }

    // Restart the telegram bot with the imported token.
    if (settings.telegramToken) {
      try {
        await telegramManager.startBot(settings.telegramToken);
      } catch (error) {
        // The import itself succeeded - the telegram status will show the failure.
        logger.error(
          `Configuration import: failed to start telegram bot: ${errorString(error)}`,
        );
      }
    }
    logger.info('Configuration import: done');
    res.json({
      ok: true,
    });
  } finally {
    importLock = false;
  }
}));

export default apiConfigurationRouter;
