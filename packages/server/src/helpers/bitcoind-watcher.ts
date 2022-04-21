import EventEmitter from 'events';
import zeromq from 'zeromq';
import { Transaction } from 'bitcoinjs-lib';
import { Network } from 'bitcoin-address-validation';

import logger from './logger';
import { errorString } from './error';
import {
  ChainInfo, BlockVerbosity2, getBestBlockHash, getBlock, getBlockchainInfo, getBlockTransactions,
  getNotificationAddresses, getRawMempool, getRawTransaction, getRawTransactionsBatch,
  isTransactionInMempool, TxInStandard, BlockTransaction, RawTransaction,
} from './bitcoin-rpc';
import { TransactionStatus } from '../models/watched-transactions';

export enum BitcoindWatcherEventName {
  Trigger = 'trigger', // for internal purposes
  InitialTransactionAnalysis = 'initialTransactionAnalysis',
  NewTransactionAnalysis = 'newTransactionAnalysis',
  BlocksSkipped = 'blocksSkipped',
  NewBlockAnalyzed = 'newBlockAnalyzed',
}

export interface TransactionAnalysis {
  status: TransactionStatus;
  blockHashes: Set<string>;
  confirmations: number;
  conflictingTransactions?: Set<string>;
  transactionInputKeys?: Set<string>;
  rawTransaction?: RawTransaction;
}

export interface NewTransactionAnalysisEvent {
  txid: string;
  newAnalysis: TransactionAnalysis;
  oldAnalysis: TransactionAnalysis;
}

export interface NewBlockAnalyzedEvent {
  blockHashes: string[];
  bestBlockHeight: number;
}

const rawTransactionsBatchSize = 50;
const maxAnalyzedBlocks = 5;
const bitcoindWatcherErrorGraceMs = 10_000;
const bestBlockCheckIntervalMs = 15_000;
const recheckMempoolGraceMs = 10;

const startAttempts = 6;
const startGraceMs = 20_000;

export function transactionAnalysisToString(analysis: TransactionAnalysis): string {
  return JSON.stringify({
    status: analysis.status,
    blockHashes: [...analysis.blockHashes],
    confirmations: analysis.confirmations,
    conflictingTransactions: analysis.conflictingTransactions?.size,
    transactionInputKeys: analysis.transactionInputKeys?.size,
  });
}

function txInStandardKey(parameters: Pick<TxInStandard, 'txid' | 'vout'>): string {
  return `${parameters.txid}:${parameters.vout}`;
}

class BitcoindWatcher extends EventEmitter {
  private recheckMempoolTransactions: string[] = [];

  // Analyses is the plural of analysis
  private transactionAnalyses: Map<string, TransactionAnalysis> = new Map();

  private transactionsByInput: Map<string, Set<string>> = new Map();

  private analyzedBlockHashes: string[] = [];

  private newTransactionsToWatch: string[] = [];

  private transactionsToUnwatch: string[] = [];

  private transactionsToReanalyze: string[] = [];

  private transactionPayloadsQueue: Buffer[] | undefined;

  private checkNewBlock = true;

  private checkMempool = true;

  private sequenceNotificationSocket: zeromq.Socket | undefined;

  private rawTransactionSocket: zeromq.Socket | undefined;

  private shouldRerun = false;

  private isRunning = false;

  private chain: Network | undefined;

  constructor() {
    super();
    this.on(BitcoindWatcherEventName.Trigger, () => this.runSafe());
  }

  // The type resitrctions can be improved by forcing the value types to match the event name.
  private safeAsyncEmit(
    eventName: string,
    value?: (
      NewTransactionAnalysisEvent | TransactionAnalysis | NewBlockAnalyzedEvent | string
    ),
  ) {
    // non-blocking
    setImmediate(() => {
      try {
        if (eventName !== BitcoindWatcherEventName.Trigger) {
          logger.info(`asyncEmit: emitting ${eventName}`);
        }
        this.emit(eventName, value);
      } catch (error) {
        logger.error(`asyncEmit: failed to emit ${eventName}: ${errorString(error)}`);
      }
    });
  }

  private setTransactionAnalysis(txid: string, analysis: TransactionAnalysis) {
    this.transactionAnalyses.set(txid, analysis);
    if (!analysis.transactionInputKeys) {
      return;
    }
    for (const vinKey of analysis.transactionInputKeys) {
      this.transactionsByInput.set(
        vinKey,
        new Set([
          ...this.transactionsByInput.get(vinKey) ?? [],
          txid,
        ]),
      );
    }
  }

