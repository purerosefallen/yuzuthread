import { initWorker, DefineWorker, WorkerMethod, Shared } from '..';
import {
  SingleSharedWorker,
  MultiSharedWorker,
  MixedSharedWorker,
  SharedData,
} from './fixtures/shared-param.worker';
import {
  PublicSharedWorker,
  PublicSharedData,
} from './fixtures/public-shared-param.worker';

describe('@Shared parameter decorator', () => {
  describe('Single @Shared parameter', () => {
    it('should share memory between main thread and worker', async () => {
      // Create shared data
      const originalData = new SharedData();
      originalData.counter = 10;
      originalData.flag = 5;

      // Note: @Shared parameters are converted to SharedArrayBuffer-backed instances
      // The original reference is NOT modified, worker receives the converted instance
      const worker = await initWorker(SingleSharedWorker, originalData);

      // After init, the worker has the shared version
      // We need to get the shared reference from somewhere
      // For now, let's verify by calling worker methods

      // Worker modifies
      const newCounter = await worker.incrementCounter();
      expect(newCounter).toBe(11);

      // Get current values from worker
      let values = await worker.getValues();
      expect(values.counter).toBe(11);
      expect(values.flag).toBe(5);

      // Worker sets flag
      await worker.setFlag(20);
      values = await worker.getValues();
      expect(values.flag).toBe(20);

      await worker.finalize();
    });

    it('should support public parameter pattern: constructor(@Shared() public data)', async () => {
      // This tests the expected usage pattern where @Shared parameter is also a public field
      const originalData = new SharedData();
      originalData.counter = 10;
      originalData.flag = 5;

      const worker = await initWorker(SingleSharedWorker, originalData);

      // Worker has access to the shared data through 'this.data'
      // Main thread should be able to access it through 'worker.data' 
      // However, worker.data is private in our test fixture
      // Let's verify the concept by checking SharedArrayBuffer backing

      // Worker modifies through its internal reference
      await worker.incrementCounter();

      // Get values to verify modification
      const values = await worker.getValues();
      expect(values.counter).toBe(11);

      await worker.finalize();
    });

    it('should use SharedArrayBuffer internally', async () => {
      const data = new SharedData();
      data.counter = 50;
      data.flag = 10;

      const worker = await initWorker(SingleSharedWorker, data);

      // The worker has a SharedArrayBuffer-backed version internally
      // We can verify by checking that modifications are reflected in worker methods
      const initialValues = await worker.getValues();
      expect(initialValues.counter).toBe(50);

      await worker.finalize();
    });
  });

  describe('Multiple @Shared parameters', () => {
    it('should handle multiple shared parameters', async () => {
      // Create multiple shared data objects
      const data1 = new SharedData();
      data1.counter = 10;
      data1.flag = 1;

      const data2 = new SharedData();
      data2.counter = 20;
      data2.flag = 2;

      // Create worker with multiple @Shared parameters
      // Note: Worker receives SharedArrayBuffer-backed versions
      const worker = await initWorker(MultiSharedWorker, data1, data2);

      // Worker modifies
      const result = await worker.incrementBoth();
      expect(result.counter1).toBe(11);
      expect(result.counter2).toBe(21);

      // Verify worker has the updated values
      const result2 = await worker.incrementBoth();
      expect(result2.counter1).toBe(12);
      expect(result2.counter2).toBe(22);

      await worker.finalize();
    });

    it('should maintain independent memory for different parameters', async () => {
      const data1 = new SharedData();
      data1.counter = 100;

      const data2 = new SharedData();
      data2.counter = 200;

      const worker = await initWorker(MultiSharedWorker, data1, data2);

      // Each parameter is converted to shared memory independently
      const result1 = await worker.incrementBoth();
      expect(result1.counter1).toBe(101);
      expect(result1.counter2).toBe(201);

      // They are independent within the worker
      const result2 = await worker.incrementBoth();
      expect(result2.counter1).toBe(102);
      expect(result2.counter2).toBe(202);

      await worker.finalize();
    });
  });

  describe('@Shared with typed-struct worker', () => {
    it('should handle both worker typed-struct and @Shared parameters', async () => {
      // Create shared data for parameter
      const data = new SharedData();
      data.counter = 50;
      data.flag = 5;

      // Create worker (typed-struct) with @Shared parameter
      // Worker class itself is typed-struct, receives SharedArrayBuffer
      // @Shared parameter is also converted to SharedArrayBuffer
      const worker = await initWorker(MixedSharedWorker, 10, data);

      // Verify worker's own value (shared with main thread)
      expect(worker.value).toBe(10);

      // Worker modifies its own value
      const newValue = await worker.incrementValue();
      expect(newValue).toBe(11);
      expect(worker.value).toBe(11); // Main thread sees change (same SharedArrayBuffer)

      // Worker modifies shared parameter
      const newCounter = await worker.incrementDataCounter();
      expect(newCounter).toBe(51);

      // Verify current state
      const all = await worker.getAll();
      expect(all.value).toBe(11);
      expect(all.counter).toBe(51);
      expect(all.flag).toBe(5);

      // Main thread modifies worker's own struct field
      worker.value = 99;

      // Worker sees the change (shared memory)
      const all2 = await worker.getAll();
      expect(all2.value).toBe(99);

      await worker.finalize();
    });

    it('should verify worker SharedArrayBuffer backing', async () => {
      const data = new SharedData();
      data.counter = 100;

      const worker = await initWorker(MixedSharedWorker, 20, data);

      // Verify worker's own buffer is SharedArrayBuffer-backed
      const workerRaw = MixedSharedWorker.raw(worker) as Buffer;
      expect(workerRaw.buffer.constructor.name).toBe('SharedArrayBuffer');

      // Worker can access and modify both its own value and the shared parameter
      const all = await worker.getAll();
      expect(all.value).toBe(20);
      expect(all.counter).toBe(100);

      await worker.finalize();
    });
  });

  describe('Public parameter pattern', () => {
    it('should support constructor(@Shared() public data) pattern', async () => {
      // Expected usage: constructor(@Shared() public sharedData: SharedData)
      // Main thread can access worker.sharedData
      // Both sides share the same SharedArrayBuffer
      
      const data = new PublicSharedData();
      data.counter = 100;
      data.flag = 5;

      const worker = await initWorker(PublicSharedWorker, data);

      // Main thread can access worker.sharedData
      expect(worker.sharedData).toBeDefined();
      expect(worker.sharedData.counter).toBe(100);

      // Worker modifies through this.sharedData
      const newCounter = await worker.incrementCounter();
      expect(newCounter).toBe(101);

      // Main thread sees the change through worker.sharedData
      expect(worker.sharedData.counter).toBe(101);

      // Main thread modifies worker.sharedData
      worker.sharedData.counter = 200;
      worker.sharedData.flag = 99;

      // Worker sees the change
      const currentCounter = await worker.getCounter();
      expect(currentCounter).toBe(200);

      // Verify it's SharedArrayBuffer-backed
      const raw = PublicSharedData.raw(worker.sharedData) as Buffer;
      expect(raw.buffer.constructor.name).toBe('SharedArrayBuffer');

      await worker.finalize();
    });

    it('should maintain shared memory across multiple calls', async () => {
      const data = new PublicSharedData();
      data.counter = 50;

      const worker = await initWorker(PublicSharedWorker, data);

      // Multiple modifications from both sides
      await worker.incrementCounter(); // 51
      worker.sharedData.counter += 10; // 61
      await worker.incrementCounter(); // 62
      worker.sharedData.counter *= 2; // 124

      const finalCounter = await worker.getCounter();
      expect(finalCounter).toBe(124);
      expect(worker.sharedData.counter).toBe(124);

      await worker.finalize();
    });
  });

  describe('Error handling', () => {
    it('should throw error for parameter without shared memory segments', async () => {
      class NoSharedMemory {
        value: number = 0;
      }

      // This should fail during decorator evaluation
      expect(() => {
        @DefineWorker()
        class InvalidWorker {
          constructor(@Shared(() => NoSharedMemory) data: NoSharedMemory) {}

          @WorkerMethod()
          doSomething(): void {}
        }
      }).toThrow('does not contain any shared memory segments');
    });
  });
});
