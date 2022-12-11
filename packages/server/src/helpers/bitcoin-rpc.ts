import AbortController from 'abort-controller';
import fetch from 'node-fetch';

export interface ChainInfo {
  chain: string
  blocks: number
  headers: number
  bestblockchash: number
  difficulty: number
  mediantime: number
  verificationprogress: number
  initialblockdownload: boolean
  chainwork: string
  size_on_disk: number
  pruned: boolean
  pruneheight: number
  automatic_pruning: boolean
  prune_target_size: number
  softforks: {
    id: string
    version: number
    reject: {
      status: boolean
    }
  }[]
  bip9_softforks: {
    [key: string]: {
      status: 'defined' | 'started' | 'locked_in' | 'active' | 'failed'
    }
  }[]
  warnings?: string
}

interface TxInScriptSig {
  asm: string;
  hex: string;
}

interface TxInCoinbase {
  coinbase: string;
  sequence: number;
  txid: undefined;
  vout: undefined;
}

export interface TxInStandard {
  txid: string;
  vout: number;
  scriptSig: TxInScriptSig;
  txinwitness?: string[];
  sequence: number;
}

type TxIn = TxInCoinbase | TxInStandard;

interface TxOutScriptPubKey {
  asm: string;
  hex: string;
  type: string;
  address?: string;
  addresses?: string[];
}

interface TxOut {
  value: number
  n: number
  scriptPubKey: TxOutScriptPubKey;
}

export function getOutAddresses(txOut: TxOut): string[] {
  if (!txOut.scriptPubKey.addresses) {
    // modern api
    return txOut.scriptPubKey.address ? [txOut.scriptPubKey.address] : [];
  }
  const { address } = txOut.scriptPubKey;
  if (!address || txOut.scriptPubKey.addresses.includes(address)) {
    return txOut.scriptPubKey.addresses;
  }
  return [
    ...txOut.scriptPubKey.addresses,
    address,
  ];
}

// When the transaction is specified in a specific block details
export interface BlockTransaction {
  txid: string;
  hash: string;
  version: number;
  size: number;
  vsize: number;
  weight: number;
  locktime: number;
  vin: TxIn[];
  vout: TxOut[];
}

export interface RawTransaction extends BlockTransaction {
  blockhash?: string;
  confirmations?: number;
  blocktime?: number;
  time?: number;
}

export interface BlockVerbosity2 {
  hash: string;
  confirmations: number;
  strippedsize: number;
  size: number;
  weight: number;
  height: number;
  version: number;
  verxionHex: string;
  merkleroot: string;
  tx: BlockTransaction[];
  hex: string;
  time: number;
  mediantime: number;
  nonce: number;
  bits: string;
  difficulty: number;
  chainwork: string;
  previousblockhash: string;
  nextblockchash?: string;
}

interface RawMempoolTransaction {
  // There are lots of other fields that we don't use. see:
  // https://developer.bitcoin.org/reference/rpc/getrawmempool.html#result-for-verbose-true
  weight: number;
  time: number;
}

interface BitcoinRpcErrorJson {
  code: number;
  message: string;
}

interface BitcoinRpcResponseId {
  id: string;
}

interface BitcoinRpcSuccessResponse<T> extends BitcoinRpcResponseId {
  result: T;
  error: null;
}

interface BitcoinRpcFailResponse extends BitcoinRpcResponseId {
  result: null;
  error: BitcoinRpcErrorJson;
}

interface ZmqNotification {
  type: string;
  address: string;
  hwm?: number;
}

type BitcoinRpcResponse<T> = BitcoinRpcSuccessResponse<T> | BitcoinRpcFailResponse;

const bitcoinRpcUrl = `http://${
  process.env.APP_BITCOIN_NODE_IP || 'localhost'
}:${process.env.APP_BITCOIN_RPC_PORT || 8332}`;

