import { createLogger, format, transports } from 'winston';

export const defaultLogFormat = format.combine(
  format.label({ label: 'server' }),
  format.timestamp(),
  format.printf(({
    level, message, label, timestamp,
  }): string => `${timestamp} [${label}] ${level}: ${message}`),
);

const logger = createLogger({
  level: (process.env.NODE_ENV === 'production') ? 'info' : 'debug',
  format: defaultLogFormat,
  transports: [
    new transports.Console(),
    ...process.env.SERVER_LOGS_FILEPATH ? [
      new transports.File({
        filename: process.env.SERVER_LOGS_FILEPATH,
        maxsize: 10_000_000,
        maxFiles: 2,
      }),
    ] : [],
  ],
});

export default logger;
