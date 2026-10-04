import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import RecallDashboard from "@/features/dashboard/RecallDashboard";
import { OfflineAvailability } from "./offline-availability";
import "@/app/globals.css";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <OfflineAvailability />
      <RecallDashboard />
    </StrictMode>,
  );
