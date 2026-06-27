import { createLogger, format, transports } from 'winston';
import path from 'path';
import fs from 'fs';

const LOG_DIR = './logs';
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

export const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
      return `[${timestamp}] ${level.toUpperCase()} ${message}${metaStr}`;
    }),
  ),
  transports: [
    new transports.Console({ level: 'warn' }),
    new transports.File({
      filename: path.join(LOG_DIR, `scraper_${new Date().toISOString().slice(0, 10)}.log`),
    }),
  ],
});
