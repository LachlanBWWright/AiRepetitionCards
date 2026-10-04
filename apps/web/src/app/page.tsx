import { OfflineAvailability } from "../../pwa/offline-availability";
import RecallDashboard from "@/features/dashboard/RecallDashboard";

export default function Home() {
  return (
    <>
      <OfflineAvailability />
      <RecallDashboard />
    </>
  );
}
