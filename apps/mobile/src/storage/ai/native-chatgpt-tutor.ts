import { fetch } from "expo/fetch";
import * as Crypto from "expo-crypto";
import { Effect } from "effect";
import { createLocalTutorApi } from "@recall/application";
import { nativeChatGPTAuth } from "../auth/native-chatgpt-auth";
import { createNativeChatGPTPlanClient, nativePlanFailure } from "./chatgpt-plan-client";
import { createNativeChatGPTTutorStore } from "./native-chatgpt-tutor-store";

export const nativeChatGPTPlan = createNativeChatGPTPlanClient({ auth: nativeChatGPTAuth, fetch });
export function createNativeChatGPTTutor(
  clientId: string,
  model: string,
  areaId: string,
  mayWrite: () => boolean,
) {
  const epoch = nativeChatGPTAuth.epoch();
  const current = () => mayWrite() && nativeChatGPTAuth.epoch() === epoch;
  const storage = createNativeChatGPTTutorStore(clientId, areaId, current);
  return createLocalTutorApi({
    model,
    knowledgeAreaId: areaId,
    createId: Crypto.randomUUID,
    failure: nativePlanFailure,
    assertCurrent: nativeChatGPTPlan
      .assertCurrent(clientId, epoch)
      .pipe(
        Effect.flatMap(() =>
          current() ? Effect.void : Effect.fail(nativePlanFailure("account-changed")),
        ),
      ),
    ...storage,
    infer: (input) => nativeChatGPTPlan.infer(clientId, input),
  });
}
