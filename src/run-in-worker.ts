import { AnyClass } from 'nfkit';
import { initWorker } from './init-worker';

export const runInWorker = async <C extends AnyClass, Result>(
  cls: C,
  cb: (instance: InstanceType<C>) => Result | Promise<Result>,
  ...args: ConstructorParameters<C>
): Promise<Awaited<Result>> => {
  const workerInstance = await initWorker(cls, ...args);
  try {
    return (await cb(workerInstance as InstanceType<C>)) as Awaited<Result>;
  } finally {
    await workerInstance.finalize();
  }
};