  private async runSafe() {
    if (this.isRunning) {
      this.shouldRerun = true;
      return;
    }
    this.shouldRerun = false;
    this.isRunning = true;
    try {
      // the this.run...(...) functions should only be called here.
      if (this.transactionsToUnwatch.length > 0) {
        logger.info('runSafe: New transactions to unwatch');
        this.shouldRerun = true;
        const unwatchTxid = this.transactionsToUnwatch.shift() as string;
        const unwatchAnalysis = this.transactionAnalyses.get(unwatchTxid);
        this.transactionAnalyses.delete(unwatchTxid);
        for (const inputKey of unwatchAnalysis?.transactionInputKeys ?? []) {
          const inputKeyTxids = this.transactionsByInput.get(inputKey);
          inputKeyTxids?.delete(unwatchTxid);
          if (inputKeyTxids?.size === 0) {
            this.transactionsByInput.delete(inputKey);
          }
        }
      } else if (this.newTransactionsToWatch.length > 0) {
        logger.info('runSafe: New transactions to watch');
        this.shouldRerun = true;
        const newTxid = this.newTransactionsToWatch.shift() as string;
        this.transactionPayloadsQueue = [];
        try {
          const analysis = await this.analyzeTransaction(
            newTxid,
            !(this.transactionAnalyses.get(newTxid)?.transactionInputKeys),
          );
          if (!this.transactionAnalyses.has(newTxid)) {
            this.setTransactionAnalysis(newTxid, analysis);
          }
          this.safeAsyncEmit(
            `${BitcoindWatcherEventName.InitialTransactionAnalysis}:${newTxid}`,
            analysis,
          );
        } finally {
          const { transactionPayloadsQueue } = this;
          this.transactionPayloadsQueue = undefined;
          for (const transactionPayload of transactionPayloadsQueue) {
            this.handleNewTransactionPayload(transactionPayload);
          }
        }
      } else if (this.transactionsToReanalyze.length > 0) {
        logger.info('runSafe: transactions to reanalyze');
        this.shouldRerun = true;
        const txid = this.transactionsToReanalyze.shift() as string;
        const oldAnalysis = this.transactionAnalyses.get(txid);
        if (oldAnalysis) {
          this.transactionPayloadsQueue = [];
          try {
            const newAnalysis = await this.analyzeTransaction(
              txid,
              !oldAnalysis.transactionInputKeys,
            );
            if (oldAnalysis === this.transactionAnalyses.get(txid)) {
              // safety check that analysis did not change
              this.handleNewTransactionAnalysis(txid, oldAnalysis, newAnalysis);
            } else {
              // race-condition ?
              this.transactionsToReanalyze.push(txid);
            }
          } finally {
            const { transactionPayloadsQueue } = this;
            this.transactionPayloadsQueue = undefined;
            for (const transactionPayload of transactionPayloadsQueue) {
              this.handleNewTransactionPayload(transactionPayload);
            }
          }
        }
      } else if (this.checkNewBlock) {
        logger.info('runSafe: new block');
        this.shouldRerun = true;
        this.checkNewBlock = false;
        try {
          const bestBlockHash = await getBestBlockHash();
          if (!bestBlockHash) {
            throw new Error('Best block hash not found');
          }
          if (!this.analyzedBlockHashes.includes(bestBlockHash)) {
            const analysisComplete = await this.analyzeNewBlocks(bestBlockHash);
            if (!analysisComplete) {
              this.checkNewBlock = true;
            }
          }
        } catch (error) {
          this.checkNewBlock = true;
          throw error;
        }
      } else if (this.checkMempool) {
        this.shouldRerun = true;
        this.checkMempool = false;
        try {
          const mempoolTransactions = await getRawMempool();
          if (mempoolTransactions) {
            logger.info(`mempoolTransactions: ${mempoolTransactions.length}`);
            const mempoolSet = new Set(this.recheckMempoolTransactions);
            this.recheckMempoolTransactions.push(
              ...mempoolTransactions.filter((t) => !mempoolSet.has(t)),
            );
            this.shouldRerun = true;
          }
        } catch (error) {
          this.checkMempool = true;
          throw error;
        }
      } else if (this.recheckMempoolTransactions.length > 0) {
        // Do not re-trigger immediately. Give some runtime to other parts of the app.
        setTimeout(
          () => this.safeAsyncEmit(BitcoindWatcherEventName.Trigger),
          recheckMempoolGraceMs,
        );
        const recheckTxids = this.recheckMempoolTransactions.slice(0, rawTransactionsBatchSize);
        const recheckTransactions = await getRawTransactionsBatch(recheckTxids);
        this.recheckMempoolTransactions = this.recheckMempoolTransactions.slice(
          rawTransactionsBatchSize,
        );
        if (this.recheckMempoolTransactions.length === 0) {
          logger.info('runSafe: last mempool transaction to check for conflicts');
        }
        for (const recheckTransaction of recheckTransactions) {
          this.checkTransactionConflicts(
            recheckTransaction.txid,
            recheckTransaction.vin
              .filter((txIn) => txIn.txid)
              .map((txIn) => txInStandardKey(txIn as TxInStandard)),
          );
        }
      }
    } catch (error) {
      logger.error(`BitcoindWatcher: run failed ${errorString(error)}`);
      await new Promise((resolve) => {
        setTimeout(resolve, bitcoindWatcherErrorGraceMs);
      });
    }
    this.isRunning = false;
    if (this.shouldRerun) {
      this.safeAsyncEmit(BitcoindWatcherEventName.Trigger);
    }
  }

