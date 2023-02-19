import { EventEmitter } from 'stream';
import fs from 'fs';
import { authenticatedLndGrpc, AuthenticatedLnd } from 'lightning';
import logger from './logger';

class LndWatcher extends EventEmitter {
  private lnd: AuthenticatedLnd | undefined;

  async start() {
    for (const paramName of [
      'APP_LIGHTNING_NODE_IP',
      'APP_LIGHTNING_NODE_GRPC_PORT',
      'LND_READONLY_MACAROON_PATH',
      'LND_TLS_PATH',
    ]) {
      if (!process.env[paramName]) {
        logger.info(`LndWatcher: missing ${paramName}`);
        return;
      }
    }
    logger.info(`LndWatcher: reading ${process.env.LND_READONLY_MACAROON_PATH}}`);
    const readonlyMacaroon: Buffer = await new Promise((resolve, reject) => {
      fs.readFile(process.env.LND_READONLY_MACAROON_PATH ?? '', (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
    logger.info(`LndWatcher: reading ${process.env.LND_TLS_PATH}`);
    const tls: Buffer = await new Promise((resolve, reject) => {
      fs.readFile(process.env.LND_TLS_PATH ?? '', (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      });
    });
    const socketTarget = `${
      process.env.APP_LIGHTNING_NODE_IP
    }:${process.env.APP_LIGHTNING_NODE_GRPC_PORT}`;
    logger.info(`LndWatcher: initializing lnd to ${socketTarget}`);
    const { lnd } = authenticatedLndGrpc({
      cert: tls.toString('base64'),
      macaroon: readonlyMacaroon.toString('base64'),
      socket: socketTarget,
    });
    this.lnd = lnd;
  }

  isRunning() {
    return Boolean(this.lnd);
  }
}

export const lndWatcher = new LndWatcher();
