import { Struct } from 'typed-struct';
import { WorkerMethod, Worker } from '../..';

const Base = new Struct('SharedStructBase').UInt8('value').compile();

@Worker()
export class SharedStructWorker extends Base {
  @WorkerMethod()
  setValue(value: number) {
    this.value = value;
    return this.value;
  }
}
