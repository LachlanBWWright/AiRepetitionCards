"use client";

import type { ReactNode } from "react";
import { Alert } from "@recall/ui-web";
import type { DeckSharingNotice } from "./DeckSharingPanelTypes";

type Props = {
  readonly filters: ReactNode;
  readonly results: ReactNode;
  readonly notice: DeckSharingNotice | null;
};

export function DeckSharingPanelBrowse({ filters, results, notice }: Props) {
  return (
    <div className="grid content-start gap-4">
      {filters}
      {notice ? (
        <Alert variant={notice.kind === "error" ? "destructive" : "default"}>
          {notice.message}
        </Alert>
      ) : null}
      {results}
    </div>
  );
}
