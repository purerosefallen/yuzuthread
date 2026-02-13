import { initWorker } from '..';
import { LongRunningWorker } from './fixtures/long-running.worker.js';

describe('Worker Termination', () => {
  it('should throw error when worker is finalized during long-running call', async () => {
    const worker = await initWorker(LongRunningWorker);

    // Start a long-running task (5 seconds)
    const longCallPromise = worker.longTask(5000);

    // Capture the rejection to prevent unhandled rejection warning
    let rejectionError: Error | null = null;
    longCallPromise.catch((error) => {
      rejectionError = error;
    });

    // Wait a bit to ensure the call has been sent to worker
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Terminate the worker while the task is still running
    await worker.finalize();

    // Wait for the rejection to be processed
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The long call should have been rejected
    expect(rejectionError).toBeTruthy();
    expect(rejectionError?.message).toBe('Worker has been finalized');
  });

  it('should reject multiple pending calls when worker is finalized', async () => {
    const worker = await initWorker(LongRunningWorker);

    // Start multiple long-running tasks
    const call1 = worker.longTask(5000);
    const call2 = worker.longTask(5000);
    const call3 = worker.longTask(5000);

    // Capture rejections
    const errors: (Error | null)[] = [null, null, null];
    call1.catch((error) => {
      errors[0] = error;
    });
    call2.catch((error) => {
      errors[1] = error;
    });
    call3.catch((error) => {
      errors[2] = error;
    });

    // Wait a bit to ensure calls have been sent to worker
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Terminate the worker while all tasks are still running
    await worker.finalize();

    // Wait for rejections to be processed
    await new Promise((resolve) => setTimeout(resolve, 50));

    // All calls should have been rejected
    expect(errors[0]).toBeTruthy();
    expect(errors[0]?.message).toBe('Worker has been finalized');
    expect(errors[1]).toBeTruthy();
    expect(errors[1]?.message).toBe('Worker has been finalized');
    expect(errors[2]).toBeTruthy();
    expect(errors[2]?.message).toBe('Worker has been finalized');
  });

  it('should complete quick call but reject long call after finalize', async () => {
    const worker = await initWorker(LongRunningWorker);

    // Make a quick call that should complete
    const quickResult = await worker.quickTask();
    expect(quickResult).toBe('quick result');

    // Start a long call
    const longCall = worker.longTask(5000);

    // Capture the rejection
    let rejectionError: Error | null = null;
    longCall.catch((error) => {
      rejectionError = error;
    });

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Finalize
    await worker.finalize();

    // Wait for rejection to be processed
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Long call should have been rejected
    expect(rejectionError).toBeTruthy();
    expect(rejectionError?.message).toBe('Worker has been finalized');
  });

  it('should reject long call when @WorkerFinalize method is called', async () => {
    const worker = await initWorker(LongRunningWorker);

    // Start a long-running task
    const longCall = worker.longTask(5000);

    // Capture the rejection
    let longCallError: Error | null = null;
    longCall.catch((error) => {
      longCallError = error;
    });

    // Wait a bit to ensure long call has been sent
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Call a method that triggers @WorkerFinalize
    const exitResult = await worker.quickAndExit();
    expect(exitResult).toBe('cleanup done');

    // Wait for worker to exit and rejection to be processed
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Long call should have been rejected
    expect(longCallError).toBeTruthy();
    expect(longCallError?.message).toBe('Worker has been finalized');
  });

  it('should reject pending calls when @WorkerMethod+@WorkerFinalize is called', async () => {
    const worker = await initWorker(LongRunningWorker);

    // Start multiple long-running tasks
    const longCall1 = worker.longTask(5000);
    const longCall2 = worker.longTask(5000);

    // Capture rejections
    const errors: (Error | null)[] = [null, null];
    longCall1.catch((error) => {
      errors[0] = error;
    });
    longCall2.catch((error) => {
      errors[1] = error;
    });

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Call method with both @WorkerMethod and @WorkerFinalize
    const exitResult = await worker.directExit(5);
    expect(exitResult).toBe(50);

    // Wait for worker to exit and rejections to be processed
    await new Promise((resolve) => setTimeout(resolve, 200));

    // All pending calls should have been rejected
    expect(errors[0]).toBeTruthy();
    expect(errors[0]?.message).toBe('Worker has been finalized');
    expect(errors[1]).toBeTruthy();
    expect(errors[1]?.message).toBe('Worker has been finalized');
  });
});
