import { bitcoindWatcher } from '../helpers/bitcoind-watcher';
import { WatchedAddressesModel } from '../models/watched-addresses';

export async function unwatchUnusedAddresses(addresses: string[]) {
  const existingAddressDocs = await WatchedAddressesModel.find({
    address: {
      $in: addresses,
    },
  });
  const existingAddresses = new Set(existingAddressDocs.map(({ address }) => address));
  for (const address of addresses) {
    if (!existingAddresses.has(address)) {
      bitcoindWatcher.unwatchAddress(address);
    }
  }
}
