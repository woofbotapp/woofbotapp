import { TelegramStatus, telegramCommands, BotCommandName } from '@woofbot/common';
import { Context, Telegraf, TelegramError } from 'telegraf';
import { validate } from 'bitcoin-address-validation';
import { Types } from 'mongoose';

import { SettingsModel } from '../models/settings';
import { defaultUserProperties, UsersModel, UserDocument } from '../models/users';
import { WatchedAddressesModel } from '../models/watched-addresses';
import { TransactionStatus, WatchedTransactionsModel } from '../models/watched-transactions';
import { unwatchUnusedAddresses } from '../controllers/addresses';
import { unwatchUnusedTransactions } from '../controllers/transactions';
import { deleteUser } from '../controllers/users';
import {
  bitcoindWatcher, BitcoindWatcherEventName, NewTransactionAnalysisEvent, TransactionAnalysis,
  transactionAnalysisToString, NewAddressPaymentEvent, NewBlockAnalyzedEvent,
} from './bitcoind-watcher';
import { errorString } from './error';
import logger from './logger';
import { zeroObjectId } from './mongo';
import { PriceChangeEvent, priceWatcher, PriceWatcherEventName } from './price-watcher';

interface TextMessage {
  text: string;
}

interface TextContext extends Context {
  message: Context['message'] & TextMessage & { reply_to_message?: TextMessage };
}

