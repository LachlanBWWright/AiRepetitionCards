import { createNativeOperationStore } from "../workspace/native-operation-store";
export const createNativeForkOperationStore = (mayWrite: () => boolean) =>
  createNativeOperationStore("fork", mayWrite);
export const nativeForkOperationStore = createNativeForkOperationStore(() => true);
