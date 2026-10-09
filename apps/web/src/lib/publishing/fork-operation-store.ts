import { Effect } from "effect";
import type { PublicationForkOperationStore } from "@recall/application";
import { coordinateLocalWrite } from "@/features/workspace/local-write-coordinator";
import { volatileStorage } from "@/lib/volatile-storage";

const key = (versionId: string) => `recall-pending-fork:${versionId.toLowerCase()}`;
const failure = () => ({ _tag: "PublicationForkOperationFailure" }) as const;
export const browserForkOperationStore: PublicationForkOperationStore = {
  read: (versionId) =>
    coordinateLocalWrite(
      Effect.try({ try: () => volatileStorage.getItem(key(versionId)), catch: failure }),
      failure,
    ),
  write: (versionId, operationId) =>
    coordinateLocalWrite(
      Effect.try({
        try: () => volatileStorage.setItem(key(versionId), operationId.toLowerCase()),
        catch: failure,
      }),
      failure,
    ),
  clear: (versionId) =>
    coordinateLocalWrite(
      Effect.try({ try: () => volatileStorage.removeItem(key(versionId)), catch: failure }),
      failure,
    ),
};
