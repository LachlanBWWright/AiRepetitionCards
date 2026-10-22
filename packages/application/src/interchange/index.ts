export { fromKnowledgeArea, toKnowledgeArea } from "./knowledge-area-interchange";

export { exportDelimitedCards, importDelimitedCards } from "./delimited-interchange";

export type { DelimitedImportError, DelimitedImportResult } from "./delimited-interchange";

export { importAnkiApkg, AnkiCollectionSchema } from "./anki/anki-import";

export { decodeAnkiV18Collection } from "./anki/anki-v18";

export type { AnkiV18CollectionRows } from "./anki/anki-v18";

export type {
  AnkiCardRow,
  AnkiCollection,
  AnkiImportError,
  AnkiImportProposal,
  AnkiNoteRow,
  AnkiNoteType,
  AnkiSqliteReader,
  AnkiSqliteReaderError,
} from "./anki/anki-import";

export {
  exportKnowledgeAreaPackage,
  importKnowledgeAreaPackage,
  isSupportedMediaContent,
  verifyMediaAsset,
  MAX_KNOWLEDGE_AREA_PACKAGE_BYTES,
} from "./knowledge-area-package";

export type {
  ImportedKnowledgeAreaPackage,
  KnowledgeAreaPackageFailure,
} from "./knowledge-area-package";

export {
  exportWorkspaceBackupPackage,
  importWorkspaceBackupPackage,
} from "./workspace-backup-package";

export type { RestoredWorkspaceBackup, WorkspaceBackupFailure } from "./workspace-backup-package";

export type {
  KnowledgeAreaExportError,
  KnowledgeAreaImportError,
} from "./knowledge-area-interchange";

export * from "./portable/portable-deck-package";

export { privateDeckHistory } from "./portable/private-study-history";
export { decodeAnkiTemplates, decodeAnkiScheduling } from "./anki/anki-legacy-metadata";
export { exportAnkiApkg } from "./anki/anki-export";
export type { AnkiExportFailure, AnkiSqliteWriter, AnkiSqlStatement } from "./anki/anki-export";

export { applyAnkiImport } from "./anki/anki-reimport";
export type { AnkiReimportFailure } from "./anki/anki-reimport";