  private async analyzeTransaction(
    txid: string,
    findConflicts: boolean,
  ): Promise<TransactionAnalysis> {
    logger.info(`analyzeTransaction: analyzing ${txid}`);
    logger.info(`analyzeTransaction: ${txid} findConflicts: ${findConflicts}`);
    const isInMempool = await isTransactionInMempool(txid);
    logger.info(`analyzeTransaction: ${txid} isInMempool: ${isInMempool}`);
    const rawTransaction = await getRawTransaction(txid);
    if (!rawTransaction) {
      logger.info(`analyzeTransaction: ${txid} no raw transaction`);
      const undetailedAnalysis: TransactionAnalysis = {
        blockHashes: new Set(),
        status: isInMempool ? TransactionStatus.Mempool : TransactionStatus.Unpublished,
        confirmations: 0,
      };
      return undetailedAnalysis;
    }
    const transactionInputKeys = new Set(
      (rawTransaction.vin.filter(
        (vin) => vin.txid,
      ) as TxInStandard[]).map(txInStandardKey),
    );
    logger.info(`analyzeTransaction: ${txid} has ${transactionInputKeys.size} inputs`);
    const confirmations = rawTransaction.confirmations ?? 0;
    if (confirmations > maxAnalyzedBlocks) {
      logger.info(`analyzeTransaction: ${txid} is fully confirmed`);
      // confirmed, no need to watch
      return {
        status: TransactionStatus.FullConfirmation,
        transactionInputKeys,
        blockHashes: new Set(
          rawTransaction.blockhash ? [rawTransaction.blockhash] : [],
        ),
        confirmations,
        rawTransaction,
      };
    }
    const detailedAnalysis: TransactionAnalysis = {
      status: (confirmations > 0)
        ? TransactionStatus.PartialConfirmation
        : TransactionStatus.Mempool,
      transactionInputKeys,
      blockHashes: new Set(
        rawTransaction.blockhash ? [rawTransaction.blockhash] : [],
      ),
      confirmations,
      rawTransaction,
    };
    logger.info(`analyzeTransaction: ${txid} is not confirmed: ${detailedAnalysis.status}`);
    if (!findConflicts) {
      return detailedAnalysis;
    }
    logger.info(
      `analyzeTransaction: ${txid} try finding conflicts in blocks ${
        this.analyzedBlockHashes.join(', ')
      }`,
    );
    const blockchainTransactions = (await getBlockTransactions(this.analyzedBlockHashes)).map(
      ([transaction]) => transaction,
    );
    const conflictingBlockchainTransactions = blockchainTransactions.filter((transaction) => (
      (transaction.txid !== txid)
      && transaction.vin.some(
        (txIn) => txIn.txid && transactionInputKeys.has(txInStandardKey(txIn)),
      )
    )).map((transaction) => transaction.txid);
    detailedAnalysis.conflictingTransactions = new Set(conflictingBlockchainTransactions);
    logger.info(
      `analyzeTransaction: ${txid} found ${
        detailedAnalysis.conflictingTransactions.size
      } conflicts on-chain`,
    );
    return detailedAnalysis;
  }

