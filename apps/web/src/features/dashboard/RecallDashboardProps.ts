import { type DashboardView as DashboardViewValue } from "@/features/dashboard/navigation/dashboard-navigation";
import { type StoryDemo } from "@/features/dashboard/layout/RecallDashboardSupport";
export type RecallDashboardProps = {
  readonly demo?: StoryDemo;
  readonly sharedRequest?: { readonly versionId: string; readonly token?: string };
  readonly routeView?: DashboardViewValue;
  readonly onViewChange?: (
    view: DashboardViewValue,
    areaId?: string,
    activity?: "materials" | "import" | "flagged",
  ) => void;
  readonly initialAreaId?: string | undefined;
  readonly initialActivityId?: string | undefined;
  readonly onActivityChange?: (areaId: string, activityId: string) => void;
  readonly onOpenDeckPage?: (deckId?: string, token?: string) => void;
  readonly initialTutorActivity?: "materials" | undefined;
  readonly initialImport?: boolean;
  readonly initialFlaggedOnly?: boolean;
  readonly practiceId?: string | undefined;
  readonly onPracticeChange?: (id: string) => void;
};
