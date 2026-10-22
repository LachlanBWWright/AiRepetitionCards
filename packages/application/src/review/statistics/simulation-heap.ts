/** Mutable scratch heap, confined to a single pure simulation call. */
export class SimulationHeap<T> {
  private readonly values: T[] = [];
  constructor(private readonly compare: (left: T, right: T) => number) {}
  push(value: T): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const previous = this.values[parent];
      if (previous === undefined || this.compare(previous, value) <= 0) break;
      this.values[index] = previous;
      index = parent;
    }
    this.values[index] = value;
  }
  pop(): T | undefined {
    const first = this.values[0],
      last = this.values.pop();
    if (this.values.length && last !== undefined) {
      let index = 0;
      while (index * 2 + 1 < this.values.length) {
        let next = index * 2 + 1;
        const right = this.values[next + 1],
          left = this.values[next];
        if (right !== undefined && left !== undefined && this.compare(right, left) < 0) next += 1;
        const child = this.values[next];
        if (child === undefined || this.compare(last, child) <= 0) break;
        this.values[index] = child;
        index = next;
      }
      this.values[index] = last;
    }
    return first;
  }
}
