/** Read mutable refs again after asynchronous work instead of retaining a narrowed value. */
export function readRef<Value>(ref: { readonly current: Value }): Value {
  return ref.current;
}
