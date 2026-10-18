import type { ReactNode } from "react";

type Props = {
  readonly cardSaving: boolean;
  readonly children: ReactNode;
};

export function RecallDashboardCardEditorFields({ cardSaving, children }: Props) {
  return (
    <fieldset
      disabled={cardSaving}
      className="grid gap-3"
      style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
    >
      {children}
    </fieldset>
  );
}
