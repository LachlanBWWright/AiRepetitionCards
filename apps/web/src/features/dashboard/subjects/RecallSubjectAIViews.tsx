import { type ComponentProps } from "react";
import { Effect, Either } from "effect";
import { RecallSubjectAI } from "./RecallSubjectAI";
import { KnowledgeNotebookPanel } from "@/components/tutor/notebook/KnowledgeNotebookPanel";
import { toKnowledgeArea } from "@/features/workspace/knowledge-area-json";
import { DashboardView } from "../navigation/dashboard-navigation";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";

type Approve = ComponentProps<typeof KnowledgeNotebookPanel>["onApprove"];
export function RecallSubjectAIViews({
  model,
  onApprove,
}: {
  readonly model: RecallDashboardModel;
  readonly onApprove: (
    ...args: [...Parameters<Approve>, targetAreaId?: string]
  ) => ReturnType<Approve>;
}) {
  const materialsActive =
    model.activeView === DashboardView.Library &&
    model.libraryDeckOpen &&
    model.subjectSection === "materials";
  const aiActive =
    materialsActive ||
    model.activeView === DashboardView.Tutor ||
    model.activeView === DashboardView.Improve;
  return (
    <>
      {model.workspace.areas
        .filter((area) => aiActive && area.id === model.area?.id)
        .map((area) => {
          const document = Effect.runSync(Effect.either(toKnowledgeArea(area, true, true)));
          if (Either.isLeft(document))
            return (
              <p key={area.id} hidden={!aiActive || model.area?.id !== area.id}>
                This subject has invalid content. Check its cards and settings before using AI.
              </p>
            );
          const visible = aiActive && model.area?.id === area.id;
          const approve: Approve = (...args) => onApprove(...args, area.id);
          return (
            <RecallSubjectAI
              key={area.id}
              model={model}
              document={document.right}
              visible={visible}
              materialsActive={materialsActive}
              onApprove={approve}
            />
          );
        })}
    </>
  );
}
