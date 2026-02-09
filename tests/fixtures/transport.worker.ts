import {
  DefineWorker,
  WorkerMethod,
  WorkerCallback,
  TransportType,
  TransportEncoder,
} from '../..';

class CustomData {
  constructor(
    public value: number,
    public text: string,
  ) {}
}

class NestedData {
  @TransportType(() => CustomData)
  data!: CustomData;

  constructor(data: CustomData) {
    this.data = data;
  }
}

@DefineWorker()
export class TransportWorker {
  @WorkerMethod()
  @TransportType(() => CustomData)
  async createCustomData(
    @TransportType(() => CustomData) input: CustomData,
  ): Promise<CustomData> {
    return new CustomData(input.value * 2, input.text.toUpperCase());
  }

  @WorkerMethod()
  @TransportType(() => [CustomData])
  async processArray(
    @TransportType(() => [CustomData]) items: CustomData[],
  ): Promise<CustomData[]> {
    return items.map((item) => new CustomData(item.value + 1, item.text + '!'));
  }

  @WorkerMethod()
  @TransportType(() => NestedData)
  async processNested(
    @TransportType(() => NestedData) input: NestedData,
  ): Promise<NestedData> {
    return new NestedData(
      new CustomData(input.data.value * 3, input.data.text + ' nested'),
    );
  }

  @WorkerMethod()
  async processBuffer(buffer: Buffer): Promise<Buffer> {
    return Buffer.from(buffer.toString().toUpperCase());
  }

  @WorkerMethod()
  @TransportEncoder(
    (date: Date) => date.toISOString(),
    (str: string) => new Date(str),
  )
  async encodeDate(
    @TransportEncoder(
      (date: Date) => date.toISOString(),
      (str: string) => new Date(str),
    )
    date: Date,
  ): Promise<Date> {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() + 1);
    return newDate;
  }

  @WorkerCallback()
  @TransportType(() => CustomData)
  onCustomCallback(
    @TransportType(() => CustomData) data: CustomData,
  ): CustomData {
    return new CustomData(data.value + 100, data.text + ' from main');
  }

  @WorkerMethod()
  async callCustomCallback(value: number, text: string): Promise<CustomData> {
    return this.onCustomCallback(new CustomData(value, text));
  }
}
