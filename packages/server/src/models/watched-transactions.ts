import {
  Schema, model, ObjectId, Types,
} from 'mongoose';

import { TimeFields } from '../helpers/mongo';

export enum TransactionStatus {
  Unpublished = 'unpublished',
  Mempool = 'mempool',
  PartialConfirmation = 'partialConfirmation',
  FullConfirmation = 'fullConfirmation',
}

interface WatchedTransactionFields {
  userId: ObjectId;
  txid: string;
  nickname?: string;
  status: TransactionStatus;
  blockHashes: string[];
  confirmations: number;
  conflictingTransactions?: string[];
  transactionInputKeys?: string[];
}

const schema = new Schema<WatchedTransactionFields & TimeFields>({
  userId: { type: Types.ObjectId, required: true, ref: 'users' },
  txid: { type: String, required: true, index: true },
  nickname: { type: String, required: false },
  status: { type: String, enum: Object.values(TransactionStatus), required: true },
  blockHashes: { type: [String], required: false },
  confirmations: { type: Number, required: true },
  conflictingTransactions: { type: [String], required: false },
  transactionInputKeys: { type: [String], required: false },
}, { timestamps: true });

export const WatchedTransactionsModel = model('watched_transactions', schema);
