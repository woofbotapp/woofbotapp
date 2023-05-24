import EventEmitter from 'events';
import zeromq from 'zeromq';
import {
  Transaction, address as bitcoinjsAddress, networks as bitcoinjsNetworks,
} from 'bitcoinjs-lib';
import { Network } from 'bitcoin-address-validation';

import logger from './logger';
import { errorString } from './error';
import {
  ChainInfo, BlockVerbosity2, getBestBlockHash, getBlock, getBlockchainInfo, getBlockTransactions,
  getNotificationAddresses, getRawMempool, getRawTransaction, getRawTransactionsBatch,
  isTransactionInMempool, TxInStandard, BlockTransaction, RawTransaction, getOutAddresses,
  getNetworkInfo, getMempoolInfo,
} from './bitcoin-rpc';
import { TransactionStatus } from '../models/watched-transactions';

export enum BitcoindWatcherEventName {
  Trigger = 'trigger', // for internal purposes
  InitialTransactionAnalysis = 'initialTransactionAnalysis',
  NewTransactionAnalysis = 'newTransactionAnalysis',
  BlocksSkipped = 'blocksSkipped',
  NewBlockAnalyzed = 'newBlockAnalyzed',
  NewAddressPayment = 'newAddressPayment',
  AddressOverload = 'addressOverload',
  NewMempoolClearStatus = 'newMempoolClearStatus',
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
  newBlocks: number;
}

export interface NewAddressPaymentEvent {
  address: string;
  txid: string;
  status: TransactionStatus;
  confirmations: number;
  multiAddress: boolean;
  incomeSats?: number;
  outcomeSats?: number;
}

export interface NewMempoolClearStatusEvent {
  isClear: boolean;
}

const networks = {
  [Network.mainnet]: bitcoinjsNetworks.bitcoin,
  [Network.testnet]: bitcoinjsNetworks.testnet,
  [Network.regtest]: bitcoinjsNetworks.regtest,
};

const rawTransactionsBatchSize = 100;
const maxAnalyzedBlocks = 5;
const bitcoindWatcherErrorGraceMs = 10_000;
const mempoolSizeRecheckIntervalMs = 600_000;
const bestBlockRecheckIntervalMs = 60_000;
const delayedTriggerTimeoutMs = 1;
const newBlockDebounceTimeoutMs = 3_000;

const startAttempts = 6;
const startGraceMs = 20_000;

const satsPerBitcoin = 100_000_000;

const maxOngoingIncomeTransactions = 1000;

const maxBlockWeight = 4_000_000;

function confirmationsToTransactionStatus(confirmations: number): TransactionStatus {
  if (confirmations === 0) {
    return TransactionStatus.Mempool;
  }
  if (confirmations <= maxAnalyzedBlocks) {
    return TransactionStatus.PartialConfirmation;
  }
  return TransactionStatus.FullConfirmation;
}

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

const monitorListener = (socketName: string, eventName: string) => (
  eventValue: number,
  address: string,
  error: unknown,
) => {
  logger.info(`${socketName}: monitor ${eventName} ${eventValue} ${errorString(error)}`);
};

const monitorInterval = 60_000;

function monitorSocket(socketName: string, socket: zeromq.Socket): void {
  for (const eventName of [
    'connect', 'bind_error', 'accept_error', 'close', 'close_error', 'disconnect',
  ]) {
    socket.on(eventName, monitorListener(socketName, eventName));
  }
  socket.monitor(monitorInterval, 1);
}

interface BitcoindInfo {
  chain: Network;
  version: string;
}

class BitcoindWatcher extends EventEmitter {
  private delayedTriggerTimeout: ReturnType<typeof setTimeout> | undefined;

  private newBlockDebounceTimeout: ReturnType<typeof setTimeout> | undefined;

  private mempoolSizeRecheckInterval: ReturnType<typeof setInterval> | undefined;

  private recheckMempoolTransactions: string[] | undefined;

  // Analyses is the plural of analysis
  private transactionAnalyses: Map<string, TransactionAnalysis> = new Map();

