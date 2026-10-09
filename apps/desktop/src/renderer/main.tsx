import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import DesktopDashboardRoutes from "./DesktopDashboardRoutes";
import { AppUiProvider } from "@/components/ui/AppUiProvider";
import "@/app/globals.css";

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <AppUiProvider>
        <DesktopDashboardRoutes />
      </AppUiProvider>
    </StrictMode>,
  );