  private handleNewTransactionAnalysis(
    txid: string,
    oldAnalysis: TransactionAnalysis,
    newAnalysis: TransactionAnalysis,
  ) {
    logger.info(
      `handleNewTransactionAnalysis: ${txid} ${transactionAnalysisToString(oldAnalysis)} ${
        transactionAnalysisToString(newAnalysis)
      }`,
    );
    const combinedAnalysis: TransactionAnalysis = {
      ...newAnalysis,
      ...(
        newAnalysis.conflictingTransactions || oldAnalysis.conflictingTransactions
      ) && {
        conflictingTransactions: new Set([
          ...oldAnalysis.conflictingTransactions ?? [],
          ...newAnalysis.conflictingTransactions ?? [],
        ]),
      },
    };
    this.setTransactionAnalysis(txid, combinedAnalysis);
    if (combinedAnalysis.status === TransactionStatus.FullConfirmation) {
      logger.info(`handleNewTransactionAnalysis: ${txid} is fully confirmed`);
      this.unwatchTransaction(txid);
    }
    if (
      (combinedAnalysis.status !== oldAnalysis.status)
      || (
        Boolean(combinedAnalysis.transactionInputKeys)
        !== Boolean(oldAnalysis.transactionInputKeys)
      )
      || (
        combinedAnalysis.conflictingTransactions?.size
        !== oldAnalysis.conflictingTransactions?.size
      )
    ) {
      logger.info(
        `handleNewTransactionAnalysis: ${txid} analysis has changed, from: ${
          transactionAnalysisToString(oldAnalysis)
        } to: ${transactionAnalysisToString(newAnalysis)}`,
      );
      this.safeAsyncEmit(BitcoindWatcherEventName.NewTransactionAnalysis, {
        txid,
        newAnalysis: combinedAnalysis,
        oldAnalysis,
      });
    }
  }

  private handleNewTransactionPayload(transactionPayload: Buffer) {
    if (this.transactionPayloadsQueue) {
      this.transactionPayloadsQueue.push(transactionPayload);
      return;
    }
    const transaction = Transaction.fromBuffer(transactionPayload);
    if (transaction.isCoinbase()) {
      this.checkNewBlock = true;
      this.safeAsyncEmit(BitcoindWatcherEventName.Trigger);
    }
    const txid = transaction.getId();
    const analysis = this.transactionAnalyses.get(txid);
    if (analysis && !analysis.transactionInputKeys) {
      this.transactionsToReanalyze.push(txid);
      this.safeAsyncEmit(BitcoindWatcherEventName.Trigger);
    }
    const txInKeys = transaction.ins.map((transactionInput) => txInStandardKey({
      txid: transactionInput.hash.reverse().toString('hex'),
      vout: transactionInput.index,
    }));
    this.checkTransactionConflicts(txid, txInKeys);
  }

  private checkTransactionConflicts(txid: string, txInKeys: string[]) {
    for (const txInKey of txInKeys) {
      const conflictedTxids = this.transactionsByInput.get(txInKey);
      if (!conflictedTxids) {
        continue;
      }
      for (const conflictedTxid of conflictedTxids) {
        if (conflictedTxid === txid) {
          continue;
        }
        const oldAnalysis = this.transactionAnalyses.get(conflictedTxid);
        if (!oldAnalysis) {
          // Safety check, unexpected to happen.
          continue;
        }
        if (oldAnalysis.conflictingTransactions?.has(txid)) {
          continue;
        }
        this.handleNewTransactionAnalysis(
          conflictedTxid,
          oldAnalysis,
          {
            ...oldAnalysis,
            conflictingTransactions: new Set([
              ...oldAnalysis.conflictingTransactions ?? [],
              txid,
            ]),
          },
        );
      }
    }
  }

