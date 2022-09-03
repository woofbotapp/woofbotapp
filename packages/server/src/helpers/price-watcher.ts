import { EventEmitter } from 'stream';
import fetch from 'node-fetch';
import AbortController from 'abort-controller';

import logger from './logger';
import { errorString } from './error';

interface UsdPrice {
  usd?: number;
}

interface CoingeckoPriceApiJson {
  bitcoin?: UsdPrice;
}

export enum PriceWatcherEventName {
  ConsecutiveApiErrors = 'consecutiveApiErrors',
  ApiResponsiveAgain = 'apiResponsiveAgain',
  PriceChange = 'priceChange',
}

export interface PriceChangeEvent {
  id: string;
  oldThreshold: [number, number];
  newPrice: number;
  newThreshold: [number, number];
  delta: number;
}

interface PriceWatch {
  id: string;
  threshold?: [number, number];
  delta: number;
}

const priceCheckIntervalMs = 60_000;
const priceCheckTimeoutMs = 15_000;
const errorCounterLimit = 10;

class PriceWatcher extends EventEmitter {
  private lastPrice: number | undefined;

  private errorCounter: number | undefined = 0;

  private priceCheckInterval: ReturnType<typeof setInterval> | undefined;

  private priceWatches: PriceWatch[] = [];

  private static async getPrice(): Promise<number> {
    logger.info('getPrice: getting Bitcoin price.');
    const abortController = new AbortController();
    const abortTimeout = setTimeout(() => abortController.abort(), priceCheckTimeoutMs);
    const fetchResult = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      {
        signal: abortController.signal,
      },
    );
    clearTimeout(abortTimeout);
    if (!fetchResult.ok) {
      throw new Error('Bad response from CoinGecko server');
    }
    const jsonResult: CoingeckoPriceApiJson = await fetchResult.json();
    const price = jsonResult?.bitcoin?.usd;
    if (typeof price !== 'number') {
      throw new Error('Could not parse price');
    }
    logger.info(`getPrice: Bitcoin price is $${price}`);
    return price;
  }

  private static calculateThresholds(price: number, delta: number): [number, number] {
    const thresholdMiddle = Math.round(price / delta) * delta;
    return [thresholdMiddle - delta, thresholdMiddle + delta];
  }

  private safeAsyncEmit(
    eventName: PriceWatcherEventName,
    value?: PriceChangeEvent,
  ) {
    // non-blocking
    setImmediate(() => {
      try {
        logger.info(`PriceWatcher.asyncEmit: emitting ${eventName}`);
        this.emit(eventName, value);
      } catch (error) {
        logger.error(
          `PriceWatcher.asyncEmit: failed to emit ${eventName}: ${errorString(error)}`,
        );
      }
    });
  }

  private async checkPriceChange(): Promise<void> {
    const newPrice = await PriceWatcher.getPrice();
    if (!this.priceCheckInterval) {
      // Interval was cancelled during price check
      return;
    }
    for (const priceWatch of this.priceWatches) {
      logger.info(`checkPriceChange: comparing to ${JSON.stringify(priceWatch)}`);
      const newThreshold = PriceWatcher.calculateThresholds(newPrice, priceWatch.delta);
      if (!priceWatch.threshold) {
        logger.info('checkPriceChange: setting threshold for the first time');
        priceWatch.threshold = newThreshold;
        continue;
      }
      const [priceMin, priceMax] = priceWatch.threshold;
      if ((newPrice <= priceMin) || (priceMax <= newPrice)) {
        this.safeAsyncEmit(
          PriceWatcherEventName.PriceChange,
          {
            id: priceWatch.id,
            oldThreshold: priceWatch.threshold,
            newPrice,
            newThreshold,
            delta: priceWatch.delta,
          },
        );
        priceWatch.threshold = newThreshold;
      }
      // keep threshold
    }
    this.lastPrice = newPrice;
  }

  private startInterval(): void {
    this.priceCheckInterval = setInterval(async () => {
      try {
        await this.checkPriceChange();
        if (this.errorCounter === undefined) {
          this.emit(PriceWatcherEventName.ApiResponsiveAgain);
        }
        this.errorCounter = 0;
      } catch (error) {
        logger.error(`PriceWatcher: failed to fetch price ${errorString(error)}`);
        if (this.errorCounter === undefined) {
          return;
        }
        this.errorCounter += 1;
        if (this.errorCounter >= errorCounterLimit) {
          this.errorCounter = undefined;
          this.safeAsyncEmit(PriceWatcherEventName.ConsecutiveApiErrors);
        }
      }
    }, priceCheckIntervalMs);
    this.priceCheckInterval.unref();
  }

  public async watchPriceChange(
    id: string,
    delta: number,
  ): Promise<[number, number, number] | undefined> {
    if ((delta <= 0) || !Number.isSafeInteger(delta)) {
      throw new Error('Invalid delta');
    }
    if (!this.lastPrice) {
      try {
        this.lastPrice = await PriceWatcher.getPrice();
      } catch (error) {
        logger.error(
          `watchPriceChange: failed to fetch price ${errorString(error)}`,
        );
      }
    }
    const newWatch = {
      id,
      delta,
      ...(this.lastPrice !== undefined) && {
        threshold: PriceWatcher.calculateThresholds(this.lastPrice, delta),
      },
    };
    logger.info(`watchPriceChange: adding new watch ${JSON.stringify(newWatch)}`);
    this.priceWatches = [
      ...this.priceWatches.filter((priceWatch) => priceWatch.id !== id),
      newWatch,
    ];
    if (!this.priceCheckInterval) {
      this.startInterval();
    }
    if (
      (this.errorCounter === undefined)
      || (this.lastPrice === undefined)
      || !newWatch.threshold
    ) {
      return undefined;
    }
    // lastPrice, min, max.
    return [
      this.lastPrice,
      ...newWatch.threshold,
    ];
  }

  public unwatchPriceChange(id: string): void {
    this.priceWatches = this.priceWatches.filter((priceWatch) => (priceWatch.id !== id));
    if (this.priceWatches.length === 0) {
      if (this.priceCheckInterval) {
        clearInterval(this.priceCheckInterval);
        this.priceCheckInterval = undefined;
      }
      this.lastPrice = undefined;
      this.errorCounter = 0;
    }
  }
}

export const priceWatcher = new PriceWatcher();
