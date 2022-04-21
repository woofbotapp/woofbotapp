import expressAsyncHandler from 'express-async-handler';
import Router from 'express';
import { Types } from 'mongoose';

import { RefreshTokensModel } from '../../../models/refresh-tokens';

const apiAuthLogoutRouter = Router();

apiAuthLogoutRouter.post('/', expressAsyncHandler(async (req, res) => {
  await RefreshTokensModel.deleteOne({
    _id: new Types.ObjectId(req.authToken?.refreshTokenId),
  });
  res.json({
    ok: true,
  });
}));

export default apiAuthLogoutRouter;
