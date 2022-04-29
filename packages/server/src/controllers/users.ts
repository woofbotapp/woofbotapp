import { FilterQuery } from 'mongoose';
import { UserDocument, UsersModel } from '../models/users';
import { WatchedAddressesModel } from '../models/watched-addresses';
import { WatchedTransactionsModel } from '../models/watched-transactions';
import { unwatchUnusedAddresses } from './addresses';
import { unwatchUnusedTransactions } from './transactions';

export async function deleteUser(
  filterQuery: FilterQuery<UserDocument>,
): Promise<UserDocument | undefined> {
  const user = await UsersModel.findOneAndDelete(filterQuery);
  if (!user) {
    return undefined;
  }
  const transactions = await WatchedTransactionsModel.find({
    userId: user._id,
  });
  if (transactions.length) {
    await WatchedTransactionsModel.deleteMany({
      userId: user._id,
    });
    await unwatchUnusedTransactions(
      transactions.map(({ txid }) => txid),
    );
  }
  const addresses = await WatchedAddressesModel.find({
    userId: user._id,
  });
  if (addresses.length) {
    await WatchedTransactionsModel.deleteMany({
      userId: user._id,
    });
    await unwatchUnusedAddresses(
      addresses.map(({ address }) => address),
    );
  }
  return user;
}
