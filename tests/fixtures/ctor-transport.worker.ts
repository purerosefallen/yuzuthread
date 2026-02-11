import { DefineWorker, WorkerMethod, TransportType, TransportNoop } from '../..';

export class UserData {
  name: string;
  age: number;

  constructor(name: string = '', age: number = 0) {
    this.name = name;
    this.age = age;
  }

  greet(): string {
    return `Hello, I'm ${this.name}, ${this.age} years old`;
  }
}

export class Config {
  @TransportType(() => Date)
  createdAt: Date;

  timeout: number;

  constructor() {
    this.createdAt = new Date();
    this.timeout = 5000;
  }

  isExpired(nowDate: Date): boolean {
    return nowDate.getTime() - this.createdAt.getTime() > this.timeout;
  }
}

// Worker with custom class parameters
@DefineWorker()
export class CtorTransportWorker {
  constructor(
    @TransportType(() => UserData) private userData: UserData,
    @TransportType(() => Config) private config: Config,
  ) {}

  @WorkerMethod()
  getUserGreeting(): string {
    // This should work if prototype is preserved
    return this.userData.greet();
  }

  @WorkerMethod()
  checkExpired(): boolean {
    return this.config.isExpired(new Date());
  }

  @WorkerMethod()
  getUserName(): string {
    return this.userData.name;
  }

  @WorkerMethod()
  modifyUserAge(newAge: number): void {
    this.userData.age = newAge;
  }
}

// Worker without @TransportType on constructor parameters
// Relies only on design:paramtypes from emitDecoratorMetadata
@DefineWorker()
export class NoDecoratorCtorWorker {
  constructor(
    private userData: UserData,
    private config: Config,
  ) {}

  @WorkerMethod()
  getUserGreeting(): string {
    // This should work even without @TransportType decorator
    return this.userData.greet();
  }

  @WorkerMethod()
  checkExpired(): boolean {
    return this.config.isExpired(new Date());
  }

  @WorkerMethod()
  getUserData(): UserData {
    return this.userData;
  }

  @WorkerMethod()
  getConfigCreatedAt(): Date {
    return this.config.createdAt;
  }
}

// Worker with @TransportNoop on constructor parameter
@DefineWorker()
export class CtorTransportNoopWorker {
  constructor(
    @TransportType(() => UserData) private userData: UserData,
    @TransportNoop() private sensitiveConfig?: Config,
    private normalParam?: string,
  ) {}

  @WorkerMethod()
  getUserGreeting(): string {
    return this.userData.greet();
  }

  @WorkerMethod()
  getSensitiveConfig(): Config | undefined {
    // Should be undefined because of @TransportNoop
    return this.sensitiveConfig;
  }

  @WorkerMethod()
  getNormalParam(): string | undefined {
    return this.normalParam;
  }

  @WorkerMethod()
  checkAllParams(): {
    hasUserData: boolean;
    hasSensitiveConfig: boolean;
    hasNormalParam: boolean;
  } {
    return {
      hasUserData: this.userData !== undefined,
      hasSensitiveConfig: this.sensitiveConfig !== undefined,
      hasNormalParam: this.normalParam !== undefined,
    };
  }
}
