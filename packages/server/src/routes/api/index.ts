import Router, { json as expressJson } from 'express';
import expressWinston from 'express-winston';
import winston from 'winston';

import { asyncHandler } from '../../helpers/express';
import logger, { defaultLogFormat } from '../../helpers/logger';
import { verifyAuthToken } from '../../models/refresh-tokens';
import apiAuthRouter from './auth';
import apiAuthLogoutRouter from './auth/logout';
import apiSettingsRouter from './settings';
import apiUsersRouter from './users';

const rebootAt = new Date();

const apiRouter = Router();

apiRouter.use(expressJson({
  limit: '100kb',
}), (err, req, res, next) => {
  if (err instanceof SyntaxError) {
    logger.info(`Unparsable body: ${err.stack}`);
    res.status(400).json({
      error: 'Unparsable body',
    });
    return;
  }
  next(err);
});

// Public apis

apiRouter.use('/auth', apiAuthRouter);

apiRouter.use(asyncHandler(async (req, res, next) => {
  const authorizationHeader = req.get('authorization');
  if (!authorizationHeader) {
    res.status(401).json({
      error: 'Unauthenticated',
    });
    return;
  }
  if (!authorizationHeader.startsWith('Bearer ')) {
    res.status(400).json({
      error: 'Invalid authorization header',
    });
    return;
  }
  const token = authorizationHeader.slice('Bearer'.length).trim();
  const decodedToken = await verifyAuthToken(token);
  if (!decodedToken) {
    res.status(401).json({
      error: 'Invalid or expired authentication token',
    });
    return;
  }
  req.authToken = decodedToken;
  next();
}));

// Private apis

apiRouter.use('/auth/logout', apiAuthLogoutRouter);

apiRouter.get('/ping', asyncHandler(async (req, res) => {
  res.json({
    ok: true,
  });
}));

apiRouter.use('/settings', apiSettingsRouter);

apiRouter.get('/stats', asyncHandler(async (req, res) => {
  res.json({
    rebootAt,
  });
}));

apiRouter.use('/users', apiUsersRouter);

apiRouter.use((req, res) => {
  res.status(404).json({
    error: 'Api not found',
  });
});

apiRouter.use(expressWinston.errorLogger({
  transports: [
    new winston.transports.Console(),
  ],
  format: defaultLogFormat,
}) as (...args: unknown[]) => void); // typescript problems

// eslint-disable-next-line @typescript-eslint/no-unused-vars
apiRouter.use((err, _req, res, _next) => {
  logger.error(err.stack);
  if (!res.headersSent) {
    res.status(500).json({
      error: 'Internal error',
    });
  }
});

export default apiRouter;