  private transactionsByInput: Map<string, Set<string>> = new Map();

  private analyzedBlockHashes: string[] = [];

  private newTransactionsToWatch: string[] = [];

  private transactionsToUnwatch: string[] = [];

  private transactionsToReanalyze: string[] = [];

  private transactionPayloadsQueue: Buffer[] | undefined;

  private checkNewBlock = true;

  private checkRawMempool = true;

  private checkMempoolSize = false;

  // Full check of mempool conflicts and incomes (of watched transactions and addresses) is only
  // relevant after boot. After that, we check each transaction when it arrives on the sequence
  // socket.
  private checkMempoolConflictsAndIncomes = true;

  // maps address -> income-txid
  private watchedAddresses: Map<string, Set<string>> = new Map();

  private overloadedAddresses = new Set();

  private sequenceNotificationSocket: zeromq.Socket | undefined;

  private rawBlockSocket: zeromq.Socket | undefined;

  private rawTransactionSocket: zeromq.Socket | undefined;

  private shouldRerun = false;

  private isRunning = false;

  private chain: Network | undefined;

  private mempoolWeight: number | undefined;

  constructor() {
    super();
    this.on(BitcoindWatcherEventName.Trigger, () => this.runSafe());
  }

  // The type resitrctions can be improved by forcing the value types to match the event name.
  private safeAsyncEmit(
    eventName: string,
    value?: (
      NewTransactionAnalysisEvent | TransactionAnalysis | NewBlockAnalyzedEvent
      | NewAddressPaymentEvent | NewMempoolClearStatusEvent | string
    ),
  ) {
    // non-blocking
    setImmediate(() => {
      try {
        logger.info(`asyncEmit: emitting ${eventName}`);
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

  private newBlockDebounce() {
    if (!this.newBlockDebounceTimeout) {
      logger.info('newBlockDebounce: defining for the first time');
      this.newBlockDebounceTimeout = setTimeout(() => {
        logger.info('newBlockDebounce: setting checkNewBlock');
        this.checkNewBlock = true;
        this.delayedTriggerTimeout?.refresh();
      }, newBlockDebounceTimeoutMs);
      return;
    }
    logger.info('newBlockDebounce: refreshing');
    this.newBlockDebounceTimeout.refresh();
  }

  private runSafe() {
    logger.info(`runSafe: isRunning: ${this.isRunning}`);
    if (this.isRunning) {
      this.shouldRerun = true;
      return;
    }
    this.shouldRerun = false;
    this.isRunning = true;
    this.run();
  }

  private async run() {
    try {
      logger.info('run: started');
      this.shouldRerun = true;
      if (this.transactionsToUnwatch.length > 0) {
        logger.info('run: New transactions to unwatch');
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
        logger.info('run: New transactions to watch');
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
        logger.info('run: transactions to reanalyze');
        const txid = this.transactionsToReanalyze.shift() as string;
        const oldAnalysis = this.transactionAnalyses.get(txid);
        this.transactionPayloadsQueue = [];
        try {
          const newAnalysis = await this.analyzeTransaction(
            txid,
            Boolean(oldAnalysis && !oldAnalysis.transactionInputKeys),
          );
          if (oldAnalysis) {
            if (oldAnalysis === this.transactionAnalyses.get(txid)) {
              // safety check that analysis did not change
              this.handleNewTransactionAnalysis(txid, oldAnalysis, newAnalysis);
            } else {
              // race-condition ?
              this.transactionsToReanalyze.push(txid);
            }
          }
          if (newAnalysis.rawTransaction && !newAnalysis.rawTransaction.confirmations) {
            // report incomes for this mempool transactions
            this.reportIncomes(newAnalysis.rawTransaction, 0);
          }
        } finally {
          const { transactionPayloadsQueue } = this;
          this.transactionPayloadsQueue = undefined;
          for (const transactionPayload of transactionPayloadsQueue) {
            this.handleNewTransactionPayload(transactionPayload);
          }
        }
      } else if (this.checkNewBlock) {
        logger.info('run: check new block');
        this.checkNewBlock = false;
        try {
          const bestBlockHash = await getBestBlockHash();
          if (!bestBlockHash) {
            throw new Error('Best block hash not found');
          }
          const alreadyAnalyzed = this.analyzedBlockHashes.includes(bestBlockHash);
          logger.info(`run: best-block ${bestBlockHash} already analyzed: ${alreadyAnalyzed}`);
          if (!alreadyAnalyzed) {
            this.checkMempoolSize = true;
            const analysisComplete = await this.analyzeNewBlocks(bestBlockHash);
            if (!analysisComplete) {
              this.checkNewBlock = true;
            }
          }
        } catch (error) {
          this.checkNewBlock = true;
          throw error;
        }
      } else if (this.recheckMempoolTransactions) {
        logger.info('run: recheck mempool transaction');
        // Do not re-trigger immediately. Give some runtime to other parts of the app.
        this.shouldRerun = false;
        this.delayedTriggerTimeout?.refresh();
        const recheckTxids = this.recheckMempoolTransactions.slice(0, rawTransactionsBatchSize);
        const leftTxids = this.recheckMempoolTransactions.slice(rawTransactionsBatchSize);
        const recheckTransactions = await getRawTransactionsBatch(recheckTxids);
        this.recheckMempoolTransactions = leftTxids;
        if (this.checkMempoolConflictsAndIncomes) {
          for (const recheckTransaction of recheckTransactions) {
            this.checkTransactionConflicts(
              recheckTransaction.txid,
              recheckTransaction.vin
                .filter((txIn) => txIn.txid)
                .map((txIn) => txInStandardKey(txIn as TxInStandard)),
            );
            if (!recheckTransaction.confirmations) {
              // report incomes for this mempool transactions
              this.reportIncomes(recheckTransaction, 0);
            }
          }
        }
        if (this.recheckMempoolTransactions.length === 0) {
          logger.info('run: finished last mempool transaction to check for conflicts');
          this.checkMempoolConflictsAndIncomes = false;
          this.recheckMempoolTransactions = undefined;
        }
      } else if (this.checkMempoolSize) {
        this.checkMempoolSize = false;
        await this.runCheckMempoolSize();
      } else if (this.checkRawMempool) {
        this.checkRawMempool = false;
        try {
          logger.info('run: checkRawMempool: getting raw mempool');
          const mempoolTransactions = await getRawMempool();
          if (mempoolTransactions) {
            const mempoolTransactionIds = Object.keys(mempoolTransactions);
            logger.info(
              `run: checkRawMempool: transactions: ${mempoolTransactionIds.length}`,
            );
            if (this.checkMempoolConflictsAndIncomes) {
              // no need to check the transactions otherwise
              this.recheckMempoolTransactions = mempoolTransactionIds;
            }
            const newMempoolWeight = Object.values(mempoolTransactions).reduce(
              (soFar, { weight }) => soFar + weight,
              0,
            );
            logger.info(`run: checkRawMempool: new mempool weight: ${newMempoolWeight}`);
            if (this.mempoolWeight !== undefined) {
              const wasClear = this.mempoolWeight < maxBlockWeight;
              const isClear = newMempoolWeight < maxBlockWeight;
              if (wasClear !== isClear) {
                this.safeAsyncEmit(BitcoindWatcherEventName.NewMempoolClearStatus, {
                  isClear,
                });
              }
            }
            this.mempoolWeight = newMempoolWeight;
          } else {
            logger.info('run: checkRawMempool: undefined mempool transactions');
          }
        } catch (error) {
          this.checkRawMempool = true;
          throw error;
        }
      } else {
        this.shouldRerun = false;
      }
    } catch (error) {
      logger.error(`run: failed ${errorString(error)}`);
      await new Promise((resolve) => {
        setTimeout(resolve, bitcoindWatcherErrorGraceMs);
      });
    }
    this.isRunning = false;
    logger.info(`run: finished - shouldRerun: ${this.shouldRerun}`);
    if (this.shouldRerun) {
      this.delayedTriggerTimeout?.refresh();
    }
  }

  private async runCheckMempoolSize(): Promise<void> {
    try {
      this.mempoolSizeRecheckInterval?.refresh();
      logger.info('runCheckMempoolSize: getting mempool info');
      const mempoolInfo = await getMempoolInfo();
      if (!mempoolInfo) {
        logger.info('runCheckMempoolSize: mempool info is undefined');
        this.checkRawMempool = true;
        return;
      }
      const minWeight = mempoolInfo.bytes * 3;
      logger.info(`runCheckMempoolSize: new weight is at least ${minWeight}`);
      if (minWeight < maxBlockWeight) {
        logger.info('runCheckMempoolSize: not enough info to tell if mempool is clear or not');
        this.checkRawMempool = true;
        return;
      }
      logger.info('runCheckMempoolSize: the mempool is not clear');
      if (this.mempoolWeight !== undefined) {
        const wasClear = this.mempoolWeight < maxBlockWeight;
        logger.info(`runCheckMempoolSize: wasClear: ${wasClear}`);
        if (wasClear) {
          this.safeAsyncEmit(BitcoindWatcherEventName.NewMempoolClearStatus, {
            isClear: false,
          });
        }
      } else {
        logger.info('runCheckMempoolSize: last mempoolWeight is undefined');
      }
      this.mempoolWeight = minWeight;
    } catch (error) {
      // Check raw mempool anyways
      this.checkRawMempool = true;
      throw error;
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

  private fromOutputScript(script: Buffer): string | undefined {
    if (!this.chain) {
      return undefined;
    }
    try {
      return bitcoinjsAddress.fromOutputScript(script, networks[this.chain]);
    } catch (error) { // ignore error
      return undefined;
    }
  }

  private handleNewTransactionPayload(transactionPayload: Buffer) {
    if (this.transactionPayloadsQueue) {
      this.transactionPayloadsQueue.push(transactionPayload);
      return;
    }
    const transaction = Transaction.fromBuffer(transactionPayload);
    if (transaction.isCoinbase()) {
      this.newBlockDebounce();
    }
    const txid = transaction.getId();
    const analysis = this.transactionAnalyses.get(txid);
    if (
      (analysis && !analysis.transactionInputKeys)
      || transaction.outs.some((transactionOutput) => {
        const address = this.fromOutputScript(transactionOutput.script);
        return address && this.watchedAddresses.has(address);
      })
    ) {
      this.transactionsToReanalyze.push(txid);
      this.delayedTriggerTimeout?.refresh();
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

  private reportIncomes(transaction: BlockTransaction, confirmations: number) {
    const matchingAddresses: Set<string> = new Set();
    for (const txOut of transaction.vout) {
      for (const txOutAddress of getOutAddresses(txOut)) {
        if (this.watchedAddresses.has(txOutAddress)) {
          matchingAddresses.add(txOutAddress);
        }
      }
    }
    for (const matchingAddress of matchingAddresses) {
      this.checkWatchedAddressIncome(matchingAddress, transaction, confirmations);
    }
  }

  private checkWatchedAddressIncome(
    watchedAddress: string,
    rawTransaction: BlockTransaction,
    confirmations: number,
  ) {
    logger.info(
      `checkWatchedAddressIncome: address: ${watchedAddress} txid: ${
        rawTransaction.txid
      } confirmations: ${confirmations}.`,
    );
    const alreadyDiscoveredTransactions = this.watchedAddresses.get(watchedAddress);
    if (!alreadyDiscoveredTransactions) {
      // address not watched
      return;
    }
    if ((confirmations === 0) && alreadyDiscoveredTransactions.has(rawTransaction.txid)) {
      // First appearance on mempool was already reported
      return;
    }
    const newTransactionStatus = confirmationsToTransactionStatus(confirmations);
    const txOuts = rawTransaction.vout.filter(
      (txOut) => getOutAddresses(txOut).includes(watchedAddress),
    );
    const multiAddress = txOuts.some(
      (txOut) => (getOutAddresses(txOut).length > 1),
    );
    const incomeSats = txOuts.reduce(
      (partialSum, txOut) => partialSum + Math.round(txOut.value * satsPerBitcoin),
      0,
    );
    if (!alreadyDiscoveredTransactions.has(rawTransaction.txid)) {
      if (alreadyDiscoveredTransactions.size >= maxOngoingIncomeTransactions) {
        alreadyDiscoveredTransactions.clear();
        this.safeAsyncEmit(BitcoindWatcherEventName.AddressOverload, watchedAddress);
      }
      alreadyDiscoveredTransactions.add(rawTransaction.txid);
    }
    this.safeAsyncEmit(
      BitcoindWatcherEventName.NewAddressPayment,
      {
        address: watchedAddress,
        txid: rawTransaction.txid,
        status: newTransactionStatus,
        confirmations,
        multiAddress,
        incomeSats,
      },
    );
  }

  private async analyzeNewBlocks(bestBlockHash: string): Promise<boolean> {
    logger.info(`analyzeNewBlocks: ${bestBlockHash}`);
    const newBlocks: BlockVerbosity2[] = [];
    let chainBlockhash = bestBlockHash;
    for (let count = 0; count < maxAnalyzedBlocks; count += 1) {
      logger.info(`analyzeNewBlocks: getting parent block ${count} ${chainBlockhash}`);
      // eslint-disable-next-line no-await-in-loop
      const block = await getBlock(chainBlockhash);
      if (!block) {
        logger.info('analyzeNewBlocks: could not get block');
        return false;
      }
      logger.info(`analyzeNewBlocks: new block height is ${block.height}`);
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
      logger.info('analyzeNewBlocks: no new blocks');
      return true;
    }
    logger.info(`analyzeNewBlocks: new blocks: ${newBlocks.length}`);
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
      for (const [, alreadyDiscoveredTransactions] of this.watchedAddresses) {
        // might cause same payment status to be reported multiple times.
        alreadyDiscoveredTransactions.clear();
      }
      this.shouldRerun = true;
    }
    logger.info('analyzeNewBlocks: mapping blocks transactions');
    const transactions = newBlocks.flatMap(
      (block) => block.tx.map((transaction): [BlockTransaction, BlockVerbosity2] => ([
        transaction,
        block,
      ])),
    );
    logger.info(`analyzeNewBlocks: ${this.watchedAddresses.size} watched addresses`);
    if (this.watchedAddresses.size > 0) {
      await this.analyzeBlockSpendingAddresses(transactions, false);
    }
    logger.info(`analyzeNewBlocks: updating transaction analyses with ${
      transactions.length
    } new transactions`);
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
    logger.info('analyzeNewBlocks: checking transaction conflicts');
    for (const [transaction, block] of transactions) {
      this.checkTransactionConflicts(
        transaction.txid,
        transaction.vin
          .filter((txIn) => txIn.txid)
          .map((txIn) => txInStandardKey(txIn as TxInStandard)),
      );
      this.reportIncomes(transaction, block.confirmations);
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
      newBlocks: newBlocks.length,
    });
    const confirmedBlockHashes = attachedBlockHashes.slice(0, -maxAnalyzedBlocks).reverse();
    logger.info(`analyzeNewBlocks: confirmedBlockHashes: ${confirmedBlockHashes.join(', ')}`);

    if (this.watchedAddresses.size > 0) {
      logger.info('analyzeNewBlocks: analyzing confirmed transactions for watched addresses');
      const confirmedTransactions = await getBlockTransactions(confirmedBlockHashes);
      await this.analyzeBlockSpendingAddresses(confirmedTransactions, true);
      for (const [transaction, block] of confirmedTransactions) {
        this.reportIncomes(transaction, block.confirmations);
        for (const [, alreadyDiscoveredTransactions] of this.watchedAddresses) {
          alreadyDiscoveredTransactions.delete(transaction.txid);
        }
      }
    }
    logger.info(
      'analyzeNewBlocks: updating transaction analyses with confirmed and detached blocks',
    );
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
    logger.info('analyzeNewBlocks: analysis complete');
    return true; // analysis complete
  }

  private async analyzeBlockSpendingAddresses(
    transactions: [RawTransaction, BlockVerbosity2][],
    fullConfirmation: boolean,
  ) {
    const inputTransactionIds = [...new Set(transactions.flatMap(
      ([transaction]) => transaction.vin.map((txIn) => txIn.txid).filter(Boolean),
    ) as string[])];
    logger.info(`analyzeBlockSpendingAddresses: Getting ${
      inputTransactionIds.length
    } input transactions`);
    const inputTransactions: Map<string, RawTransaction> = new Map();
    while (inputTransactionIds.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      const someInputTransactions = await getRawTransactionsBatch(
        inputTransactionIds.splice(0, rawTransactionsBatchSize),
      );
      for (const someInputTransaction of someInputTransactions) {
        if (someInputTransaction.vout.some(
          (txOut) => getOutAddresses(txOut).some(
            (ad) => this.watchedAddresses.has(ad),
          ),
        )) {
          inputTransactions.set(someInputTransaction.txid, someInputTransaction);
        }
      }
    }
    for (const [transaction, block] of transactions) {
      const spendingByAddresses: Map<string, number> = new Map();
      for (const txIn of transaction.vin) {
        if (!txIn.txid) {
          continue;
        }
        const inputTransaction = inputTransactions.get(txIn.txid);
        if (!inputTransaction) {
          continue;
        }
        const txOut = inputTransaction.vout[txIn.vout];
        if (!txOut) {
          continue;
        }
        for (const spendingAddress of getOutAddresses(txOut)) {
          if (this.watchedAddresses.has(spendingAddress)) {
            spendingByAddresses.set(
              spendingAddress,
              (spendingByAddresses.get(spendingAddress) ?? 0)
              + Math.round(txOut.value * satsPerBitcoin),
            );
          }
        }
      }
      for (const [address, outcomeSats] of spendingByAddresses) {
        this.safeAsyncEmit(
          BitcoindWatcherEventName.NewAddressPayment,
          {
            address,
            txid: transaction.txid,
            status: (
              fullConfirmation
                ? TransactionStatus.FullConfirmation
                : TransactionStatus.PartialConfirmation
            ),
            confirmations: block.confirmations,
            multiAddress: false, // relevant only for incoming transactions
            outcomeSats,
          },
        );
      }
    }
  }

  private async bestBlockRecheck(): Promise<void> {
    try {
      logger.info('bestBlockRecheck: started');
      this.newBlockDebounce();
      logger.info('bestBlockRecheck: finished');
    } catch (error) {
      logger.error(`bestBlockRecheck: Failed ${errorString(error)}`);
    }
  }

  private async mempoolSizeRecheck(): Promise<void> {
    try {
      logger.info('mempoolSizeRecheck: started');
      this.checkMempoolSize = true;
      this.delayedTriggerTimeout?.refresh();
      logger.info('mempoolSizeRecheck: finished');
    } catch (error) {
      logger.error(`mempoolSizeRecheck: failed to run ${errorString(error)}`);
    }
  }

  async start(
    analyzedBlockHashes: string[],
    watchedTransactions: [string, TransactionAnalysis][],
    watchedAddresses: string[],
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
    logger.info(`BitcoindWatcher: zmq notification addresses: ${
      JSON.stringify(notificationAddresses)
    }`);
    if (!notificationAddresses.rawtx) {
      throw new Error('The required zmq-notification addresses do not contain rawtx');
    }

    this.analyzedBlockHashes = analyzedBlockHashes;
    for (const [txid, analysis] of watchedTransactions) {
      this.setTransactionAnalysis(txid, analysis);
    }
    for (const watchedAddress of watchedAddresses) {
      this.watchedAddresses.set(watchedAddress, new Set());
    }

    if (notificationAddresses.rawblock) {
      logger.info('BitcoindWatcher: subscribing to rawblock zmq notifications');
      this.rawBlockSocket = zeromq.socket('sub');
      this.rawBlockSocket.connect(notificationAddresses.rawblock);
      this.rawBlockSocket.subscribe('rawblock');
      this.rawBlockSocket.on('message', (topicBuffer: Buffer) => {
        const topic = topicBuffer.toString();
        if (topic !== 'rawblock') {
          return;
        }
        this.newBlockDebounce();
      });
      monitorSocket('rawBlockSocket', this.rawBlockSocket);
    } else if (notificationAddresses.sequence) {
      logger.info('BitcoindWatcher: subscribing to sequence zmq notifications');
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
          this.newBlockDebounce();
        }
      });
      monitorSocket('sequenceNotificationSocket', this.sequenceNotificationSocket);
    } else {
      logger.info('BitcoindWatcher: starting best block recheck interval');
      const bestBlockRecheckInterval = setInterval(
        () => this.bestBlockRecheck(),
        bestBlockRecheckIntervalMs,
      );
      bestBlockRecheckInterval.unref();
    }
    this.mempoolSizeRecheckInterval = setInterval(
      () => this.mempoolSizeRecheck(),
      mempoolSizeRecheckIntervalMs,
    );
    this.mempoolSizeRecheckInterval.unref();

    logger.info('BitcoindWatcher: subscribing to rawtx zmq notifications');
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
    monitorSocket('rawTransactionSocket', this.rawTransactionSocket);
    this.delayedTriggerTimeout = setTimeout(
      () => {
        logger.info('delayedTriggerTimeout: trigger');
        this.emit(BitcoindWatcherEventName.Trigger);
      },
      delayedTriggerTimeoutMs,
    );
  }

  watchNewTransaction(txid: string) {
    this.newTransactionsToWatch.push(txid);
    this.delayedTriggerTimeout?.refresh();
  }

  unwatchTransaction(txid: string) {
    this.transactionsToUnwatch.push(txid);
    this.delayedTriggerTimeout?.refresh();
  }

  watchAddress(watchedAddress: string) {
    if (this.watchedAddresses.has(watchedAddress)) {
      return this.overloadedAddresses.has(watchedAddress);
    }
    this.watchedAddresses.set(watchedAddress, new Set());
    return false;
  }

  unwatchAddress(watchedAddress: string) {
    this.watchedAddresses.delete(watchedAddress);
    this.overloadedAddresses.delete(watchedAddress);
  }

  getChain(): Network {
    if (!this.chain) {
      throw new Error('BitcoindWatcher: Not started');
    }
    return this.chain;
  }

  countTasks(): number {
    logger.info(`countTasks: ${JSON.stringify({
      isRunning: this.isRunning,
      shouldRerun: this.shouldRerun,
      newTransactionsToWatch: this.newTransactionsToWatch.length,
      transactionsToUnwatch: this.transactionsToUnwatch.length,
      transactionsToReanalyze: this.transactionsToReanalyze.length,
      transactionPayloadsQueue: this.transactionPayloadsQueue?.length ?? 0,
      recheckMempoolTransactions: this.recheckMempoolTransactions?.length ?? 0,
      checkNewBlock: this.checkNewBlock,
      checkRawMempool: this.checkRawMempool,
    })}`);
    return (
      this.newTransactionsToWatch.length + this.transactionsToUnwatch.length
      + this.transactionsToReanalyze.length + (this.transactionPayloadsQueue?.length ?? 0)
      + (this.recheckMempoolTransactions?.length ?? 0) + (this.checkNewBlock ? 1 : 0)
      + (this.checkRawMempool ? 1 : 0)
    );
  }

  getMempoolWeight(): number {
    return this.mempoolWeight ?? 0;
  }

  isMempoolClear(): boolean | undefined {
    if (this.mempoolWeight === undefined) {
      return undefined;
    }
    return this.mempoolWeight < maxBlockWeight;
  }

  async getInfo(): Promise<BitcoindInfo> {
    const chain = this.getChain();
    const networkInfo = await getNetworkInfo();
    if (!networkInfo) {
      throw new Error('Failed to get network info');
    }
    return {
      chain,
      version: networkInfo.subversion,
    };
  }
}

export const bitcoindWatcher = new BitcoindWatcher();
