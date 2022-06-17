import {
  scrypt, ScryptOptions, timingSafeEqual, randomBytes, createHash,
} from 'crypto';
import expressAsyncHandler from 'express-async-handler';
import Router from 'express';

import { zeroObjectId } from '../../../helpers/mongo';
import { SettingsModel } from '../../../models/settings';
import { createTokensPair, RefreshTokensModel } from '../../../models/refresh-tokens';

const apiAuthRouter = Router();

const scryptMaxCost = 2 ** 20;
const scryptDefaultKeyLen = 32;
const scryptDefaultCost = 2 ** 18;
const scryptDefaultBlockSize = 8;
const scryptDefaultParallelization = 1;

const promisifiedScrypt = (
  password: string,
  salt: string,
  keylen: number,
  options: ScryptOptions,
) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, keylen, options, (error, result) => {
    if (error) {
      return reject(error);
    }
    return resolve(result);
  });
});

const hasPassword = async () => {
  if (process.env.APP_PASSWORD) {
    return true;
  }
  const settings = await SettingsModel.findById(zeroObjectId);
  if (!settings) {
    throw new Error('Could not find settings document');
  }
  return Boolean(settings.adminPasswordHash);
};

const verifyPassword = async (password: string) => {
  const settings = await SettingsModel.findById(zeroObjectId);
  if (!settings) {
    throw new Error('Could not find settings document');
  }
  if (!settings.adminPasswordHash) {
    const currentPassword = Buffer.from(process.env.APP_PASSWORD ?? '');
    const givenPassword = Buffer.from(password);
    return (
      (currentPassword.byteLength === givenPassword.byteLength)
      && timingSafeEqual(currentPassword, givenPassword)
    );
  }
  if (settings.adminPasswordHash.startsWith('scrypt$')) {
    const [
      , costString, blockSizeString, parallelizationString, salt, derivedKeyBase64,
    ] = settings.adminPasswordHash.split('$');
    const [cost, blockSize, parallelization] = [
      costString, blockSizeString, parallelizationString,
    ].map(Number);
    if ([cost, blockSize, parallelization].some(Number.isNaN) || (typeof derivedKeyBase64 !== 'string')) {
      throw new Error('Invalid scrypt password hash');
    }
    const derivedKey = Buffer.from(derivedKeyBase64, 'base64');
    if (
      (cost <= 0) || (cost > scryptMaxCost)
      || (blockSize !== scryptDefaultBlockSize)
      || (parallelization !== scryptDefaultParallelization)
      || (derivedKey.byteLength === 0)
    ) {
      throw new Error('Unsupported scrypt parameters');
    }
    const givenDerivedKey = await promisifiedScrypt(password, salt, derivedKey.length, {
      cost,
      blockSize,
      parallelization,
      maxmem: 256 * cost * blockSize,
    });
    return (
      (derivedKey.byteLength === givenDerivedKey.byteLength)
      && timingSafeEqual(derivedKey, givenDerivedKey)
    );
  }
  throw new Error('Invalid settings adminPasswordHash');
};

let lastLoginFail = new Date(0);
const loginSafetyGapMs = 3000;

apiAuthRouter.post('/try-passwordless-login', expressAsyncHandler(async (req, res) => {
  if (await hasPassword()) {
    res.json({ ok: false });
    return;
  }
  res.json({
    ok: true,
    ...await createTokensPair(),
  });
}));

apiAuthRouter.post('/login', expressAsyncHandler(async (req, res) => {
  if (typeof req.body?.password !== 'string') {
    res.status(400).json({
      error: 'Invalid body',
    });
    return;
  }
  const now = new Date();
  if (now.getTime() - lastLoginFail.getTime() < loginSafetyGapMs) {
    res.status(401).json({
      error: 'Too many frequent login attempts, please try again in a few seconds.',
    });
    return;
  }
  if (!await verifyPassword(req.body.password)) {
    lastLoginFail = new Date();
    res.status(401).json({
      error: 'Wrong password, please try again in a few seconds.',
    });
    return;
  }
  res.json(await createTokensPair());
}));

apiAuthRouter.post('/refresh-token', expressAsyncHandler(async (req, res) => {
  if (typeof req.body?.refreshToken !== 'string') {
    res.status(400).json({
      error: 'Invalid body',
    });
    return;
  }
  const tokenHash = createHash('sha256').update(req.body.refreshToken).digest('base64');
  const tokenDocument = await RefreshTokensModel.findOneAndRemove({
    tokenHash,
  });
  if (!tokenDocument || (tokenDocument.expireAt.getTime() < Date.now())) {
    res.status(401).json({
      error: 'Invalid or expired refresh token',
    });
    return;
  }
  res.json(await createTokensPair());
}));

apiAuthRouter.post('/change-password', expressAsyncHandler(async (req, res) => {
  if (
    (typeof req.body?.oldPassword !== 'string')
    || (typeof req.body?.newPassword !== 'string')
  ) {
    res.status(400).json({
      error: 'Invalid body',
    });
    return;
  }
  const now = new Date();
  if (now.getTime() - lastLoginFail.getTime() < loginSafetyGapMs) {
    res.status(401).json({
      error: 'Too many frequent login attempts, please try again in a few seconds.',
    });
    return;
  }
  if (!await verifyPassword(req.body.oldPassword)) {
    lastLoginFail = new Date();
    res.status(401).json({
      error: 'Wrong password, please try again in a few seconds.',
    });
    return;
  }
  const salt = randomBytes(32).toString('base64').slice(0, -1);
  const derivedKey = await promisifiedScrypt(
    req.body.newPassword,
    salt,
    scryptDefaultKeyLen,
    {
      cost: scryptDefaultCost,
      blockSize: scryptDefaultBlockSize,
      parallelization: scryptDefaultParallelization,
      maxmem: 256 * scryptDefaultCost * scryptDefaultBlockSize,
    },
  );
  // ignored race condition of two /change-password calls at the same time.
  await SettingsModel.updateOne({
    _id: zeroObjectId,
  }, {
    $set: {
      adminPasswordHash: [
        'scrypt',
        scryptDefaultCost,
        scryptDefaultBlockSize,
        scryptDefaultParallelization,
        salt,
        derivedKey.toString('base64'),
      ].join('$'),
    },
  });
  // Force logout all sessions
  await RefreshTokensModel.deleteMany({});
  res.json({
    ok: true,
  });
}));

export default apiAuthRouter;
