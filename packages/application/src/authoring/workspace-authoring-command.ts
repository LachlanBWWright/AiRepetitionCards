import {
  RestoreWorkspaceCheckpointSchema,
  RepairCollectionReferencesSchema,
} from "../workspace/maintenance/workspace-recovery";
import { MediaMaintenanceCommandSchema } from "../workspace/maintenance/collection-health";
import { SaveStudyNoteSchema } from "../notes";
import { Schema } from "effect";
import { AreaIdSchema, AssessmentIdSchema, SchedulerSettingsSchema } from "@recall/domain";
import { RestoreCardVersionSchema } from "../card-history";
import { ReplaceCardFieldsSchema } from "../review/search/card-browser";
import { RateFilteredCardSchema } from "../review/search/rate-filtered-card";
import { UndoReviewCommandSchema } from "../review/administration/undo-review";
import { ManualSchedulingCommandSchema } from "../review/administration/manual-scheduling";
import { AreaDetailsSchema } from "./area-management";
import { AreaSettingsSchema } from "./area-settings";
import { DeleteCardSchema, CardContentSchema, SaveCardSchema } from "./card-management";
export const WorkspaceAuthoringCommandSchema = Schema.Union(
  RestoreWorkspaceCheckpointSchema,
  RepairCollectionReferencesSchema,
  MediaMaintenanceCommandSchema,
  Schema.Struct({ kind: Schema.Literal("save-note"), ...SaveStudyNoteSchema.fields }),
  Schema.Struct({
    kind: Schema.Literal("resolve-study-settings"),
    choice: Schema.Literal("local", "remote"),
  }),
  ManualSchedulingCommandSchema,
  UndoReviewCommandSchema,
  RateFilteredCardSchema,
  ReplaceCardFieldsSchema,
  Schema.Struct({
    kind: Schema.Literal("update-scheduler-settings"),
    settings: SchedulerSettingsSchema,
  }),
  Schema.Struct({ kind: Schema.Literal("save-area"), ...AreaDetailsSchema.fields }),
  Schema.Struct({ kind: Schema.Literal("delete-area"), areaId: AreaIdSchema }),
  Schema.Struct({ kind: Schema.Literal("create-card"), ...SaveCardSchema.fields }),
  Schema.Struct({
    kind: Schema.Literal("create-cards"),
    areaId: AreaIdSchema,
    cards: Schema.Array(
      Schema.Struct({ cardId: AssessmentIdSchema, content: CardContentSchema }),
    ).pipe(Schema.minItems(1), Schema.maxItems(5)),
  }),
  Schema.Struct({ kind: Schema.Literal("update-card"), ...SaveCardSchema.fields }),
  Schema.Struct({ kind: Schema.Literal("delete-card"), ...DeleteCardSchema.fields }),
  Schema.Struct({
    kind: Schema.Literal("bulk-tag-cards"),
    areaId: AreaIdSchema,
    cardIds: Schema.Array(AssessmentIdSchema).pipe(Schema.minItems(1), Schema.maxItems(500)),
    tags: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("bulk-delete-cards"),
    areaId: AreaIdSchema,
    cardIds: Schema.Array(AssessmentIdSchema).pipe(Schema.minItems(1), Schema.maxItems(500)),
  }),
  Schema.Struct({
    kind: Schema.Literal("bulk-move-cards"),
    areaId: AreaIdSchema,
    targetAreaId: AreaIdSchema,
    cards: Schema.Array(
      Schema.Struct({ cardId: AssessmentIdSchema, newCardId: AssessmentIdSchema }),
    ).pipe(Schema.minItems(1), Schema.maxItems(500)),
  }),
  Schema.Struct({ kind: Schema.Literal("restore-card"), ...RestoreCardVersionSchema.fields }),
  Schema.Struct({
    kind: Schema.Literal("replace-card"),
    ...DeleteCardSchema.fields,
    cards: Schema.Array(
      Schema.Struct({ cardId: AssessmentIdSchema, content: CardContentSchema }),
    ).pipe(Schema.minItems(1), Schema.maxItems(5)),
  }),
  Schema.Struct({
    kind: Schema.Literal("update-area-settings"),
    areaId: AreaIdSchema,
    settings: AreaSettingsSchema,
  }),
);
export type WorkspaceAuthoringCommand = typeof WorkspaceAuthoringCommandSchema.Type;
