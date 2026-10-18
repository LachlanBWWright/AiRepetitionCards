import type { ReactNode } from "react";
import type { LearningArea } from "@recall/domain";

export type NativeWorkspaceCardLibraryProps = {
  readonly area: LearningArea | undefined;
  readonly header: ReactNode;
  readonly filters: ReactNode;
  readonly bulkActions: ReactNode;
  readonly cardRows: ReactNode;
  readonly emptyState: ReactNode;
};

export function NativeWorkspaceCardLibrary({
  area,
  header,
  filters,
  bulkActions,
  cardRows,
  emptyState,
}: NativeWorkspaceCardLibraryProps) {
  if (!area) return null;

  return (
    <>
      {header}
      {filters}
      {bulkActions}
      {cardRows}
      {emptyState}
    </>
  );
}
