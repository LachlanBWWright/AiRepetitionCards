export const DashboardView = {
  Today: "Today",
  Library: "Explore",
  Tutor: "Tutor",
  Insights: "Insights",
  Improve: "Improve",
} as const;

export type DashboardView = (typeof DashboardView)[keyof typeof DashboardView];

export const dashboardViewPaths: Readonly<Record<DashboardView, string>> = {
  [DashboardView.Today]: "/subjects",
  [DashboardView.Library]: "/subjects?mode=overview",
  [DashboardView.Tutor]: "/subjects?mode=tutor",
  [DashboardView.Improve]: "/subjects?mode=improve",
  [DashboardView.Insights]: "/insights",
};

export function dashboardViewFromPath(path: string): DashboardView {
  const normalized = path.split("?")[0]?.replace(/\/$/, "") ?? "";
  const query = new URLSearchParams(path.split("?")[1]);
  if (normalized === "/subjects") {
    if (query.get("mode") === "review") return DashboardView.Today;
    if (query.get("mode") === "tutor") return DashboardView.Tutor;
    if (query.get("mode") === "improve") return DashboardView.Improve;
    return query.has("area") ? DashboardView.Library : DashboardView.Today;
  }
  switch (normalized) {
    case "/library":
      return DashboardView.Library;
    case "/tutor":
      return DashboardView.Tutor;
    case "/insights":
      return DashboardView.Insights;
    default:
      return DashboardView.Today;
  }
}

export const dashboardNavigationItems = [
  { view: DashboardView.Today, label: "Home", icon: "◷" },
] as const;

export const dashboardViewLabels: Readonly<Record<DashboardView, string>> = {
  [DashboardView.Today]: "Home",
  [DashboardView.Library]: "Overview",
  [DashboardView.Tutor]: "Tutor",
  [DashboardView.Improve]: "Improve",
  [DashboardView.Insights]: "Progress",
};
