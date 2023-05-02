import { Router } from 'express';
import { Types } from 'mongoose';

import { asyncHandler } from '../../../helpers/express';
import { RefreshTokensModel } from '../../../models/refresh-tokens';

const apiAuthLogoutRouter = Router();

apiAuthLogoutRouter.post('/', asyncHandler(async (req, res) => {
  await RefreshTokensModel.deleteOne({
    _id: new Types.ObjectId(req.authToken?.refreshTokenId),
  });
  res.json({
    ok: true,
  });
}));

export default apiAuthLogoutRouter;
