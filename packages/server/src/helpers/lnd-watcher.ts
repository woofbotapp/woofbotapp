import { EventEmitter } from 'stream';
import fs from 'fs';
import {
  authenticatedLndGrpc, AuthenticatedLnd, getChannels, subscribeToChannels,
  getForwards, subscribeToForwards, subscribeToInvoices,
} from 'lightning';
import logger from './logger';
import { LndChannelInformation } from '../models/settings';
import { errorString } from './error';

export enum LndWatcherEventName {
  CheckChannels = 'checkChannels', // internal
  CheckForwards = 'checkForwards', // internal
  ChannelsStatus = 'channelStatus',
  NewForwards = 'newForward',
  InvoiceUpdated = 'invoiceUpdated',
}

export interface LndChannelsStatusEvent {
  addedChannels: LndChannelInformation[];
  removedChannels: LndChannelInformation[];
  allChannels: LndChannelInformation[];
}

export interface LndInvoiceUpdatedEvent {

}

interface ForwardInformation {
  createdAt: Date; // original created_at is a string
  fee: number;
  fee_mtokens: string;
  incoming_channel: string;
  mtokens: string;
  outgoing_channel: string;
  tokens: number;
}

export interface LndNewForwardsEvent {
  forwards: ForwardInformation[];
  tooMany: boolean;
  lastForwardAt: Date;
  lastForwardCount: number;
}

const delayedCheckTimeoutMs = 1_000;
const recheckGraceMs = 15_000;
const getForwardsLimit = 50;

interface LndWatcherStartOptions {
  savedChannels: LndChannelInformation[] | undefined;
  lastForwardAt: Date;
  lastForwardCount: number;
}

class LndWatcher extends EventEmitter {
  private lnd: AuthenticatedLnd | undefined;

  private channelsSubscriber: EventEmitter | undefined;

  private delayedCheckChannelsTimeout: ReturnType<typeof setTimeout> | undefined;

  private savedChannels: Map<string, LndChannelInformation> | undefined;

  private isCheckingChannels: boolean = false;

  private shouldRecheckChannels: boolean = false;

  private forwardsSubscriber: EventEmitter | undefined;

  private delayedCheckForwardsTimeout: ReturnType<typeof setTimeout> | undefined;

  private lastForwardAt: Date = new Date(0);

  private lastForwardCount: number = 0;

  private isCheckingForwards: boolean = false;

  private shouldRecheckForwards: boolean = false;

  private invoicesSubscriber: EventEmitter | undefined;

  constructor() {
    super();
    this.on(LndWatcherEventName.CheckChannels, () => this.checkChannelsSafe());
    this.on(LndWatcherEventName.CheckForwards, () => this.checkForwardsSafe());
  }

