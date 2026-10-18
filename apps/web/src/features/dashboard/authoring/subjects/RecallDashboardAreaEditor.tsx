import { RecallDashboardAreaEditorDialog } from "@/features/dashboard/authoring/subjects/RecallDashboardAreaEditorDialog";
import { dashboardColors as colors } from "@/features/dashboard/layout/RecallDashboardSupport";
import type { RecallDashboardModel } from "../../state/useRecallDashboardController";
export function RecallDashboardAreaEditor({ model }: { readonly model: RecallDashboardModel }) {
  const {
    addingArea,
    workspaceUnlocked,
    requestDraftClose,
    libraryMutation,
    editingAreaId,
    areaEditorError,
    areaDraftStale,
    workspaceRef,
    requestConfirmation,
    editArea,
    createArea,
    areaTitle,
    setAreaTitle,
    areaColor,
    setAreaColor,
  } = model;
  return (
    <RecallDashboardAreaEditorDialog
      open={addingArea && workspaceUnlocked}
      onOpenChange={(open) => {
        if (!open) requestDraftClose("area");
      }}
      busy={libraryMutation === "area-save"}
      interactionsDisabled={libraryMutation !== null}
      editing={Boolean(editingAreaId)}
      error={areaEditorError}
      stale={areaDraftStale}
      onReopenLatest={() => {
        const latest = workspaceRef.current.areas.find((item) => item.id === editingAreaId);
        if (latest)
          requestConfirmation(
            "Replace this draft with the latest saved area name and color? Copy any text you want to keep first.",
            () => {
              editArea(latest);
            },
          );
      }}
      onSubmit={(event) => {
        void createArea(event);
      }}
      title={areaTitle}
      onTitleChange={setAreaTitle}
      color={areaColor}
      onColorChange={setAreaColor}
      colors={colors}
      onCancel={() => {
        requestDraftClose("area");
      }}
    />
  );
}