const bitcoinRpcHttpOptions = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Basic ${Buffer.from(`${
      process.env.APP_BITCOIN_RPC_USER || 'bitcoinrpcuser'
    }:${
      process.env.APP_BITCOIN_RPC_PASS || 'bitcoinrpcpassword'
    }`).toString('base64')}`,
  },
};

const bitcoinRpcErrorNotFound = -5;

class BitcoinRpcError extends Error {
  code: number;

  constructor(errorJson: BitcoinRpcErrorJson) {
    super(errorJson.message || 'Unknown error');
    this.code = errorJson.code;
  }

  isNotFound() {
    return (this.code === bitcoinRpcErrorNotFound);
  }
}

interface RpcProperties {
  method: string;
  params?: unknown;
}

const abortTimeoutMs = 90_000;

async function rpc<T>(properties: RpcProperties): Promise<T> {
  const abortController = new AbortController();
  const abortTimeout = setTimeout(() => abortController.abort(), abortTimeoutMs);
  try {
    const rpcId = Math.random().toString(36).substring(2);
    const response = await fetch(
      bitcoinRpcUrl,
      {
        ...bitcoinRpcHttpOptions,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: rpcId,
          method: properties.method,
          params: properties.params,
        }),
        signal: abortController.signal,
      },
    );
    let responseJson: BitcoinRpcResponse<T>;
    try {
      responseJson = (await response.json()) as BitcoinRpcResponse<T>;
    } catch (error) {
      if (!response.ok) {
        // ignore the analysis error
        throw new Error('Bitcoin rpc failed to parse json and response not ok');
      }
      throw error;
    }
    if (responseJson.id !== rpcId) {
      throw new Error('Unexpected bitcoin rpc response id');
    }
    if (responseJson.error) {
      // It is strange that the status is ok but we have an error defined
      throw new BitcoinRpcError(responseJson.error);
    }
    if (!response.ok) {
      throw new Error('Bitcoin rpc response not ok');
    }
    return responseJson.result;
  } finally {
    clearTimeout(abortTimeout);
  }
}

async function rpcBatch<T>(propertiesArray: RpcProperties[]): Promise<(BitcoinRpcError | T)[]> {
  const abortController = new AbortController();
  const abortTimeout = setTimeout(() => abortController.abort(), abortTimeoutMs);
  try {
    const rpcId = Math.random().toString(36).substring(2);
    const response = await fetch(
      bitcoinRpcUrl,
      {
        ...bitcoinRpcHttpOptions,
        body: JSON.stringify(
          propertiesArray.map(({ method, params }, index) => ({
            jsonrpc: '2.0',
            id: `${rpcId}:${index}`,
            method,
            params,
          })),
        ),
        signal: abortController.signal,
      },
    );
    let responseJson: BitcoinRpcResponse<T>[];
    try {
      responseJson = (await response.json()) as BitcoinRpcResponse<T>[];
      if (!Array.isArray(responseJson)) {
        throw new Error('Bitcoin rpc batch response is not array');
      }
    } catch (error) {
      if (!response.ok) {
        // ignore the analysis error
        throw new Error('Bitcoin rpc batch failed to parse json and response not ok');
      }
      throw error;
    }
    if (responseJson.some(({ id }, index) => `${rpcId}:${index}` !== id)) {
      throw new Error('Unexpected bitcoin rpc batch response id');
    }
    // ignore status code check - not sure what it should be if some of the responses
    // have errors and some don't.
    return responseJson.map((rpcResponse) => (
      rpcResponse.error ? new BitcoinRpcError(rpcResponse.error) : rpcResponse.result
    ));
  } finally {
    clearTimeout(abortTimeout);
  }
}

export async function getRawTransaction(txid: string): Promise<RawTransaction | undefined> {
  try {
    const response: RawTransaction = await rpc({
      method: 'getrawtransaction',
      params: {
        txid,
        verbose: true,
      },
    });
    return response;
  } catch (error) {
    if ((error instanceof BitcoinRpcError) && error.isNotFound()) {
      return undefined;
    }
    throw error;
  }
}

export async function getRawTransactionsBatch(txids: string[]): Promise<RawTransaction[]> {
  if (txids.length === 0) {
    return [];
  }
  const rawTransactions: (RawTransaction | BitcoinRpcError)[] = await rpcBatch(
    txids.map((txid) => ({
      method: 'getrawtransaction',
      params: {
        txid,
        verbose: true,
      },
    })),
  );
  const filteredTransactions = rawTransactions.filter((rawTransaction) => {
    if (rawTransaction instanceof BitcoinRpcError) {
      if (!rawTransaction.isNotFound()) {
        throw rawTransaction;
      }
      return false;
    }
    return true;
  }) as RawTransaction[];
  return filteredTransactions;
}

export async function isTransactionInMempool(txid: string) {
  try {
    await rpc({
      method: 'getmempoolentry',
      params: { txid },
    });
    return true;
  } catch (error) {
    if ((error instanceof BitcoinRpcError) && error.isNotFound()) {
      return false;
    }
    throw error;
  }
}

export async function getRawMempool(): Promise<
  Record<string, RawMempoolTransaction> | undefined> {
  try {
    const response: Record<string, RawMempoolTransaction> = await rpc({
      method: 'getrawmempool',
      params: { verbose: true },
    });
    return response;
  } catch (error) {
    if ((error instanceof BitcoinRpcError) && error.isNotFound()) {
      return undefined;
    }
    throw error;
  }
}

export async function getBlockchainInfo(): Promise<ChainInfo | undefined> {
  try {
    const response: ChainInfo = await rpc({
      method: 'getblockchaininfo',
    });
    return response;
  } catch (error) {
    if ((error instanceof BitcoinRpcError) && error.isNotFound()) {
      return undefined;
    }
    throw error;
  }
}

export async function getBestBlockHash(): Promise<string | undefined> {
  try {
    const response: string = await rpc({
      method: 'getbestblockhash',
    });
    return response;
  } catch (error) {
    if ((error instanceof BitcoinRpcError) && error.isNotFound()) {
      return undefined;
    }
    throw error;
  }
}

export async function getZmqNotifications(): Promise<ZmqNotification[] | undefined> {
  try {
    const response: ZmqNotification[] = await rpc({
      method: 'getzmqnotifications',
    });
    return response;
  } catch (error) {
    if ((error instanceof BitcoinRpcError) && error.isNotFound()) {
      return undefined;
    }
    throw error;
  }
}

export async function getBlock(blockhash: string): Promise<BlockVerbosity2 | undefined> {
  try {
    const response: BlockVerbosity2 = await rpc({
      method: 'getblock',
      params: {
        blockhash,
        verbosity: 2,
      },
    });
    return response;
  } catch (error) {
    if ((error instanceof BitcoinRpcError) && error.isNotFound()) {
      return undefined;
    }
    throw error;
  }
}

export async function getBlockTransactions(
  blockHashes: string[],
): Promise<[BlockTransaction, BlockVerbosity2][]> {
  if (blockHashes.length === 0) {
    return [];
  }
  const blocks: (BlockVerbosity2 | BitcoinRpcError)[] = await rpcBatch(
    blockHashes.map((blockhash) => ({
      method: 'getblock',
      params: {
        blockhash,
        verbosity: 2,
      },
    })),
  );
  const filteredBlocks = blocks.filter((block) => {
    if (block instanceof BitcoinRpcError) {
      if (!block.isNotFound()) {
        throw block;
      }
      return false;
    }
    return true;
  }) as BlockVerbosity2[];
  return filteredBlocks.flatMap(
    (block) => block.tx.map((someTx): [BlockTransaction, BlockVerbosity2] => [someTx, block]),
  );
}

function fixLocalAddress(address: string): string {
  const parts = address.split(':');
  if (
    process.env.APP_BITCOIN_NODE_IP
    && (parts[0] === 'tcp')
    && ['//127.0.0.1', '//0.0.0.0', '[::1]'].includes(parts[1])
  ) {
    return `tcp://${process.env.APP_BITCOIN_NODE_IP}:${parts.slice(2).join(':')}`;
  }
  return address;
}

export interface ZmqNotificationAddresses {
  sequence?: string;
  rawtx: string;
}

export async function getNotificationAddresses(): Promise<ZmqNotificationAddresses | undefined> {
  const zmqNotifications = await getZmqNotifications();
  if (!zmqNotifications) {
    return undefined;
  }
  const rawtx = zmqNotifications.find(
    (zmqNotification) => (zmqNotification.type === 'pubrawtx'),
  )?.address;
  if (!rawtx) {
    return undefined;
  }
  const sequence = zmqNotifications.find(
    (zmqNotification) => ['sequence', 'pubsequence'].includes(zmqNotification.type),
  )?.address;
  return {
    sequence: sequence && fixLocalAddress(sequence),
    rawtx: fixLocalAddress(rawtx),
  };
}
