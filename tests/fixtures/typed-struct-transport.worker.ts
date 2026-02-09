import { Struct } from 'typed-struct';
import {
  WorkerMethod,
  DefineWorker,
  TransportType,
  TransportEncoder,
} from '../..';

const Base = new Struct('TypedStructTransportBase')
  .UInt8('value')
  .UInt32LE('count')
  .compile();

class MyData extends Base {
  declare value: number;
  declare count: number;
  extraField: string = '';
  nestedData?: { name: string };
}

// Typed-struct class with @TransportType on a field
class ComplexData extends Base {
  declare value: number;
  declare count: number;

  @TransportType(() => MyData)
  nested?: MyData;

  plainField: string = '';
}

// Typed-struct class with @TransportEncoder on a field
class EncodedData extends Base {
  declare value: number;
  declare count: number;

  @TransportEncoder(
    (date: Date) => date.toISOString(),
    (str: string) => new Date(str),
  )
  timestamp?: Date;
}

// Regular class with typed-struct field
class WrapperClass {
  @TransportType(() => MyData)
  data!: MyData;

  label: string = '';

  constructor(data?: MyData, label?: string) {
    if (data) this.data = data;
    if (label) this.label = label;
  }
}

@DefineWorker()
export class TypedStructTransportWorker {
  @WorkerMethod()
  @TransportType(() => MyData)
  createData(@TransportType(() => MyData) input?: MyData): MyData {
    const data = new MyData();
    if (input) {
      data.value = input.value;
      data.count = input.count;
      data.extraField = input.extraField;
      data.nestedData = input.nestedData;
    } else {
      data.value = 42;
      data.count = 100;
      data.extraField = 'test';
      data.nestedData = { name: 'example' };
    }
    return data;
  }

  @WorkerMethod()
  @TransportType(() => MyData)
  modifyData(@TransportType(() => MyData) data: MyData): MyData {
    const result = new MyData();
    result.value = data.value * 2;
    result.count = data.count + 1;
    result.extraField = data.extraField + ' modified';
    result.nestedData = data.nestedData
      ? { name: data.nestedData.name + '!' }
      : undefined;
    return result;
  }

  @WorkerMethod()
  @TransportType(() => [MyData])
  createArray(): MyData[] {
    const arr: MyData[] = [];
    for (let i = 0; i < 3; i++) {
      const data = new MyData();
      data.value = i;
      data.count = i * 10;
      data.extraField = `item${i}`;
      arr.push(data);
    }
    return arr;
  }

  @WorkerMethod()
  @TransportType(() => ComplexData)
  createComplexData(): ComplexData {
    const nested = new MyData();
    nested.value = 10;
    nested.count = 20;
    nested.extraField = 'nested';

    const data = new ComplexData();
    data.value = 1;
    data.count = 2;
    data.nested = nested;
    data.plainField = 'plain';
    return data;
  }

  @WorkerMethod()
  @TransportType(() => ComplexData)
  processComplexData(
    @TransportType(() => ComplexData) data: ComplexData,
  ): ComplexData {
    const result = new ComplexData();
    result.value = data.value * 2;
    result.count = data.count + 5;
    result.plainField = data.plainField + ' processed';

    if (data.nested) {
      const nested = new MyData();
      nested.value = data.nested.value + 1;
      nested.count = data.nested.count + 1;
      nested.extraField = data.nested.extraField + '!';
      result.nested = nested;
    }

    return result;
  }

  @WorkerMethod()
  @TransportType(() => EncodedData)
  createEncodedData(): EncodedData {
    const data = new EncodedData();
    data.value = 99;
    data.count = 100;
    data.timestamp = new Date('2024-01-01T00:00:00.000Z');
    return data;
  }

  @WorkerMethod()
  @TransportType(() => EncodedData)
  processEncodedData(
    @TransportType(() => EncodedData) data: EncodedData,
  ): EncodedData {
    const result = new EncodedData();
    result.value = data.value + 1;
    result.count = data.count + 1;
    result.timestamp = data.timestamp
      ? new Date(data.timestamp.getTime() + 86400000) // +1 day
      : undefined;
    return result;
  }

  @WorkerMethod()
  @TransportType(() => WrapperClass)
  createWrapper(): WrapperClass {
    const myData = new MyData();
    myData.value = 5;
    myData.count = 10;
    myData.extraField = 'wrapped';

    return new WrapperClass(myData, 'wrapper-label');
  }

  @WorkerMethod()
  @TransportType(() => WrapperClass)
  processWrapper(
    @TransportType(() => WrapperClass) wrapper: WrapperClass,
  ): WrapperClass {
    const myData = new MyData();
    myData.value = wrapper.data.value * 2;
    myData.count = wrapper.data.count * 2;
    myData.extraField = wrapper.data.extraField + ' modified';

    return new WrapperClass(myData, wrapper.label + ' processed');
  }

  @WorkerMethod()
  @TransportType(() => [WrapperClass])
  createWrapperArray(): WrapperClass[] {
    const arr: WrapperClass[] = [];
    for (let i = 0; i < 2; i++) {
      const myData = new MyData();
      myData.value = i;
      myData.count = i * 5;
      myData.extraField = `item${i}`;
      arr.push(new WrapperClass(myData, `label${i}`));
    }
    return arr;
  }
}
