import Router from 'express';
import { Types } from 'mongoose';

import { asyncHandler } from '../../helpers/express';
import { UsersModel } from '../../models/users';
import { WatchedAddressesModel } from '../../models/watched-addresses';
import { WatchedTransactionsModel } from '../../models/watched-transactions';
import { deleteUser } from '../../controllers/users';
import logger from '../../helpers/logger';
import { errorString } from '../../helpers/error';
import telegramManager, { escapeMarkdown } from '../../helpers/telegram';

const maxLimit = 200;

const listAttributes = [
  'telegramFromId',
  'telegramUsername',
  'telegramChatId',
  'watchReboot',
  'watchNewBlocks',
  'watchPriceChange',
  'watchMempoolClear',
  'permissionGroups',
  'updatedAt',
  'createdAt',
];

const apiUsersRouter = Router();

apiUsersRouter.get('/', asyncHandler(async (req, res) => {
  const { page } = req.query;
  if (
    !page
    || (typeof page !== 'object')
    || Array.isArray(page)
    || !page.size
  ) {
    res.status(400).json({
      error: 'Missing page[size] query param',
    });
    return;
  }
  const pageSize = (typeof page.size === 'string') && Number(page.size);
  if (!pageSize || !Number.isSafeInteger(pageSize) || (pageSize <= 0) || (maxLimit < pageSize)) {
    res.status(400).json({
      error: 'Invalid page[size]',
    });
    return;
  }
  const cursor = page.cursor?.toString();
  if (
    cursor
    && (
      (cursor.length > 1 + 14 + 1 + 24)
      || !/^[1-9]\d{0,14}\.[0-9a-f]{24}$/.test(cursor)
    )
  ) {
    res.status(400).json({
      error: 'Invalid page[cursor]',
    });
    return;
  }
  const [cursorTimestamp, cursorObjectId] = (
    cursor ? cursor.split('.') : ['', '']
  );
  const cursorDate = cursorTimestamp && new Date(Number(cursorTimestamp));
  const users = await UsersModel.find({
    ...Boolean(cursor) && {
      $or: [
        {
          createdAt: cursorDate,
          _id: {
            $gte: new Types.ObjectId(cursorObjectId),
          },
        },
        {
          createdAt: {
            $gt: cursorDate,
          },
        },
      ],
    },
  }).sort([
    ['createdAt', 1],
    ['_id', 1],
  ]).limit(pageSize + 1);
  const nextUser = users[pageSize];
  res.json({
    links: {
      ...nextUser && {
        next: `${
          req.originalUrl.split('?')[0]
        }?${
          new URLSearchParams({
            'page[size]': `${pageSize}`,
            'page[cursor]': `${nextUser.createdAt.getTime()}.${nextUser.id}`,
          })
        }`,
      },
    },
    data: users.slice(0, pageSize).map((userDoc) => ({
      type: 'users',
      id: userDoc.id,
      attributes: Object.fromEntries(
        listAttributes.map((key) => [key, userDoc[key]]),
      ),
    })),
  });
}));

apiUsersRouter.delete('/:userId([0-9a-f]{24})', asyncHandler(async (req, res) => {
  const user = await deleteUser({
    _id: new Types.ObjectId(req.params.userId),
  });
  if (!user) {
    res.status(404).json({
      error: 'User not found',
    });
    return;
  }
  try {
    telegramManager.sendMessage({
      text: escapeMarkdown('Woof! You have been removed by the bot administrator. Goodbye!'),
      chatId: user.telegramChatId,
    });
  } catch (error) {
    logger.error(`Failed to send notification to deleted user: ${errorString(error)}`);
  }
  res.json({ ok: true });
}));

apiUsersRouter.get('/:userId([0-9a-f]{24})', asyncHandler(async (req, res) => {
  const user = await UsersModel.findOne({
    _id: new Types.ObjectId(req.params.userId),
  });
  if (!user) {
    res.status(404).json({
      error: 'User not found',
    });
    return;
  }
  const watchedAddresses = await WatchedAddressesModel.find({
    userId: user._id,
  });
  const watchedTransactions = await WatchedTransactionsModel.find({
    userId: user._id,
  });
  res.json({
    data: {
      type: 'users',
      id: user.id,
      attributes: Object.fromEntries(
        listAttributes.map((key) => [key, user[key]]),
      ),
      relationships: {
        watchedAddresses: {
          data: watchedAddresses.map((doc) => ({
            type: 'watched-addresses',
            id: doc.id,
          })),
        },
        watchedTransactions: {
          data: watchedTransactions.map((doc) => ({
            type: 'watched-transactions',
            id: doc.id,
          })),
        },
      },
    },
    included: [
      ...watchedAddresses.map((doc) => ({
        type: 'watched-addresses',
        id: doc.id,
        attributes: Object.fromEntries([
          'address',
          'nickname',
          'createdAt',
          'updatedAt',
        ].map((key) => [key, doc[key]])),
      })),
      ...watchedTransactions.map((doc) => ({
        type: 'watched-transactions',
        id: doc.id,
        attributes: Object.fromEntries([
          'txid',
          'nickname',
          'status',
          'blockHashes',
          'confirmations',
          'conflictingTransactions',
          'createdAt',
          'updatedAt',
        ].map((key) => [key, doc[key]])),
      })),
    ],
  });
}));

apiUsersRouter.patch('/:userId([0-9a-f]{24})', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const data = req.body?.data;
  if (!data || data.type !== 'users' || data.id !== userId || data.relationships) {
    res.status(400).json({
      error: 'Invalid body',
    });
    return;
  }
  const { attributes } = data;
  if (!attributes || Array.isArray(attributes) || typeof attributes !== 'object') {
    res.status(400).json({
      error: 'Invalid attributes field',
    });
    return;
  }
  const { permissionGroups, ...leftover } = attributes;
  if (permissionGroups !== undefined) {
    if (
      !Array.isArray(permissionGroups) || permissionGroups.length > 100
      || permissionGroups.some((group) => typeof group !== 'string' || !/^[a-z_]{1,100}$/.test(group))
    ) {
      res.status(400).json({
        error: 'Invalid permission groups attribute',
      });
      return;
    }
  }
  if (Object.keys(leftover).length > 0) {
    res.status(403).json({
      error: 'Not allowed to change one or more attributes',
    });
    return;
  }
  const user = await UsersModel.findOneAndUpdate(
    {
      _id: new Types.ObjectId(req.params.userId),
    },
    {
      $set: {
        ...permissionGroups && {
          permissionGroups,
        },
      },
    },
  );
  if (!user) {
    res.status(404).json({
      error: 'User not found',
    });
    return;
  }
  res.json({ ok: true });
}));

export default apiUsersRouter;
