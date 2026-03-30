// ── middleware/logger.js ──
// Lightweight file + console logger. No extra dependencies.
// For production, consider replacing with Winston or Pino.

const fs   = require('fs');
const path = require('path');

const LOG_DIR  = path.join(__dirname, '..', 'logs');
const isProd   = process.env.NODE_ENV === 'production';

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function timestamp() {
  return new Date().toISOString();
}

function writeToFile(level, msg) {
  const line = `[${timestamp()}] [${level}] ${msg}\n`;
  const file = path.join(LOG_DIR, `app-${new Date().toISOString().slice(0, 10)}.log`);
  fs.appendFile(file, line, () => {}); // async, non-blocking
}

const logger = {
  info:  (msg) => { console.log (`[INFO]  ${msg}`); if (isProd) writeToFile('INFO',  msg); },
  warn:  (msg) => { console.warn(`[WARN]  ${msg}`); if (isProd) writeToFile('WARN',  msg); },
  error: (msg) => { console.error(`[ERROR] ${msg}`); writeToFile('ERROR', msg); },
};

// Express request logger middleware
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const ms  = Date.now() - start;
    const msg = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms — ${req.ip}`;
    if (res.statusCode >= 500)      logger.error(msg);
    else if (res.statusCode >= 400) logger.warn(msg);
    else                            logger.info(msg);
  });
  next();
}

module.exports = { logger, requestLogger };
