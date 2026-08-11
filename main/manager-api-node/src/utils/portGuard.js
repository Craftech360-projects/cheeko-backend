const net = require('net');
const { execSync } = require('child_process');
const logger = require('./logger');

const DEFAULT_PORT = Number(process.env.PORT || 8002);

const parsePidFromLsof = (output) => {
  const lines = output.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;

  const headerIndex = lines.findIndex((line) => line.includes('COMMAND'));
  if (headerIndex === -1) return null;

  const dataLine = lines[headerIndex + 1];
  if (!dataLine) return null;

  const pidMatch = dataLine.match(/\b(\d+)\b/);
  return pidMatch ? Number(pidMatch[1]) : null;
};

const parsePidFromNetstat = (output, port) => {
  const line = output
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/))
    .find((cols) => cols[3] === 'LISTENING' && cols[1] && cols[1].endsWith(`:${port}`));

  return line ? Number(line[4]) : null;
};

const isWindows = process.platform === 'win32';

const ensurePortAvailability = async (port = DEFAULT_PORT, host = '127.0.0.1') => {
  if (process.env.SKIP_PORT_GUARD === '1') {
    logger.warn('Skipping port guard because SKIP_PORT_GUARD=1');
    return;
  }

  const probe = net.createServer();

  return new Promise((resolve, reject) => {
    probe.once('error', async (error) => {
      if (error.code !== 'EADDRINUSE') {
        probe.close();
        reject(error);
        return;
      }

      logger.warn(`Port ${port} is already in use. Attempting to free it...`);

      try {
        const execOpts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
        const output = execSync(
          isWindows ? 'netstat -ano -p tcp' : `lsof -nP -iTCP:${port} -sTCP:LISTEN`,
          execOpts
        );
        const pid = isWindows ? parsePidFromNetstat(output, port) : parsePidFromLsof(output);
        if (!pid) {
          logger.warn(`Could not determine PID for port ${port}.`);
          resolve();
          return;
        }

        execSync(isWindows ? `taskkill /PID ${pid} /F` : `kill -TERM ${pid}`, execOpts);
        logger.info(`Stopped stale process ${pid} bound to port ${port}.`);
        resolve();
      } catch (killError) {
        logger.error(`Failed to free port ${port}:`, killError);
        reject(killError);
      } finally {
        probe.close();
      }
    });

    probe.once('listening', () => {
      probe.close();
      resolve();
    });

    probe.listen(port, host);
  });
};

module.exports = { ensurePortAvailability, parsePidFromLsof, parsePidFromNetstat };
