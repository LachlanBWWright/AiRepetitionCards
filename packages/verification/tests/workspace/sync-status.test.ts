import assert from "node:assert/strict";
import test from "node:test";
import { describeWorkspaceSyncStatus } from "@recall/application";
const input = {
  storage: "device",
  writable: true,
  busy: false,
  signedIn: true,
  online: true,
  error: false,
  conflict: false,
  confirmed: false,
  pending: 1,
} as const;
void test("sync status never equates local saves, pending changes, conflicts or failed requests with account confirmation", () => {
  assert.match(describeWorkspaceSyncStatus(input).label, /pending/);
  assert.match(describeWorkspaceSyncStatus({ ...input, busy: true }).label, /Syncing/);
  assert.match(describeWorkspaceSyncStatus({ ...input, confirmed: true }).label, /pending/);
  assert.equal(
    describeWorkspaceSyncStatus({ ...input, confirmed: true, pending: 0 }).label,
    "Synced with account",
  );
  assert.match(
    describeWorkspaceSyncStatus({ ...input, confirmed: true, pending: 0, conflict: true }).label,
    /decision/,
  );
  assert.equal(describeWorkspaceSyncStatus({ ...input, error: true }).attention, true);
  assert.match(describeWorkspaceSyncStatus({ ...input, online: false }).label, /Offline/);
  assert.match(
    describeWorkspaceSyncStatus({ ...input, storage: "tab", signedIn: false }).label,
    /tab/,
  );
  assert.equal(describeWorkspaceSyncStatus({ ...input, writable: false }).attention, true);
});