  async start({
    savedChannels,
    lastForwardAt,
    lastForwardCount,
  }: LndWatcherStartOptions) {
    if (savedChannels) {
      this.savedChannels = new Map(savedChannels.map((channel) => [channel.channelId, channel]));
    }
    this.lastForwardAt = lastForwardAt;
    this.lastForwardCount = lastForwardCount;
    for (const paramName of [
      'APP_LIGHTNING_NODE_IP',
      'APP_LIGHTNING_NODE_GRPC_PORT',
      'LND_READONLY_MACAROON_PATH',
      'LND_TLS_PATH',
    ]) {
      if (!process.env[paramName]) {
        logger.info(`LndWatcher: missing ${paramName}`);
        return;
      }
    }
    logger.info(`LndWatcher: reading ${process.env.LND_READONLY_MACAROON_PATH}}`);
    const readonlyMacaroon: Buffer = await new Promise((resolve, reject) => {
      fs.readFile(process.env.LND_READONLY_MACAROON_PATH ?? '', (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
    logger.info(`LndWatcher: reading ${process.env.LND_TLS_PATH}`);
    const tls: Buffer = await new Promise((resolve, reject) => {
      fs.readFile(process.env.LND_TLS_PATH ?? '', (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
    const socketTarget = `${
      process.env.APP_LIGHTNING_NODE_IP
    }:${process.env.APP_LIGHTNING_NODE_GRPC_PORT}`;
    logger.info(`LndWatcher: initializing lnd to ${socketTarget}`);
    const { lnd } = authenticatedLndGrpc({
      cert: tls.toString('base64'),
      macaroon: readonlyMacaroon.toString('base64'),
      socket: socketTarget,
    });
    this.lnd = lnd;
    logger.info('LndWatcher: subscribing to channels');
    this.channelsSubscriber = subscribeToChannels({ lnd });
    const delayedCheckChannels = () => {
      this.delayedCheckChannelsTimeout?.refresh();
    };
    // See: https://github.com/alexbosworth/ln-service#subscribetochannels
    for (const eventName of [
      'channel_active_changed', 'channel_closed', 'channel_opened', 'channel_opening',
    ]) {
      this.channelsSubscriber.on(eventName, delayedCheckChannels);
    }
    this.delayedCheckChannelsTimeout = setTimeout(
      () => this.emit(LndWatcherEventName.CheckChannels),
      delayedCheckTimeoutMs,
    );
    logger.info('LndWatcher: subscribing to forwards');
    this.forwardsSubscriber = subscribeToForwards({ lnd });
    const delayedCheckForwards = () => {
      this.delayedCheckForwardsTimeout?.refresh();
    };
    // See: https://github.com/alexbosworth/ln-service#subscribetoforwards
    for (const eventName of ['forward', 'error']) {
      this.forwardsSubscriber.on(eventName, delayedCheckForwards);
    }
    this.delayedCheckForwardsTimeout = setTimeout(
      () => this.emit(LndWatcherEventName.CheckForwards),
      delayedCheckTimeoutMs,
    );
    this.invoicesSubscriber = subscribeToInvoices({ lnd });
    this.invoicesSubscriber.on('invoice_updated', (event) => {
      try {
        this.emit(LndWatcherEventName.InvoiceUpdated, event);
      } catch (error) {
        logger.error(`invoicesSubscriber: Failed to emit invoice_updated event ${
          errorString(event)
        }`);
      }
    });
  }

  private checkChannelsSafe() {
    if (this.isCheckingChannels) {
      this.shouldRecheckChannels = true;
      return;
    }
    this.shouldRecheckChannels = false;
    this.isCheckingChannels = true;
    this.checkChannels();
  }

  private async checkChannels() {
    try {
      logger.info('checkChannels: started');
      if (!this.lnd) {
        throw new Error('checkChannels: lnd is not defined');
      }
      const { channels } = await getChannels({ lnd: this.lnd });
      const now = new Date();
      const allChannels = channels.map((channel) => ({
        channelId: channel.id,
        lastActiveAt: channel.is_active ? now : this.savedChannels?.get(channel.id)?.lastActiveAt,
      }));
      const addedChannels: LndChannelInformation[] = allChannels.filter(
        ({ channelId }) => !this.savedChannels?.has(channelId),
      );
      const allChannelIds = new Set(channels.map((channel) => channel.id));
      const removedChannels = [
        ...this.savedChannels?.values() ?? [],
      ].filter(({ channelId }) => !allChannelIds.has(channelId));
      this.savedChannels = new Map(allChannels.map((c) => [c.channelId, c]));
      const event: LndChannelsStatusEvent = {
        addedChannels,
        removedChannels,
        allChannels,
      };
      this.emit(LndWatcherEventName.ChannelsStatus, event);
    } catch (error) {
      logger.error(`checkChannels: failed: ${errorString(error)}`);
      this.shouldRecheckChannels = true;
      await new Promise((resolve) => {
        setTimeout(resolve, recheckGraceMs);
      });
    }
    this.isCheckingChannels = false;
    if (this.shouldRecheckChannels) {
      this.emit(LndWatcherEventName.CheckChannels);
    }
  }

  private checkForwardsSafe() {
    if (this.isCheckingForwards) {
      this.shouldRecheckForwards = true;
      return;
    }
    this.shouldRecheckForwards = false;
    this.isCheckingForwards = true;
    this.checkForwards();
  }

  private async checkForwards() {
    try {
      logger.info('checkForwards: started');
      if (!this.lnd) {
        throw new Error('checkForwards: lnd is not defined');
      }
      const lastForwardAtString = this.lastForwardAt.toJSON();
      logger.info(`checkForwards: getting forwards after ${
        lastForwardAtString
      } and ignoring the first ${this.lastForwardCount} at that date`);
      const { forwards } = await getForwards({
        lnd: this.lnd,
        after: lastForwardAtString,
        before: '9999-12-31T23:59:59.999Z', // required when using after
        limit: getForwardsLimit,
      });
      logger.info(`checkForwards: found ${forwards.length}`);
      // eslint-disable-next-line camelcase
      const datedForwards = forwards.map(({ created_at, ...other }) => ({
        createdAt: new Date(created_at),
        ...other,
      })).sort( // Sort in order (usually already sorted in reverse).
        (f1, f2) => new Date(f1.createdAt).getTime() - new Date(f2.createdAt).getTime(),
      );
      const tooMany = datedForwards.length >= getForwardsLimit;
      let forwardsToDrop = this.lastForwardCount;
      if (tooMany) {
        logger.info(`checkForwards: Reached limit of ${getForwardsLimit} forwards`);
        // throw away any number of forwards at this.lastForwardAt.
        forwardsToDrop = Infinity;
      }
      while (
        datedForwards.length > 0
        && datedForwards[0].createdAt.getTime() === this.lastForwardAt.getTime()
        && forwardsToDrop > 0
      ) {
        datedForwards.shift();
        forwardsToDrop -= 1;
      }
      logger.info(`checkForwards: left after dropping: ${datedForwards.length}`);
      if (datedForwards.length > 0) {
        const lastCreatedAt = datedForwards.slice(-1)[0].createdAt;
        if (lastCreatedAt.getTime() === this.lastForwardAt.getTime()) {
          logger.info('checkForwards: new forwards all have same timestamp');
          this.lastForwardCount += datedForwards.length;
        } else {
          logger.info('checkForwards: last forward has new timestamp');
          this.lastForwardAt = lastCreatedAt;
          this.lastForwardCount = datedForwards.filter(
            (forward) => forward.createdAt.getTime() === lastCreatedAt.getTime(),
          ).length;
        }
      } else if (tooMany) {
        logger.info('checkForwards: too many new forwards, all dropped');
        this.lastForwardCount = 0;
        this.lastForwardAt = new Date(this.lastForwardAt.getTime() + 1);
      }
      logger.info(`checkForwards: new lastForwardAt is ${
        this.lastForwardAt
      }, new lastForwardCount is ${this.lastForwardCount}`);
      const event: LndNewForwardsEvent = {
        forwards: datedForwards,
        tooMany,
        lastForwardAt: this.lastForwardAt,
        lastForwardCount: this.lastForwardCount,
      };
      this.emit(LndWatcherEventName.NewForwards, event);
    } catch (error) {
      logger.error(`checkForwards: failed: ${errorString(error)}`);
      this.shouldRecheckForwards = true;
      await new Promise((resolve) => {
        setTimeout(resolve, recheckGraceMs);
      });
    }
    this.isCheckingForwards = false;
    if (this.shouldRecheckForwards) {
      this.emit(LndWatcherEventName.CheckForwards);
    }
  }

  isRunning() {
    return Boolean(this.lnd);
  }
}

export const lndWatcher = new LndWatcher();
