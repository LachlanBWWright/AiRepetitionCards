import type { ComponentProps, ReactNode } from "react";
import type { KnowledgeArea } from "@recall/domain";
import { Button } from "@/components/ui/Button";
import { Alert } from "@recall/ui-web";
import { KnowledgeAreaReceivePanel } from "../updates/KnowledgeAreaReceivePanel";

type Props = {
  readonly embedded: boolean;
  readonly area: KnowledgeArea | null | undefined;
  readonly busy: boolean;
  readonly forkConflict: boolean;
  readonly publicationConflict: boolean;
  readonly notice: string | null;
  readonly publishForm: ReactNode;
  readonly receivePanelProps: ComponentProps<typeof KnowledgeAreaReceivePanel>;
  readonly startNewForkAttempt: () => void;
  readonly startNewPublicationAttempt: () => void;
};

export function KnowledgeAreaPublishingView({
  embedded,
  area,
  busy,
  forkConflict,
  publicationConflict,
  notice,
  publishForm,
  receivePanelProps,
  startNewForkAttempt,
  startNewPublicationAttempt,
}: Props) {
  const hasErrorNotice =
    notice !== null &&
    /could not|couldn't|failed|failure|unavailable|not added|not published|not saved|choose/i.test(
      notice,
    );
  return (
    <section
      className={
        embedded
          ? "w-full"
          : "mx-auto mt-12 w-full max-w-5xl rounded-xl border bg-card p-5 shadow-sm sm:p-8"
      }
      aria-labelledby="publication-title"
    >
      {!embedded && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            SHARE KNOWLEDGE
          </p>
          <h2 className="text-xl font-semibold tracking-tight" id="publication-title">
            Publish or receive an area
          </h2>
          <p>Shared content has no personal schedules or review history.</p>
        </div>
      )}
      <div
        className={
          embedded ? "grid grid-cols-1 gap-6" : "mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2"
        }
      >
        {area && publishForm}
        <KnowledgeAreaReceivePanel {...receivePanelProps} />
      </div>
      {forkConflict && (
        <Button type="button" disabled={busy} onClick={startNewForkAttempt}>
          Start a new copy attempt
        </Button>
      )}
      {publicationConflict && area ? (
        <Button type="button" disabled={busy} onClick={startNewPublicationAttempt}>
          Start a new publication attempt
        </Button>
      ) : null}
      {notice && (
        <Alert
          className="mt-4"
          role={hasErrorNotice ? "alert" : "status"}
          variant={hasErrorNotice ? "destructive" : "default"}
        >
          {notice}
        </Alert>
      )}
    </section>
  );
}
