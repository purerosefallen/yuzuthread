import { initWorker } from '..';
import { EventWorker } from './fixtures/event.worker.js';
import { MultiHandlerWorker } from './fixtures/multi-handler.worker.js';
import { ErrorHandlerWorker } from './fixtures/error-handler.worker.js';
import { MultiEventHandlerWorker } from './fixtures/multi-event-handler.worker.js';

describe('worker events', () => {
  it('should call @OnWorkerExit handler when worker exits', async () => {
    const worker = await initWorker(EventWorker);

    // online event fires during initialization
    const onlineEvents = worker.events.filter((e) => e.event === 'online');
    expect(onlineEvents.length).toBeGreaterThan(0);

    // Trigger exit - this will cause the worker to exit with code 42
    const exitPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, 500);
    });

    worker.exit().catch(() => {
      // Expected to fail because worker exits
    });

    await exitPromise;

    // Check that onExit was called
    const exitEvents = worker.events.filter((e) => e.event === 'exit');
    expect(exitEvents.length).toBeGreaterThan(0);
    expect(exitEvents[0].args[0]).toBe(42);
  });

  it('should call @OnWorkerEvent("online") handler when worker comes online', async () => {
    const worker = await initWorker(EventWorker);

    // online event fires during initialization
    const onlineEvents = worker.events.filter((e) => e.event === 'online');
    expect(onlineEvents.length).toBeGreaterThan(0);

    await worker.finalize();
  });

  it('should support multiple handlers for the same event', async () => {
    const worker = await initWorker(MultiHandlerWorker);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(worker.calls).toContain('handler1');
    expect(worker.calls).toContain('handler2');

    await worker.finalize();
  });

  it('should handle errors in event handlers gracefully', async () => {
    const worker = await initWorker(ErrorHandlerWorker);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Both handlers should be called even if one throws
    expect(worker.errorCount).toBe(2);

    await worker.finalize();
  });

  it('should support one method handling multiple events', async () => {
    const worker = await initWorker(MultiEventHandlerWorker);

    // Wait for online event
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should have both multi-handler and online-only called for online event
    expect(worker.events).toContain('multi-handler');
    expect(worker.events).toContain('online-only');

    const initialCount = worker.events.filter(
      (e) => e === 'multi-handler',
    ).length;
    expect(initialCount).toBe(1);

    await worker.finalize();
  });
});
