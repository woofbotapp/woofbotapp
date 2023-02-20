import { EventEmitter } from 'stream';
import fs from 'fs';
import {
  authenticatedLndGrpc, AuthenticatedLnd, getChannels, subscribeToChannels,
} from 'lightning';
import logger from './logger';
import { LndChannelInformation } from '../models/settings';
import { errorString } from './error';

export enum LndWatcherEventName {
  CheckChannels = 'checkChannels', // internal
  ChannelsStatus = 'channelStatus',
}

export interface LndChannelsStatusEvent {
  addedChannels: LndChannelInformation[];
  removedChannels: LndChannelInformation[];
  allChannels: LndChannelInformation[];
}

const delayedCheckChannelsTimeoutMs = 1_000;
const recheckChannelsGraceMs = 15_000;

class LndWatcher extends EventEmitter {
  private lnd: AuthenticatedLnd | undefined;

  private channelsSubscriber: EventEmitter | undefined;

  private delayedCheckChannelsTimeout: ReturnType<typeof setTimeout> | undefined;

  private savedChannels: Map<string, LndChannelInformation> | undefined;

  private isCheckingChannels: boolean = false;

  private shouldRecheckChannels: boolean = false;

  constructor() {
    super();
    this.on(LndWatcherEventName.CheckChannels, () => this.checkChannelsSafe());
  }

  async start(
    savedChannels: LndChannelInformation[] | undefined,
  ) {
    if (savedChannels) {
      this.savedChannels = new Map(savedChannels.map((channel) => [channel.channelId, channel]));
    }
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
      delayedCheckChannelsTimeoutMs,
    );
    this.checkChannelsSafe();
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
        throw new Error('lnd is not defined');
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
        setTimeout(resolve, recheckChannelsGraceMs);
      });
    }
    this.isCheckingChannels = false;
    if (this.shouldRecheckChannels) {
      this.emit(LndWatcherEventName.CheckChannels);
    }
  }

  isRunning() {
    return Boolean(this.lnd);
  }
}

export const lndWatcher = new LndWatcher();
