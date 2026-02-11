# yuzuthread

A lightweight, class-first `worker_threads` library for Node.js.  
Define a class with decorators, run methods in a worker thread, and keep a mirrored instance on the main thread.

## Why

`yuzuthread` is built around a few practical goals:

- Organize worker logic with classes instead of manual message protocols.
- Keep method calls ergonomic and object-oriented.
- Automatically use shared memory for `typed-struct` classes.
- Stay non-intrusive: your class can still be used with plain `new`.

## Install

```bash
npm i yuzuthread typed-struct
```

`typed-struct` is required because `yuzuthread` declares it as a peer dependency.

### TypeScript Configuration

Enable decorators in your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

- `experimentalDecorators` is required for all decorators
- `emitDecoratorMetadata` enables automatic type inference for `@TransportType()`

## Define a Worker Class

Put each worker class in its own file and add `@DefineWorker()`.

```ts
// counter.worker.ts
import { isMainThread } from 'node:worker_threads';
import { DefineWorker, WorkerMethod, WorkerCallback } from 'yuzuthread';

@DefineWorker()
export class CounterWorker {
  count = 0;

  @WorkerMethod()
  async increment(step: number) {
    this.count += step;
    return { count: this.count, isMainThread };
  }

  @WorkerMethod()
  add(a: number, b: number) {
    return a + b;
  }

  @WorkerCallback()
  onMainAdd(a: number, b: number) {
    this.count += a + b;
    return { count: this.count, isMainThread };
  }

  @WorkerMethod()
  async callMainAdd(a: number, b: number) {
    return this.onMainAdd(a, b);
  }
}
```

## Long-running Worker (`initWorker`)

`initWorker` creates a persistent worker instance.  
Methods marked with `@WorkerMethod()` are proxied to the worker thread.  
You still hold a main-thread instance of the same class.

```ts
import { initWorker } from 'yuzuthread';
import { CounterWorker } from './counter.worker.js';

const counter = await initWorker(CounterWorker);

console.log(await counter.increment(2));
// -> { count: 2, isMainThread: false }

console.log(counter.count);
// -> 0 (main-thread instance state)

await counter.finalize();
```

## One-time Worker (`runInWorker`)

`runInWorker` is for fire-and-forget style work: create worker, run callback, finalize automatically.

```ts
import { runInWorker } from 'yuzuthread';
import { CounterWorker } from './counter.worker.js';

const value = await runInWorker(
  CounterWorker,
  async (counter) => {
    await counter.increment(2);
    const result = await counter.increment(3);
    return result.count;
  },
);

console.log(value); // -> 5
```

## Reverse Calls with `WorkerCallback`

`@WorkerCallback()` is the reverse direction:

- Called on the main thread: runs locally like a normal method.
- Called inside the worker thread: forwarded to main thread, then result is sent back.

Use this when worker-side logic needs to call back into main-thread state or services.

## Shared Memory with `typed-struct`

### Worker Class Shared Memory

If a worker class inherits from a compiled `typed-struct` class, `yuzuthread` automatically:

- Detects the struct class and computes buffer size.
- Creates a `SharedArrayBuffer`.
- Injects the shared buffer into both main-thread and worker-thread instances.

So both sides operate on the same underlying memory.

```ts
import { Struct } from 'typed-struct';
import { DefineWorker, WorkerMethod, initWorker } from 'yuzuthread';

const Base = new Struct('SharedStructBase').UInt8('value').compile();

@DefineWorker()
class SharedStructWorker extends Base {
  @WorkerMethod()
  setValue(value: number) {
    this.value = value;
    return this.value;
  }
}

const instance = await initWorker(SharedStructWorker, [0x10]);
await instance.setValue(0x7f);
console.log(instance.value); // -> 0x7f
await instance.finalize();
```

### Shared Constructor Parameters with `@Shared`

Use `@Shared()` to mark constructor parameters that should use shared memory:

