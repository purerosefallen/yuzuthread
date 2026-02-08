import { Struct } from 'typed-struct';
import { WorkerMethod } from '../../src/worker-method';
import { Worker } from '../../src/worker';

const Base = new Struct('SharedStructBase').UInt8('value').compile();

@Worker(__filename)
export class SharedStructWorker extends Base {
  @WorkerMethod()
  setValue(value: number) {
    this.value = value;
    return this.value;
  }
}
