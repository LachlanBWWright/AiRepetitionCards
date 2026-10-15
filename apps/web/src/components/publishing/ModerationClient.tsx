"use client";

import { useMemo } from "react";
import { OperatorModerationPanel } from "./OperatorModerationPanel";
import { createBrowserDeckSharingApi } from "@/lib/deck-sharing-api";

export function ModerationClient() {
  const api = useMemo(() => createBrowserDeckSharingApi(), []);
  return <OperatorModerationPanel api={api} />;
}
