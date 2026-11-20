export type ConfirmationOptions = {
  readonly title?: string;
  readonly confirmLabel?: string;
  readonly variant?: "default" | "destructive";
};
export type DashboardConfirmation = ConfirmationOptions & {
  readonly description: string;
  readonly onConfirm: () => unknown;
  readonly onCancel?: () => void;
};
