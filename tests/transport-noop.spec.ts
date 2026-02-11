import { initWorker } from '..';
import { TransportNoopWorker } from './fixtures/transport-noop.worker.js';

describe('TransportNoop', () => {
  it('should transport field as undefined', async () => {
    const worker = await initWorker(TransportNoopWorker);

    const result = await worker.processWithNoopField({
      normalValue: 'hello',
      noopValue: 'should-be-undefined',
    });

    expect(result.normalValue).toBe('HELLO');
    expect(result.noopValue).toBeUndefined();

    await worker.finalize();
  });

  it('should transport parameter as undefined', async () => {
    const worker = await initWorker(TransportNoopWorker);

    const result = await worker.processWithNoopParam(
      'normal',
      'should-be-undefined',
    );

    expect(result.normalValue).toBe('normal');
    expect(result.noopValue).toBeUndefined();

    await worker.finalize();
  });

  it('should transport return value as undefined', async () => {
    const worker = await initWorker(TransportNoopWorker);

    const result = await worker.returnNoop();

    expect(result).toBeUndefined();

    await worker.finalize();
  });

  it('should work with arrays containing noop decorator', async () => {
    const worker = await initWorker(TransportNoopWorker);

    const result = await worker.processArrayWithNoop([
      { normalValue: 'a', noopValue: 'x' },
      { normalValue: 'b', noopValue: 'y' },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].normalValue).toBe('A');
    expect(result[0].noopValue).toBeUndefined();
    expect(result[1].normalValue).toBe('B');
    expect(result[1].noopValue).toBeUndefined();

    await worker.finalize();
  });
});
