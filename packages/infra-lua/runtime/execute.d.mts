export const version: string;
export function execute(
  request: unknown,
): Promise<
  | { readonly ok: true; readonly value: unknown; readonly version: string }
  | { readonly ok: false; readonly error: import("../src/index.ts").LuaRuntimeFailure }
>;
