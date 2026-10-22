import { Schema } from "effect";
import { StudySyncDocumentSchema } from "@recall/domain";
const Revision = Schema.Number.pipe(Schema.int(), Schema.nonNegative());
export const WorkspaceStudyPageSchema = Schema.Struct({
  revision: Revision,
  document: StudySyncDocumentSchema,
  nextCursor: Schema.NullOr(Revision),
});
export const WorkspaceStudyBatchSchema = Schema.Struct({
  revision: Revision,
  document: StudySyncDocumentSchema,
}).pipe(
  Schema.filter(
    ({ document }) =>
      document.adjustments.length +
        document.corrections.length +
        document.undoStates.length +
        (document.importedSchedules?.length ?? 0) <=
      5000,
  ),
);
export const WorkspaceStudyBatchReplySchema = Schema.Struct({ revision: Revision });
