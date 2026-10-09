"use client";

import { useCallback, useEffect, useState } from "react";
import { Effect, Either, Fiber, Schema } from "effect";
import {
  diffKnowledgeAreas,
  verifyMediaAsset,
  pendingPublicationForkOperation,
  pendingPublicationOperation,
  type PublicationOperationStore,
  publicationNeedsReuseConfirmation,
  publicationFailureMessage,
  type PublicationForkOperationStore,
  type KnowledgeAreaDiff,
  type PublishedMediaGateway,
  type PublishingApi,
} from "@recall/application";
import { PublicationVisibilitySchema } from "@recall/contracts";
import type { KnowledgeArea } from "@recall/domain";
import type { MediaStore, StoredMediaAsset } from "@recall/local-store";
import { browserMediaStore } from "@/features/workspace/browser-media-store";
import { publishedMediaGateway } from "@/features/workspace/published-media-api";
import { publishingApi } from "@/lib/publishing-api";
import { isDesktopRuntime } from "@/lib/desktop-api";
import { KnowledgeAreaDiffView } from "./KnowledgeAreaDiffView";
import { browserForkOperationStore } from "@/lib/publishing/fork-operation-store";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web";
import { Alert, toast } from "@recall/ui-web";

import {
  browserPublicationOperationStore,
  createPublicationShareToken,
} from "@/lib/publishing/publication-operation-store";

type UpstreamUpdateState =
  | { readonly status: "available"; readonly versionId: string }
  | { readonly status: "no-public-update" | "unavailable" | "failed" };

type Props = {
  readonly area?: KnowledgeArea | null;
  readonly embedded?: boolean;
  readonly initialUpstreamUpdate?: UpstreamUpdateState;
  readonly initialRequest?: { readonly versionId: string; readonly token?: string };
  readonly lineageArea?: KnowledgeArea;
  readonly onFork: (
    document: KnowledgeArea,
    attribution: string | null,
    license: string | null,
    forkedFromVersionId: string,
    contentHash: string,
    assets: readonly StoredMediaAsset[],
  ) => boolean | Promise<boolean>;
  readonly forkOperationStore?: PublicationForkOperationStore;
  readonly createForkOperationId?: () => string;
  readonly publicationOperationStore?: PublicationOperationStore;
  readonly createPublishShareToken?: () => string;
  readonly initialPublishRecovery?: "pending" | "conflict";
  readonly initialForkRecovery?: "local-save-failure";
  readonly transport?: PublishingApi;
  readonly mediaGateway?: PublishedMediaGateway;
  readonly mediaStore?: MediaStore;
  readonly initialPublication?: {
    readonly versionId: string;
    readonly token: string | null;
    readonly owner?: boolean;
    readonly visibility?: "private" | "unlisted" | "public";
    readonly document: KnowledgeArea;
    readonly attribution: string | null;
    readonly license: string | null;
  };
};

