export type RefAccess<T> = {
  readonly get: () => T;
  readonly set: (value: T) => void;
};

export type CounterAccess = {
  readonly get: () => number;
  readonly increment: () => void;
};