```ts
import { Struct } from 'typed-struct';
import { DefineWorker, WorkerMethod, Shared, initWorker } from 'yuzuthread';

const SharedDataBase = new Struct('SharedData')
  .UInt32LE('counter')
  .compile();

class SharedData extends SharedDataBase {
  declare counter: number;
}

@DefineWorker()
class SharedParamWorker {
  constructor(
    @Shared(() => SharedData) public data: SharedData,
  ) {}

  @WorkerMethod()
  increment() {
    this.data.counter++;
    return this.data.counter;
  }
}

const data = new SharedData();
data.counter = 100;

const worker = await initWorker(SharedParamWorker, [data]);

// Main thread and worker share the same memory
await worker.increment();
console.log(worker.data.counter); // -> 101 (updated by worker)

data.counter = 200;
console.log(await worker.increment()); // -> 201 (sees main thread's change)

await worker.finalize();
```

**How it works:**
- Parameters marked with `@Shared()` are converted to use `SharedArrayBuffer` during worker initialization
- The factory function `() => Type` is optional - if omitted, type is inferred from `design:paramtypes`
- The library calculates total memory needed (including worker class itself if typed-struct)
- Both main thread and worker thread share the same underlying memory
- Works with `Buffer`, `SharedArrayBuffer`, `typed-struct` classes, and user classes containing these

**Requirements:**
- The parameter type must contain shared memory segments (`typed-struct`, `Buffer`, or `SharedArrayBuffer`)
- If the type has no shared memory segments, an error is thrown
- Can be combined with worker class shared memory (worker class itself is typed-struct)

**Multiple shared parameters:**

```ts
@DefineWorker()
class MultiSharedWorker {
  constructor(
    @Shared(() => SharedData) public data1: SharedData,
    @Shared(() => SharedData) public data2: SharedData,
    @Shared(() => Buffer) public buffer: Buffer,
  ) {}

  @WorkerMethod()
  updateAll() {
    this.data1.counter++;
    this.data2.counter--;
    this.buffer[0] = 0xff;
  }
}

const data1 = new SharedData();
const data2 = new SharedData();
const buffer = Buffer.alloc(10);

const worker = await initWorker(MultiSharedWorker, [data1, data2, buffer]);
await worker.updateAll();

// All parameters are shared
console.log(data1.counter); // updated by worker
console.log(data2.counter); // updated by worker
console.log(buffer[0]); // -> 0xff
```

### Manual Shared Memory Conversion with `toShared()`

`toShared()` converts objects to use shared memory. **Important:** The object must contain shared memory segments to be converted:
- The class itself is a `typed-struct` class, OR
- The object has `Buffer` or `SharedArrayBuffer` fields, OR  
- The object has fields (marked with `@TransportType()`) that are `typed-struct` classes

```ts
import { Struct } from 'typed-struct';
import { toShared, TransportType } from 'yuzuthread';

// Example 1: typed-struct class
const SharedDataBase = new Struct('SharedData')
  .UInt32LE('counter')
  .compile();

class SharedData extends SharedDataBase {
  declare counter: number;
}

const data = new SharedData();
data.counter = 42;

const sharedData = toShared(data);
// sharedData is a NEW instance using SharedArrayBuffer
console.log(sharedData.counter); // -> 42

// Example 2: Buffer
const buffer = Buffer.from('hello');
const sharedBuffer = toShared(buffer);
// sharedBuffer is a NEW Buffer backed by SharedArrayBuffer
console.log(sharedBuffer.toString()); // -> 'hello'

// Example 3: User class with typed-struct field
class Container {
  @TransportType(() => SharedData)
  data!: SharedData;
  
  label: string = '';
}

const container = new Container();
container.data = new SharedData();
container.data.counter = 100;
container.label = 'test';

toShared(container); // Converts container.data in-place
// container.data is now a different instance using SharedArrayBuffer
console.log(container.data.counter); // -> 100
console.log(container.label); // -> 'test' (unchanged)

// Example 4: User class with Buffer field
class BufferContainer {
  @TransportType(() => Buffer)
  buffer!: Buffer;
}

const bufferContainer = new BufferContainer();
bufferContainer.buffer = Buffer.from('data');

toShared(bufferContainer); // Converts bufferContainer.buffer in-place
// bufferContainer.buffer is now backed by SharedArrayBuffer

// Example 5: Complex nested structure
class NestedContainer {
  @TransportType(() => Container)
  container!: Container;
  
  @TransportType(() => Buffer)
  buffer!: Buffer;
}

const nested = new NestedContainer();
nested.container = new Container();
nested.container.data = new SharedData();
nested.container.data.counter = 200;
nested.buffer = Buffer.from('nested');

toShared(nested);
// Both nested.container.data and nested.buffer are now shared
console.log(nested.container.data.counter); // -> 200
```

