import { bitcoindWatcher } from '../helpers/bitcoind-watcher';
import { WatchedTransactionsModel } from '../models/watched-transactions';

export async function unwatchUnusedTransactions(txids: string[]) {
  const existingTransactions = await WatchedTransactionsModel.find({
    txid: {
      $in: txids,
    },
  });
  const existingTxids = new Set(existingTransactions.map(({ txid }) => txid));
  for (const txid of txids) {
    if (!existingTxids.has(txid)) {
      bitcoindWatcher.unwatchTransaction(txid);
    }
  }
}
