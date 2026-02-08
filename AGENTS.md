# 项目要求

## 项目规范

- 能用 lambda 函数就用 lambda 函数，而不是 function。
- 如果表达「类」类型，不要用 function，而是用 AnyClass 或者 ClassType<T>。
- 如果写的代码属于和本业务无关的工具函数，那么写在 src/utility 下新开一个文件。并且要专门为这个文件写单元测试。
- 和业务无关的类型放在 src/utility/types.ts 里。如果类型太长，那么另开文件。
- 对于写的任何一个小方法，都要写单元测试 .spec.ts 然后跑一下验证对不对。

## 项目目标

实现一个和 nanolith 差不多的库，可以用类创建 worker。

## 参考代码

下面的代码库可以作为参考，但是不要改里面的文件。
注意不要尝试去 nanolith 找 typed-struct 相关的，不可能有的。

- typed-struct: /Users/nanahira/nas-toa/workspace/ref/typed-struct
- nanolith: /Users/nanahira/nas-toa/workspace/ref/typed-struct
- typed-reflector: /Users/nanahira/nas-toa/workspace/typed-reflector
