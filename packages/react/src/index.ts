"use client";

export {
  useDeckUpdate,
  type DeckUpdateProps,
  type DeckUpdateChoice,
} from "./decks/use-deck-update";
export { useLibraryNotes } from "./workspace/use-library-notes";
export {
  useLearningActivities,
  type LearningActivitiesProps,
} from "./activities/use-learning-activities";
export {
  useStudyCommand,
  adaptStudyCommandSave,
  type StudyCommandSave,
  type StudyCommandPromiseSave,
} from "./study/use-study-command";
export { useFilteredStudy } from "./study/use-filtered-study";
export { useStudyPresets } from "./study/use-study-presets";
export { useReviewTiming } from "./study/use-review-timing";
export { useSchedulingSteps } from "./study/use-scheduling-steps";
export { useManualScheduling } from "./study/use-manual-scheduling";
export { useCramPractice } from "./study/use-cram-practice";

export { useStudyPlanner } from "./study/use-study-planner";

export { useCardBrowser } from "./study/use-card-browser";
export { useTypedAnswer } from "./review/use-typed-answer";
export { useCardSpeech } from "./review/use-card-speech";
export { useTodayStudyLimits } from "./study/use-today-study-limits";

export { useNoteAuthoring, type NoteAuthoringModel } from "./notes/use-note-authoring";

export { useCollectionHealth } from "./study/use-collection-health";
export { useSpeechVoices } from "./review/use-speech-voices";

export type {
  NoteAuthoringProps,
  NoteAuthoringSave,
  NoteDraftPort,
} from "./notes/note-authoring-ports";
export { createNoteDraftPort } from "./notes/create-note-draft-port";

export { useReviewerControls } from "./review/use-reviewer-controls";

export { useParameterFitting } from "./study/use-parameter-fitting";

export { useWorkspaceRecovery } from "./study/use-workspace-recovery";

export { useSubjectTutor } from "./tutor/use-subject-tutor";

export { useReviewRepair } from "./tutor/use-review-repair";
export * from "./study/use-equation-editor";
export {
  useCodingActivity,
  type CodingActivityOptions,
} from "./activities/coding/use-coding-activity";

export { useLuaActivity, type LuaActivityWorkspaceProps } from "./activities/lua/use-lua-activity";
export { useLuaAuthoringPreview } from "./activities/lua/use-lua-authoring-preview";

export { useAiFunding, type AiFundingPorts } from "./tutor/use-ai-funding";

export { useAgentHandover } from "./interchange/use-agent-handover";
export type {
  AgentHandoverProps,
  AgentTransferPorts,
  AgentHandoverModel,
} from "./interchange/use-agent-handover";