export function KnowledgeAreaPublishing({
  area,
  embedded = false,
  lineageArea,
  onFork,
  transport = publishingApi,
  mediaGateway = publishedMediaGateway,
  mediaStore = browserMediaStore,
  initialPublication,
  initialRequest,
  forkOperationStore = browserForkOperationStore,
  createForkOperationId = () => crypto.randomUUID(),
  publicationOperationStore = browserPublicationOperationStore,
  createPublishShareToken = createPublicationShareToken,
  initialPublishRecovery,
  initialForkRecovery,
  initialUpstreamUpdate,
}: Props) {
  const upstreamArea = lineageArea?.forkedFromVersionId
    ? lineageArea
    : area?.forkedFromVersionId
      ? area
      : null;
  const [upstreamRecord, setUpstreamRecord] = useState<{
    readonly sourceVersionId: string | null;
    readonly value: UpstreamUpdateState | null;
  }>({
    sourceVersionId: upstreamArea?.forkedFromVersionId ?? null,
    value: initialUpstreamUpdate ?? null,
  });
  const upstreamUpdate =
    upstreamRecord.sourceVersionId === (upstreamArea?.forkedFromVersionId ?? null)
      ? upstreamRecord.value
      : null;
  const setUpstreamUpdate = (value: UpstreamUpdateState) =>
    setUpstreamRecord({ sourceVersionId: upstreamArea?.forkedFromVersionId ?? null, value });
  const [visibility, setVisibility] = useState<"private" | "unlisted" | "public">("unlisted");
  const [attribution, setAttribution] = useState(area?.attribution ?? "");
  const [license, setLicense] = useState(area?.licence ?? "");
  const [reuseConfirmed, setReuseConfirmed] = useState(false);
  const needsReuseConfirmation = area ? publicationNeedsReuseConfirmation(area, license) : true;
  const [versionId, setVersionId] = useState(
    initialRequest?.versionId ?? initialPublication?.versionId ?? "",
  );
  const [token, setToken] = useState(initialRequest?.token ?? initialPublication?.token ?? "");
  const [shareToken, setShareToken] = useState(initialPublication?.token ?? null);
  const [publishedVersionId, setPublishedVersionId] = useState(
    initialPublication?.owner ? initialPublication.versionId : "",
  );
  const [publishedVisibility, setPublishedVisibility] = useState<"private" | "unlisted" | "public">(
    initialPublication?.visibility ?? "unlisted",
  );
  const [ownsPublication, setOwnsPublication] = useState(initialPublication?.owner ?? false);
  const [publication, setPublication] = useState<{
    readonly versionId: string;
    readonly token: string | null;
    readonly document: KnowledgeArea;
    readonly attribution: string | null;
    readonly license: string | null;
  } | null>(initialPublication ?? null);
  const [notice, setNotice] = useState<string | null>(
    initialForkRecovery === "local-save-failure"
      ? "Your cloud copy is saved, but its cards and attachments could not be saved on this device. Retry to recover the same copy."
      : initialPublishRecovery === "conflict"
        ? "This draft differs from a pending publication. Restore that draft to retry, or start a new publication attempt; the earlier attempt may already be published."
        : initialPublishRecovery === "pending"
          ? "The publication response was interrupted. Retry the saved attempt to recover its existing version."
          : null,
  );
  const [forkConflict, setForkConflict] = useState(false);
  const [publicationConflict, setPublicationConflict] = useState(
    initialPublishRecovery === "conflict",
  );
  const initialComparison =
    lineageArea?.forkedFromVersionId && initialPublication
      ? Effect.runSync(
          Effect.either(
            diffKnowledgeAreas({
              baseline: lineageArea,
              candidate: initialPublication.document,
            }),
          ),
        )
      : null;
  const [comparison, setComparison] = useState<KnowledgeAreaDiff | null>(
    initialComparison && Either.isRight(initialComparison) ? initialComparison.right : null,
  );
  const [comparisonFailed, setComparisonFailed] = useState(false);
  const [busy, setBusy] = useState(Boolean(initialRequest));
  const sharePath =
    publishedVersionId &&
    (publishedVisibility === "public" || (publishedVisibility === "unlisted" && shareToken))
      ? `/shared/${encodeURIComponent(publishedVersionId)}${publishedVisibility === "unlisted" && shareToken ? `?token=${encodeURIComponent(shareToken)}` : ""}`
      : null;
  const [shareOrigin, setShareOrigin] = useState<string | null>(null);
  useEffect(() => {
    const origin = isDesktopRuntime() ? process.env.RECALL_API_URL : window.location.origin;
    if (!origin) return;
    const fiber = Effect.runFork(
      Effect.try({
        try: () => new URL(origin),
        catch: () => ({ _tag: "InvalidShareOrigin" }) as const,
      }).pipe(
        Effect.either,
        Effect.map((parsed) => {
          setShareOrigin(
            Either.isRight(parsed) && ["http:", "https:"].includes(parsed.right.protocol)
              ? parsed.right.origin
              : null,
          );
        }),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, []);
  const shareUrl = sharePath && shareOrigin ? `${shareOrigin}${sharePath}` : null;

  const readPreview = useCallback(
    (request: { readonly versionId: string; readonly token?: string }) =>
      transport.read(request.versionId, request.token).pipe(
        Effect.either,
        Effect.map((result) => {
          setComparison(null);
          setComparisonFailed(false);
          if (Either.isLeft(result)) {
            setPublication(null);
            setNotice(
              "Could not load this shared Knowledge Area. Check the link and access token.",
            );
          } else {
            const received = result.right.version;
            if (upstreamArea) {
              const compared = Effect.runSync(
                Effect.either(
                  diffKnowledgeAreas({ baseline: upstreamArea, candidate: received.content }),
                ),
              );
              if (Either.isRight(compared)) setComparison(compared.right);
              else setComparisonFailed(true);
            }
            setVersionId(received.id);
            setPublication({
              versionId: received.id,
              token: request.token ?? null,
              document: received.content,
              attribution: received.attribution,
              license: received.license,
            });
            setNotice(
              upstreamArea
                ? "Review this version and its differences before adding a personal copy."
                : "Review the source and license before adding your own copy.",
            );
          }
          setBusy(false);
        }),
      ),
    [transport, upstreamArea],
  );

  const initialVersionId = initialRequest?.versionId;
  const initialToken = initialRequest?.token;
  useEffect(() => {
    if (!initialVersionId) return;
    const fiber = Effect.runFork(
      readPreview({
        versionId: initialVersionId,
        ...(initialToken ? { token: initialToken } : {}),
      }),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [initialVersionId, initialToken, readPreview]);

  async function copyShareLink(): Promise<void> {
    if (!shareUrl) return;
    const copied = await Effect.runPromise(
      Effect.either(
        Effect.suspend(() => {
          if (!navigator.clipboard) return Effect.fail({ _tag: "ClipboardFailure" } as const);
          return Effect.tryPromise({
            try: () => navigator.clipboard.writeText(shareUrl),
            catch: () => ({ _tag: "ClipboardFailure" }) as const,
          });
        }),
      ),
    );
    if (Either.isRight(copied)) {
      setNotice(null);
      toast.success("Share link copied.");
    } else setNotice("Could not copy the link. Select and copy the link below.");
  }

  async function checkUpstreamUpdates(): Promise<void> {
    const sourceVersionId = upstreamArea?.forkedFromVersionId;
    const api = transport;
    if (!sourceVersionId || !api) {
      setUpstreamUpdate({ status: "unavailable" });
      return;
    }
    setBusy(true);
    const result = await Effect.runPromise(
      Effect.either(api.checkUpdates({ versionId: sourceVersionId })),
    );
    if (Either.isLeft(result)) {
      const unavailable =
        result.left._tag === "PublishingApiFailure" &&
        result.left.reason === "http" &&
        [401, 403, 404].includes(result.left.status);
      setUpstreamUpdate({ status: unavailable ? "unavailable" : "failed" });
    } else {
      const update = result.right.latestPublicVersion;
      setUpstreamUpdate(
        update ? { status: "available", versionId: update.id } : { status: "no-public-update" },
      );
    }
    setBusy(false);
  }

  async function publish(): Promise<void> {
    if (!area) return;
    if (
      visibility !== "private" &&
      (!license.trim() || (needsReuseConfirmation && !reuseConfirmed))
    ) {
      setNotice("Choose a license and confirm you have permission to share this content.");
      return;
    }
    setBusy(true);
    setNotice(null);
    const references = [
      ...new Map(
        area.cards.flatMap((card) => card.media ?? []).map((item) => [item.id, item]),
      ).values(),
    ];
    for (const reference of references) {
      const local = await Effect.runPromise(Effect.either(mediaStore.get(reference.id)));
      if (Either.isLeft(local) || !local.right || !verifyMediaAsset(local.right)) {
        setNotice(
          "An attachment is missing or failed integrity validation. The area was not published.",
        );
        setBusy(false);
        return;
      }
      const uploaded = await Effect.runPromise(Effect.either(mediaGateway.upload(local.right)));
      if (Either.isLeft(uploaded)) {
        setNotice("An attachment could not be uploaded. The area was not published.");
        setBusy(false);
        return;
      }
    }
    const pending = await Effect.runPromise(
      Effect.either(
        pendingPublicationOperation(
          publicationOperationStore,
          {
            sourceAreaId: area.id,
            content: area,
            visibility,
            attribution: attribution.trim() || null,
            license: license.trim() || null,
            forkedFromVersionId: area.forkedFromVersionId ?? null,
            reuseConfirmed,
          },
          createForkOperationId,
          createPublishShareToken,
        ),
      ),
    );
    if (Either.isLeft(pending)) {
      setPublicationConflict(pending.left.reason === "conflict");
      setNotice(
        pending.left.reason === "conflict"
          ? "This draft differs from a pending publication. Restore that draft to retry, or start a new publication attempt; the earlier attempt may already be published."
          : "The pending publication could not be saved. Restore local storage before retrying.",
      );
      setBusy(false);
      return;
    }
    const result = await Effect.runPromise(Effect.either(transport.publish(pending.right)));
    if (Either.isLeft(result)) {
      setPublicationConflict(
        result.left._tag === "PublishingApiFailure" &&
          result.left.reason === "http" &&
          result.left.code === "publication-operation-conflict",
      );
      setNotice(publicationFailureMessage(result.left));
    } else {
      setVersionId(result.right.version.id);
      setToken(result.right.shareToken ?? "");
      setShareToken(result.right.shareToken ?? null);
      setOwnsPublication(true);
      setPublishedVersionId(result.right.version.id);
      setPublishedVisibility(result.right.version.visibility ?? visibility);
      const cleared = await Effect.runPromise(
        Effect.either(publicationOperationStore.clear(area.id)),
      );
      setPublicationConflict(false);
      setNotice(
        Either.isRight(cleared)
          ? "Knowledge Area published. Its study history remains private."
          : "Published, but the pending attempt could not be cleared. Retrying recovers this version.",
      );
    }
    setBusy(false);
  }

  async function manageShareToken(action: "rotate" | "revoke"): Promise<void> {
    if (!publishedVersionId || !ownsPublication) return;
    setBusy(true);
    setNotice(null);
    const result = await Effect.runPromise(
      Effect.either(transport.manageShareToken(publishedVersionId, action)),
    );
    if (Either.isLeft(result)) {
      setNotice(
        action === "rotate"
          ? "Could not rotate the share link."
          : "Could not revoke the share link.",
      );
    } else {
      const nextToken = result.right.token;
      setShareToken(nextToken);
      setToken(nextToken ?? "");
      setNotice(
        nextToken
          ? "A new share link is active. Previous links no longer work."
          : "The share link was revoked.",
      );
    }
    setBusy(false);
  }

  async function receive(): Promise<void> {
    if (!versionId.trim()) return;
    setBusy(true);
    setNotice(null);
    await Effect.runPromise(
      readPreview({
        versionId: versionId.trim(),
        ...(token.trim() ? { token: token.trim() } : {}),
      }),
    );
  }

  async function fork(): Promise<void> {
    if (!publication) return;
    setBusy(true);
    setNotice(null);
    const operation = await Effect.runPromise(
      Effect.either(
        pendingPublicationForkOperation(
          forkOperationStore,
          publication.versionId,
          createForkOperationId,
        ),
      ),
    );
    if (Either.isLeft(operation)) {
      setNotice("The pending copy could not be saved. Restore local storage before retrying.");
      setBusy(false);
      return;
    }
    const result = await Effect.runPromise(
      Effect.either(
        transport.fork(publication.versionId, operation.right, publication.token ?? undefined),
      ),
    );
    if (Either.isLeft(result)) {
      setNotice(
        result.left._tag === "PublishingApiFailure" &&
          result.left.reason === "http" &&
          result.left.status === 401
          ? "Sign in to add a personal copy, then return to this shared area."
          : "Could not create a personal copy of this Knowledge Area.",
      );
      setForkConflict(
        result.left._tag === "PublishingApiFailure" &&
          result.left.reason === "http" &&
          result.left.code === "fork-operation-conflict",
      );
    } else {
      const references = [
        ...new Map(
          result.right.document.cards
            .flatMap((card) => card.media ?? [])
            .map((item) => [item.id, item]),
        ).values(),
      ];
      const assets: StoredMediaAsset[] = [];
      for (const reference of references) {
        const downloaded = await Effect.runPromise(
          Effect.either(
            mediaGateway.read(publication.versionId, reference, publication.token ?? undefined),
          ),
        );
        if (
          Either.isLeft(downloaded) ||
          !downloaded.right ||
          !verifyMediaAsset(downloaded.right) ||
          downloaded.right.reference.id !== reference.id ||
          downloaded.right.reference.mimeType !== reference.mimeType ||
          downloaded.right.reference.byteLength !== reference.byteLength
        ) {
          setNotice("A shared attachment could not be verified. The personal copy was not added.");
          setBusy(false);
          return;
        }
        assets.push(downloaded.right);
      }
      const copied = await onFork(
        result.right.document,
        result.right.attribution,
        result.right.license,
        result.right.forkedFromVersionId,
        result.right.contentHash,
        assets,
      );
      const cleared = copied
        ? await Effect.runPromise(Effect.either(forkOperationStore.clear(publication.versionId)))
        : null;
      setNotice(
        copied
          ? cleared && Either.isLeft(cleared)
            ? "Your copy was added. Its pending operation could not be cleared; retrying will reopen the same copy."
            : "A personal copy was added. Its review schedule starts fresh."
          : "Your cloud copy is saved, but its cards and attachments could not be saved on this device. Retry to recover the same copy.",
      );
    }
    setBusy(false);
  }

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
        {area && (
          <form
            className={`${embedded ? "" : "rounded-xl border p-5 "}flex flex-col items-stretch gap-3 [&>label]:grid [&>label]:gap-2 [&>label]:text-sm [&>label]:font-semibold`}
            onSubmit={(event) => {
              event.preventDefault();
              void publish();
            }}
          >
            <h3 className="text-base font-semibold">Publish “{area.title}”</h3>
            <label>
              Visibility
              <Select
                value={visibility}
                onValueChange={(value) =>
                  setVisibility(
                    Schema.decodeUnknownEither(PublicationVisibilitySchema)(value).pipe(
                      Either.getOrElse(() => "unlisted" as const),
                    ),
                  )
                }
              >
                <SelectTrigger aria-label="Visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unlisted">Unlisted · link access</SelectItem>
                  <SelectItem value="private">Private · account only</SelectItem>
                  <SelectItem value="public">Public access</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label>
              Attribution
              <Input
                value={attribution}
                onChange={(event) => setAttribution(event.currentTarget.value)}
                placeholder="Your name or source"
                maxLength={200}
              />
            </label>
            <label>
              License
              <Select
                value={license || "none"}
                onValueChange={(value) => {
                  setLicense(value === "none" ? "" : value);
                  setReuseConfirmed(false);
                }}
              >
                <SelectTrigger aria-label="License">
                  <SelectValue placeholder="Choose a license" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Choose a license</SelectItem>
                  {license &&
                    !["CC BY 4.0", "CC BY-SA 4.0", "CC0 1.0", "All rights reserved"].includes(
                      license,
                    ) && <SelectItem value={license}>{license}</SelectItem>}
                  <SelectItem value="CC BY 4.0">CC BY 4.0</SelectItem>
                  <SelectItem value="CC BY-SA 4.0">CC BY-SA 4.0</SelectItem>
                  <SelectItem value="CC0 1.0">CC0 1.0</SelectItem>
                  <SelectItem value="All rights reserved">All rights reserved</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {visibility !== "private" && needsReuseConfirmation && (
              <label htmlFor="publication-reuse-confirmed">
                <Checkbox
                  id="publication-reuse-confirmed"
                  checked={reuseConfirmed}
                  onCheckedChange={(checked) => setReuseConfirmed(checked === true)}
                />{" "}
                I own this content or have permission to share it under the selected license.
              </label>
            )}
            <Button
              className="self-start"
              type="submit"
              disabled={
                busy ||
                (visibility !== "private" &&
                  (!license.trim() || (needsReuseConfirmation && !reuseConfirmed)))
              }
            >
              Publish area
            </Button>
            {shareUrl && (
              <div
                className={
                  embedded
                    ? "grid gap-2 border-t pt-4"
                    : "grid gap-2 rounded-xl border bg-muted/40 p-4"
                }
              >
                <p>{publishedVisibility === "public" ? "Public access" : "Share link"}</p>
                <a
                  className="[overflow-wrap:anywhere] text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  href={shareUrl}
                >
                  {shareUrl}
                </a>
                <Button type="button" onClick={() => void copyShareLink()}>
                  Copy link
                </Button>
              </div>
            )}
            {sharePath && !shareOrigin && (
              <p>Configure the web server URL to create a share link.</p>
            )}
            {ownsPublication && publishedVersionId && publishedVisibility === "unlisted" && (
              <div
                className={
                  embedded
                    ? "grid gap-2 border-t pt-4"
                    : "grid gap-2 rounded-xl border bg-muted/40 p-4"
                }
                aria-live="polite"
              >
                <p className="mb-0 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  UNLISTED LINK ACCESS
                </p>
                {shareToken ? (
                  <>
                    <p>Anyone with the share link can open this area.</p>
                    <div className="flex flex-wrap gap-3">
                      <Button
                        type="button"
                        disabled={busy}
                        onClick={() => void manageShareToken("rotate")}
                      >
                        Rotate link
                      </Button>
                      <Button
                        type="button"
                        disabled={busy}
                        onClick={() => void manageShareToken("revoke")}
                      >
                        Revoke link
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p>This unlisted area has no active share link.</p>
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => void manageShareToken("rotate")}
                    >
                      Create share link
                    </Button>
                  </>
                )}
              </div>
            )}
          </form>
        )}
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
                Check for newer public versions of the original area. Your copy and review history
                stay unchanged until you choose a separate copy.
              </p>
              <Button type="button" disabled={busy} onClick={() => void checkUpstreamUpdates()}>
                {busy ? "Checking…" : "Check upstream updates"}
              </Button>
              {upstreamUpdate && (
                <Alert
                  role={
                    upstreamUpdate.status === "failed" || upstreamUpdate.status === "unavailable"
                      ? "alert"
                      : "status"
                  }
                  variant={
                    upstreamUpdate.status === "failed" || upstreamUpdate.status === "unavailable"
                      ? "destructive"
                      : "default"
                  }
                >
                  {upstreamUpdate.status === "available"
                    ? "A newer public version is available. Review its differences before adding a separate copy."
                    : upstreamUpdate.status === "no-public-update"
                      ? "No newer public version is available."
                      : upstreamUpdate.status === "unavailable"
                        ? "No accessible public source is available. Ask the author for a share link to review another version."
                        : "Updates could not be checked. Try again when connected."}
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
              onChange={(event) => setVersionId(event.currentTarget.value)}
              placeholder="Paste a shared version ID"
            />
          </label>
          <label>
            Access token <span className="font-normal text-muted-foreground">if required</span>
            <Input
              value={token}
              onChange={(event) => setToken(event.currentTarget.value)}
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
                  <dd className="m-0 text-right font-semibold">
                    {publication.document.cards.length}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 text-sm">
                  <dt className="text-muted-foreground">Attachments</dt>
                  <dd className="m-0 text-right font-semibold">
                    {
                      new Set(
                        publication.document.cards.flatMap((card) =>
                          (card.media ?? []).map((reference) => reference.id),
                        ),
                      ).size
                    }
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
              <Button
                className="self-start"
                type="button"
                disabled={busy}
                onClick={() => void fork()}
              >
                Add a personal copy
              </Button>
            </div>
          )}
        </div>
      </div>
      {forkConflict && publication && (
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            Effect.runFork(
              forkOperationStore.clear(publication.versionId).pipe(
                Effect.match({
                  onFailure: () =>
                    setNotice(
                      "The pending copy could not be cleared. Restore local storage before retrying.",
                    ),
                  onSuccess: () => {
                    setForkConflict(false);
                    setNotice(
                      "The previous copy attempt was cleared. Add a personal copy to start a new operation.",
                    );
                  },
                }),
              ),
            );
          }}
        >
          Start a new copy attempt
        </Button>
      )}
      {publicationConflict && area ? (
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            Effect.runFork(
              publicationOperationStore.clear(area.id).pipe(
                Effect.match({
                  onFailure: () => setNotice("Could not clear the pending attempt."),
                  onSuccess: () => {
                    setPublicationConflict(false);
                    setNotice(
                      "A new publication attempt is ready. The earlier attempt may already exist.",
                    );
                  },
                }),
              ),
            );
          }}
        >
          Start a new publication attempt
        </Button>
      ) : null}
      {notice && (
        <Alert
          className="mt-4"
          role={
            /could not|couldn't|failed|failure|unavailable|not added|not published|not saved|choose/i.test(
              notice,
            )
              ? "alert"
              : "status"
          }
          variant={
            /could not|couldn't|failed|failure|unavailable|not added|not published|not saved|choose/i.test(
              notice,
            )
              ? "destructive"
              : "default"
          }
        >
          {notice}
        </Alert>
      )}
    </section>
  );
}
