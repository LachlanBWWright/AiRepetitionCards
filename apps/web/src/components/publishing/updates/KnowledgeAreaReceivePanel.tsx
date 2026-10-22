import { areaMediaReferences } from "@recall/application";
import { Effect } from "effect";
import type { KnowledgeArea } from "@recall/domain";
import type { PublishedMediaGateway, PublishingApi, KnowledgeAreaDiff } from "@recall/application";
import type { StoredMediaAsset } from "@recall/local-store";
import { Button } from "@/components/ui/Button";
import { Input } from "@recall/ui-web";
import { Alert } from "@recall/ui-web";
import { KnowledgeAreaDiffView } from "./KnowledgeAreaDiffView";
import { DeckUpdatePanel } from "./DeckUpdatePanel";
import type { UpstreamUpdateState } from "../releases/KnowledgeAreaPublishingTypes";

type Publication = {
  readonly versionId: string;
  readonly token: string | null;
  readonly document: KnowledgeArea;
  readonly attribution: string | null;
  readonly license: string | null;
};
type Props = {
  readonly embedded: boolean;
  readonly upstreamArea: KnowledgeArea | null;
  readonly busy: boolean;
  readonly checkUpstreamUpdates: () => Promise<void>;
  readonly upstreamUpdate: UpstreamUpdateState | null;
  readonly setBusy: (busy: boolean) => void;
  readonly setToken: (token: string) => void;
  readonly readPreview: (request: {
    readonly versionId: string;
    readonly token?: string;
  }) => Effect.Effect<void>;
  readonly versionId: string;
  readonly token: string;
  readonly setVersionId: (value: string) => void;
  readonly receive: () => Promise<void>;
  readonly publication: Publication | null;
  readonly lineageArea: KnowledgeArea | undefined;
  readonly comparison: KnowledgeAreaDiff | null;
  readonly comparisonFailed: boolean;
  readonly area: KnowledgeArea | null | undefined;
  readonly onUpdate:
    | ((
        area: KnowledgeArea,
        versionId: string,
        advanceBaseline: boolean,
        assets: readonly StoredMediaAsset[],
      ) => Promise<boolean>)
    | undefined;
  readonly transport: PublishingApi;
  readonly mediaGateway: PublishedMediaGateway;
  readonly fork: () => Promise<void>;
};

function attachmentCount(area: KnowledgeArea): number {
  return areaMediaReferences(area).length;
}

function upstreamUpdateMessage(update: UpstreamUpdateState): string {
  switch (update.status) {
    case "available":
      return "A newer public version is available. Review its differences before adding a separate copy.";
    case "no-public-update":
      return "No newer public version is available.";
    case "unavailable":
      return "No accessible public source is available. Ask the author for a share link to review another version.";
    case "failed":
      return "Updates could not be checked. Try again when connected.";
  }
}

export function KnowledgeAreaReceivePanel({
  embedded,
  upstreamArea,
  busy,
  checkUpstreamUpdates,
  upstreamUpdate,
  setBusy,
  setToken,
  readPreview,
  versionId,
  token,
  setVersionId,
  receive,
  publication,
  lineageArea,
  comparison,
  comparisonFailed,
  area,
  onUpdate,
  transport,
  mediaGateway,
  fork,
}: Props) {
  const updateHasError =
    upstreamUpdate?.status === "failed" || upstreamUpdate?.status === "unavailable";

  return (
    <div
      className={`${embedded ? "border-t pt-5" : "rounded-xl border p-5 "}flex flex-col items-stretch gap-3 [&>label]:grid [&>label]:gap-2 [&>label]:text-sm [&>label]:font-semibold`}
    >
      <h3 className="text-base font-semibold">Receive a shared area</h3>
      {upstreamArea && (
        <div
          className={embedded ? "mt-2 border-t pt-4" : "mt-2 rounded-xl bg-muted/50 p-4"}
          aria-label="Upstream updates"
        >
          <p className="mb-0 text-sm font-semibold">Upstream updates</p>
          <p>
            Check for newer public versions of the original area. Your copy and review history stay
            unchanged until you choose a separate copy.
          </p>
          <Button type="button" disabled={busy} onClick={() => void checkUpstreamUpdates()}>
            {busy ? "Checking…" : "Check upstream updates"}
          </Button>
          {upstreamUpdate && (
            <Alert
              role={updateHasError ? "alert" : "status"}
              variant={updateHasError ? "destructive" : "default"}
            >
              {upstreamUpdateMessage(upstreamUpdate)}
            </Alert>
          )}
          {upstreamUpdate?.status === "available" && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setToken("");
                Effect.runFork(readPreview({ versionId: upstreamUpdate.versionId }));
              }}
            >
              Review available version
            </Button>
          )}
        </div>
      )}

      <label>
        Version ID
        <Input
          value={versionId}
          onChange={(event) => {
            setVersionId(event.currentTarget.value);
          }}
          placeholder="Paste a shared version ID"
        />
      </label>
      <label>
        Access token <span className="font-normal text-muted-foreground">if required</span>
        <Input
          value={token}
          onChange={(event) => {
            setToken(event.currentTarget.value);
          }}
          placeholder="Paste link token"
        />
      </label>
      <Button type="button" disabled={busy || !versionId.trim()} onClick={() => void receive()}>
        Preview shared area
      </Button>
      {publication && (
        <div className={embedded ? "mt-2 border-t pt-4" : "mt-2 rounded-xl bg-muted/50 p-4"}>
          <p className="mb-0 text-sm font-semibold">Shared area details</p>
          <h4 className="text-base font-semibold">{publication.document.title}</h4>
          <p className="text-sm text-muted-foreground">
            {publication.document.description || "No description provided."}
          </p>
          <dl className="my-4 grid gap-2">
            <div className="flex justify-between gap-4 text-sm">
              <dt className="text-muted-foreground">Attribution</dt>
              <dd className="m-0 text-right font-semibold">
                {publication.attribution || "Not provided"}
              </dd>
            </div>
            <div className="flex justify-between gap-4 text-sm">
              <dt className="text-muted-foreground">License</dt>
              <dd className="m-0 text-right font-semibold">
                {publication.license || "Not provided"}
              </dd>
            </div>
            <div className="flex justify-between gap-4 text-sm">
              <dt className="text-muted-foreground">Cards</dt>
              <dd className="m-0 text-right font-semibold">{publication.document.cards.length}</dd>
            </div>
            <div className="flex justify-between gap-4 text-sm">
              <dt className="text-muted-foreground">Attachments</dt>
              <dd className="m-0 text-right font-semibold">
                {attachmentCount(publication.document)}
              </dd>
            </div>
          </dl>
          {comparison && (
            <KnowledgeAreaDiffView
              comparison={comparison}
              baseline={lineageArea}
              candidate={publication.document}
            />
          )}
          {comparisonFailed && (
            <Alert variant="destructive">
              The shared version loaded, but its differences could not be compared.
            </Alert>
          )}
          {onUpdate &&
            area?.forkedFromVersionId &&
            area.sourceId === publication.document.id &&
            area.forkedFromVersionId !== publication.versionId && (
              <DeckUpdatePanel
                key={`${area.id}:${publication.versionId}`}
                current={area}
                upstream={publication.document}
                versionId={publication.versionId}
                {...(publication.token ? { token: publication.token } : {})}
                publishing={transport}
                media={mediaGateway}
                createId={() => crypto.randomUUID()}
                onSave={onUpdate}
              />
            )}
          <Button className="self-start" type="button" disabled={busy} onClick={() => void fork()}>
            Add a personal copy
          </Button>
        </div>
      )}
    </div>
  );
}
