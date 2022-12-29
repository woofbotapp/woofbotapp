import fs from 'fs';
import path from 'path';
import { createLogger, format, transports } from 'winston';

export const defaultLogFormat = format.combine(
  format.label({ label: 'server' }),
  format.timestamp(),
  format.printf(({
    level, message, label, timestamp,
  }): string => `${timestamp} [${label}] ${level}: ${message}`),
);

interface SuccessFileTransport {
  kind: 'success';
  fileTransport: typeof transports.File;
}

interface FailFileTransport {
  kind: 'fail';
  operations: string[];
  error: unknown;
}

function createFileTransport(
  serverLogsFilepath: string,
): SuccessFileTransport | FailFileTransport {
  const operations: string[] = [];
  try {
    operations.push(`Trying to access ${serverLogsFilepath}`);
    fs.writeFileSync(serverLogsFilepath, '');
    const { dir, name, ext } = path.parse(serverLogsFilepath);
    operations.push(`Listing files in ${dir}`);
    fs.readdirSync(dir).forEach((filename) => {
      // checks that the file matchs '<name><digits><ext>'.
      if (!filename.startsWith(name) || !filename.endsWith(ext)) {
        return;
      }
      const wildcard = filename.slice(name.length, -ext.length ?? Infinity);
      if (!/^\d*$/.test(wildcard)) {
        return;
      }
      const filepath = path.join(dir, filename);
      operations.push(`Unlinking ${filepath}`);
      fs.unlinkSync(filepath);
    });
    return {
      kind: 'success',
      fileTransport: new transports.File({
        filename: serverLogsFilepath,
        maxsize: 10_000_000,
        maxFiles: 2,
      }),
    };
  } catch (error) {
    return {
      kind: 'fail',
      operations,
      error,
    };
  }
}

const ftResult = process.env.SERVER_LOGS_FILEPATH ? createFileTransport(
  process.env.SERVER_LOGS_FILEPATH,
) : undefined;

const logger = createLogger({
  level: (process.env.NODE_ENV === 'production') ? 'info' : 'debug',
  format: defaultLogFormat,
  transports: [
    new transports.Console(),
    ...ftResult?.kind === 'success' ? [ftResult.fileTransport] : [],
  ],
});

if (ftResult?.kind === 'fail') {
  logger.error(`Failed to initialize file logger: ${
    ftResult.operations.join('\n')
  } ${ftResult.error}`);
}

export default logger;
