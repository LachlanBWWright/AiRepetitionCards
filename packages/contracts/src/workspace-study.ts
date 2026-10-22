import { Schema } from "effect";
import { StudySyncDocumentSchema } from "@recall/domain";
export const WorkspaceStudySyncSchema = Schema.Struct({
  revision: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  document: StudySyncDocumentSchema,
});
