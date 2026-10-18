import { DashboardView } from "@/features/dashboard/navigation/dashboard-navigation";
import { Button } from "@/components/ui/Button";
import { Plus } from "lucide-react";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
export function RecallDashboardLibraryToolbar({ model }: { readonly model: RecallDashboardModel }) {
  const {
    activeView,
    libraryDeckOpen,
    area,
    setActiveView,
    addCard,
    generateCards,
    addArea,
    setLibraryTools,
    setImportExportOpen,
    setReviewSettingsOpen,
  } = model;
  function openImport() {
    setLibraryTools("import");
    setImportExportOpen(true);
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 space-y-2">
        {activeView === DashboardView.Library && libraryDeckOpen && area && (
          <Button
            variant="link"
            className="h-auto p-0 text-sm text-muted-foreground"
            onClick={() => {
              setActiveView(DashboardView.Library);
            }}
          >
            Home / Subjects
          </Button>
        )}
        <h1 className="break-words text-3xl font-semibold tracking-tight">
          {activeView === DashboardView.Library
            ? libraryDeckOpen && area
              ? area.title
              : "Library"
            : "Workspace data"}
        </h1>
        {activeView === DashboardView.Library && !libraryDeckOpen && (
          <p className="text-sm text-muted-foreground">Choose a subject to manage its cards.</p>
        )}
      </div>
      {activeView === DashboardView.Library && (
        <div className="flex flex-wrap items-center gap-2">
          {libraryDeckOpen && area ? (
            <>
              <Button onClick={addCard}>
                <Plus aria-hidden="true" />
                Add card
              </Button>
              <Button variant="secondary" onClick={generateCards}>
                Generate cards
              </Button>
            </>
          ) : (
            <>
              <Button onClick={addArea}>
                <Plus aria-hidden="true" />
                New subject
              </Button>
              <Button variant="secondary" onClick={openImport}>
                Import cards
              </Button>
            </>
          )}
        </div>
      )}
      {activeView === DashboardView.Insights && (
        <Button
          variant="secondary"
          onClick={() => {
            setReviewSettingsOpen(true);
          }}
        >
          Review settings
        </Button>
      )}
    </div>
  );
}
