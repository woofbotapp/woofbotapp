import {
  TelegramStatus, telegramCommands, BotCommandName, mSatsToSats, prettyDate, WatchName, watches,
  watchByName, PermissionKey, AppVersion, AppName,
} from '@woofbot/common';
import { Context, Telegraf, TelegramError } from 'telegraf';
import { validate } from 'bitcoin-address-validation';
import { Types } from 'mongoose';

import { SettingsModel } from '../models/settings';
import {
  defaultUserProperties, UsersModel, UserDocument, UserFields,
} from '../models/users';
import { WatchedAddressesModel } from '../models/watched-addresses';
import { TransactionStatus, WatchedTransactionsModel } from '../models/watched-transactions';
import { unwatchUnusedAddresses } from '../controllers/addresses';
import { unwatchUnusedTransactions } from '../controllers/transactions';
import { deleteUser } from '../controllers/users';
import {
  bitcoindWatcher, BitcoindWatcherEventName, NewTransactionAnalysisEvent, TransactionAnalysis,
  transactionAnalysisToString, NewAddressPaymentEvent, NewBlockAnalyzedEvent,
  NewMempoolClearStatusEvent,
} from './bitcoind-watcher';
import { errorString } from './error';
import logger from './logger';
import { zeroObjectId } from './mongo';
import { PriceChangeEvent, priceWatcher, PriceWatcherEventName } from './price-watcher';
import {
  LndChannelsStatusEvent, LndNewForwardsEvent, lndWatcher, LndWatcherEventName,
  LndInvoiceUpdatedEvent,
} from './lnd-watcher';
import {
  isTransactionId, mergeDescriptionToAddressId, mergeDescriptionToTransactionId,
} from './validations';

interface TextMessage {
  text: string;
}

interface TextContext extends Context {
  message: Context['message'] & TextMessage & { reply_to_message?: TextMessage };
}

