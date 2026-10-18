import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";
import { Button } from "@recall/ui-web";
import { ChevronDown } from "lucide-react";
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
  research,
  modelSelection,
  unavailableReason,
}: Props & {
  readonly sessionNamespace: string;
  readonly research: ReactNode;
  readonly modelSelection: ChatModelSelection | undefined;
  readonly unavailableReason: string | null;
  readonly api: NonNullable<ComponentProps<typeof KnowledgeNotebookPanel>["api"]>;
}) {
  return (
    <>
      {model.activeView === DashboardView.Tutor && (
        <div className="flex min-h-0 flex-1 flex-col">
          <RecallSubjectTutor
            area={document}
            modelSelection={modelSelection}
            api={api}
            disabled={model.reviewSaving || model.reviewSaveFailed || Boolean(unavailableReason)}
            unavailableReason={unavailableReason}
            tools={research ? <ChatResearch>{research}</ChatResearch> : undefined}
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
          <KnowledgeNotebookPanel
            key={materialsActive ? "materials" : "improve"}
            sessionOnly={!materialsActive}
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
            key={context.sessionNamespace}
            {...props}
            api={api}
            sessionNamespace={context.sessionNamespace}
            research={context.research}
            modelSelection={context.modelSelection}
            unavailableReason={context.unavailableReason}
          />
        )}
      />
    </div>
  );
}

function ChatResearch({ children }: { readonly children: ReactNode }) {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="link" className="h-auto p-0 text-xs text-muted-foreground">
          Research tools
          <ChevronDown aria-hidden="true" className="size-3" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}
