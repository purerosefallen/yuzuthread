import {
  DefineWorker,
  WorkerMethod,
  TransportType,
  TransportNoop,
} from '../..';

class DataWithNoop {
  normalValue!: string;

  @TransportNoop()
  noopValue?: string;

  constructor(normalValue: string, noopValue?: string) {
    this.normalValue = normalValue;
    this.noopValue = noopValue;
  }
}

@DefineWorker()
export class TransportNoopWorker {
  @WorkerMethod()
  @TransportType(() => DataWithNoop)
  async processWithNoopField(
    @TransportType(() => DataWithNoop) input: DataWithNoop,
  ): Promise<DataWithNoop> {
    // noopValue should be undefined after transport
    return new DataWithNoop(
      input.normalValue.toUpperCase(),
      input.noopValue ? input.noopValue.toUpperCase() : undefined,
    );
  }

  @WorkerMethod()
  @TransportType(() => DataWithNoop)
  async processWithNoopParam(
    normalParam: string,
    @TransportNoop() noopParam: string,
  ): Promise<DataWithNoop> {
    // noopParam should be undefined after transport
    return new DataWithNoop(normalParam, noopParam);
  }

  @WorkerMethod()
  @TransportNoop()
  async returnNoop(): Promise<string> {
    // Return value should be undefined after transport
    return 'this-should-be-undefined';
  }

  @WorkerMethod()
  @TransportType(() => [DataWithNoop])
  async processArrayWithNoop(
    @TransportType(() => [DataWithNoop]) items: DataWithNoop[],
  ): Promise<DataWithNoop[]> {
    return items.map(
      (item) =>
        new DataWithNoop(
          item.normalValue.toUpperCase(),
          item.noopValue ? item.noopValue.toUpperCase() : undefined,
        ),
    );
  }
}
