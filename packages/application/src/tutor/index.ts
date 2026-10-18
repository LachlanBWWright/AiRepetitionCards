export { createTutorApi, tutorApiFailureMessage } from "./transport/tutor-api";

export type {
  TutorApiFailure,
  TutorHttpRequest,
  TutorHttpResponse,
  TutorTransport,
  TutorTransportError,
} from "./transport/tutor-api";

export * from "./transport/tutor-privacy";

export {
  executeTutorWorkflow,
  prepareTutorWorkflow,
  resolveTutorWorkflowProposal,
  validateTutorProposalResolution,
  type PreparedTutorWorkflow,
  type TutorWorkflowFailure,
  type TutorWorkflowProvider,
  type TutorWorkflowSnapshot,
  type TutorWorkflowTransition,
} from "./workflow/tutor-workflow";

export {
  prepareTutorCardApproval,
  persistTutorCardApproval,
  type TutorApprovalFailure,
} from "./proposals/tutor-approval";

export { tutorAreaFingerprint } from "./transport/tutor-context-transport";

export {
  accumulateTutorObservations,
  selectTutorQuizObjective,
  type TutorEvidenceFailure,
} from "./workflow/tutor-objective-selection";

export { createCardAssistanceTutor } from "./proposals/card-assistance-tutor";

export { applyNotebookRefinement } from "./proposals/card-refinement";

export { importTutorProposal } from "./proposals/tutor-proposal-import";

export { createLocalTutorApi } from "./workflow/local-tutor-api";

export type { LocalTutorPorts, LocalTutorInference } from "./workflow/local-tutor-api";

export * from "./transport/tutor-budget-transport";

export { askSubjectTutor, type SubjectDialogue } from "./chat/subject-tutor";

export {
  improvementMessages,
  improvementOpening,
  sendImprovementMessage,
  type ImprovementMessage,
} from "./chat/improvement-chat";

export { DEFAULT_TUTOR_MODEL, selectTutorModel } from "./chat/tutor-model-selection";