**How `toShared()` works:**
- **Buffer** → Creates a `SharedArrayBuffer` copy, returns new `Buffer` instance
- **SharedArrayBuffer** → Returns as-is (already shared)
- **typed-struct classes** → Creates new instance with `SharedArrayBuffer`
- **User classes** → Recursively converts fields marked with `@TransportType()` **in-place**
- **Arrays** → Converts each element in-place
- Built-in types (Date, RegExp, etc.) → Not supported, returns as-is

**Field conversion rules:**
- Only converts fields with `@TransportType()` decorator
- Or fields with `design:type` metadata (when `emitDecoratorMetadata` is enabled)
- Skips fields with manual encoders (`@TransportEncoder()`)
- Skips fields with `@TransportNoop()` (prevents transport and shared memory conversion)
- Skips built-in types

**Important notes:**
- For `typed-struct` classes and `Buffer`, `toShared()` returns a **new instance** (cannot modify in-place)
- For user classes, `toShared()` modifies fields **in-place** (the object itself is the same, but its fields may be replaced)
- The object must contain at least one shared memory segment, otherwise it's returned unchanged
- Use `@TransportType()` to mark fields that should be recursively converted

## Custom Class Transport

By default, `worker_threads` can only pass serializable data (primitives, plain objects, `Buffer`, etc.). For custom classes, `yuzuthread` provides transport decorators to automatically serialize and deserialize instances.

### Basic Class Transport

Use `@TransportType()` to mark parameters and return values that need class restoration:

```ts
import { DefineWorker, WorkerMethod, TransportType, initWorker } from 'yuzuthread';

class UserData {
  constructor(
    public id: number,
    public name: string,
  ) {}

  greet() {
    return `Hello, ${this.name}!`;
  }
}

@DefineWorker()
class DataWorker {
  @WorkerMethod()
  @TransportType(() => UserData)  // Return type
  async processUser(
    @TransportType(() => UserData) user: UserData,  // Parameter
  ): Promise<UserData> {
    return new UserData(user.id, user.name.toUpperCase());
  }
}

const worker = await initWorker(DataWorker);
const input = new UserData(1, 'alice');
const result = await worker.processUser(input);

console.log(result.greet()); // -> "Hello, ALICE!"
await worker.finalize();
```

### Array Transport

Use `[Class]` syntax for arrays:

```ts
@DefineWorker()
class BatchWorker {
  @WorkerMethod()
  @TransportType(() => [UserData])
  async processBatch(
    @TransportType(() => [UserData]) users: UserData[],
  ): Promise<UserData[]> {
    return users.map((u) => new UserData(u.id + 100, u.name.toLowerCase()));
  }
}
```

### Nested Objects

For classes with custom-class properties, add `@TransportType()` to the property:

```ts
class Address {
  constructor(
    public city: string,
    public country: string,
  ) {}
}

class Person {
  @TransportType(() => Address)
  address!: Address;

  constructor(
    public name: string,
    address: Address,
  ) {
    this.address = address;
  }
}

@DefineWorker()
class PersonWorker {
  @WorkerMethod()
  @TransportType(() => Person)
  async processPerson(
    @TransportType(() => Person) person: Person,
  ): Promise<Person> {
    return new Person(
      person.name,
      new Address(person.address.city.toUpperCase(), person.address.country),
    );
  }
}
```

### Custom Encoder

For complex serialization logic, use `@TransportEncoder()`:

