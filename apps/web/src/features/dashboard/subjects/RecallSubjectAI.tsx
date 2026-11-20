import { DashboardAgentHandover } from "./DashboardAgentHandover";
import type { ComponentProps, ReactNode } from "react";
import type { KnowledgeArea } from "@recall/domain";
import { LocalChatGPTTutor } from "@/components/tutor/connection/LocalChatGPTTutor";
import { KnowledgeNotebookPanel } from "@/components/tutor/notebook/KnowledgeNotebookPanel";
import type { ChatModelSelection } from "@/components/tutor/chat/ChatModelPicker";
import { RecallSubjectTutor } from "./RecallSubjectTutor";
import { DashboardView } from "../navigation/dashboard-navigation";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
type Props = {
  readonly model: RecallDashboardModel;
  readonly document: KnowledgeArea;
  readonly visible: boolean;
  readonly materialsActive: boolean;
  readonly onApprove: ComponentProps<typeof KnowledgeNotebookPanel>["onApprove"];
};
function SubjectAIContent({
  model,
  document,
  materialsActive,
  onApprove,
  api,
  sessionNamespace,
  modelSelection,
  unavailableReason,
  connectionPrompt,
}: Props & {
  readonly sessionNamespace: string;
  readonly modelSelection: ChatModelSelection | undefined;
  readonly unavailableReason: string | null;
  readonly connectionPrompt: ReactNode;
  readonly api: NonNullable<ComponentProps<typeof KnowledgeNotebookPanel>["api"]>;
}) {
  return (
    <>
      {model.activeView === DashboardView.Tutor && (
        <div className="flex min-h-0 flex-1 flex-col">
          <RecallSubjectTutor
            area={document}
            renderHandover={(history) => (
              <DashboardAgentHandover model={model} areaId={document.id} conversation={history} />
            )}
            conversationScope={`${model.workspace.syncOwnerId ?? "local"}:${sessionNamespace}`}
            modelSelection={modelSelection}
            api={api}
            disabled={model.reviewSaving || model.reviewSaveFailed || Boolean(unavailableReason)}
            unavailableReason={unavailableReason}
            connectionPrompt={connectionPrompt}
          />
        </div>
      )}
      {(model.activeView === DashboardView.Improve || materialsActive) && (
        <div
          hidden={model.activeView !== DashboardView.Improve && !materialsActive}
          className={
            materialsActive
              ? "space-y-5"
              : model.activeView === DashboardView.Improve
                ? "flex min-h-0 flex-1 flex-col"
                : "hidden"
          }
        >
          {connectionPrompt}
          <KnowledgeNotebookPanel
            key={materialsActive ? "materials" : "improve"}
            sessionOnly={!materialsActive}
            renderHandover={(history) => (
              <DashboardAgentHandover model={model} areaId={document.id} conversation={history} />
            )}
            experience="chat"
            modelSelection={modelSelection}
            aiUnavailableReason={unavailableReason}
            knowledgeArea={document}
            {...(model.searchTarget?.areaId === document.id
              ? { searchTarget: model.searchTarget.target }
              : {})}
            sessionNamespace={sessionNamespace}
            api={api}
            duplicateCandidates={model.duplicateCandidates}
            reviewEvents={model.workspace.reviewEvents ?? []}
            initialActivity={model.tutorActivity === "materials" ? "materials" : "practice"}
            demo={Boolean(model.demo)}
            activityOverride={materialsActive ? "materials" : undefined}
            onApprove={onApprove}
            onStartReview={() => {
              model.startPractice(document.id);
            }}
          />
        </div>
      )}
    </>
  );
}
export function RecallSubjectAI(props: Props) {
  return (
    <div
      hidden={!props.visible}
      className={
        !props.visible
          ? "hidden"
          : props.materialsActive
            ? "mx-auto w-full max-w-[1080px] px-4 py-7 sm:px-8"
            : "flex min-h-0 flex-1 flex-col"
      }
      inert={props.model.reviewSaving || props.model.reviewSaveFailed}
    >
      <LocalChatGPTTutor
        knowledgeArea={props.document}
        onApprove={props.onApprove}
        renderContent={(api, context) => (
          <SubjectAIContent
            key={`${context.sessionNamespace}:${props.model.workspace.syncOwnerId ?? "local"}`}
            {...props}
            api={api}
            sessionNamespace={context.sessionNamespace}
            modelSelection={context.modelSelection}
            unavailableReason={context.unavailableReason}
            connectionPrompt={context.connectionPrompt}
          />
        )}
      />
    </div>
  );
}
