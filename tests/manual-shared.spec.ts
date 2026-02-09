import { initWorker } from '..';
import { toShared } from '../src/to-shared';
import {
  ManualSharedWorker,
  ManualSharedData,
} from './fixtures/manual-shared.worker.js';

describe('Manual shared memory with toShared()', () => {
  it('should share memory between main thread sharedData, worker.data, and worker methods', async () => {
    // Create data and manually convert to shared
    const data = new ManualSharedData();
    data.counter = 10;
    data.value = 100;

    const sharedData = toShared(data);

    // Initialize worker with sharedData
    const worker = await initWorker(ManualSharedWorker, sharedData);

    // Verify initial state
    expect(sharedData.counter).toBe(10);
    expect(sharedData.value).toBe(100);
    expect(worker.data.counter).toBe(10);
    expect(worker.data.value).toBe(100);

    // Modify from worker
    const newCounter = await worker.incrementCounter();
    expect(newCounter).toBe(11);

    // Main thread should see the change
    expect(sharedData.counter).toBe(11);
    expect(worker.data.counter).toBe(11);

    // Modify from worker again
    await worker.setValue(200);

    // Main thread should see the change
    expect(sharedData.value).toBe(200);
    expect(worker.data.value).toBe(200);

    // Modify from main thread
    sharedData.counter = 50;
    sharedData.value = 500;

    // Worker should see the change
    const values = await worker.getValues();
    expect(values.counter).toBe(50);
    expect(values.value).toBe(500);

    // worker.data should also reflect changes
    expect(worker.data.counter).toBe(50);
    expect(worker.data.value).toBe(500);

    // All three references should be synchronized
    sharedData.counter++;
    await worker.incrementCounter();

    // After increment in both places: 50 -> 51 -> 52
    expect(sharedData.counter).toBe(52);
    expect(worker.data.counter).toBe(52);

    await worker.finalize();
  });

  it('should work with nested structures after toShared()', async () => {
    class Container {
      data!: ManualSharedData;
    }

    const container = new Container();
    container.data = new ManualSharedData();
    container.data.counter = 20;
    container.data.value = 300;

    // Convert the nested data to shared (requires @TransportType in real usage)
    const sharedData = toShared(container.data);

    const worker = await initWorker(ManualSharedWorker, sharedData);

    // Verify shared memory
    expect(sharedData.counter).toBe(20);
    expect(worker.data.counter).toBe(20);

    await worker.incrementCounter();

    expect(sharedData.counter).toBe(21);
    expect(worker.data.counter).toBe(21);

    await worker.finalize();
  });

  it('should demonstrate toShared() without @Shared decorator still shares memory', async () => {
    // This test shows that manual toShared() achieves the same result as @Shared()
    const data = new ManualSharedData();
    data.counter = 0;
    data.value = 0;

    // Manual conversion
    const sharedData = toShared(data);

    const worker = await initWorker(ManualSharedWorker, sharedData);

    // Increment 100 times from worker
    for (let i = 0; i < 100; i++) {
      await worker.incrementCounter();
    }

    // Main thread sees all increments without any data transfer
    expect(sharedData.counter).toBe(100);
    expect(worker.data.counter).toBe(100);

    // Modify from main thread
    sharedData.counter = 999;

    // Worker sees the change immediately
    const values = await worker.getValues();
    expect(values.counter).toBe(999);

    await worker.finalize();
  });
});