```ts
import { DefineWorker, WorkerMethod, TransportEncoder, initWorker } from 'yuzuthread';

@DefineWorker()
class DateWorker {
  @WorkerMethod()
  @TransportEncoder(
    (date: Date) => date.toISOString(),
    (str: string) => new Date(str),
  )
  async addDay(
    @TransportEncoder(
      (date: Date) => date.toISOString(),
      (str: string) => new Date(str),
    )
    date: Date,
  ): Promise<Date> {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    return next;
  }
}

const worker = await initWorker(DateWorker);
const today = new Date('2024-01-01');
const tomorrow = await worker.addDay(today);
console.log(tomorrow); // -> Date('2024-01-02')
await worker.finalize();
```

Encoders support async operations:

```ts
@TransportEncoder(
  async (obj: MyClass) => {
    // async encoding logic
    return await serialize(obj);
  },
  async (data: string) => {
    // async decoding logic
    return await deserialize(data);
  },
)
```

### Preventing Transport with `@TransportNoop`

Use `@TransportNoop()` to mark fields, parameters, or return values that should always be transmitted as `undefined`. This is useful for:

- Sensitive data that should not cross worker boundaries
- Large objects that should not be copied
- Functions or non-serializable objects
- Fields that are only relevant in one thread

```ts
import { DefineWorker, WorkerMethod, TransportType, TransportNoop, initWorker } from 'yuzuthread';

class UserData {
  username!: string;
  email!: string;

  // This field will always be undefined after transport
  @TransportNoop()
  password?: string;

  // This field will also be undefined after transport
  @TransportNoop()
  sessionToken?: string;
}

@DefineWorker()
class SecureWorker {
  @WorkerMethod()
  @TransportType(() => UserData)
  async processUser(
    @TransportType(() => UserData) userData: UserData,
    // This parameter will be undefined in the worker
    @TransportNoop() sensitiveInfo?: string,
  ): Promise<UserData> {
    // userData.password is undefined here
    // sensitiveInfo is undefined here
    return new UserData();
  }

  @WorkerMethod()
  @TransportNoop()
  async getSecret(): Promise<string> {
    // Return value will be undefined in the main thread
    return 'this-will-be-undefined';
  }
}

const worker = await initWorker(SecureWorker);

const user = new UserData();
user.username = 'alice';
user.password = 'secret123';

const result = await worker.processUser(user, 'sensitive');
// result.password is undefined (not transmitted)

const secret = await worker.getSecret();
console.log(secret); // -> undefined

await worker.finalize();
```

**Behavior with `toShared()`:**

Fields decorated with `@TransportNoop()` are not recursively processed by `toShared()`:

```ts
class DataWithBuffer {
  normalBuffer!: Buffer;

  // This buffer will NOT be converted to SharedArrayBuffer
  @TransportNoop()
  sensitiveBuffer?: Buffer;
}

const data = new DataWithBuffer();
data.normalBuffer = Buffer.from('normal');
data.sensitiveBuffer = Buffer.from('sensitive');

toShared(data);

// normalBuffer is converted to SharedArrayBuffer
console.log(data.normalBuffer.buffer.constructor.name); // -> 'SharedArrayBuffer'

// sensitiveBuffer stays as regular Buffer
console.log(data.sensitiveBuffer.buffer.constructor.name); // -> 'ArrayBuffer'
```

**Implementation note:**  
`@TransportNoop` is implemented using `@TransportEncoder` with both encode and decode functions returning `undefined`.

### Built-in Type Handling

- **Primitives** (`string`, `number`, `boolean`, etc.) - passed as-is
- **Built-in objects** (`Date`, `RegExp`, `Map`, `Set`, etc.) - handled by structured clone
- **Buffer** - automatically encoded/decoded with `Uint8Array`
- **TypedArrays** (`Uint8Array`, `Int32Array`, etc.) - passed directly
- **Plain objects** - passed as-is
- **Custom classes** - require `@TransportType()` or `@TransportEncoder()`

### Typed Struct Classes

Classes that extend `typed-struct` are automatically detected and handled with special transport logic. The library separates struct fields (stored in the buffer) from regular fields:

