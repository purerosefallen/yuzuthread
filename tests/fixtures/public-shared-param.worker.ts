import { Struct } from 'typed-struct';
import { DefineWorker, WorkerMethod, Shared } from '../..';

const Base = new Struct('PublicSharedBase')
  .UInt32LE('counter')
  .UInt8('flag')
  .compile();

export class PublicSharedData extends Base {
  declare counter: number;
  declare flag: number;
}

// Worker with public @Shared parameter
// Expected usage: constructor(@Shared() public sharedData: SharedData)
@DefineWorker()
export class PublicSharedWorker {
  constructor(
    @Shared(() => PublicSharedData) public sharedData: PublicSharedData,
  ) {}

  @WorkerMethod()
  incrementCounter(): number {
    this.sharedData.counter++;
    return this.sharedData.counter;
  }

  @WorkerMethod()
  getCounter(): number {
    return this.sharedData.counter;
  }
}
