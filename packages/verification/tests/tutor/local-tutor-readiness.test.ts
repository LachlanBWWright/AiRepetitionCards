import assert from "node:assert/strict";
import test from "node:test";
import { localTutorUnavailableReason } from "../../../../apps/web/src/components/tutor/connection/local-tutor-readiness";
const state = {
  enabled: true,
  activeClientId: "client",
  accounts: [
    { clientId: "client", label: "ChatGPT", email: null, signedIn: true, planEnabled: true },
  ],
};
void test("desktop chat waits for account and model readiness without blocking hosted tutoring", () => {
  assert.equal(
    localTutorUnavailableReason({ desktop: false, state: null, model: "", error: null }),
    null,
  );
  assert.match(
    localTutorUnavailableReason({ desktop: true, state: null, model: "", error: null }) ?? "",
    /Checking/,
  );
  assert.match(
    localTutorUnavailableReason({ desktop: true, state, model: "", error: null }) ?? "",
    /Choose.*model/,
  );
  assert.equal(
    localTutorUnavailableReason({ desktop: true, state, model: "study-model", error: null }),
    null,
  );
  assert.match(
    localTutorUnavailableReason({
      desktop: true,
      state: { ...state, accounts: [] },
      model: "study-model",
      error: null,
    }) ?? "",
    /Connect ChatGPT/,
  );
  const paused = {
    ...state,
    accounts: state.accounts.map((account) => ({ ...account, planEnabled: false })),
  };
  assert.match(
    localTutorUnavailableReason({
      desktop: true,
      state: paused,
      model: "study-model",
      error: null,
    }) ?? "",
    /Enable ChatGPT plan/,
  );
});
