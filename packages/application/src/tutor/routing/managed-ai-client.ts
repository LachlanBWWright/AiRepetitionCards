import { Effect, Schema } from "effect";
import { ManagedAiStatusSchema } from "@recall/contracts";
export { ManagedAiStatusSchema, type ManagedAiStatus } from "@recall/contracts";
export function decodeManagedAiStatus(input: unknown, owner: string) {
  return Schema.decodeUnknown(ManagedAiStatusSchema)(input).pipe(
    Effect.filterOrFail(
      (status) => status.accountId === owner,
      () => ({ message: "The selected account changed." }),
    ),
    Effect.mapError(() => ({
      message: "Managed AI access could not be verified. Retry in AI settings.",
    })),
  );
}
