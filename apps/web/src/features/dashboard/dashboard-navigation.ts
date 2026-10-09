export const DashboardView = {
  Today: "Today",
  Library: "Explore",
  Tutor: "Tutor",
  Insights: "Insights",
} as const;

export type DashboardView = (typeof DashboardView)[keyof typeof DashboardView];

export const dashboardViewPaths: Readonly<Record<DashboardView, string>> = {
  [DashboardView.Today]: "/today",
  [DashboardView.Library]: "/library",
  [DashboardView.Tutor]: "/tutor",
  [DashboardView.Insights]: "/insights",
};

export function dashboardViewFromPath(path: string): DashboardView {
  const normalized = path.split("?")[0]?.replace(/\/$/, "") ?? "";
  switch (normalized) {
    case dashboardViewPaths[DashboardView.Library]:
      return DashboardView.Library;
    case dashboardViewPaths[DashboardView.Tutor]:
      return DashboardView.Tutor;
    case dashboardViewPaths[DashboardView.Insights]:
      return DashboardView.Insights;
    default:
      return DashboardView.Today;
  }
}

export const dashboardNavigationItems = [
  { view: DashboardView.Today, label: "Today", icon: "◷" },
  { view: DashboardView.Library, label: "Library", icon: "▤" },
  { view: DashboardView.Tutor, label: "Tutor", icon: "?" },
  { view: DashboardView.Insights, label: "Insights", icon: "↗" },
] as const satisfies readonly {
  readonly view: DashboardView;
  readonly label: string;
  readonly icon: string;
}[];

export const dashboardViewLabels: Readonly<Record<DashboardView, string>> = {
  [DashboardView.Today]: "Today",
  [DashboardView.Library]: "Library",
  [DashboardView.Tutor]: "Tutor",
  [DashboardView.Insights]: "Insights",
};
