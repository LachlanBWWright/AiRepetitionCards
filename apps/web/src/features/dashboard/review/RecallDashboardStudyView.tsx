import { Button } from "@/components/ui/Button";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";

function studyHeading(accountStatus: string, webAccountConfigured: boolean): string {
  if (accountStatus === "checking") return "Checking your account…";
  if (accountStatus === "signed-in") return "Loading your account workspace…";
  if (!webAccountConfigured || accountStatus === "unavailable")
    return "Sign in to access your cards";
  return "Sign in to access your cards";
}

export function RecallDashboardStudyView({ model }: { readonly model: RecallDashboardModel }) {
  const { accountStatus, webAccountConfigured, checkAccount } = model;
  return (
    <main className="mx-auto grid min-h-[60vh] w-full max-w-2xl content-center gap-4 px-4 py-12 sm:px-8">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">
          {studyHeading(accountStatus, webAccountConfigured)}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {accountStatus === "signed-in"
            ? "Your cards will appear here when the account workspace has loaded."
            : "Card creation, reading, and study require a signed-in account."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {accountStatus === "signed-out" && webAccountConfigured && (
            <Button asChild>
              <a href="/sign-in">Sign in</a>
            </Button>
          )}
          {accountStatus === "unavailable" && <Button onClick={checkAccount}>Retry</Button>}
        </div>
      </div>
    </main>
  );
}
