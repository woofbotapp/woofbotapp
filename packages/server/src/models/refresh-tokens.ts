import { createHash, createHmac, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { Schema, model, Types } from 'mongoose';
import ms from 'ms';

import logger from '../helpers/logger';
import { TimeFields } from '../helpers/mongo';
import { isValidObjectIdString } from '../helpers/validations';

interface RefreshTokenFields {
  tokenHash: string;
  expireAt: Date;
}

const schema = new Schema<RefreshTokenFields & TimeFields>({
  tokenHash: { type: String, required: true, index: true },
  expireAt: { type: Date, required: true, expires: 0 },
}, { timestamps: true });

export const RefreshTokensModel = model('refresh_tokens', schema);

const refreshTokenExpirationMs = 3_600_000;
const jwtAlgorithm = 'HS256';
const jwtSecret = process.env.APP_SEED
  ? createHmac('sha256', process.env.APP_SEED).update('jwt-secret').digest('base64')
  : randomBytes(32).toString('base64');
const jwtIssuer = 'woofbot';
const jwtSubject = 'admin-auth';
const jwtExpiresIn = '30m';

export const createTokensPair = async () => {
  const preHash = randomBytes(32).toString('base64').slice(0, -1);
  const refreshToken = new RefreshTokensModel({
    tokenHash: createHash('sha256').update(preHash).digest('base64'),
    expireAt: new Date(Date.now() + refreshTokenExpirationMs),
  });
  await refreshToken.save();
  const authToken = jwt.sign({
    refreshTokenId: refreshToken.id,
  }, jwtSecret, {
    algorithm: jwtAlgorithm,
    expiresIn: jwtExpiresIn,
    issuer: jwtIssuer,
    subject: jwtSubject,
  });
  return {
    authToken,
    refreshToken: preHash,
    expiresIn: ms(jwtExpiresIn),
  };
};

export interface DecodedAuthToken extends jwt.JwtPayload {
  refreshTokenId: string;
}

export const verifyAuthToken = async (authToken: string): Promise<DecodedAuthToken | undefined> => {
  const decodedToken = await new Promise<jwt.JwtPayload | undefined>((resolve) => {
    jwt.verify(authToken, jwtSecret, {
      algorithms: [jwtAlgorithm],
      issuer: jwtIssuer,
      subject: jwtSubject,
      clockTolerance: 60,
    }, (error, decoded) => {
      if (error) {
        logger.error(`Bad auth token: ${error.stack}`);
        return resolve(undefined);
      }
      if (!decoded || (typeof decoded !== 'object')) {
        logger.error('Failed to decode token');
        return resolve(undefined);
      }
      return resolve(decoded);
    });
  });
  if (!decodedToken) {
    return undefined;
  }
  const { refreshTokenId } = decodedToken;
  const refreshTokenDocument = (
    isValidObjectIdString(refreshTokenId)
    && await RefreshTokensModel.findById(new Types.ObjectId(refreshTokenId))
  );
  if (!refreshTokenDocument) {
    logger.info('The associated refresh-token of the auth-token has expired or has been removed');
    return undefined;
  }
  return decodedToken as DecodedAuthToken;
};