  private async analyzeNewBlocks(bestBlockHash: string): Promise<boolean> {
    logger.info(`analyzeNewBlocks: ${bestBlockHash}`);
    const newBlocks: BlockVerbosity2[] = [];
    let chainBlockhash = bestBlockHash;
    for (let count = 0; count < maxAnalyzedBlocks; count += 1) {
      // eslint-disable-next-line no-await-in-loop
      const block = await getBlock(chainBlockhash);
      if (!block) {
        return false;
      }
      newBlocks.unshift(block);
      if (block.height === 0) {
        // Test chain?
        break;
      }
      chainBlockhash = block.previousblockhash;
      if (this.analyzedBlockHashes.includes(chainBlockhash)) {
        break;
      }
    }
    if (newBlocks.length === 0) {
      return true;
    }
    if (
      (newBlocks.length === maxAnalyzedBlocks)
      && !this.analyzedBlockHashes.includes(newBlocks[0].previousblockhash)
      && (this.analyzedBlockHashes.length > 0)
    ) {
      logger.info('analyzeNewBlocks: some blocks have been skipped');
      this.safeAsyncEmit(BitcoindWatcherEventName.BlocksSkipped);
      this.transactionsToReanalyze.push(
        ...this.transactionAnalyses.keys(),
      );
      this.shouldRerun = true;
    }
    const transactions = newBlocks.flatMap(
      (block) => block.tx.map((transaction): [BlockTransaction, BlockVerbosity2] => ([
        transaction,
        block,
      ])),
    );
    for (const [transaction, block] of transactions) {
      const oldAnalysis = this.transactionAnalyses.get(transaction.txid);
      if (!oldAnalysis) {
        continue;
      }
      if (
        (oldAnalysis.status === TransactionStatus.PartialConfirmation)
        && oldAnalysis.blockHashes.has(block.hash)
      ) {
        continue;
      }
      logger.info(
        `analyzeNewBlocks: found transaction ${transaction.txid} in new block ${block.hash}`,
      );
      this.handleNewTransactionAnalysis(
        transaction.txid,
        oldAnalysis,
        {
          ...oldAnalysis,
          blockHashes: new Set([
            ...oldAnalysis.blockHashes,
            block.hash,
          ]),
          confirmations: block.confirmations,
          status: TransactionStatus.PartialConfirmation,
        },
      );
    }
    for (const [transaction] of transactions) {
      this.checkTransactionConflicts(
        transaction.txid,
        transaction.vin
          .filter((txIn) => txIn.txid)
          .map((txIn) => txInStandardKey(txIn as TxInStandard)),
      );
    }
    const lastAttachedBlockIndex = this.analyzedBlockHashes.indexOf(
      newBlocks[0].previousblockhash,
    );
    // lastAttachedBlockIndex is -1 if all existing block-hashes are detached
    const detachedBlockHashes = this.analyzedBlockHashes.slice(lastAttachedBlockIndex + 1);
    logger.info(`analyzeNewBlocks: detachedBlockHashes: ${detachedBlockHashes.join(', ')}`);
    const attachedBlockHashes: string[] = [
      ...this.analyzedBlockHashes.slice(0, lastAttachedBlockIndex + 1),
      ...newBlocks.map((block) => block.hash),
    ];
    this.analyzedBlockHashes = attachedBlockHashes.slice(-maxAnalyzedBlocks);
    logger.info(`analyzeNewBlocks: analyzedBlockHashes: ${this.analyzedBlockHashes.join(', ')}`);
    this.safeAsyncEmit(BitcoindWatcherEventName.NewBlockAnalyzed, {
      blockHashes: this.analyzedBlockHashes,
      bestBlockHeight: newBlocks.slice(-1)[0]!.height,
    });
    const confirmedBlockHashes = attachedBlockHashes.slice(0, -maxAnalyzedBlocks).reverse();
    logger.info(`analyzeNewBlocks: confirmedBlockHashes: ${confirmedBlockHashes.join(', ')}`);

    for (const [txid, oldAnalysis] of [...this.transactionAnalyses]) {
      if (oldAnalysis.blockHashes.size === 0) {
        continue;
      }
      const confirmedBlockHash = confirmedBlockHashes.find(
        (bh) => oldAnalysis.blockHashes.has(bh),
      );
      if (confirmedBlockHash) {
        const confirmedBlockIndex = confirmedBlockHashes.indexOf(confirmedBlockHash);
        logger.info(`analyzeNewBlocks: transaction found in confirmed block: ${txid}`);
        this.handleNewTransactionAnalysis(
          txid,
          oldAnalysis,
          {
            ...oldAnalysis,
            status: TransactionStatus.FullConfirmation,
            confirmations: confirmedBlockIndex + 1 + maxAnalyzedBlocks,
          },
        );
        continue;
      }
      if (detachedBlockHashes.some((bh) => oldAnalysis.blockHashes.has(bh))) {
        logger.info(`analyzeNewBlocks: transaction found in detached block: ${txid}`);
        this.transactionsToReanalyze.push(txid);
        this.shouldRerun = true;
      }
    }
    return true; // analysis complete
  }

