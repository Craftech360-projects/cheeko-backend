const mockNetCreateServer = jest.fn();
const mockExecSync = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerError = jest.fn();

jest.mock('net', () => ({
  createServer: mockNetCreateServer
}));

jest.mock('child_process', () => ({
  execSync: mockExecSync
}));

jest.mock('../../src/utils/logger', () => ({
  warn: mockLoggerWarn,
  info: mockLoggerInfo,
  error: mockLoggerError
}));

describe('port guard startup helper', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...process.env };
    delete process.env.SKIP_PORT_GUARD;
    delete process.env.AUTO_KILL_PORT;
  });

  it('kills stale listeners on the configured port before startup', async () => {
    mockNetCreateServer.mockImplementation(() => ({
      once: (event, handler) => {
        if (event === 'error') {
          handler({ code: 'EADDRINUSE' });
        }
      },
      listen: jest.fn(),
      close: jest.fn()
    }));

    const isWindows = process.platform === 'win32';
    mockExecSync
      .mockReturnValueOnce(
        isWindows
          ? '  TCP    0.0.0.0:8002    0.0.0.0:0    LISTENING    9988\n'
          : 'COMMAND PID USER\nnode 9988 abraham\n'
      )
      .mockReturnValueOnce('');

    const { ensurePortAvailability } = require('../../src/utils/portGuard');

    await ensurePortAvailability(8002, '127.0.0.1');

    expect(mockExecSync).toHaveBeenCalledWith(
      isWindows ? 'netstat -ano -p tcp' : 'lsof -nP -iTCP:8002 -sTCP:LISTEN',
      expect.objectContaining({ encoding: 'utf8' })
    );
    expect(mockExecSync).toHaveBeenCalledWith(
      isWindows ? 'taskkill /PID 9988 /F' : 'kill -TERM 9988',
      expect.objectContaining({ encoding: 'utf8' })
    );
  });

  it('parses the listening PID out of netstat output', () => {
    const { parsePidFromNetstat } = require('../../src/utils/portGuard');
    const output = [
      '  TCP    0.0.0.0:8001    0.0.0.0:0    LISTENING    111',
      '  TCP    127.0.0.1:5000  127.0.0.1:8002  ESTABLISHED  222',
      '  TCP    0.0.0.0:8002    0.0.0.0:0    LISTENING    9988'
    ].join('\r\n');

    expect(parsePidFromNetstat(output, 8002)).toBe(9988);
  });
});