```ts
import { Struct } from 'typed-struct';
import { DefineWorker, WorkerMethod, TransportType, initWorker } from 'yuzuthread';

const Base = new Struct('DataBase')
  .UInt8('id')
  .UInt32LE('counter')
  .compile();

class MyData extends Base {
  declare id: number;
  declare counter: number;
  extraField: string = '';
  nestedData?: { name: string };
}

@DefineWorker()
class StructWorker {
  @WorkerMethod()
  @TransportType(() => MyData)
  async processData(
    @TransportType(() => MyData) data?: MyData,
  ): Promise<MyData> {
    const result = new MyData();
    if (data) {
      result.id = data.id;
      result.counter = data.counter + 1;
      result.extraField = data.extraField + ' processed';
      result.nestedData = data.nestedData;
    } else {
      result.id = 1;
      result.counter = 0;
      result.extraField = 'new';
    }
    return result;
  }
}

const worker = await initWorker(StructWorker);
const data = await worker.processData();
console.log(data.id); // -> 1
console.log(data.counter); // -> 0
console.log(data.extraField); // -> 'new'
```

**How it works:**
- When encoding, the library dumps the struct buffer and encodes non-struct fields separately
- When decoding, it creates a new instance with the buffer, then restores non-struct fields
- All struct fields (defined by `typed-struct`) are preserved in the buffer
- Additional class fields are transported using the standard transport logic

**Expected usage pattern:**
```ts
class SomeDataClass extends new Struct()...compile() {
  // Struct fields (declare them for TypeScript)
  declare structField1: number;
  declare structField2: number;
  
  // Other fields (will be transported separately)
  otherField: string = '';
}
```

**Mixed scenarios with transport decorators:**

Typed-struct classes can use `@TransportType()` and `@TransportEncoder()` on their non-struct fields:

```ts
class ComplexData extends Base {
  declare value: number;  // struct field
  declare count: number;  // struct field
  
  @TransportType(() => MyData)
  nested?: MyData;  // non-struct field with custom class
  
  @TransportEncoder(
    (date: Date) => date.toISOString(),
    (str: string) => new Date(str),
  )
  timestamp?: Date;  // non-struct field with custom encoder
}
```

Regular classes can have typed-struct fields:

```ts
class WrapperClass {
  @TransportType(() => MyStructData)
  data!: MyStructData;  // typed-struct class field
  
  label: string = '';  // regular field
}
```

All combinations work seamlessly - the transport system automatically handles:
- Typed-struct classes with decorated non-struct fields
- Regular classes with typed-struct fields
- Arrays of any of the above
- Nested structures of any depth

### Notes on Transport

