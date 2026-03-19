import { resolveWorkerFilePath } from '../src/utility/resolve-worker-file-path';

describe('resolveWorkerFilePath', () => {
  it('should prefer explicit filePath over moduleUrl', () => {
    expect(
      resolveWorkerFilePath(
        {
          filePath: '/tmp/worker.cjs',
          moduleUrl: 'file:///tmp/worker.mjs',
        },
        '/tmp/fallback.ts',
      ),
    ).toBe('/tmp/worker.cjs');
  });

  it('should resolve file paths from moduleUrl', () => {
    expect(
      resolveWorkerFilePath(
        {
          moduleUrl: 'file:///tmp/module-url.worker.mjs',
        },
        null,
      ),
    ).toBe('/tmp/module-url.worker.mjs');
  });

  it('should fall back to discovered file path', () => {
    expect(resolveWorkerFilePath({}, '/tmp/discovered.ts')).toBe(
      '/tmp/discovered.ts',
    );
  });

  it('should throw when moduleUrl is not a valid file url', () => {
    expect(() =>
      resolveWorkerFilePath(
        {
          moduleUrl: 'not-a-file-url',
        },
        null,
      ),
    ).toThrow();
  });
});
