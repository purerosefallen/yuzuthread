import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const esmFixtureDir = resolve(__dirname, 'fixtures/esm');

const runFixture = async (fileName: string) => {
  const result = await execFileAsync(
    process.execPath,
    [resolve(esmFixtureDir, fileName)],
    {
      cwd: resolve(__dirname, '..'),
      encoding: 'utf8',
    },
  );

  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout.trim());
};

describe('initWorker in ESM', () => {
  it('should support moduleUrl: import.meta.url for worker registration', async () => {
    await expect(runFixture('basic.main.mjs')).resolves.toEqual({
      remote: {
        count: 2,
        isMainThread: false,
        hasExpectedWorkerUrl: true,
      },
      callback: {
        count: 7,
        isMainThread: true,
      },
      local: {
        count: 10,
        isMainThread: true,
      },
      mainCount: 10,
      readyStatus: true,
      finalizedStatus: true,
    });
  });

  it('should load ESM workers with top-level await', async () => {
    await expect(runFixture('top-level-await.main.mjs')).resolves.toEqual({
      sum: 7,
      hasExpectedWorkerUrl: true,
    });
  });
});
