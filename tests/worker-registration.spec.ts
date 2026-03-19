import { DefineWorker, getWorkerRegistration } from '..';
import { CounterWorker } from './fixtures/counter.worker.js';

describe('worker registration metadata', () => {
  it('should register worker metadata on decorated classes', () => {
    const registration = getWorkerRegistration(CounterWorker);

    expect(registration).not.toBeNull();
    expect(registration).toMatchObject({
      id: expect.stringContaining('CounterWorker'),
      filePath: expect.stringContaining('counter.worker'),
    });
  });

  it('should not inherit worker registrations across subclasses', () => {
    class DerivedCounterWorker extends CounterWorker {}

    expect(getWorkerRegistration(DerivedCounterWorker)).toBeNull();
  });

  it('should register decorated subclasses independently', () => {
    @DefineWorker()
    class DecoratedDerivedCounterWorker extends CounterWorker {}

    const registration = getWorkerRegistration(DecoratedDerivedCounterWorker);

    expect(registration).not.toBeNull();
    expect(registration).toMatchObject({
      id: expect.stringContaining('DecoratedDerivedCounterWorker'),
      filePath: expect.stringContaining('worker-registration.spec'),
    });
  });
});
