export function readRef<A>(ref: { readonly current: A }): A {
  return ref.current;
}
