import { AppName, AppVersion } from '@woofbot/common';
import express from 'express';
import expressWinston from 'express-winston';
import helmet from 'helmet';
import { connect as connectMongoose } from 'mongoose';
import nocache from 'nocache';
import { join } from 'path';
import winston from 'winston';

import apiRouter from './routes/api';
import { defaultSettings, SettingsModel } from './models/settings';
import logger, { defaultLogFormat } from './helpers/logger';
import { zeroObjectId } from './helpers/mongo';
import { DecodedAuthToken } from './models/refresh-tokens';
import telegramManager, { escapeMarkdown } from './helpers/telegram';
import { UsersModel } from './models/users';
import { bitcoindWatcher, TransactionAnalysis } from './helpers/bitcoind-watcher';
import { lndWatcher } from './helpers/lnd-watcher';
import { WatchedTransactionsModel } from './models/watched-transactions';
import { WatchedAddressesModel } from './models/watched-addresses';
import { priceWatcher } from './helpers/price-watcher';
import { migrate, migrationsLength } from './migration';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface Request {
      authToken?: DecodedAuthToken;
    }
  }
}

const clientPath = '../../client/build';
const port = Number(process.env.APP_PORT) || 8080; // default port to listen
const mongodbUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/woofbot';
const rebootMessage = escapeMarkdown(`\
⚠️ Woof! The server has rebooted, and some events might have been missed. \
If you configured any watches for transactions or addresses, it is recommended to check them \
manually.`);

const app = express();
app.use(helmet({
  hsts: false,
  expectCt: false,
  contentSecurityPolicy: {
    directives: {
      upgradeInsecureRequests: null,
    },
  },
}));
app.use(expressWinston.logger({
  transports: [
    new winston.transports.Console(),
  ],
  format: defaultLogFormat,
  expressFormat: true,
}) as (...args: unknown[]) => void); // typescript problems

// Serve static resources from the "public" folder (ex: when there are images to display)
app.use(express.static(join(__dirname, clientPath)));

app.use('/api', nocache(), apiRouter);

// Serve the HTML page
app.get('*', (req: any, res: any) => {
  res.sendFile(join(__dirname, clientPath, 'index.html'));
});

app.use((req, res) => {
  res.status(404).send('Not Found');
});

app.use(expressWinston.errorLogger({
  transports: [
    new winston.transports.Console(),
  ],
  format: defaultLogFormat,
}) as (...args: unknown[]) => void); // typescript problems

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err, _req, res, _next) => {
  if (!res.headersSent) {
    res.status(500);
    res.send('Internal error');
  }
});

// start the server
(async () => {
  logger.info(`Starting ${AppName} v${AppVersion}, NODE_ENV: ${process.env.NODE_ENV}`);
  for (const envKey of [
    'MONGODB_URI', 'APP_SEED', 'APP_PASSWORD', 'APP_BITCOIN_NODE_IP', 'APP_BITCOIN_RPC_USER',
    'APP_BITCOIN_RPC_PASS', 'APP_BITCOIN_RPC_PORT', 'APP_PORT', 'APP_BITCOIN_ZMQ_RAWBLOCK_PORT',
    'APP_BITCOIN_ZMQ_RAWTX_PORT', 'APP_LIGHTNING_NODE_IP', 'APP_LIGHTNING_NODE_GRPC_PORT',
    'LND_READONLY_MACAROON_PATH', 'LND_TLS_PATH',
  ]) {
    logger.info(`Env var ${envKey} was ${process.env[envKey] ? 'found' : 'not found'}`);
  }
  await connectMongoose(mongodbUri);
  await SettingsModel.updateOne({
    _id: zeroObjectId,
  }, {
    $setOnInsert: {
      migrationVersion: migrationsLength,
      ...defaultSettings,
    },
  }, {
    upsert: true,
  });
  await migrate();
  const settings = await SettingsModel.findById(zeroObjectId);
  if (!settings) {
    throw new Error('Could not load settings');
  }
  telegramManager.startMessageQueueInterval();
  if (settings.telegramToken) {
    await telegramManager.startBot(settings.telegramToken);
  }
  const watchedAddresses = await WatchedAddressesModel.find({});
  const transactions = await WatchedTransactionsModel.find({});
  const analysisByTxid = new Map<string, TransactionAnalysis>(transactions.map((transaction) => [
    transaction.txid,
    {
      status: transaction.status,
      blockHashes: new Set(transaction.blockHashes),
      confirmations: transaction.confirmations,
      conflictingTransactions: transaction.conflictingTransactions && new Set(
        transaction.conflictingTransactions,
      ),
      transactionInputKeys: transaction.transactionInputKeys && new Set(
        transaction.transactionInputKeys,
      ),
      ...(typeof transaction.rawTransaction === 'string') && {
        rawTransaction: JSON.parse(transaction.rawTransaction),
      },
    },
  ]));
  await bitcoindWatcher.start(
    settings.analyzedBlockHashes,
    [...analysisByTxid.entries()],
    [...new Set(watchedAddresses.map(({ address }) => address))],
  );
  await lndWatcher.start({
    savedChannels: settings.lndChannels,
    lastForwardAt: settings.lndLastForwardAt ?? new Date(),
    lastForwardCount: settings.lndLastForwardCount ?? 0,
  });
  const watchRebootUsers = await UsersModel.find({ watchReboot: true });
  for await (const user of watchRebootUsers) {
    await telegramManager.sendMessage({
      chatId: user.telegramChatId,
      text: rebootMessage,
    });
  }
  const watchPriceChangeUsers = await UsersModel.find({
    watchPriceChange: {
      $exists: true,
    },
  });
  for await (const user of watchPriceChangeUsers) {
    if (user.watchPriceChange) {
      await priceWatcher.watchPriceChange(user._id.toString(), user.watchPriceChange);
    }
  }
  app.listen(port, () => {
    logger.info(`app ${AppName} v${AppVersion} started at http://localhost:${port}`);
  });
})().catch((error) => {
  // Crash with error
  setImmediate(() => {
    throw error;
  });
});
