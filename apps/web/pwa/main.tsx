import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import RecallDashboard from "@/features/dashboard/RecallDashboard";
import { ServiceWorkerRegistration } from "./service-worker-registration";
import { AppUiProvider } from "@/components/ui/AppUiProvider";
import "@/app/globals.css";

const root = document.getElementById("root");

if (root)
  createRoot(root).render(
    <StrictMode>
      <AppUiProvider>
        <ServiceWorkerRegistration />
        <RecallDashboard />
      </AppUiProvider>
    </StrictMode>,
  );
