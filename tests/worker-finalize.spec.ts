import { initWorker } from '..';
import {
  WorkerFinalizeTestWorker,
  WorkerFinalizeErrorWorker,
  WorkerFinalizeDirectWorker,
} from './fixtures/worker-finalize.worker.js';

describe('@WorkerFinalize', () => {
  it('should exit worker after @WorkerFinalize method is called from @WorkerMethod', async () => {
    const worker = await initWorker(WorkerFinalizeTestWorker);

    const result = await worker.computeAndExit(21);
    expect(result).toBe(42);

    // Give the worker some time to exit
    await new Promise((resolve) => setTimeout(resolve, 200));

    // After finalize, calling methods should fail
    await expect(worker.regularMethod(10)).rejects.toThrow();
  });

  it('should exit worker even if @WorkerFinalize method throws error', async () => {
    const worker = await initWorker(WorkerFinalizeErrorWorker);

    await expect(worker.failAndExit()).rejects.toThrow('Method failed');

    // Give the worker some time to exit
    await new Promise((resolve) => setTimeout(resolve, 200));

    // After finalize, calling methods should fail
    await expect(worker.shouldNotBeCalled()).rejects.toThrow();
  });

  it('should allow normal method calls before @WorkerFinalize is called', async () => {
    const worker = await initWorker(WorkerFinalizeTestWorker);

    // Regular method should work
    const result1 = await worker.regularMethod(5);
    expect(result1).toBe(15);

    // Another regular call should also work
    const result2 = await worker.regularMethod(10);
    expect(result2).toBe(20);

    // Now call the method that triggers finalize
    const finalResult = await worker.computeAndExit(100);
    expect(finalResult).toBe(200);

    // Give the worker some time to exit
    await new Promise((resolve) => setTimeout(resolve, 200));

    // After finalize, calling methods should fail
    await expect(worker.regularMethod(10)).rejects.toThrow();
  });

  it('should support @WorkerMethod and @WorkerFinalize on same method', async () => {
    const worker = await initWorker(WorkerFinalizeDirectWorker);

    // Regular method should work first
    const result1 = await worker.normalMethod(10);
    expect(result1).toBe(15);

    // Call the method that has both decorators
    const result2 = await worker.directFinalizeMethod(7);
    expect(result2).toBe(21);

    // Give the worker some time to exit
    await new Promise((resolve) => setTimeout(resolve, 200));

    // After finalize, calling methods should fail
    await expect(worker.normalMethod(10)).rejects.toThrow();
  });
});
