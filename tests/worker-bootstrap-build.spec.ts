import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('worker bootstrap build outputs', () => {
  it('should keep CommonJS bootstrap in dist/index.cjs', () => {
    const output = readFileSync(resolve(__dirname, '../dist/index.cjs'), 'utf8');

    expect(output).toContain("require(workerData.__entryFile);");
    expect(output).not.toContain(
      'pathToFileURL(workerData.__entryFile).href',
    );
  });

  it('should use ESM bootstrap in dist/index.mjs', () => {
    const output = readFileSync(resolve(__dirname, '../dist/index.mjs'), 'utf8');

    expect(output).toContain(
      'import(pathToFileURL(workerData.__entryFile).href).catch(reportInitError)',
    );
    expect(output).not.toContain("require(workerData.__entryFile);");
  });
});