- `@TransportType()` can be used without arguments to enable `emitDecoratorMetadata` without registering metadata
- Transport decorators work with both `@WorkerMethod()` and `@WorkerCallback()`
- Multiple `@TransportType()` can be stacked (e.g., for method + parameters)
- Encoding/decoding happens automatically during method calls
- Transport uses structured clone algorithm with custom class restoration
- `@TransportNoop()` provides a way to prevent specific fields/parameters from being transported
- Fields with `@TransportNoop()` are also skipped by `toShared()` (won't be recursively converted)

## Worker Status

You can check the worker status at any time using `workerStatus()`:

```ts
const worker = await initWorker(CounterWorker);
console.log(worker.workerStatus()); // -> 'Ready'

await worker.increment(5);
console.log(worker.workerStatus()); // -> 'Ready'

await worker.finalize();
console.log(worker.workerStatus()); // -> 'Finalized'
```

Possible status values (`WorkerStatus` enum):
- `Initializing` - Worker is being created
- `Ready` - Worker is ready to accept calls
- `InitError` - Worker failed to initialize
- `WorkerError` - Worker encountered a runtime error
- `Exited` - Worker exited unexpectedly
- `Finalized` - Worker was finalized via `finalize()`

## Worker Event Handlers

You can handle worker lifecycle events in the main thread using event decorators:

```ts
import { DefineWorker, WorkerMethod, OnWorkerEvent, OnWorkerExit, OnWorkerError, initWorker } from 'yuzuthread';

@DefineWorker()
class MonitoredWorker {
  @WorkerMethod()
  async doWork() {
    // some work
  }

  @OnWorkerError()
  handleError(error: Error) {
    console.log('Worker error:', error.message);
  }

  @OnWorkerExit()
  handleExit(code: number) {
    console.log('Worker exited with code:', code);
  }

  @OnWorkerEvent('online')
  handleOnline() {
    console.log('Worker is online');
  }

  // One method can handle multiple events
  @OnWorkerEvent('online')
  @OnWorkerEvent('exit')
  handleMultipleEvents(arg?: unknown) {
    console.log('Worker online or exited');
  }
}

const worker = await initWorker(MonitoredWorker);
// Event handlers will be called automatically when events occur
```

Available decorators:
- `@OnWorkerEvent(event: WorkerEventName)` - Handle any worker event (e.g., 'online', 'message', 'messageerror')
  - `WorkerEventName` is typed to match `Worker.on()` events for type safety
  - Can be stacked on the same method to handle multiple events
- `@OnWorkerError()` - Shorthand for `@OnWorkerEvent('error')`
- `@OnWorkerExit()` - Shorthand for `@OnWorkerEvent('exit')`

Event handlers run on the main thread and can access the main-thread instance state. Multiple handlers can be registered for the same event, and one method can handle multiple events. If a handler throws an error, it will be logged but won't affect other handlers or worker operation.

## API

### Decorators

#### Worker Definition

- `DefineWorker(options?)`
  - `options.filePath?`: worker file path override (optional, auto-inferred by default)
  - `options.id?`: custom class registration ID (optional)

#### Method Execution

- `WorkerMethod()`
  - marks a method to execute on worker thread
- `WorkerCallback()`
  - marks a method to execute on main thread when called from worker

#### Event Handlers

- `OnWorkerEvent(event: WorkerEventName)`
  - marks a method to handle worker events on main thread
  - `WorkerEventName` is typed to match `Worker.on()` for type safety
  - supports: 'error', 'exit', 'online', 'message', 'messageerror'
  - can be stacked on the same method to handle multiple events
- `OnWorkerError()`
  - shorthand for `@OnWorkerEvent('error')`
- `OnWorkerExit()`
  - shorthand for `@OnWorkerEvent('exit')`

#### Data Transport

- `TransportType(factory?: () => Class | [Class])`
  - marks parameter, return value, or property for custom class transport
  - use `() => Class` for single instance
  - use `() => [Class]` for arrays
  - can be used without arguments to enable `emitDecoratorMetadata` only
  - works as `PropertyDecorator`, `MethodDecorator`, and `ParameterDecorator`
- `TransportEncoder<T, U>(encode, decode)`
  - custom encoder/decoder for transport
  - `encode: (obj: T) => Awaitable<U>` - serialize function
  - `decode: (encoded: U) => Awaitable<T>` - deserialize function
  - supports async operations
  - works as `PropertyDecorator`, `MethodDecorator`, and `ParameterDecorator`
- `TransportNoop()`
  - prevents field, parameter, or return value from being transported (always `undefined`)
  - useful for sensitive data, large objects, or non-serializable values
  - implemented using `TransportEncoder` with encode/decode returning `undefined`
  - fields with `@TransportNoop` are not processed by `toShared()`
  - works as `PropertyDecorator`, `MethodDecorator`, and `ParameterDecorator`

#### Shared Memory

- `Shared(factory?: () => Type)`
  - marks constructor parameter to use shared memory
  - factory function `() => Type` is optional (inferred from `design:paramtypes` if omitted)
  - parameter type must contain shared memory segments (`typed-struct`, `Buffer`, `SharedArrayBuffer`)
  - throws error if type has no shared memory segments
  - works as `ParameterDecorator` (constructor parameters only)
  - automatically converts parameter to use `SharedArrayBuffer` during worker initialization
  - both main thread and worker thread share the same memory

### Functions

- `initWorker(cls, ...args)`
  - creates a persistent worker and returns instance with `finalize(): Promise<void>` and `workerStatus(): WorkerStatus`
  - automatically handles `@Shared` constructor parameters
  - preserves prototype chain for custom class constructor parameters
- `runInWorker(cls, cb, ...args)`
  - one-time worker execution with automatic finalize
  - same constructor parameter handling as `initWorker`
- `toShared(obj)`
  - converts object to use shared memory
  - returns new instance for `typed-struct` classes
  - modifies in-place for user classes (updates fields)
  - creates `SharedArrayBuffer` copy for `Buffer`
  - returns as-is for `SharedArrayBuffer`
  - recursively processes fields with `@TransportType()` or `design:type` metadata

### Types

- `WorkerStatus`
  - enum for worker status states
  - values: `Initializing`, `Ready`, `InitError`, `WorkerError`, `Exited`, `Finalized`
- `WorkerInstance<T>`
  - type for worker instance with `finalize()` and `workerStatus()` methods
- `WorkerEventName`
  - type for worker event names, matches `Worker.on()` event parameter
  - includes: `'error'`, `'exit'`, `'online'`, `'message'`, `'messageerror'`
- `Awaitable<T>`
  - type for value that can be sync or async: `T | Promise<T>`
- `TransportTypeFactory`
  - type for transport type factory: `() => Class | [Class]`
- `TransportEncoderType<T, U>`
  - type for custom encoder/decoder object
- `SharedTypeFactory`
  - type for shared type factory: `() => Class`
  - used with `@Shared()` decorator

## Notes

- Worker classes are still normal classes when instantiated directly via `new`.
- Only decorated methods go through the RPC channel.
- TypeScript decorators require `experimentalDecorators`.
- For `@TransportType()` to automatically infer types from TypeScript metadata, enable `emitDecoratorMetadata` in `tsconfig.json`.
- Transport decorators work with both `@WorkerMethod()` and `@WorkerCallback()`.
- Custom class transport preserves the prototype chain and method definitions.

### Constructor Parameter Transport

Constructor parameters passed to `initWorker()` are automatically transported with prototype preservation:

```ts
class Config {
  @TransportType(() => Date)
  createdAt: Date;

  constructor(public name: string) {
    this.createdAt = new Date();
  }
}

@DefineWorker()
class ConfigWorker {
  constructor(
    public config: Config,  // No decorator needed if emitDecoratorMetadata is enabled
  ) {}

  @WorkerMethod()
  getConfigName() {
    return this.config.name.toUpperCase();
  }
}

const config = new Config('app');
const worker = await initWorker(ConfigWorker, [config]);

// config methods are preserved in worker
const name = await worker.getConfigName();
console.log(name); // -> "APP"
```

- Constructor parameters with custom classes are automatically transported
- Prototype chain is preserved using `@TransportType()` or `design:paramtypes` metadata
- Works the same way as method parameters and return values
- `@Shared` parameters are converted first, then transported

### Circular Reference Detection

The library detects and prevents circular references in both transport and shared memory:

**Transport:**
```ts
class Node {
  @TransportType(() => Node)
  next?: Node;
}

const node1 = new Node();
const node2 = new Node();
node1.next = node2;
node2.next = node1; // Circular reference

await worker.processNode(node1); // Throws: "Circular reference detected"
```

**Shared memory:**
```ts
class CircularContainer {
  @TransportType(() => SharedData)
  data!: SharedData;
}

const container: any = new Container();
container.data = new SharedData();
container.self = container; // Circular reference

toShared(container); // Throws: "Circular reference detected"
```

Circular references in type hierarchies are also detected:
```ts
class CircularA {
  @TransportType(() => CircularB)
  b?: CircularB;
}

class CircularB {
  @TransportType(() => CircularA)
  a?: CircularA;
}

// Throws when scanning metadata or attempting to transport
```

### SharedArrayBuffer Support

`SharedArrayBuffer` is automatically detected and handled in transport:

```ts
@DefineWorker()
class SharedBufferWorker {
  @WorkerMethod()
  incrementBuffer(
    @TransportType(() => Buffer) buffer: Buffer,
  ) {
    buffer[0]++;
    return buffer[0];
  }
}

const sab = new SharedArrayBuffer(10);
const buffer = Buffer.from(sab);
buffer[0] = 100;

const worker = await initWorker(SharedBufferWorker);

// Buffer backed by SharedArrayBuffer is shared
await worker.incrementBuffer(buffer);
console.log(buffer[0]); // -> 101 (updated by worker)
```

- `Buffer` backed by `SharedArrayBuffer` is automatically detected
- No copy is made - the same memory is shared
- Works with both `@TransportType()` and `@Shared()`
- `SharedArrayBuffer` can be passed directly as a parameter type
