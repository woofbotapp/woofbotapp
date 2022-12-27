import { NextFunction, Request, Response } from 'express';

function immediateNext(next: NextFunction, params: unknown[]): void {
  // If next() throws an error, it's a global error not in this scope.
  setImmediate(() => next(...params));
}

export const asyncHandler = (
  fn: ((req: Request, res: Response, next: NextFunction) => void | Promise<void>),
) => function asyncHandlerWrap(req: Request, res: Response, next: NextFunction) {
  let nextParams: undefined | unknown[];
  const nextSaver: NextFunction = (...params: unknown[]) => {
    nextParams = params;
  };
  let fnReturn: void | Promise<void>;
  try {
    fnReturn = fn(req, res, nextSaver);
  } catch (error) {
    immediateNext(next, nextParams ?? [error]);
    return;
  }
  Promise.resolve(fnReturn).catch((error) => {
    if (!nextParams) {
      nextParams = [error];
    }
  }).then(() => {
    if (!nextParams) {
      return;
    }
    immediateNext(next, nextParams);
  });
};
