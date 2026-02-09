import { initWorker } from '..';
import {
  CtorTransportWorker,
  NoDecoratorCtorWorker,
  UserData,
  Config,
} from './fixtures/ctor-transport.worker';

describe('Constructor parameter transport', () => {
  it('should preserve prototype chain for custom class parameters', async () => {
    const userData = new UserData('Alice', 25);
    const config = new Config();

    // Before fix, worker would receive objects without prototypes
    // Methods like userData.greet() would not exist
    const worker = await initWorker(CtorTransportWorker, userData, config);

    // This should work because prototype is preserved through encode/decode
    const greeting = await worker.getUserGreeting();
    expect(greeting).toBe("Hello, I'm Alice, 25 years old");

    await worker.finalize();
  });

  it('should handle @TransportType on nested fields', async () => {
    const userData = new UserData('Bob', 30);
    const config = new Config();
    config.timeout = 1000;

    const worker = await initWorker(CtorTransportWorker, userData, config);

    // Config has a Date field with @TransportType
    // This should be properly encoded/decoded
    const isExpired = await worker.checkExpired();
    expect(typeof isExpired).toBe('boolean');

    await worker.finalize();
  });

  it('should work without @TransportType if design:paramtypes is available', async () => {
    // Even without explicit @TransportType on parameters,
    // design:paramtypes should provide type information
    const userData = new UserData('Charlie', 35);
    const config = new Config();

    const worker = await initWorker(CtorTransportWorker, userData, config);

    const name = await worker.getUserName();
    expect(name).toBe('Charlie');

    await worker.finalize();
  });

  it('should handle parameter modifications', async () => {
    const userData = new UserData('David', 40);
    const config = new Config();

    const worker = await initWorker(CtorTransportWorker, userData, config);

    // Modify through worker
    await worker.modifyUserAge(45);

    // Note: The main thread's userData is NOT modified
    // because it's not using SharedArrayBuffer (not @Shared)
    expect(userData.age).toBe(40); // Original value

    // But worker has the modified value
    const greeting = await worker.getUserGreeting();
    expect(greeting).toBe("Hello, I'm David, 45 years old");

    await worker.finalize();
  });
});

describe('Constructor parameter transport without decorators', () => {
  it('should preserve prototype using only design:paramtypes metadata', async () => {
    // No @TransportType on constructor parameters
    // Should work with only emitDecoratorMetadata (design:paramtypes)
    const userData = new UserData('Alice', 28);
    const config = new Config();

    const worker = await initWorker(NoDecoratorCtorWorker, userData, config);

    // Methods should work because prototype is preserved
    const greeting = await worker.getUserGreeting();
    expect(greeting).toBe("Hello, I'm Alice, 28 years old");

    await worker.finalize();
  });

  it('should handle nested @TransportType fields in parameters', async () => {
    const userData = new UserData('Bob', 32);
    const config = new Config();
    config.createdAt = new Date('2025-01-01');
    config.timeout = 100;

    const worker = await initWorker(NoDecoratorCtorWorker, userData, config);

    // Config.createdAt has @TransportType(() => Date)
    // This should be properly transported even without decorator on constructor param
    const createdAt = await worker.getConfigCreatedAt();
    expect(createdAt).toHaveProperty('toISOString');
    expect(typeof createdAt.toISOString).toBe('function');
    expect(createdAt.toISOString()).toBe(config.createdAt.toISOString());

    await worker.finalize();
  });

  it('should return properly typed objects from worker methods', async () => {
    const userData = new UserData('Charlie', 35);
    const config = new Config();

    const worker = await initWorker(NoDecoratorCtorWorker, userData, config);

    // Worker returns UserData object
    const returnedUserData = await worker.getUserData();
    
    // Should have correct prototype and methods
    expect(returnedUserData).toHaveProperty('name', 'Charlie');
    expect(returnedUserData).toHaveProperty('age', 35);
    expect(returnedUserData).toHaveProperty('greet');
    expect(typeof returnedUserData.greet).toBe('function');
    
    // Methods should work
    expect(returnedUserData.greet()).toBe("Hello, I'm Charlie, 35 years old");

    await worker.finalize();
  });

  it('should handle complex scenarios with both decorated and non-decorated params', async () => {
    // This tests that mixing decorated and non-decorated params works
    const userData = new UserData('David', 40);
    const config = new Config();

    const worker = await initWorker(NoDecoratorCtorWorker, userData, config);

    // Both should work correctly
    const greeting = await worker.getUserGreeting();
    expect(greeting).toContain('David');
    
    const isExpired = await worker.checkExpired();
    expect(typeof isExpired).toBe('boolean');

    await worker.finalize();
  });
});