  async start(
    analyzedBlockHashes: string[],
    watchedTransactions: [string, TransactionAnalysis][],
  ) {
    let blockchainInfo: ChainInfo | undefined;
    for (let attempt = 0; attempt < startAttempts; attempt += 1) {
      logger.info(`BitcoindWatcher: Getting blockchain info, attempt ${attempt}.`);
      try {
        // eslint-disable-next-line no-await-in-loop
        blockchainInfo = await getBlockchainInfo();
        if (!blockchainInfo) {
          throw new Error('BitcoindWatcher: failed to get blockchain info');
        }
        break;
      } catch (error) {
        logger.warn(`Could not fetch blockchain-info: ${errorString(error)}`);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          setTimeout(resolve, startGraceMs);
        });
      }
    }
    if (!blockchainInfo) {
      throw new Error('Bitcoind is not responding');
    }
    switch (blockchainInfo.chain) {
      case 'main':
        this.chain = Network.mainnet;
        break;
      case 'test':
        this.chain = Network.testnet;
        break;
      case 'regtest':
        this.chain = Network.regtest;
        break;
      default:
        throw new Error(`Unexpected chain: ${blockchainInfo.chain}`);
    }

    const notificationAddresses = await getNotificationAddresses();
    if (!notificationAddresses) {
      throw new Error('The required zmq-notification addresses are not configured');
    }

    this.analyzedBlockHashes = analyzedBlockHashes;
    for (const [txid, analysis] of watchedTransactions) {
      this.setTransactionAnalysis(txid, analysis);
    }

    if (notificationAddresses.sequence) {
      this.sequenceNotificationSocket = zeromq.socket('sub');
      this.sequenceNotificationSocket.connect(notificationAddresses.sequence);
      this.sequenceNotificationSocket.subscribe('sequence');
      this.sequenceNotificationSocket.on('message', (topicBuffer: Buffer, message: Buffer) => {
        const topic = topicBuffer.toString();
        if (topic !== 'sequence') {
          return;
        }
        const messageType = String.fromCharCode(message[32] ?? 0);
        if (messageType === 'C') {
          logger.info('BitcoindWatcher: New block from zmq-sequence message');
          this.checkNewBlock = true;
          this.safeAsyncEmit(BitcoindWatcherEventName.Trigger);
        }
      });
    } else {
      let bestBlockHash: string | undefined;
      const blockCheckInterval = setInterval(async () => {
        try {
          const newBestBlockHash = await getBestBlockHash();
          if (bestBlockHash === newBestBlockHash) {
            return;
          }
          if (bestBlockHash) {
            logger.info('BitcoindWatcher: New block from interval');
            this.checkNewBlock = true;
            this.safeAsyncEmit(BitcoindWatcherEventName.Trigger);
          }
          bestBlockHash = newBestBlockHash;
        } catch (error) {
          logger.error(`BitcoindWatcher: Failed to check best block hash ${errorString(error)}`);
        }
      }, bestBlockCheckIntervalMs);
      blockCheckInterval.unref();
    }
    this.rawTransactionSocket = zeromq.socket('sub');
    this.rawTransactionSocket.connect(notificationAddresses.rawtx);
    this.rawTransactionSocket.subscribe('rawtx');
    this.rawTransactionSocket.on('message', (topicBuffer: Buffer, message: Buffer) => {
      const topic = topicBuffer.toString();
      if (topic !== 'rawtx') {
        return;
      }
      try {
        this.handleNewTransactionPayload(message);
      } catch (error) {
        logger.error(
          `BitcoindWatcher: failed to handle transaction payload from stream: ${
            errorString(error)
          }`,
        );
      }
    });
    this.safeAsyncEmit(BitcoindWatcherEventName.Trigger);
  }

  watchNewTransaction(txid: string) {
    this.newTransactionsToWatch.push(txid);
    this.safeAsyncEmit(BitcoindWatcherEventName.Trigger);
  }

  unwatchTransaction(txid: string) {
    this.transactionsToUnwatch.push(txid);
    this.safeAsyncEmit(BitcoindWatcherEventName.Trigger);
  }

  getChain(): Network {
    if (!this.chain) {
      throw new Error('BitcoindWatcher: Not started');
    }
    return this.chain;
  }

  countTasks(): number {
    return (
      this.newTransactionsToWatch.length + this.transactionsToUnwatch.length
      + this.transactionsToReanalyze.length + (this.transactionPayloadsQueue?.length ?? 0)
      + this.recheckMempoolTransactions.length + (this.checkNewBlock ? 1 : 0)
      + (this.checkMempool ? 1 : 0)
    );
  }
}

export const bitcoindWatcher = new BitcoindWatcher();