export function escapeMarkdown(text: string): string {
  // escape Markdown V2
  return text.replaceAll(/([_*[\]()~`>#+-=|{}.!])/g, '\\$1');
}

function prettyBlockHash(blockHash: string): string {
  return `0..0${blockHash.replace(/^0+/, '')}`;
}

const sponsorship = `\n\n*Follow us on [Nostr \\(@woofbot\\)]\
(https://snort.social/woofbot@protonmail.com.ln2.email)\
 or on [Twitter \\(@woofbotapp\\)](https://twitter.com/woofbotapp)*`;

const startMessage = `${escapeMarkdown(`\
🐶 Welcome to ${AppName}, your personal telegram bot that will send you customized notifications.
For example, to get a notification whenever the server reboots, call /watch reboot.
To unset this configuration, call /unwatch reboot.
For a list of all commands, call /help.`)}${sponsorship}`;

const notFoundMessage = escapeMarkdown('Woof! Call /start first.');

const notPermittedMessage = escapeMarkdown(`\
👮 Sorry you are not allowed to run this command, please contact the bot administrator to add your\
 user to one of the command's permission groups\
`);

interface MessageTask {
  chatId: string | number;
  text: string;
}

const messageQueueIntervalMs = 60_000;
const messageQueueMaxSize = 10_000;
const transactionAnalysisTimeoutMs = 300_000;
const blockSkippedWarningBackoffMs = 300_000;

const telegramCommandByName = new Map(
  telegramCommands.map((telegramCommand) => [telegramCommand.name, telegramCommand]),
);

const telegramCommandByParametersRequestMessage = new Map(
  telegramCommands.filter(
    (telegramCommand) => telegramCommand.parametersRequestMessage,
  ).map((telegramCommand) => [telegramCommand.parametersRequestMessage, telegramCommand]),
);

const watchByParametersRequestMessage = new Map(
  watches.filter(
    (watch) => watch.watchParametersRequestMessage,
  ).map((watch) => [watch.watchParametersRequestMessage, watch]),
);

const unwatchByParametersRequestMessage = new Map(
  watches.filter(
    (watch) => watch.unwatchParametersRequestMessage,
  ).map((watch) => [watch.unwatchParametersRequestMessage, watch]),
);

const filteredTelegramCommands = telegramCommands.filter(
  ({ name }) => ![BotCommandName.Help, BotCommandName.Start].includes(name),
);

interface ChannelFullNameParams {
  channelId: string;
  partnerName?: string;
}

function channelFullName({
  channelId, partnerName,
}: ChannelFullNameParams): string {
  if (partnerName) {
    return `\`${escapeMarkdown(partnerName)}\` ${escapeMarkdown(`(${channelId})`)}`;
  }
  return escapeMarkdown(`channel-id ${channelId}`);
}

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
    bitcoindWatcher.on(
      BitcoindWatcherEventName.NewMempoolClearStatus,
      (event) => this.onNewMempoolClearStatus(event),
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
    lndWatcher.on(
      LndWatcherEventName.ChannelsStatus,
      (event) => this.onLndChannelsStatus(event),
    );
    lndWatcher.on(
      LndWatcherEventName.NewForwards,
      (event) => this.onLndNewForwards(event),
    );
    lndWatcher.on(
      LndWatcherEventName.InvoiceUpdated,
      (event) => this.onLndInvoiceUpdated(event),
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
          event.newPrice.toLocaleString('en-US')
        }. I will check the price every minute and let you know when the price goes below $${
          newMin.toLocaleString('en-US')
        } or above $${newMax.toLocaleString('en-US')}.`,
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
          (blockHash, index) => `Block ${prettyBlockHash(blockHash)} at height ${
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
            } 丰${incomeSats.toLocaleString('en-US')} by transaction ${txid}.`,
          );
        }
        if (outcomeSats !== undefined) {
          messages.push(
            `Address ${addressName} ${
              (status === TransactionStatus.FullConfirmation) ? 'has sent' : 'is sending'
            } 丰${outcomeSats.toLocaleString('en-US')} by transaction ${txid}.`,
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

  private async onNewMempoolClearStatus(parameters: NewMempoolClearStatusEvent) {
    try {
      logger.info(`onNewMempoolClearStatus: isClear ${parameters.isClear}`);
      const watchMempoolClearUsers = await UsersModel.find({
        watchMempoolClear: true,
      });
      const message = escapeMarkdown(
        parameters.isClear
          ? [
            '🌚 Woof! The mempool is clear and all of its transactions could fit in a the next',
            'block. Now is a good time to publish low-fee transactions.',
          ].join(' ')
          : [
            '🌝 Woof! The mempool is no longer clear and more than one block is needed to confirm',
            'all of its transactions.',
          ].join(' '),
      );
      for await (const user of watchMempoolClearUsers) {
        await this.sendMessage({
          chatId: user.telegramChatId,
          text: message,
        });
      }
    } catch (error) {
      logger.error(
        `TelegrafManager: Failed to handle mempool clear status: ${errorString(error)}`,
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

  private async onLndChannelsStatus(event: LndChannelsStatusEvent) {
    try {
      logger.info(`onLndChannelsStatus: ${JSON.stringify(event)}`);
      const settings = await SettingsModel.findByIdAndUpdate(
        zeroObjectId,
        {
          $set: {
            lndChannels: event.allChannels,
          },
        },
      );
      if (!settings) {
        throw new Error('settings not found');
      }
      if (!settings.lndChannels) {
        return;
      }
      if (event.addedChannels.length > 0) {
        const openedChannelsUsers = await UsersModel.find({
          watchLightningChannelsOpened: true,
        });
        const message = `${
          escapeMarkdown(
            event.addedChannels.length === 1
              ? '🤝 Woof! A new lightning channel was opened: '
              : '🤝 Woof! New lightning channels were opened: ',
          )
        }${event.addedChannels.map(channelFullName).join(escapeMarkdown(', '))}`;
        for (const user of openedChannelsUsers) {
          // eslint-disable-next-line no-await-in-loop
          await this.sendMessage({
            chatId: user.telegramChatId,
            text: message,
          });
        }
      }
      if (event.removedChannels.length > 0) {
        const closedChannelsUsers = await UsersModel.find({
          watchLightningChannelsClosed: true,
        });
        const message = `${
          escapeMarkdown(
            event.removedChannels.length === 1
              ? '🙌 Woof! A lightning channel was closed: '
              : '🙌 Woof! Some lightning channels were closed: ',
          )
        }${event.removedChannels.map(channelFullName).join(escapeMarkdown(', '))}`;
        for (const user of closedChannelsUsers) {
          // eslint-disable-next-line no-await-in-loop
          await this.sendMessage({
            chatId: user.telegramChatId,
            text: message,
          });
        }
      }
    } catch (error) {
      logger.error(`onLndChannelsStatus: failed ${errorString(error)}`);
    }
  }

  private async onLndNewForwards(event: LndNewForwardsEvent) {
    try {
      logger.info(`onLndNewForwards: ${JSON.stringify(event)}`);
      const settings = await SettingsModel.findByIdAndUpdate(
        zeroObjectId,
        {
          $set: {
            lndLastForwardAt: event.lastForwardAt,
            lndLastForwardCount: event.lastForwardCount,
          },
        },
      );
      if (!settings) {
        throw new Error('settings not found');
      }
      if (event.forwards.length === 0 && !event.tooMany) {
        return;
      }
      const users = await UsersModel.find({
        watchLightningForwards: true,
      });
      const message = event.forwards.length > 0
        ? `${escapeMarkdown(`✨ Woof! You have earned lightning fees:`)} ${
          event.forwards.map((forward) => {
            const fromChannelName = channelFullName({
              channelId: forward.incoming_channel, partnerName: forward.incomingPartnerName,
            });
            const toChannelName = channelFullName({
              channelId: forward.outgoing_channel, partnerName: forward.outgoingPartnerName,
            });
            return `${
              escapeMarkdown(`丰${mSatsToSats(forward.fee_mtokens)} for forwarding 丰${
                mSatsToSats(forward.mtokens)
              } at ${prettyDate(forward.createdAt.toJSON())} from `)
            }${fromChannelName}${
              escapeMarkdown(' to ')
            }${toChannelName}`;
          }).join(escapeMarkdown(', '))
        }`
        : escapeMarkdown(
          '✨ Woof! There were too many forwardings at the same second to display here.',
        );
      for (const user of users) {
        // eslint-disable-next-line no-await-in-loop
        await this.sendMessage({
          chatId: user.telegramChatId,
          text: message,
        });
      }
    } catch (error) {
      logger.error(`onLndNewForwards: failed ${errorString(error)}`);
    }
  }

  private async onLndInvoiceUpdated(event: LndInvoiceUpdatedEvent) {
    try {
      if (event.is_outgoing) {
        return;
      }
      logger.info(`onLndInvoiceUpdated: ${event.id} ${event.confirmed_at ?? 'unconfirmed'}`);
      const users = await UsersModel.find(
        event.confirmed_at
          ? {
            watchLightningInvoicesPaid: true,
          }
          : {
            watchLightningInvoicesCreated: true,
          },
      );
      const message = escapeMarkdown(
        event.confirmed_at
          ? `⚡ Woof! You have received a lightning payment of 丰${
            mSatsToSats(event.received_mtokens)
          } at ${prettyDate(event.confirmed_at)}\nInvoice Creation Time: ${
            prettyDate(event.created_at)
          }\nInvoice Description:`
          : `🧾 Woof! Your node has created an invoice for ${
            event.mtokens ? `丰${mSatsToSats(event.mtokens)}` : 'unknown amount'
          } at ${
            prettyDate(event.created_at)
          }\nInvoice Expiration: ${
            prettyDate(event.expires_at)
          }\nInvoice Description:`,
      ) + (
        event.description
          ? `\n\`\`\`\n${escapeMarkdown(event.description)}\n\`\`\``
          : ` empty`
      );
      for (const user of users) {
        // eslint-disable-next-line no-await-in-loop
        await this.sendMessage({
          chatId: user.telegramChatId,
          text: message,
        });
      }
    } catch (error) {
      logger.error(`onLndInvoiceUpdated: failed ${errorString(error)}`);
    }
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
                  [...newAnalysis.blockHashes].map(prettyBlockHash).join(', ') || 'unknown'
                }.`,
              );
              break;
            case TransactionStatus.FullConfirmation:
              messages.push(
                `🚀 Woof! Transaction ${transactionName} has ${newAnalysis.confirmations}`,
                'confirmations and is now fully confirmed.',
                `It was mined in block ${
                  [...newAnalysis.blockHashes].map(prettyBlockHash).join(', ') || 'unknown'
                }.`,
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
          disable_web_page_preview: true,
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
      logger.info(`TelegrafManager: Got settings, internal status is ${this.internalStatus}`);
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
            disable_web_page_preview: true,
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

  static async isPermitted(user: UserFields, permissionKey: PermissionKey): Promise<boolean> {
    const settings = await SettingsModel.findById(zeroObjectId);
    if (!settings) {
      throw new Error('Settings not found to check permission groups');
    }
    const commandPermissionGroups = settings?.commandsPermissionGroups[permissionKey];
    if (!commandPermissionGroups) {
      return true;
    }
    const commandPermissionGroupsSet = new Set(commandPermissionGroups);
    return user.permissionGroups.some(
      (group) => commandPermissionGroupsSet.has(group),
    );
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
          const telegramUsername = ctx.from.username ?? '';
          const canInsert = (
            (settings.maxUsers === undefined) || (usersCount < settings.maxUsers)
          ) && (
            (settings.usersWhitelist === undefined) || settings.usersWhitelist.includes(
              telegramUsername,
            )
          );
          const found = await UsersModel.findOneAndUpdate(
            {
              telegramFromId: ctx.from.id,
            },
            {
              $set: {
                telegramChatId: ctx.chat.id,
                telegramUsername,
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
              'You are restricted from accessing this bot.',
              'Please contact the bot administrator and ask to be added to the users whitelist',
              'or to increase the maximal number of users that the bot is allowed to support.',
            ].join(' ')));
            return;
          }
          if (settings.usersWhitelist) {
            await SettingsModel.updateOne(
              {
                _id: zeroObjectId,
              },
              {
                $pull: {
                  usersWhitelist: telegramUsername,
                },
              },
            );
          }
          await ctx.replyWithMarkdownV2(startMessage, { disable_web_page_preview: true });
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
                ({ name, description }) => `/${name} - ${description}`,
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
      for (const command of filteredTelegramCommands) {
        bot.command(command.name, async (ctx) => {
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
            const { permissionKey } = command;
            if (permissionKey && !await TelegrafManager.isPermitted(user, permissionKey)) {
              ctx.replyWithMarkdownV2(notPermittedMessage);
              return;
            }
            const args = ctx.message.text.trim().split(/\s+/).slice(1);
            const parametersRequestMessage = telegramCommandByName.get(
              command.name,
            )?.parametersRequestMessage;
            if ((args.length === 0) && parametersRequestMessage) {
              await ctx.replyWithMarkdownV2(
                escapeMarkdown(parametersRequestMessage),
                {
                  reply_markup: {
                    force_reply: true,
                  },
                },
              );
              return;
            }
            await this.runCommand(command.name, ctx as TextContext, user, args);
          } catch (error) {
            logger.error(
              `TelegrafManager: Failed to run command ${command.name} for chat-id ${
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
          const textContext = ctx as TextContext;
          const replyToMessageText = textContext.message.reply_to_message?.text;
          const args = ctx.message.text.trim().split(/\s+/).filter((arg) => arg);
          if (replyToMessageText && args.length > 0) {
            const telegramCommand = telegramCommandByParametersRequestMessage.get(
              replyToMessageText,
            );
            if (telegramCommand) {
              const user = ctx.from?.id && await UsersModel.findOne(
                {
                  telegramFromId: ctx.from.id,
                },
              );
              if (!user) {
                await ctx.replyWithMarkdownV2(notFoundMessage);
                return;
              }
              const { permissionKey } = telegramCommand;
              if (permissionKey && !await TelegrafManager.isPermitted(user, permissionKey)) {
                ctx.replyWithMarkdownV2(notPermittedMessage);
                return;
              }
              await this.runCommand(telegramCommand.name, textContext, user, args);
              return;
            }
            const watch = watchByParametersRequestMessage.get(
              replyToMessageText,
            );
            if (watch) {
              const user = ctx.from?.id && await UsersModel.findOne(
                {
                  telegramFromId: ctx.from.id,
                },
              );
              if (!user) {
                await ctx.replyWithMarkdownV2(notFoundMessage);
                return;
              }
              const { permissionKey } = watch;
              if (permissionKey && !await TelegrafManager.isPermitted(user, permissionKey)) {
                ctx.replyWithMarkdownV2(notPermittedMessage);
                return;
              }
              switch (watch.name) {
                case WatchName.Transaction:
                  await this.watchTransaction(textContext, user, args);
                  return;
                case WatchName.Addresses:
                  await TelegrafManager.watchAddresses(textContext, user, args);
                  return;
                case WatchName.PriceChange:
                  await TelegrafManager.watchPriceChange(textContext, user, args);
                  return;
                default:
                  break;
              }
            }
            const unwatch = unwatchByParametersRequestMessage.get(
              replyToMessageText,
            );
            if (unwatch) {
              const user = ctx.from?.id && await UsersModel.findOne(
                {
                  telegramFromId: ctx.from.id,
                },
              );
              if (!user) {
                await ctx.replyWithMarkdownV2(notFoundMessage);
                return;
              }
              const { permissionKey } = unwatch;
              if (permissionKey && !await TelegrafManager.isPermitted(user, permissionKey)) {
                ctx.replyWithMarkdownV2(notPermittedMessage);
                return;
              }
              switch (unwatch.name) {
                case WatchName.Transaction:
                  await TelegrafManager.unwatchTransactions(textContext, user, args);
                  return;
                case WatchName.Addresses:
                  await TelegrafManager.unwatchAddresses(textContext, user, args);
                  return;
                default:
                  break;
              }
            }
          }
          await ctx.replyWithMarkdownV2(escapeMarkdown(
            'Woof! I could not understand you. See /help.',
          ));
        } catch (error) {
          logger.error(
            `TelegrafManager: Failed to hear unknown text in chat-id ${
              ctx.chat.id
            }: ${errorString(error)}`,
          );
        }
      });
      logger.info('TelegrafManager: settings commands');
      await bot.telegram.setMyCommands(
        telegramCommands.map(
          ({ name, description }) => ({ command: name, description }),
        ),
      );
      logger.info('TelegrafManager: starting launch');
      bot.launch({
        dropPendingUpdates: true,
      });
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

  async runCommand(
    command: BotCommandName,
    ctx: TextContext,
    user: UserDocument,
    args: string[],
  ) {
    if (this[command]) {
      await this[command](ctx, user, args);
    } else {
      await TelegrafManager[command](ctx, user, args);
    }
  }

  static async [BotCommandName.WhoAmI](ctx: TextContext, user: UserDocument) {
    ctx.replyWithMarkdownV2(escapeMarkdown(
      `You are @${user.telegramUsername}, telegram-id ${
        user.telegramFromId
      }, local-id ${user.id}`,
    ));
  }

  static async [BotCommandName.About](ctx: TextContext) {
    try {
      const bitcoindInfo = await bitcoindWatcher.getInfo();
      const match = bitcoindInfo.version.match(/^\/Satoshi:(.+)\/$/);
      ctx.replyWithMarkdownV2(escapeMarkdown(
        `🐶 ${AppName} v${AppVersion}\nBitcoin node version: ${
          match?.[1] ?? bitcoindInfo.version
        }\nBitcoin chain: ${bitcoindInfo.chain}\n${
          lndWatcher.isRunning()
            ? `LND version: ${
              (await lndWatcher.lndVersion()) || 'unknown'
            }`
            : 'LND: not connected'
        }`,
      ));
    } catch (error) {
      logger.error(`Failed to run about command: ${errorString(error)}`);
      ctx.replyWithMarkdownV2(escapeMarkdown(
        `Failed to get server info (${AppName} v${AppVersion}), server might still be booting.`,
      ));
    }
  }

  async [BotCommandName.Watch](
    ctx: TextContext,
    user: UserDocument,
    args: string[],
  ): Promise<void | undefined> {
    if (args.length === 0) {
      ctx.replyWithMarkdownV2(
        escapeMarkdown('Which events would you like to get notifications for?'),
        {
          reply_markup: {
            keyboard: watches.map(
              (watch) => [{ text: `/watch ${watch.name}` }],
            ),
          },
        },
      );
      return undefined;
    }
    const [watchName, ...leftArgs] = args;
    const watch = watchByName.get(watchName as WatchName);
    if (!watch) {
      ctx.replyWithMarkdownV2(
        escapeMarkdown('Unrecognized event-name to watch'),
      );
      return undefined;
    }
    if (leftArgs.length === 0 && watch?.watchParametersRequestMessage) {
      await ctx.replyWithMarkdownV2(
        escapeMarkdown(watch?.watchParametersRequestMessage),
        {
          reply_markup: {
            force_reply: true,
          },
        },
      );
      return undefined;
    }
    const { permissionKey } = watch;
    if (permissionKey && !await TelegrafManager.isPermitted(user, permissionKey)) {
      ctx.replyWithMarkdownV2(notPermittedMessage);
      return undefined;
    }
    switch (watch.name) {
      case WatchName.Reboot:
        return TelegrafManager.watchReboot(ctx, user);
      case WatchName.Transaction:
        return this.watchTransaction(ctx, user, leftArgs);
      case WatchName.Addresses:
        return TelegrafManager.watchAddresses(ctx, user, leftArgs);
      case WatchName.PriceChange:
        return TelegrafManager.watchPriceChange(ctx, user, leftArgs);
      case WatchName.NewBlocks:
        return TelegrafManager.watchNewBlocks(ctx, user);
      case WatchName.MempoolClear:
        return TelegrafManager.watchMempoolClear(ctx, user);
      case WatchName.LightningChannelsOpened:
        return TelegrafManager.watchLightningChannelsOpened(ctx, user);
      case WatchName.LightningChannelsClosed:
        return TelegrafManager.watchLightningChannelsClosed(ctx, user);
      case WatchName.LightningForwards:
        return TelegrafManager.watchLightningForwards(ctx, user);
      case WatchName.LightningInvoicesCreated:
        return TelegrafManager.watchLightningInvoicesCreated(ctx, user);
      case WatchName.LightningInvoicesPaid:
        return TelegrafManager.watchLightningInvoicesPaid(ctx, user);
      default:
        break;
    }
    return undefined;
  }

  static async [BotCommandName.Unwatch](
    ctx: TextContext,
    user: UserDocument,
    args: string[],
  ): Promise<void | undefined> {
    if (args.length === 0) {
      ctx.replyWithMarkdownV2(
        escapeMarkdown('Which watches would you like to cancel?'),
        {
          reply_markup: {
            keyboard: watches.map(
              (watch) => [{ text: `/unwatch ${watch.name}` }],
            ),
          },
        },
      );
      return undefined;
    }
    const [watchName, ...leftArgs] = args;
    const watch = watchByName.get(watchName as WatchName);
    if (!watch) {
      ctx.replyWithMarkdownV2(
        escapeMarkdown('Unrecognized event-name to unwatch'),
      );
      return undefined;
    }
    if (leftArgs.length === 0 && watch?.unwatchParametersRequestMessage) {
      await ctx.replyWithMarkdownV2(
        escapeMarkdown(watch?.unwatchParametersRequestMessage),
        {
          reply_markup: {
            force_reply: true,
          },
        },
      );
      return undefined;
    }
    switch (watch.name) {
      case WatchName.Reboot:
        return TelegrafManager.unwatchReboot(ctx, user);
      case WatchName.Transaction:
        return TelegrafManager.unwatchTransactions(ctx, user, leftArgs);
      case WatchName.Addresses:
        return TelegrafManager.unwatchAddresses(ctx, user, leftArgs);
      case WatchName.PriceChange:
        return TelegrafManager.unwatchPriceChange(ctx, user);
      case WatchName.NewBlocks:
        return TelegrafManager.unwatchNewBlocks(ctx, user);
      case WatchName.MempoolClear:
        return TelegrafManager.unwatchMempoolClear(ctx, user);
      case WatchName.LightningChannelsOpened:
        return TelegrafManager.unwatchLightningChannelsOpened(ctx, user);
      case WatchName.LightningChannelsClosed:
        return TelegrafManager.unwatchLightningChannelsClosed(ctx, user);
      case WatchName.LightningForwards:
        return TelegrafManager.unwatchLightningForwards(ctx, user);
      case WatchName.LightningInvoicesCreated:
        return TelegrafManager.unwatchLightningInvoicesCreated(ctx, user);
      case WatchName.LightningInvoicesPaid:
        return TelegrafManager.unwatchLightningInvoicesPaid(ctx, user);
      default:
        break;
    }
    return undefined;
  }

  static async watchReboot(ctx: TextContext, user: UserDocument) {
    const found = await UsersModel.findByIdAndUpdate(
      user._id,
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

  static async unwatchReboot(ctx: TextContext, user: UserDocument) {
    const found = await UsersModel.findByIdAndUpdate(
      user._id,
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

  static async watchNewBlocks(ctx: TextContext, user: UserDocument) {
    const settings = await SettingsModel.findById(zeroObjectId);
    if (!settings) {
      ctx.replyWithMarkdownV2(notFoundMessage);
      return;
    }
    const found = await UsersModel.findByIdAndUpdate(
      user._id,
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
    ctx.replyWithMarkdownV2(escapeMarkdown(
      `Started watching new blocks. Best block height is: ${settings.bestBlockHeight}.`,
    ));
  }

  static async unwatchNewBlocks(ctx: TextContext, user: UserDocument) {
    const found = await UsersModel.findByIdAndUpdate(
      user._id,
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

  async watchTransaction(ctx: TextContext, user: UserDocument, originalArgs: string[]) {
    const args = mergeDescriptionToTransactionId(originalArgs);
    if (args.length > 1) {
      ctx.replyWithMarkdownV2(escapeMarkdown('Too many parameters'));
      return;
    }
    const parts = args[0].split(':');
    const txid = parts.pop();
    if (!txid || !isTransactionId(txid)) {
      ctx.replyWithMarkdownV2(escapeMarkdown('Invalid transaction id - expected 64 hex chars in lowecase.'));
      return;
    }
    const nickname = parts.join(':');
    if (nickname.length > 100) {
      ctx.replyWithMarkdownV2(escapeMarkdown('The transaction nickname is too long.'));
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
    // Run asyncly
    this.handleTransactionWatchRequest(user, txid, nickname);
  }

  private async handleTransactionWatchRequest(
    user: UserDocument,
    txid: string,
    nickname: string,
  ): Promise<void> {
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
              [...analysis.blockHashes].map(prettyBlockHash).join(', ') || 'unknown'
            }.`,
          );
          break;
        case TransactionStatus.FullConfirmation:
          replyMessage.push(
            `🚀 This transaction already has ${
              analysis.confirmations
            } confirmations and is fully confirmed, so there is no need to watch it anymore.`,
            `It was mined in block ${
              [...analysis.blockHashes].map(prettyBlockHash).join(', ') || 'unknown'
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
        text: escapeMarkdown('⚠️ Woof! Failed to initialize transaction watch.'),
      });
      logger.error(`Failed to initialize transaction watch: ${errorString(error)}`);
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

  static async unwatchTransactions(
    ctx: TextContext,
    user: UserDocument,
    args: string[],
  ) {
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

  static async watchAddresses(
    ctx: TextContext,
    user: UserDocument,
    originalArgs: string[],
  ) {
    const args = mergeDescriptionToAddressId(originalArgs);
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
        ctx.replyWithMarkdownV2(escapeMarkdown('The address nickname is too long.'));
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

  static async unwatchAddresses(
    ctx: TextContext,
    user: UserDocument,
    args: string[],
  ) {
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

  static async watchPriceChange(
    ctx: TextContext,
    user: UserDocument,
    args: string[],
  ) {
    if (args.length > 1) {
      ctx.replyWithMarkdownV2(escapeMarkdown([
        'Syntax: "/watch price-change <price-delta-in-usd>"',
        'i.e. To get a notification when the price changes by $1000, use "/watch price-change 1000".',
      ].join('\n')));
      return;
    }
    const delta = Number(args[0].replaceAll(',', ''));
    if ((delta <= 0) || !Number.isSafeInteger(delta)) {
      ctx.replyWithMarkdownV2(escapeMarkdown([
        'Invalid value, must be a positive integer.',
        'Try using only digits, and avoid commas and other symbols.',
      ].join(' ')));
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
      ctx.replyWithMarkdownV2(escapeMarkdown(
        `The current price on CoinGecko is $${
          lastPrice.toLocaleString('en-US')
        }. I will check the price every minute and let you know when the price goes below $${
          minPrice.toLocaleString('en-US')
        } or above $${maxPrice.toLocaleString('en-US')}.`,
      ));
    } else {
      ctx.replyWithMarkdownV2(escapeMarkdown([
        'Price watch has been set, but there seems to be a problem fetching the price from',
        'CoinGecko.',
      ].join(' ')));
    }
  }

  static async unwatchPriceChange(ctx: TextContext, user: UserDocument) {
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
    if (user.watchPriceChange) {
      priceWatcher.unwatchPriceChange(user._id.toString());
    }
  }

  static async watchMempoolClear(ctx: TextContext, user: UserDocument) {
    await UsersModel.updateOne(
      {
        _id: user._id,
      },
      {
        $set: {
          watchMempoolClear: true,
        },
      },
    );
    // Side effect: if the mempool size was not calculated yet, assuming that it is not clear.
    const isMempoolClear = bitcoindWatcher.isMempoolClear() ?? false;

    ctx.replyWithMarkdownV2(escapeMarkdown(
      isMempoolClear
        ? [
          'The mempool is clear. I will let you know when the mempool transactions will no',
          'longer fit in a single block (no room for low-fee transactions).',
        ].join(' ')
        : [
          'The mempool is not clear. I will let you know when the mempool transactions could fit',
          'in a single block and there is room for low-fee transactions.',
        ].join(' '),
    ));
  }

  static async unwatchMempoolClear(ctx: TextContext, user: UserDocument) {
    await UsersModel.updateOne(
      {
        _id: user._id,
      },
      {
        $set: {
          watchMempoolClear: false,
        },
      },
    );
    ctx.replyWithMarkdownV2(escapeMarkdown(
      'Stopped watching mempool clearance.',
    ));
  }

  static async watchLightningChannelsOpened(ctx: TextContext, user: UserDocument) {
    if (!lndWatcher.isRunning()) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        'Sorry, the LND integration is not configured.',
      ));
      return;
    }
    await UsersModel.updateOne(
      {
        _id: user._id,
      },
      {
        $set: {
          watchLightningChannelsOpened: true,
        },
      },
    );
    ctx.replyWithMarkdownV2(escapeMarkdown(
      'Started watching for new lightning channels being opened.',
    ));
  }

  static async unwatchLightningChannelsOpened(
    ctx: TextContext,
    user: UserDocument,
  ) {
    if (!lndWatcher.isRunning()) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        'Sorry, the LND integration is not configured.',
      ));
      return;
    }
    await UsersModel.updateOne(
      {
        _id: user._id,
      },
      {
        $set: {
          watchLightningChannelsOpened: false,
        },
      },
    );
    ctx.replyWithMarkdownV2(escapeMarkdown(
      'Stopped watching for new lightning channels being opened.',
    ));
  }

  static async watchLightningChannelsClosed(
    ctx: TextContext,
    user: UserDocument,
  ) {
    if (!lndWatcher.isRunning()) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        'Sorry, the LND integration is not configured.',
      ));
      return;
    }
    await UsersModel.updateOne(
      {
        _id: user._id,
      },
      {
        $set: {
          watchLightningChannelsClosed: true,
        },
      },
    );
    ctx.replyWithMarkdownV2(escapeMarkdown(
      'Started watching for lightning channels being closed.',
    ));
  }

  static async unwatchLightningChannelsClosed(
    ctx: TextContext,
    user: UserDocument,
  ) {
    if (!lndWatcher.isRunning()) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        'Sorry, the LND integration is not configured.',
      ));
      return;
    }
    await UsersModel.updateOne(
      {
        _id: user._id,
      },
      {
        $set: {
          watchLightningChannelsClosed: false,
        },
      },
    );
    ctx.replyWithMarkdownV2(escapeMarkdown(
      'Stopped watching for lightning channels being closed.',
    ));
  }

  static async watchLightningForwards(
    ctx: TextContext,
    user: UserDocument,
  ) {
    if (!lndWatcher.isRunning()) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        'Sorry, the LND integration is not configured.',
      ));
      return;
    }
    await UsersModel.updateOne(
      {
        _id: user._id,
      },
      {
        $set: {
          watchLightningForwards: true,
        },
      },
    );
    ctx.replyWithMarkdownV2(escapeMarkdown(
      'Started watching for lightning forwards.',
    ));
  }

  static async unwatchLightningForwards(
    ctx: TextContext,
    user: UserDocument,
  ) {
    if (!lndWatcher.isRunning()) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        'Sorry, the LND integration is not configured.',
      ));
      return;
    }
    await UsersModel.updateOne(
      {
        _id: user._id,
      },
      {
        $set: {
          watchLightningForwards: false,
        },
      },
    );
    ctx.replyWithMarkdownV2(escapeMarkdown(
      'Stopped watching for lightning forwards.',
    ));
  }

  static async watchLightningInvoicesCreated(
    ctx: TextContext,
    user: UserDocument,
  ) {
    if (!lndWatcher.isRunning()) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        'Sorry, the LND integration is not configured.',
      ));
      return;
    }
    await UsersModel.updateOne(
      {
        _id: user._id,
      },
      {
        $set: {
          watchLightningInvoicesCreated: true,
        },
      },
    );
    ctx.replyWithMarkdownV2(escapeMarkdown(
      'Started watching for lightning invoices creation.',
    ));
  }

  static async unwatchLightningInvoicesCreated(
    ctx: TextContext,
    user: UserDocument,
  ) {
    if (!lndWatcher.isRunning()) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        'Sorry, the LND integration is not configured.',
      ));
      return;
    }
    await UsersModel.updateOne(
      {
        _id: user._id,
      },
      {
        $set: {
          watchLightningInvoicesCreated: false,
        },
      },
    );
    ctx.replyWithMarkdownV2(escapeMarkdown(
      'Stopped watching for lightning invoices creation.',
    ));
  }

  static async watchLightningInvoicesPaid(
    ctx: TextContext,
    user: UserDocument,
  ) {
    if (!lndWatcher.isRunning()) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        'Sorry, the LND integration is not configured.',
      ));
      return;
    }
    await UsersModel.updateOne(
      {
        _id: user._id,
      },
      {
        $set: {
          watchLightningInvoicesPaid: true,
        },
      },
    );
    ctx.replyWithMarkdownV2(escapeMarkdown(
      'Started watching for lightning invoices being paid.',
    ));
  }

  static async unwatchLightningInvoicesPaid(
    ctx: TextContext,
    user: UserDocument,
  ) {
    if (!lndWatcher.isRunning()) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        'Sorry, the LND integration is not configured.',
      ));
      return;
    }
    await UsersModel.updateOne(
      {
        _id: user._id,
      },
      {
        $set: {
          watchLightningInvoicesPaid: false,
        },
      },
    );
    ctx.replyWithMarkdownV2(escapeMarkdown(
      'Stopped watching for lightning invoices being paid.',
    ));
  }

  static async [BotCommandName.Links](ctx: TextContext) {
    const replyToMessage = ctx.message.reply_to_message;
    if (!replyToMessage) {
      ctx.replyWithMarkdownV2(escapeMarkdown(
        'Use this command as a reply to a previous command.',
      ));
      return;
    }
    const settings = await SettingsModel.findById(zeroObjectId);
    if (!settings) {
      throw new Error('Settings not found');
    }
    const parts = replyToMessage.text.split(/[^0-9a-zA-Z.]+/).map(
      (part) => part.replace(/(^\.+|\.+$)/, ''),
    ).filter((part) => part && (part.length <= 128));
    const links: string[] = [];
    for (const part of parts) {
      if (validate(part, bitcoindWatcher.getChain())) {
        links.push(`${settings.mempoolUrlPrefix}/address/${part}`);
      } else if (/^0\.\.0[0-9a-fA-F]+/.test(part)) {
        links.push(`${settings.mempoolUrlPrefix}/block/${
          part.replace(/^0\.\.0/, '').padStart(64, '0')
        }`);
      } else if (/^[0-9a-fA-F]{64}$/.test(part)) {
        links.push(`${settings.mempoolUrlPrefix}/tx/${part}`);
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
      lines.push(escapeMarkdown(`You are watching price changes of $${
        user.watchPriceChange.toLocaleString('en-US')
      }.`));
    }
    if (user.watchMempoolClear) {
      lines.push(escapeMarkdown('You are watching mempool becoming clear.'));
    }
    if (user.watchLightningChannelsOpened) {
      lines.push(escapeMarkdown('You are watching lightning channels being opened.'));
    }
    if (user.watchLightningChannelsClosed) {
      lines.push(escapeMarkdown('You are watching lightning channels being closed.'));
    }
    if (user.watchLightningForwards) {
      lines.push(escapeMarkdown('You are watching lightning forwards.'));
    }
    if (user.watchLightningInvoicesCreated) {
      lines.push(escapeMarkdown('You are watching lightning invoices creation.'));
    }
    if (user.watchLightningInvoicesPaid) {
      lines.push(escapeMarkdown('You are watching lightning invoices being paid.'));
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

  static async [BotCommandName.Quit](ctx: TextContext, user: UserDocument) {
    const found = await deleteUser({
      _id: user._id,
    });
    if (!found) {
      ctx.replyWithMarkdownV2(notFoundMessage);
      return;
    }
    ctx.replyWithMarkdownV2(escapeMarkdown('Woof! Goodbye.'));
  }
}

const telegramManager = new TelegrafManager();

export default telegramManager;
