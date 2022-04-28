import querystring from 'querystring';
import expressAsyncHandler from 'express-async-handler';
import Router from 'express';
import { Types } from 'mongoose';

import { UsersModel } from '../../models/users';
import { deleteUser } from '../../controllers/users';
import logger from '../../helpers/logger';
import { errorString } from '../../helpers/error';
import telegramManager, { escapeMarkdown } from '../../helpers/telegram';

const maxLimit = 200;

const apiUsersRouter = Router();

apiUsersRouter.get('/', expressAsyncHandler(async (req, res) => {
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
          querystring.stringify({
            'page[size]': pageSize,
            'page[cursor]': `${nextUser.createdAt.getTime()}.${nextUser.id}`,
          })
        }`,
      },
    },
    data: users.slice(0, pageSize).map((userDoc) => ({
      type: 'users',
      id: userDoc.id,
      attributes: Object.fromEntries(
        [
          'telegramFromId',
          'telegramUsername',
          'telegramChatId',
          'watchReboot',
          'updatedAt',
          'createdAt',
        ].map((key) => [key, userDoc[key]]),
      ),
    })),
  });
}));

apiUsersRouter.delete('/:userId([0-9a-f]{24})', expressAsyncHandler(async (req, res) => {
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

export default apiUsersRouter;