export function escapeMarkdown(text): string {
  // escape Markdown V2
  return text.replaceAll(/([_*[\]()~`>#+-=|{}.!])/g, '\\$1');
}

const sponsorship = `\n\n*${
  escapeMarkdown('Your sponsorship can be here! woofbot@protonmail.com')
}*`;

const startMessage = `${escapeMarkdown(`\
🐶 Welcome to WoofBot, your personal telegram bot that will send you customized alerts.
By default, your user is configured to get alerts whenever your server reboots.
To unset this configuration, call /unwatchreboot.
To start watching reboots events again, call /watchreboot.
For more information, call /help.`)}${sponsorship}`;

const notFoundMessage = escapeMarkdown('Woof! Call /start first.');

interface MessageTask {
  chatId: string | number;
  text: string;
}

const messageQueueIntervalMs = 60_000;
const messageQueueMaxSize = 10_000;
const transactionAnalysisTimeoutMs = 300_000;
const blockSkippedWarningBackoffMs = 300_000;

export class TelegrafManager {
  private internalBot: Telegraf | undefined = undefined;

  private internalStatus: TelegramStatus = TelegramStatus.Unset;

  private messageQueue: MessageTask[] = [];

  private messageQueueInterval: ReturnType<typeof setInterval> | undefined;

  private newTransactionAnalysesQueue: NewTransactionAnalysisEvent[] | undefined;

  private lastBlockSkippedWarning = new Date(0);

  get bot(): Telegraf | undefined {
    return this.internalBot;
  }

  get status(): TelegramStatus {
    return this.internalStatus;
  }

  constructor() {
    bitcoindWatcher.on(
      BitcoindWatcherEventName.NewTransactionAnalysis,
      (parameters) => this.onNewTransactionAnalysis(parameters),
    );
    bitcoindWatcher.on(
      BitcoindWatcherEventName.NewAddressPayment,
      (parameters) => this.onNewAddressPayment(parameters),
    );
    bitcoindWatcher.on(
      BitcoindWatcherEventName.AddressOverload,
      (address) => this.onAddressOverload(address),
    );
    bitcoindWatcher.on(
      BitcoindWatcherEventName.BlocksSkipped,
      () => this.onBlocksSkipped(),
    );
    bitcoindWatcher.on(
      BitcoindWatcherEventName.NewBlockAnalyzed,
      (event) => this.onNewBlockAnalyzed(event),
    );
    priceWatcher.on(
      PriceWatcherEventName.ConsecutiveApiErrors,
      () => this.onConsecutivePriceApiErrors(),
    );
    priceWatcher.on(
      PriceWatcherEventName.ApiResponsiveAgain,
      () => this.onPriceApiResponsiveAgain(),
    );
    priceWatcher.on(
      PriceWatcherEventName.PriceChange,
      (event) => this.onPriceChange(event),
    );
  }

  private async onConsecutivePriceApiErrors() {
    try {
      const users = await UsersModel.find({
        watchPriceChange: {
          $exists: true,
        },
      });
      const message = escapeMarkdown(
        '⚠️ Woof! There are problems connecting to CoinGecko Api to get the price of Bitcoin.',
      );
      for await (const user of users) {
        await this.sendMessage({
          chatId: user.telegramChatId,
          text: message,
        });
      }
    } catch (error) {
      logger.error(`Failed to notify price api errors: ${errorString(error)}`);
    }
  }

  private async onPriceApiResponsiveAgain() {
    try {
      const users = await UsersModel.find({
        watchPriceChange: {
          $exists: true,
        },
      });
      const message = escapeMarkdown([
        '💸 Woof! CoinGecko Api (to get the price of Bitcoin) is responsive again after some',
        'time that it was not.',
      ].join(' '));
      for await (const user of users) {
        await this.sendMessage({
          chatId: user.telegramChatId,
          text: message,
        });
      }
    } catch (error) {
      logger.error(`Failed to notify price api responsive-again: ${errorString(error)}`);
    }
  }

  private async onPriceChange(event: PriceChangeEvent) {
    try {
      logger.info(`onPriceChange: ${JSON.stringify(event)}`);
      const user = await UsersModel.findOne({
        _id: new Types.ObjectId(event.id),
        watchPriceChange: event.delta,
      });
      if (!user) {
        logger.info('onPriceChange: user not found');
        priceWatcher.unwatchPriceChange(event.id);
        return;
      }
      const [oldMin] = event.oldThreshold;
      const [newMin, newMax] = event.newThreshold;
      const isIncrease = (oldMin < newMin);
      const message = escapeMarkdown(
        `${isIncrease ? '📈' : '📉'} Woof! The price of Bitcoin on CoinGecko is $${
          event.newPrice.toFixed(2)
        }. I will check the price every minute and let you know when the price goes below $${
          newMin
        } or above $${newMax}.`,
      );
      await this.sendMessage({
        chatId: user.telegramChatId,
        text: message,
      });
    } catch (error) {
      logger.error(`Failed to notify price change: ${errorString(error)}`);
    }
  }

  private async onNewBlockAnalyzed(event: NewBlockAnalyzedEvent) {
    try {
      await SettingsModel.updateOne(
        { _id: zeroObjectId },
        {
          $set: {
            analyzedBlockHashes: event.blockHashes,
            bestBlockHeight: event.bestBlockHeight,
          },
        },
      );
      const watchNewBlocksUsers = await UsersModel.find({
        watchNewBlocks: true,
      });
      if (watchNewBlocksUsers.length > 0) {
        const newBlocksHashes = event.blockHashes.slice(-event.newBlocks);
        const messages = newBlocksHashes.map(
          (blockHash, index) => `Block ${blockHash} at height ${
            event.bestBlockHeight - event.newBlocks + index + 1
          }`,
        );
        const finalMessage = escapeMarkdown(`🧱 Woof! ${
          (event.newBlocks === 1) ? 'A new block was' : 'New blocks were'
        } mined: ${messages.join(', ')}.`);
        for await (const user of watchNewBlocksUsers) {
          await this.sendMessage({
            chatId: user.telegramChatId,
            text: finalMessage,
          });
        }
      }
    } catch (error) {
      logger.error(`Failed to handle analyzed block hashes: ${errorString(error)}`);
    }
  }

  private async onBlocksSkipped() {
    try {
      const now = new Date();
      const { lastBlockSkippedWarning } = this;
      // Will start warning again only if there are 5 minutes without warnings
      this.lastBlockSkippedWarning = now;
      if (now.getTime() - lastBlockSkippedWarning.getTime() < blockSkippedWarningBackoffMs) {
        return;
      }
      const transactions = await WatchedTransactionsModel.find({});
      const addresses = await WatchedAddressesModel.find({});
      const userIds = [
        ...new Map([
          ...transactions.map(({ userId }) => userId),
          ...addresses.map(({ userId }) => userId),
        ].map((userId) => [`${userId}`, userId])).values(),
      ];
      const users = await UsersModel.find({
        $or: [
          {
            _id: {
              $in: userIds,
            },
          },
          {
            watchNewBlocks: true,
          },
        ],
      });
      await Promise.all(
        users.map((user) => this.sendMessage({
          chatId: user.telegramChatId,
          text: escapeMarkdown([
            '⚠️ Woof! It seems that your node was not synced for some time, and some blocks were',
            'not analyzed. It is recommended to check the status of your addresses and',
            'transactions manually.',
          ].join(' ')),
        })),
      );
    } catch (error) {
      logger.error(`TelegrafManager: failed to handle onBlocksSkipped: ${errorString(error)}`);
    }
  }

  private async onNewAddressPayment({
    address,
    txid,
    status,
    confirmations,
    multiAddress,
    incomeSats,
    outcomeSats,
  }: NewAddressPaymentEvent) {
    try {
      logger.info(`onNewAddressPayment: ${address} ${txid}`);
      const watchedAddresses = await WatchedAddressesModel.find({ address });
      if (watchedAddresses.length === 0) {
        // safety check
        bitcoindWatcher.unwatchAddress(address);
        return;
      }
      const users = await UsersModel.find({
        _id: {
          $in: watchedAddresses.map(({ userId }) => userId),
        },
      });
      const userById = new Map(users.map((user) => [`${user.id}`, user]));
      logger.info(`TelegrafManager: Notifying users about new address payment ${
        address
      } ${txid}: ${users.map((user) => user.id).join(', ')}`);
      for await (const watchedAddress of watchedAddresses) {
        const user = userById.get(`${watchedAddress.userId}`);
        if (!user) {
          continue;
        }
        const messages: string[] = [];
        const addressName = watchedAddress.nickname
          ? `${watchedAddress.nickname} (${watchedAddress.address})`
          : `${watchedAddress.address}`;

        if (incomeSats !== undefined) {
          messages.push(
            `Address ${addressName} ${
              (status === TransactionStatus.FullConfirmation) ? 'has received' : 'is receiving'
            } ${incomeSats} sats by transaction ${txid}.`,
          );
        }
        if (outcomeSats !== undefined) {
          messages.push(
            `Address ${addressName} ${
              (status === TransactionStatus.FullConfirmation) ? 'has sent' : 'is sending'
            } ${outcomeSats} sats by transaction ${txid}.`,
          );
        }
        switch (status) {
          case TransactionStatus.PartialConfirmation:
            messages.push(
              `This transaction has ${confirmations} ${
                (confirmations === 1) ? 'confirmation' : 'confirmations'
              } and is not yet fully confirmed.`,
            );
            break;
          case TransactionStatus.FullConfirmation:
            messages.push(
              `🚀 This transaction has ${confirmations} ${
                (confirmations === 1) ? 'confirmation' : 'confirmations'
              } and is fully confirmed.`,
            );
            break;
          default:
            messages.push(`This transaction is only in the mempool.`);
        }
        if (multiAddress) {
          messages.push([
            '\n⚠️ Notice that one of the transaction outputs is an old m-of-n non-P2SH multisig',
            'script, a format that is rarely used today, meaning that different other addresses',
            'might be able to spend the funds.',
          ].join(' '));
        }
        await this.sendMessage({
          chatId: user.telegramChatId,
          text: escapeMarkdown(`Woof! ${messages.join(' ')}`),
        });
      }
    } catch (error) {
      logger.info(
        `onNewAddressPayment: failed to handle ${address} ${txid}: ${errorString(error)}`,
      );
    }
  }

  private async onAddressOverload(address: string) {
    try {
      logger.info(`onAddressOverload: ${address}`);
      const watchedAddresses = await WatchedAddressesModel.find({ address });
      if (watchedAddresses.length === 0) {
        // safety check
        bitcoindWatcher.unwatchAddress(address);
        return;
      }
      const users = await UsersModel.find({
        _id: {
          $in: watchedAddresses.map(({ userId }) => userId),
        },
      });
      const userById = new Map(users.map((user) => [`${user.id}`, user]));
      logger.info(`TelegrafManager: Notifying users about address overload ${
        users.map((user) => user.id).join(', ')
      }`);
      for await (const watchedAddress of watchedAddresses) {
        const user = userById.get(`${watchedAddress.userId}`);
        if (!user) {
          continue;
        }
        const addressName = watchedAddress.nickname
          ? `${watchedAddress.nickname} (${watchedAddress.address})`
          : `${watchedAddress.address}`;
        await this.sendMessage({
          chatId: user.telegramChatId,
          text: escapeMarkdown([
            `⚠️ Woof! Address ${addressName} is being overloaded with transactions in the last`,
            'hours. I cannot track each one of them, please watch them manually.',
          ].join(' ')),
        });
      }
    } catch (error) {
      logger.error(
        `TelegrafManager: Failed to handle address overload: ${errorString(error)}`,
      );
    }
  }

  private onNewTransactionAnalysis(parameters: NewTransactionAnalysisEvent) {
    logger.info(
      `onNewTransactionAnalysis: txid ${
        parameters.txid
      }, old-analysis ${
        transactionAnalysisToString(parameters.oldAnalysis)
      }, new-analysis ${
        transactionAnalysisToString(parameters.newAnalysis)
      }`,
    );
    if (this.newTransactionAnalysesQueue) {
      this.newTransactionAnalysesQueue.push(parameters);
      return;
    }
    this.handleNewTransactionAnalysis(parameters);
  }

  private async handleNewTransactionAnalysis({
    txid, oldAnalysis, newAnalysis,
  }: NewTransactionAnalysisEvent) {
    try {
      const transactions = await WatchedTransactionsModel.find({ txid });
      if (transactions.length === 0) {
        // safety check
        bitcoindWatcher.unwatchTransaction(txid);
        return;
      }
      if (newAnalysis.status === TransactionStatus.FullConfirmation) {
        await WatchedTransactionsModel.deleteMany({ txid });
      } else {
        await WatchedTransactionsModel.updateMany(
          {
            txid,
          },
          {
            $set: {
              ...newAnalysis,
              ...newAnalysis.transactionInputKeys && {
                transactionInputKeys: [...newAnalysis.transactionInputKeys],
              },
              ...newAnalysis.conflictingTransactions && {
                conflictingTransactions: [...newAnalysis.conflictingTransactions],
              },
              blockHashes: [...newAnalysis.blockHashes],
              ...(newAnalysis.rawTransaction !== undefined) && {
                rawTransaction: JSON.stringify(newAnalysis.rawTransaction),
              },
            },
          },
        );
      }
      const users = await UsersModel.find({
        _id: {
          $in: transactions.map((transaction) => transaction.userId),
        },
      });
      const userById = new Map(users.map((user) => [`${user.id}`, user]));
      logger.info(`TelegrafManager: Notifying users about new transaction analysis ${
        txid
      }: ${users.map((user) => user.id).join(', ')}`);
      for await (const transaction of transactions) {
        const user = userById.get(`${transaction.userId}`);
        if (!user) {
          continue;
        }
        const messages: string[] = [];
        const transactionName = transaction.nickname
          ? `${transaction.nickname} (${transaction.txid})`
          : `${transaction.txid}`;
        if (oldAnalysis.status !== newAnalysis.status) {
          switch (newAnalysis.status) {
            case TransactionStatus.Mempool:
              messages.push(
                `Woof! Transaction ${transactionName} has been added to the mempool.`,
              );
              break;
            case TransactionStatus.PartialConfirmation:
              messages.push(
                `⛓️ Woof! Transaction ${transactionName} has been added to the blockchain`,
                `in block ${
                  [...newAnalysis.blockHashes].join(', ') || 'unknown'
                }.`,
              );
              break;
            case TransactionStatus.FullConfirmation:
              messages.push(
                `🚀 Woof! Transaction ${transactionName} has ${newAnalysis.confirmations}`,
                'confirmations and is now fully confirmed.',
                `It was mined in block ${[...newAnalysis.blockHashes].join(', ') || 'unknown'}.`,
                'I will no longer watch this transaction.',
              );
              break;
            case TransactionStatus.Unpublished: // fallthrough
            default:
              break;
          }
        }
        const newConflicts = [...newAnalysis.conflictingTransactions ?? []].filter(
          (conflict) => !(oldAnalysis.conflictingTransactions?.has(conflict)),
        );
        if (newConflicts.length > 0) {
          if (messages.length > 0) {
            messages.push(
              `\n⚠️ Notice that ${
                (newConflicts.length === 1)
                  ? 'a new transaction was'
                  : 'some new transactions were'
              } found trying to spend the same input: ${
                newConflicts.join(', ')
              }.`,
            );
          } else {
            messages.push(
              `⚠️ Woof! ${
                (newConflicts.length === 1)
                  ? 'A new transaction was'
                  : 'Some new transactions were'
              } found trying to spend the same inputs of ${transactionName}: ${
                newConflicts.join(', ')
              }.`,
            );
          }
          messages.push(
            'This could either mean a double-spend attempt or a legit replace-by-fee.',
          );
        }
        if (messages.length > 0) {
          await this.sendMessage({
            chatId: user.telegramChatId,
            text: escapeMarkdown(messages.join(' ')),
          });
        }
      }
    } catch (error) {
      logger.error(
        `TelegrafManager: Failed to handle new transaction analysis: ${errorString(error)}`,
      );
    }
  }

  clearMessageQueue() {
    this.messageQueue = [];
  }

  async sendMessage(message: MessageTask) {
    try {
      if (!this.bot) {
        throw new Error('Bot is not configured');
      }
      await this.bot.telegram.sendMessage(
        message.chatId,
        `${message.text}${sponsorship}`,
        {
          parse_mode: 'MarkdownV2',
        },
      );
    } catch (error) {
      logger.error(
        `TelegrafManager: Failed to send message to chat-id ${message.chatId}: ${
          errorString(error)
        }`,
      );
      if (
        !(error instanceof TelegramError)
        || !Number.isSafeInteger(error.code)
        || (error.code <= 0)
      ) {
        // Networking error
        logger.info('TelegrafManager: Message sending error was a networking error');
        if (this.messageQueue.length >= messageQueueMaxSize) {
          logger.error(
            `TelegrafManager: Message queue is full, will not send message to chat-id ${
              message.chatId
            }`,
          );
          return;
        }
        this.messageQueue.push(message);
      }
    }
  }

  startMessageQueueInterval() {
    if (this.messageQueueInterval) {
      clearInterval(this.messageQueueInterval);
    }
    let isRunning = false;
    this.messageQueueInterval = setInterval(async () => {
      if (isRunning) {
        logger.info('TelegrafManager: Message queue handler is already running');
        return;
      }
      isRunning = true;
      try {
        await this.messageQueueHandler();
      } catch (error) {
        logger.error(`TelegrafManager: Message queue handler failed: ${errorString(error)}`);
      } finally {
        isRunning = false;
      }
    }, messageQueueIntervalMs);
    this.messageQueueInterval.unref();
  }

  private async messageQueueHandler() {
    if (!this.bot) {
      logger.info('TelegrafManager: trying to configure bot');
      const settings = await SettingsModel.findById(zeroObjectId);
      if (!settings) {
        logger.error('TelegrafManager: Message queue handler could not find settings');
        return;
      }
      if (settings.telegramToken && (this.internalStatus !== TelegramStatus.Loading)) {
        await this.startBot(settings.telegramToken);
      }
      return;
    }
    const { messageQueue } = this;
    if (messageQueue.length === 0) {
      return;
    }
    logger.info(`TelegrafManager: Message queue length: ${this.messageQueue.length}`);
    while (this.bot && (messageQueue.length > 0)) {
      if (messageQueue !== this.messageQueue) {
        logger.info('TelegrafManager: Message queue has been cleared');
        break;
      }
      const [message] = messageQueue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.bot.telegram.sendMessage(
          message.chatId,
          `${escapeMarkdown(
            'The following message has been sent with delay due to networking issues:\n\n',
          )}${message.text}${sponsorship}`,
          {
            parse_mode: 'MarkdownV2',
          },
        );
      } catch (error) {
        logger.error(
          `TelegrafManager: Message queue failed to send message to chat-id ${message.chatId}: ${
            errorString(error)
          }`,
        );
        if (
          !(error instanceof TelegramError)
          || !Number.isSafeInteger(error.code)
          || (error.code <= 0)
        ) {
          // Networking error
          logger.info('TelegrafManager: Message queue error was a networking error');
          break;
        }
      }
      messageQueue.shift();
    }
    logger.info('TelegrafManager: Message queue handler has finished');
  }

  async optimisticStopBot(): Promise<void> {
    logger.info('TelegrafManager: Stopping telegram bot if exists');
    this.internalStatus = TelegramStatus.Unset;
    const bot = this.internalBot;
    if (!bot) {
      logger.info('Telegram bot is already stopped');
      return;
    }
    this.internalBot = undefined;
    try {
      await bot.stop();
      logger.info('TelegrafManager: Telegram bot has stopped successfully');
    } catch (error) {
      logger.error(`TelegrafManager: Failed to stop old telegram bot: ${errorString(error)}`);
    }
  }

  async startBot(token: string) {
    if (this.internalStatus === TelegramStatus.Loading) {
      throw new Error('Already loading');
    }
    await this.optimisticStopBot();
    logger.info('TelegrafManager: Launching new telegram bot');
    this.internalStatus = TelegramStatus.Loading;
    const bot = new Telegraf(token);
    try {
      bot.start(async (ctx) => {
        try {
          const settings = await SettingsModel.findById(zeroObjectId);
          if (!settings) {
            throw new Error('Settings not found');
          }
          const usersCount = await UsersModel.countDocuments();
          const canInsert = (usersCount < settings.maxUsers);
          const found = await UsersModel.findOneAndUpdate(
            {
              telegramFromId: ctx.from.id,
            },
            {
              $set: {
                telegramChatId: ctx.chat.id,
                telegramUsername: ctx.from.username ?? '',
              },
              $setOnInsert: {
                ...defaultUserProperties,
              },
            },
            {
              upsert: canInsert,
            },
          );
          if (found) {
            ctx.replyWithMarkdownV2(escapeMarkdown(
              'You are already registered. For more information, call /help.',
            ));
            return;
          }
          if (!canInsert) {
            ctx.replyWithMarkdownV2(escapeMarkdown([
              'The number of users has already reached the maximum.',
              'Please contact the bot administrator.',
            ].join(' ')));
            return;
          }
          await ctx.replyWithMarkdownV2(startMessage);
        } catch (error) {
          logger.error(
            `TelegrafManager: Failed to run start for chat-id ${
              ctx.chat.id
            }: ${errorString(error)}`,
          );
        }
      });
      bot.help(async (ctx) => {
        try {
          await ctx.replyWithMarkdownV2(escapeMarkdown(
            `Woof! These are the commands that I was trained for:\n${
              telegramCommands.map(
                ({ command, description }) => `/${command} - ${description}`,
              ).join('\n')
            }`,
          ));
        } catch (error) {
          logger.error(
            `TelegrafManager: Failed to run help for chat-id ${
              ctx.chat.id
            }: ${errorString(error)}`,
          );
        }
      });
      const filteredTelegramCommandNames = telegramCommands.map(
        ({ command }) => command,
      ).filter(
        (command) => ![BotCommandName.Help, BotCommandName.Start].includes(command),
      );
      for (const command of filteredTelegramCommandNames) {
        bot.command(command, async (ctx) => {
          try {
            const user = ctx.from?.id && await UsersModel.findOne(
              {
                telegramFromId: ctx.from.id,
              },
            );
            if (!user) {
              await ctx.replyWithMarkdownV2(notFoundMessage);
              return;
            }
            // update telegram details if changed
            if (
              (user.telegramChatId !== ctx.chat.id)
              || (ctx.from.username && (user.telegramUsername !== ctx.from.username))
            ) {
              await UsersModel.updateOne(
                {
                  _id: user._id,
                },
                {
                  $set: {
                    telegramChatId: ctx.chat.id,
                    ...Boolean(ctx.from.username) && {
                      telegramUsername: ctx.from.username,
                    },
                  },
                },
              );
              user.telegramChatId = ctx.chat.id;
              if (ctx.from.username) {
                user.telegramUsername = ctx.from.username;
              }
            }
            if (this[command]) {
              await this[command](ctx, user);
            } else {
              await TelegrafManager[command](ctx, user);
            }
          } catch (error) {
            logger.error(
              `TelegrafManager: Failed to run command ${command} for chat-id ${
                ctx.chat.id
              }: ${errorString(error)}`,
            );
          }
        });
      }
      bot.hears(/^woof(\W|$)/i, async (ctx) => {
        try {
          await ctx.replyWithMarkdownV2(escapeMarkdown('Woof Woof!'));
        } catch (error) {
          logger.error(
            `TelegrafManager: Failed to hear woof in chat-id ${
              ctx.chat.id
            }: ${errorString(error)}`,
          );
        }
      });
      bot.hears(/^\/\S/, async (ctx) => {
        try {
          await ctx.replyWithMarkdownV2(escapeMarkdown(
            'Woof! I wasn\'t trained for this command. See /help.',
          ));
        } catch (error) {
          logger.error(
            `TelegrafManager: Failed to hear unknown command in chat-id ${
              ctx.chat.id
            }: ${errorString(error)}`,
          );
        }
      });
      bot.hears(/.*/, async (ctx) => {
        try {
          await ctx.replyWithMarkdownV2(escapeMarkdown(
            'Woof! See /help.',
          ));
        } catch (error) {
          logger.error(
            `TelegrafManager: Failed to hear unknown text in chat-id ${
              ctx.chat.id
            }: ${errorString(error)}`,
          );
        }
      });
      await bot.launch();
      await bot.telegram.setMyCommands(telegramCommands);
      this.internalBot = bot;
      this.internalStatus = TelegramStatus.Running;
    } catch (error) {
      logger.error(`TelegrafManager: Failed to launch new telegram bot: ${errorString(error)}`);
      this.internalStatus = TelegramStatus.Failed;
      try {
        await bot.stop();
      } catch (stopError) {
        logger.error(`TelegrafManager: Failed to stop telegram bot that failed to launch: ${
          errorString(stopError)
        }`);
      }
    }
  }

  static async [BotCommandName.WhoAmI](ctx: TextContext, user: UserDocument) {
    ctx.replyWithMarkdownV2(escapeMarkdown(
      `You are @${user.telegramUsername}, telegram-id ${
        user.telegramFromId
      }, local-id ${user.id}`,
    ));
  }

  static async [BotCommandName.WatchReboot](ctx: TextContext) {
    const found = await UsersModel.findOneAndUpdate(
      {
        telegramFromId: ctx.from?.id ?? '',
      },
      {
        $set: {
          watchReboot: true,
        },
      },
    );
    if (!found) {
      ctx.replyWithMarkdownV2(notFoundMessage);
      return;
    }
    ctx.replyWithMarkdownV2(escapeMarkdown('Started watching reboots.'));
  }

  static async [BotCommandName.UnwatchReboot](ctx: TextContext) {
    const found = await UsersModel.findOneAndUpdate(
      {
        telegramFromId: ctx.from?.id ?? '',
      },
      {
        $set: {
          watchReboot: false,
        },
      },
    );
    if (!found) {
      ctx.replyWithMarkdownV2(notFoundMessage);
      return;
    }
    ctx.replyWithMarkdownV2(escapeMarkdown('Stopped watching reboots.'));
  }

  static async [BotCommandName.WatchNewBlocks](ctx: TextContext) {
    const found = await UsersModel.findOneAndUpdate(
      {
        telegramFromId: ctx.from?.id ?? '',
      },
      {
        $set: {
          watchNewBlocks: true,
        },
      },
    );
    if (!found) {
      ctx.replyWithMarkdownV2(notFoundMessage);
      return;
    }
    ctx.replyWithMarkdownV2(escapeMarkdown('Started watching new blocks.'));
  }

  static async [BotCommandName.UnwatchNewBlocks](ctx: TextContext) {
    const found = await UsersModel.findOneAndUpdate(
      {
        telegramFromId: ctx.from?.id ?? '',
      },
      {
        $set: {
          watchNewBlocks: false,
        },
      },
    );
    if (!found) {
      ctx.replyWithMarkdownV2(notFoundMessage);
      return;
    }
    ctx.replyWithMarkdownV2(escapeMarkdown('Stopped watching new blocks.'));
  }

  async [BotCommandName.WatchTransaction](ctx: TextContext, user: UserDocument) {
    const [commandName, ...args] = ctx.message.text.split(/\s+/);
    if (args.length === 0) {
      ctx.replyWithMarkdownV2(escapeMarkdown([
        `Syntax: "${commandName} <transaction-id>" or "${
          commandName
        } <transaction-nickname>:<transaction-id>".`,
        'Transaction nickname must not contain spaces or more than 100 characters.',
      ].join(' ')));
      return;
    }
    if (args.length > 1) {
      ctx.replyWithMarkdownV2(escapeMarkdown('Too many parameters'));
      return;
    }
    const parts = args[0].split(':');
    const txid = parts.pop();
    if (!txid || (txid.length !== 64) || !/^[0-9a-f]{64}$/.test(txid)) {
      ctx.replyWithMarkdownV2(`Invalid transaction id - expected 64 hex chars in lowecase.`);
      return;
    }
    const nickname = parts.join(':');
    if (nickname.length > 100) {
      ctx.replyWithMarkdownV2(escapeMarkdown('Invalid transaction nickname.'));
      return;
    }
    if (nickname && await WatchedTransactionsModel.findOne({
      userId: user._id,
      nickname,
    })) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        'You have already given the same nickname to another transaction that you watch.',
      ));
      return;
    }
    if (await WatchedTransactionsModel.findOne({
      userId: user._id,
      txid,
    })) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        `You are already watching this transaction. See: /${BotCommandName.ListWatches}`,
      ));
      return;
    }
    ctx.replyWithMarkdownV2(escapeMarkdown(
      'Analyzing the transaction and looking for conflicts in the recent blocks. Please hodl.',
    ));
    const isQueueSet = Boolean(this.newTransactionAnalysesQueue);
    if (!isQueueSet) {
      this.newTransactionAnalysesQueue = [];
    }
    try {
      const analysis: TransactionAnalysis = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Timed out initializing transaction analysis')),
          transactionAnalysisTimeoutMs,
        );
        bitcoindWatcher.once(
          `${BitcoindWatcherEventName.InitialTransactionAnalysis}:${txid}`,
          (someAnalysis) => {
            clearTimeout(timeout);
            resolve(someAnalysis);
          },
        );
        bitcoindWatcher.watchNewTransaction(txid);
      });
      if (analysis.status !== TransactionStatus.FullConfirmation) {
        await WatchedTransactionsModel.create({
          userId: user.id,
          txid,
          ...analysis,
          ...analysis.transactionInputKeys && {
            transactionInputKeys: [...analysis.transactionInputKeys],
          },
          ...analysis.conflictingTransactions && {
            conflictingTransactions: [...analysis.conflictingTransactions],
          },
          ...(nickname.length > 0) && {
            nickname,
          },
          blockHashes: [...analysis.blockHashes],
          ...(analysis.rawTransaction !== undefined) && {
            rawTransaction: JSON.stringify(analysis.rawTransaction),
          },
        });
      }
      const replyMessage: string[] = [];
      switch (analysis.status) {
        case TransactionStatus.Unpublished:
          replyMessage.push(
            'I could not find any details on this transaction-id in the mempool or on the',
            'blockchain. I will let you know when it is found.',
          );
          break;
        case TransactionStatus.Mempool:
          replyMessage.push(
            'The transaction was found in the mempool.',
          );
          break;
        case TransactionStatus.PartialConfirmation:
          replyMessage.push(
            `The transaction has ${
              (analysis.confirmations === 1)
                ? '1 confirmation'
                : `${analysis.confirmations} confirmations`
            }.`,
            `It was mined in block ${
              [...analysis.blockHashes].join(', ') || 'unknown'
            }.`,
          );
          break;
        case TransactionStatus.FullConfirmation:
          replyMessage.push(
            `🚀 This transaction already has ${
              analysis.confirmations
            } confirmations and is fully confirmed, so there is no need to watch it anymore.`,
            `It was mined in block ${
              [...analysis.blockHashes].join(', ') || 'unknown'
            }.`,
          );
          break;
        default:
          throw new Error(`Unexpected analysis status ${analysis.status}`);
      }

      if (analysis.conflictingTransactions && (analysis.conflictingTransactions.size > 0)) {
        replyMessage.push(
          `\n🚨 The following ${
            (analysis.conflictingTransactions.size === 1)
              ? 'transaction was' : 'transactions were'
          } also found trying to spend the same inputs: ${
            [...analysis.conflictingTransactions].join(', ')
          }. This could either mean a double-spend attempt or a legit replace-by-fee.`,
        );
      } else {
        replyMessage.push(
          'No contradicting transactions were found (i.e. double-spend attempts).',
        );
      }
      await this.sendMessage({
        chatId: user.telegramChatId,
        text: escapeMarkdown(replyMessage.join(' ')),
      });
    } catch (error) {
      await this.sendMessage({
        chatId: user.telegramChatId,
        text: escapeMarkdown('⚠️ Woof! Failed to watch the transaction.'),
      });
      throw error;
    } finally {
      if (!isQueueSet) {
        const queue = this.newTransactionAnalysesQueue;
        this.newTransactionAnalysesQueue = undefined;
        if (queue) {
          for (const queuedAnalysis of queue) {
            this.handleNewTransactionAnalysis(queuedAnalysis);
          }
        }
      }
    }
  }

  async [BotCommandName.Wtx](ctx: TextContext, user: UserDocument) {
    return this[BotCommandName.WatchTransaction](ctx, user);
  }

  static async [BotCommandName.UnwatchTransactions](ctx: TextContext, user: UserDocument) {
    const [commandName, ...args] = ctx.message.text.split(/\s+/);
    if (args.length === 0) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        `Syntax: "${commandName} <transaction-id-in-lowercase>" or "${
          commandName
        } <transaction-nickname>" or "${
          commandName
        } <transaction-id-prefix-in-lowercase>*". Don't forget the '*' when using a prefix match.`,
      ));
      return;
    }
    const transactions = await WatchedTransactionsModel.find({
      userId: user._id,
      $or: [
        {
          txid: {
            $in: args,
          },
        },
        {
          nickname: {
            $in: args,
          },
        },
        ...args.filter((arg) => /^[0-9a-f]*\*$/.test(arg)).map((arg) => ({
          txid: {
            $regex: `^${arg.slice(0, -1)}.*$`,
          },
        })),
      ],
    });
    if (!transactions.length) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        `No matching transactions were found. See /${BotCommandName.ListWatches}.`,
      ));
      return;
    }
    const deleteResult = await WatchedTransactionsModel.deleteMany({
      userId: user._id,
      _id: {
        $in: transactions.map((transaction) => transaction._id),
      },
    });
    await unwatchUnusedTransactions(
      transactions.map(({ txid }) => txid),
    );
    ctx.replyWithMarkdownV2(escapeMarkdown(
      `${deleteResult.deletedCount} ${
        (deleteResult.deletedCount === 1) ? 'transaction-watch was' : 'transaction-watches were'
      } removed.`,
    ));
  }

  static async [BotCommandName.Uwtxs](ctx: TextContext, user: UserDocument) {
    return TelegrafManager[BotCommandName.UnwatchTransactions](ctx, user);
  }

  static async [BotCommandName.WatchAddresses](ctx: TextContext, user: UserDocument) {
    const [commandName, ...args] = ctx.message.text.split(/\s+/);
    if (args.length === 0) {
      ctx.replyWithMarkdownV2(escapeMarkdown([
        `Syntax: "${commandName} <address1> <address2> ..." or "${
          commandName
        } <address1-nickname>:<address1> <address2-nickname>:<address2>...".`,
        'Address nickname must not contain spaces or more than 100 characters.',
      ].join(' ')));
      return;
    }
    const addresses: [string | undefined, string][] = [];
    for (const arg of args) {
      const parts = arg.split(':');
      const watchedAddress = parts.pop();
      if (!watchedAddress || !validate(watchedAddress)) {
        ctx.replyWithMarkdownV2(escapeMarkdown('Invalid address.'));
        return;
      }
      const nickname = parts.join(':');
      if (nickname.length > 100) {
        ctx.replyWithMarkdownV2(escapeMarkdown('Invalid address nickname.'));
        return;
      }
      addresses.push([
        (nickname.length > 0) ? nickname : undefined,
        watchedAddress,
      ]);
    }
    const nicknames = addresses.map(([nickname]) => nickname).filter((nickname) => nickname);
    if ((nicknames.length > 0) && await WatchedAddressesModel.findOne({
      userId: user._id,
      nickname: {
        $in: nicknames,
      },
    })) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        'You have already given the same nickname to another address that you watch.',
      ));
      return;
    }
    const existingWatches = await WatchedAddressesModel.find({
      userId: user._id,
      address: {
        $in: addresses.map(([, address]) => address),
      },
    });
    if (existingWatches.length > 0) {
      if (existingWatches.length === 1) {
        ctx.replyWithMarkdownV2(escapeMarkdown(
          `You are already watching this address. See: /${BotCommandName.ListWatches}`,
        ));
      } else if (existingWatches.length === addresses.length) {
        ctx.replyWithMarkdownV2(escapeMarkdown(
          `You are already watching all of these address. See: /${BotCommandName.ListWatches}`,
        ));
      } else {
        ctx.replyWithMarkdownV2(escapeMarkdown(
          `You are already watching some of these address. See: /${BotCommandName.ListWatches}`,
        ));
      }
      return;
    }
    await WatchedAddressesModel.insertMany(
      addresses.map(([nickname, watchedAddress]) => ({
        userId: user._id,
        address: watchedAddress,
        ...Boolean(nickname) && {
          nickname,
        },
      })),
    );
    const overloadedAddresses: string[] = [];
    for (const [, watchedAddress] of addresses) {
      const isOverloaded = bitcoindWatcher.watchAddress(watchedAddress);
      if (isOverloaded) {
        overloadedAddresses.push(watchedAddress);
      }
    }
    const isSingular = (addresses.length === 1);
    ctx.replyWithMarkdownV2(escapeMarkdown([
      `Started watching the ${
        isSingular ? 'address' : 'addresses'
      }. I will let you know when incoming transactions to ${
        isSingular ? 'this address' : 'these addresses'
      } appear in the mempool and in the blockchain, and when outgoing transactions from ${
        isSingular ? 'this address' : 'these addresses'
      } appear in the blockchain (outgoing transactions in the mempool will not be reported`,
      'so please be patient or check them manually).',
    ].join(' ')));
  }

  static async [BotCommandName.Wads](ctx: TextContext, user: UserDocument) {
    return TelegrafManager[BotCommandName.WatchAddresses](ctx, user);
  }

  static async [BotCommandName.UnwatchAddresses](ctx: TextContext, user: UserDocument) {
    const [commandName, ...args] = ctx.message.text.split(/\s+/);
    if (args.length === 0) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        `Syntax: "${commandName} <address>" or "${
          commandName
        } <address-nickname>" or "${
          commandName
        } <address-prefix>*". Don't forget the '*' when using a prefix match.`,
      ));
      return;
    }
    const watchedAddresses = await WatchedAddressesModel.find({
      userId: user._id,
      $or: [
        {
          address: {
            $in: args,
          },
        },
        {
          nickname: {
            $in: args,
          },
        },
        ...args.filter((arg) => /^\w*\*$/.test(arg)).map((arg) => ({
          address: {
            $regex: `^${arg.slice(0, -1)}.*$`,
          },
        })),
      ],
    });
    if (!watchedAddresses.length) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        `No matching addresses were found. See /${BotCommandName.ListWatches}.`,
      ));
      return;
    }
    const deleteResult = await WatchedAddressesModel.deleteMany({
      userId: user._id,
      _id: {
        $in: watchedAddresses.map(({ _id }) => _id),
      },
    });
    await unwatchUnusedAddresses(
      watchedAddresses.map(({ address }) => address),
    );
    ctx.replyWithMarkdownV2(escapeMarkdown(
      `${deleteResult.deletedCount} ${
        (deleteResult.deletedCount === 1) ? 'address-watch was' : 'address-watches were'
      } removed.`,
    ));
  }

  static async [BotCommandName.Uwads](ctx: TextContext, user: UserDocument) {
    return TelegrafManager[BotCommandName.UnwatchAddresses](ctx, user);
  }

  static async [BotCommandName.WatchPriceChange](ctx: TextContext, user: UserDocument) {
    const [commandName, ...args] = ctx.message.text.split(/\s+/);
    if ((args.length === 0) || (args.length > 1)) {
      ctx.replyWithMarkdownV2(escapeMarkdown([
        `Syntax: "${commandName} <price-delta-in-usd>"`,
        `i.e. To get a notification when the price changes by $1000, use "${commandName} 1000".`,
      ].join('\n')));
      return;
    }
    const delta = Number(args[0]);
    if ((delta <= 0) || !Number.isSafeInteger(delta)) {
      ctx.replyWithMarkdownV2(escapeMarkdown('Invalid value, must be a positive integer.'));
      return;
    }
    await UsersModel.updateOne(
      {
        _id: user._id,
      },
      {
        $set: {
          watchPriceChange: delta,
        },
      },
    );
    const result = await priceWatcher.watchPriceChange(user._id.toString(), delta);
    if (result) {
      const [lastPrice, minPrice, maxPrice] = result;
      ctx.replyWithMarkdownV2(escapeMarkdown([
        `The current price on CoinGecko is $${lastPrice.toFixed(2)}. I will check the price every`,
        `minute and let you know when the price goes below $${minPrice} or above $${maxPrice}.`,
      ].join(' ')));
    } else {
      ctx.replyWithMarkdownV2(escapeMarkdown([
        'Price watch has been set, but there seems to be a problem fetching the price from',
        'CoinGecko.',
      ].join(' ')));
    }
  }

  static async [BotCommandName.Wpc](ctx: TextContext, user: UserDocument) {
    return TelegrafManager[BotCommandName.WatchPriceChange](ctx, user);
  }

  static async [BotCommandName.UnwatchPriceChange](ctx: TextContext, user: UserDocument) {
    await UsersModel.updateOne(
      {
        _id: user._id,
      },
      {
        $unset: {
          watchPriceChange: true,
        },
      },
    );
    ctx.replyWithMarkdownV2(escapeMarkdown(
      'Stopped watching price changes.',
    ));
    if (
      user.watchPriceChange
      && !await UsersModel.findOne({ watchPriceChange: user.watchPriceChange })
    ) {
      priceWatcher.unwatchPriceChange(user._id.toString());
    }
  }

  static async [BotCommandName.Uwpc](ctx: TextContext, user: UserDocument) {
    return TelegrafManager[BotCommandName.UnwatchPriceChange](ctx, user);
  }

  static async [BotCommandName.MempoolLinks](ctx: TextContext) {
    const replyToMessage = ctx.message.reply_to_message;
    if (!replyToMessage) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        'Use this command as a reply to a previous command.',
      ));
      return;
    }
    const parts = replyToMessage.text.split(/[^0-9a-zA-Z]+/).filter(
      (part) => part && (part.length <= 64),
    );
    const links: string[] = [];
    let isNextPartBlock = false;
    for (const part of parts) {
      if (['block', 'blocks'].includes(part.toLowerCase())) {
        isNextPartBlock = true;
      } else if (validate(part, bitcoindWatcher.getChain())) {
        isNextPartBlock = false;
        links.push(`https://mempool.space/address/${part}`);
      } else if (/^[0-9a-fA-F]{64}$/.test(part)) {
        links.push(`https://mempool.space/${isNextPartBlock ? 'block' : 'tx'}/${part}`);
      } else {
        isNextPartBlock = false;
      }
    }
    if (links.length === 0) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        'No addresses, transaction-ids or block-hashes were found in that message.',
      ));
      return;
    }
    ctx.replyWithMarkdownV2(escapeMarkdown(
      `Here are the links to the addresses, transactions and blocks in that message:\n${
        links.join('\n')
      }`,
    ));
  }

  static async [BotCommandName.ListWatches](ctx: TextContext, user: UserDocument) {
    const lines: string[] = [];
    if (user.watchReboot) {
      lines.push(escapeMarkdown('You are watching server reboots.'));
    }
    if (user.watchNewBlocks) {
      lines.push(escapeMarkdown('You are watching new blocks.'));
    }
    if (user.watchPriceChange) {
      lines.push(escapeMarkdown(`You are watching price changes of $${user.watchPriceChange}.`));
    }
    const watchedTransactions = await WatchedTransactionsModel.find({
      userId: user._id,
    });
    if (watchedTransactions.length > 0) {
      lines.push(
        escapeMarkdown('You are watching the following transactions:'),
        ...watchedTransactions.map(
          (transaction) => `• ${escapeMarkdown(
            transaction.nickname
              ? `${transaction.nickname}:${transaction.txid}`
              : transaction.txid,
          )}`,
        ),
      );
    }
    const watchedAddresses = await WatchedAddressesModel.find({
      userId: user._id,
    });
    if (watchedAddresses.length > 0) {
      lines.push(
        escapeMarkdown('You are watching the following addresses:'),
        ...watchedAddresses.map(
          (watchedAddress) => `• ${escapeMarkdown(
            watchedAddress.nickname
              ? `${watchedAddress.nickname}:${watchedAddress.address}`
              : watchedAddress.address,
          )}`,
        ),
      );
    }
    if (lines.length === 0) {
      lines.push(escapeMarkdown('You are not watching anything.'));
    }
    ctx.replyWithMarkdownV2(lines.join('\n'));
  }

  static async [BotCommandName.Quit](ctx: TextContext) {
    const user = await deleteUser({
      telegramFromId: ctx.from?.id ?? '',
    });
    if (!user) {
      ctx.replyWithMarkdownV2(notFoundMessage);
      return;
    }
    ctx.replyWithMarkdownV2(escapeMarkdown('Woof! Goodbye.'));
  }
}

const telegramManager = new TelegrafManager();

export default telegramManager;
