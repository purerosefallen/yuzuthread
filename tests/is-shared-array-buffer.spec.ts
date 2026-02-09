import { runInNewContext } from 'node:vm';
import { isSharedArrayBuffer } from '../src/utility/is-shared-array-buffer';

describe('isSharedArrayBuffer', () => {
  it('should return true for SharedArrayBuffer', () => {
    const shared = new SharedArrayBuffer(8);
    expect(isSharedArrayBuffer(shared)).toBe(true);
  });

  it('should return true for Buffer backed by SharedArrayBuffer', () => {
    const shared = new SharedArrayBuffer(8);
    const buffer = Buffer.from(shared);
    expect(isSharedArrayBuffer(buffer)).toBe(true);
  });

  it('should return false for regular Buffer', () => {
    const buffer = Buffer.from([1, 2, 3]);
    expect(isSharedArrayBuffer(buffer)).toBe(false);
  });

  it('should return false for non-shared values', () => {
    expect(isSharedArrayBuffer(new ArrayBuffer(8))).toBe(false);
    expect(isSharedArrayBuffer(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(isSharedArrayBuffer(null)).toBe(false);
    expect(isSharedArrayBuffer(undefined)).toBe(false);
    expect(isSharedArrayBuffer(123)).toBe(false);
    expect(isSharedArrayBuffer('test')).toBe(false);
  });

  it('should detect SharedArrayBuffer across realms', () => {
    const crossRealmShared = runInNewContext('new SharedArrayBuffer(8)');
    expect(isSharedArrayBuffer(crossRealmShared)).toBe(true);
  });
});
