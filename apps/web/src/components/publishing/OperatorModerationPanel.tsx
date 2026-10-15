"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Effect } from "effect";
import type { DeckSharingApi } from "@recall/application";
import type { ModerationReport } from "@recall/contracts";
import { Button } from "@/components/ui/Button";
import { Alert, Textarea } from "@recall/ui-web";

type Props = { readonly api: DeckSharingApi };
type DeckVisibility = "visible" | "hidden";
type Notice = { readonly kind: "error" | "success"; readonly message: string };

const run = <A,>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(Effect.either(effect));
const statusOf = (error: unknown): number | null =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  typeof error.status === "number"
    ? error.status
    : null;
const errorMessage = (error: unknown): string => {
  const status = statusOf(error);
  return status === 403
    ? "Operator access is unavailable for this account. The server rejected the request."
    : status === 401
      ? "Sign in to use moderation."
      : status === null
        ? "The moderation service could not be reached. Try again."
        : `The moderation request failed (${status}). Try again.`;
};

export function OperatorModerationPanel({ api }: Props) {
  const [reports, setReports] = useState<readonly ModerationReport[]>([]);
  const [visibility, setVisibility] = useState<ReadonlyMap<string, DeckVisibility>>(new Map());
  const [reasons, setReasons] = useState<ReadonlyMap<string, string>>(new Map());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  const sequence = useRef(0);

  const load = useCallback(
    async (initial = false) => {
      if (busy.current) return;
      const request = ++sequence.current;
      if (initial) setLoading(true);
      const result = await run(api.listModerationReports());
      if (!mounted.current || sequence.current !== request) return;
      if (result._tag === "Left") setNotice({ kind: "error", message: errorMessage(result.left) });
      else {
        setReports(result.right.reports);
        setNotice(null);
      }
      setBusyId(null);
      if (initial) setLoading(false);
    },
    [api],
  );

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load(true);
    });
    return () => {
      active = false;
      mounted.current = false;
      sequence.current += 1;
      busy.current = false;
    };
  }, [load]);

  const runMutation = async (
    id: string,
    operation: () => ReturnType<typeof run>,
    apply: () => void,
  ) => {
    if (busy.current || !mounted.current) return;
    busy.current = true;
    const request = ++sequence.current;
    setBusyId(id);
    setNotice(null);
    const result = await operation();
    if (!mounted.current || sequence.current !== request) return;
    if (result._tag === "Left") setNotice({ kind: "error", message: errorMessage(result.left) });
    else {
      apply();
      setNotice({ kind: "success", message: "Moderation change saved." });
    }
    if (mounted.current && sequence.current === request) {
      busy.current = false;
      setBusyId(null);
    }
  };

  const updateReport = (report: ModerationReport, status: "open" | "resolved") =>
    runMutation(
      report.id,
      () => run(api.updateModerationReport(report.id, { status })),
      () =>
        setReports((current) =>
          current.map((item) => (item.id === report.id ? { ...item, status } : item)),
        ),
    );

  const updateDeck = (report: ModerationReport, status: DeckVisibility) => {
    const reason = (reasons.get(report.deckId) ?? "").trim();
    if (!reason) {
      setNotice({ kind: "error", message: "Add a reason before changing deck visibility." });
      return;
    }
    void runMutation(
      report.deckId,
      () => run(api.moderateDeck(report.deckId, { status, reason })),
      () => setVisibility((current) => new Map(current).set(report.deckId, status)),
    );
  };

  const openReports = reports.filter((report) => report.status === "open").length;
  return (
    <section
      className="mx-auto grid w-full max-w-5xl gap-5 px-4 py-8 sm:px-8"
      aria-label="Operator moderation queue"
    >
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold">Deck moderation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {openReports} open reports · access is checked by the server.
          </p>
        </div>
        <Button variant="outline" disabled={busyId !== null} onClick={() => void load()}>
          Refresh queue
        </Button>
      </header>
      {notice && (
        <Alert variant={notice.kind === "error" ? "destructive" : "default"}>
          {notice.message}
        </Alert>
      )}
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading moderation queue…
        </p>
      ) : reports.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          No reports are available.
        </p>
      ) : (
        <div className="grid gap-4">
          {reports.map((report) => {
            const deckStatus = visibility.get(report.deckId) ?? null;
            return (
              <article key={report.id} className="grid gap-3 rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{report.title}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {report.reason} · {report.status} · version {report.versionId} ·{" "}
                      {new Date(report.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">Deck {report.deckId}</span>
                </div>
                <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm">
                  {report.message}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={busyId !== null}
                    onClick={() =>
                      void updateReport(report, report.status === "open" ? "resolved" : "open")
                    }
                  >
                    {busyId === report.id
                      ? "Saving…"
                      : report.status === "open"
                        ? "Resolve report"
                        : "Reopen report"}
                  </Button>
                </div>
                <div className="grid gap-2 border-t pt-3 sm:grid-cols-[1fr_auto]">
                  <div className="grid gap-2">
                    <p className="text-xs text-muted-foreground">
                      {deckStatus
                        ? `Last action: ${deckStatus}`
                        : "Visibility status is not included in the report queue."}
                    </p>
                    <Textarea
                      aria-label={`Moderation reason for ${report.title}`}
                      maxLength={2000}
                      placeholder="Reason for hiding or restoring this deck"
                      value={reasons.get(report.deckId) ?? ""}
                      onChange={(event) =>
                        setReasons((current) =>
                          new Map(current).set(report.deckId, event.currentTarget.value),
                        )
                      }
                    />
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    <Button
                      variant="outline"
                      disabled={busyId !== null || !(reasons.get(report.deckId) ?? "").trim()}
                      onClick={() => updateDeck(report, "hidden")}
                    >
                      {busyId === report.deckId ? "Saving…" : "Hide deck"}
                    </Button>
                    <Button
                      disabled={busyId !== null || !(reasons.get(report.deckId) ?? "").trim()}
                      onClick={() => updateDeck(report, "visible")}
                    >
                      {busyId === report.deckId ? "Saving…" : "Restore deck"}
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
