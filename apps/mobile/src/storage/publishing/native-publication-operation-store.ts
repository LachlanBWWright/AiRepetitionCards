import { createNativeOperationStore } from "../workspace/native-operation-store";
export const createNativePublicationOperationStore = (mayWrite: () => boolean) =>
  createNativeOperationStore("publication", mayWrite);
export const nativePublicationOperationStore = createNativePublicationOperationStore(() => true);
