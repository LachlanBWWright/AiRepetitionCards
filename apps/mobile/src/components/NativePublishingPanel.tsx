import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { Effect, Either } from "effect";
import { designTokens } from "@recall/design-tokens";
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
import type { KnowledgeArea } from "@recall/domain";
import type { MediaStore, StoredMediaAsset } from "@recall/local-store";

const palette = designTokens.color;

type UpstreamUpdateState =
  | { readonly status: "available"; readonly versionId: string }
  | { readonly status: "no-public-update" | "unavailable" | "failed" };

export function NativePublishingPanel({
  area,
  lineageArea,
  mediaStore,
  onFork,
  clients,
  initialPublication,
  initialVersionId,
  initialUpstreamUpdate,
  forkOperationStore,
  createForkOperationId,
  publicationOperationStore,
  createPublishShareToken,
}: {
  readonly area: KnowledgeArea | null;
  readonly initialUpstreamUpdate?: UpstreamUpdateState;
  readonly lineageArea?: KnowledgeArea | null;
  readonly mediaStore: MediaStore | null;
  readonly onFork: (
    document: KnowledgeArea,
    attribution: string | null,
    license: string | null,
    sourceVersionId: string,
    contentHash: string,
    assets: readonly StoredMediaAsset[],
  ) => Promise<boolean>;
  readonly clients?: { readonly publishing: PublishingApi; readonly media: PublishedMediaGateway };
  readonly initialPublication?: {
    readonly document: KnowledgeArea;
    readonly attribution: string | null;
    readonly license: string | null;
  } | null;
  readonly initialVersionId?: string;
  readonly forkOperationStore: PublicationForkOperationStore;
  readonly createForkOperationId: () => string;
  readonly publicationOperationStore: PublicationOperationStore;
  readonly createPublishShareToken: () => string;
}) {
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
  const [mode, setMode] = useState<"publish" | "receive">(
    initialPublication ? "receive" : "publish",
  );
  const [visibility, setVisibility] = useState<"private" | "unlisted" | "public">("unlisted");
  const [attribution, setAttribution] = useState(area?.attribution ?? "");
  const [license, setLicense] = useState(area?.licence ?? "");
  const [reuseConfirmed, setReuseConfirmed] = useState(false);
  const needsReuseConfirmation = area ? publicationNeedsReuseConfirmation(area, license) : true;
  const [versionId, setVersionId] = useState(initialVersionId ?? "");
  const [token, setToken] = useState("");
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [publication, setPublication] = useState<{
    readonly versionId: string;
    readonly token: string | null;
    readonly document: KnowledgeArea;
    readonly attribution: string | null;
    readonly license: string | null;
  } | null>(
    initialPublication
      ? { ...initialPublication, versionId: initialVersionId ?? "", token: null }
      : null,
  );
  const [comparison, setComparison] = useState<KnowledgeAreaDiff | null>(() => {
    if (!initialPublication || !lineageArea?.forkedFromVersionId) return null;
    const compared = Effect.runSync(
      Effect.either(
        diffKnowledgeAreas({
          baseline: lineageArea,
          candidate: initialPublication.document,
        }),
      ),
    );
    return Either.isRight(compared) ? compared.right : null;
  });
  const [comparisonFailed, setComparisonFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [forkConflict, setForkConflict] = useState(false);
  const [publicationConflict, setPublicationConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  async function checkUpstreamUpdates(): Promise<void> {
    const sourceVersionId = upstreamArea?.forkedFromVersionId;
    const api = clients?.publishing;
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

  async function publish() {
    if (!area || !mediaStore) return;
    if (
      visibility !== "private" &&
      (!license.trim() || (needsReuseConfirmation && !reuseConfirmed))
    ) {
      setNotice("Choose a license and confirm you have permission to share this content.");
      return;
    }
    const api = clients;
    if (!api) {
      setNotice("Sign in and configure the Recall API before publishing.");
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
      const stored = await Effect.runPromise(Effect.either(mediaStore.get(reference.id)));
      if (Either.isLeft(stored) || !stored.right || !verifyMediaAsset(stored.right)) {
        setNotice(
          "An attachment is missing or failed integrity validation. The area was not published.",
        );
        setBusy(false);
        return;
      }
      const uploaded = await Effect.runPromise(Effect.either(api.media.upload(stored.right)));
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
    const result = await Effect.runPromise(Effect.either(api.publishing.publish(pending.right)));
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
      const cleared = await Effect.runPromise(
        Effect.either(publicationOperationStore.clear(area.id)),
      );
      setPublicationConflict(false);
      setNotice(
        Either.isRight(cleared)
          ? "Published."
          : "Published, but the pending attempt could not be cleared. Retrying recovers this version.",
      );
    }
    setBusy(false);
  }

  async function receive(exactVersionId?: string) {
    const api = clients;
    if (!api || !(exactVersionId ?? versionId.trim())) return;
    setBusy(true);
    setNotice(null);
    setComparison(null);
    setComparisonFailed(false);
    const result = await Effect.runPromise(
      Effect.either(
        api.publishing.read(
          exactVersionId ?? versionId.trim(),
          exactVersionId ? undefined : token.trim() || undefined,
        ),
      ),
    );
    if (Either.isLeft(result)) {
      setPublication(null);
      setNotice("Could not load this shared Knowledge Area.");
    } else {
      if (upstreamArea) {
        const compared = Effect.runSync(
          Effect.either(
            diffKnowledgeAreas({
              baseline: upstreamArea,
              candidate: result.right.version.content,
            }),
          ),
        );
        if (Either.isRight(compared)) setComparison(compared.right);
        else setComparisonFailed(true);
      }
      setPublication({
        versionId: result.right.version.id,
        token: exactVersionId ? null : token.trim() || null,
        document: result.right.version.content,
        attribution: result.right.version.attribution,
        license: result.right.version.license,
      });
      setVersionId(result.right.version.id);
      setNotice(
        upstreamArea
          ? "Review this version and its differences before adding a personal copy."
          : "Review the source and license before adding your own copy.",
      );
    }
    setBusy(false);
  }

  async function fork() {
    const api = clients;
    if (!api || !mediaStore || !publication) return;
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
        api.publishing.fork(publication.versionId, operation.right, publication.token ?? undefined),
      ),
    );
    if (Either.isLeft(result)) {
      setNotice("Could not create a personal copy of this Knowledge Area.");
      setForkConflict(
        result.left._tag === "PublishingApiFailure" &&
          result.left.reason === "http" &&
          result.left.code === "fork-operation-conflict",
      );
      setBusy(false);
      return;
    }
    const document = result.right.document;
    const references = [
      ...new Map(
        document.cards.flatMap((card) => card.media ?? []).map((item) => [item.id, item]),
      ).values(),
    ];
    const assets: StoredMediaAsset[] = [];
    for (const reference of references) {
      const downloaded = await Effect.runPromise(
        Effect.either(
          api.media.read(publication.versionId, reference, publication.token ?? undefined),
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
        setNotice(
          "A shared attachment could not be verified. The personal copy was not added locally.",
        );
        setBusy(false);
        return;
      }
      assets.push(downloaded.right);
    }
    const copied = await onFork(
      document,
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
          ? "Your copy was added. Retrying will reopen the same copy because its pending operation could not be cleared."
          : "Copy added with a fresh review schedule."
        : "Your cloud copy is saved, but its cards and attachments could not be saved on this device. Retry to recover the same copy.",
    );
    setBusy(false);
  }

  if (!clients)
    return (
      <View
        className={"gap-[9px] py-[16px] border-t border-t-recall-line"}
        testID="native-publishing-panel"
      >
        <Text className={"text-recall-ink text-[17px] font-bold"}>Share files</Text>
        <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
          Import or export an area in Account. Shared area files exclude your review history and
          schedules.
        </Text>
      </View>
    );
  return (
    <View
      className={"gap-[9px] py-[16px] border-t border-t-recall-line"}
      testID="native-publishing-panel"
    >
      <View className={"flex-row gap-[8px]"}>
        {(["publish", "receive"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === value, disabled: busy }}
            disabled={busy}
            onPress={() => setMode(value)}
            className={`flex-1 min-h-[44px] items-center justify-center border-b border-recall-line ${mode === value ? "border-b-2 border-b-recall-darkGreen" : ""}`}
          >
            <Text className={"text-recall-darkGreen text-[12px] font-bold capitalize"}>
              {value === "publish" ? "Publish" : "Receive"}
            </Text>
          </Pressable>
        ))}
      </View>
      {mode === "publish" && (
        <>
          <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
            Only content is shared. Your review history and schedule stay private.
          </Text>
          <Text className={"text-recall-ink text-[14px] font-bold mt-[4px]"}>
            Publish {area ? `“${area.title}”` : "an area"}
          </Text>
          <View className={"flex-row gap-[8px]"}>
            {(["unlisted", "public", "private"] as const).map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ selected: visibility === item }}
                onPress={() => setVisibility(item)}
                className={`flex-1 items-center py-[9px] rounded-[9px] bg-recall-paper ${visibility === item ? "bg-recall-green" : ""}`}
              >
                <Text className={"text-recall-darkGreen text-[12px] font-bold capitalize"}>
                  {item}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
            {visibility === "public"
              ? "Anyone can find and view this area."
              : visibility === "unlisted"
                ? "Anyone with the share token can view this area."
                : "Only your account can view this area."}
          </Text>
          <TextInput
            accessibilityLabel="Attribution"
            onChangeText={setAttribution}
            placeholder="Attribution (optional)"
            placeholderTextColor={palette.muted}
            maxLength={200}
            className={"min-h-[42px] px-[12px] rounded-[9px] bg-recall-paper text-recall-ink"}
            value={attribution}
          />
          <TextInput
            accessibilityLabel="License"
            onChangeText={(value) => {
              setLicense(value);
              setReuseConfirmed(false);
            }}
            placeholder="Choose a license explicitly"
            placeholderTextColor={palette.muted}
            maxLength={120}
            className={"min-h-[42px] px-[12px] rounded-[9px] bg-recall-paper text-recall-ink"}
            value={license}
          />
          {visibility !== "private" && needsReuseConfirmation && (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: reuseConfirmed }}
              onPress={() => setReuseConfirmed(!reuseConfirmed)}
              className={"flex-1 items-center py-[9px] rounded-[9px] bg-recall-paper"}
            >
              <Text>
                {reuseConfirmed ? "☑" : "☐"} I own this content or have permission to share it under
                the selected license.
              </Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={
              busy ||
              !area ||
              !mediaStore ||
              (visibility !== "private" &&
                (!license.trim() || (needsReuseConfirmation && !reuseConfirmed)))
            }
            onPress={() => void publish()}
            className={
              "min-h-[42px] justify-center items-center px-[14px] rounded-[9px] bg-recall-darkGreen"
            }
          >
            {busy ? (
              <ActivityIndicator color={palette.surface} />
            ) : (
              <Text className={"text-recall-surface font-bold text-[12px]"}>Publish area</Text>
            )}
          </Pressable>
          {versionId ? (
            <Text selectable className={"text-recall-muted text-[12px] leading-[18px]"}>
              Version: {versionId}
              {shareToken ? `\nShare token: ${shareToken}` : ""}
            </Text>
          ) : null}
        </>
      )}
      {upstreamArea && (
        <View
          className={"gap-[10px] py-[14px] border-t border-recall-line"}
          accessibilityLabel="Upstream updates"
        >
          <Text className={"text-recall-ink text-[14px] font-bold mt-[4px]"}>
            Updates to your copy
          </Text>
          <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
            Review a newer version before adding it as a separate copy.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void checkUpstreamUpdates()}
            className={"min-h-[40px] justify-center items-center border-b border-recall-line"}
          >
            <Text className={"text-recall-darkGreen font-bold text-[12px]"}>Check for updates</Text>
          </Pressable>
          {upstreamUpdate && (
            <Text
              accessibilityLiveRegion="polite"
              className={"text-recall-muted text-[12px] leading-[18px]"}
            >
              {upstreamUpdate.status === "available"
                ? "A newer public version is available. Review its differences before adding a separate copy."
                : upstreamUpdate.status === "no-public-update"
                  ? "No newer public version is available."
                  : upstreamUpdate.status === "unavailable"
                    ? "No accessible public source is available. Ask the author for a share link to review another version."
                    : "Updates could not be checked. Try again when connected."}
            </Text>
          )}
          {upstreamUpdate?.status === "available" && (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                setToken("");
                setMode("receive");
                void receive(upstreamUpdate.versionId);
              }}
              className={"min-h-[40px] justify-center items-center border-b border-recall-line"}
            >
              <Text className={"text-recall-darkGreen font-bold text-[12px]"}>
                Review available version
              </Text>
            </Pressable>
          )}
        </View>
      )}
      {mode === "receive" && (
        <>
          <Text className={"text-recall-ink text-[14px] font-bold mt-[4px]"}>Receive an area</Text>
          <TextInput
            accessibilityLabel="Publication version ID"
            autoCapitalize="none"
            onChangeText={setVersionId}
            placeholder="Paste a version ID"
            placeholderTextColor={palette.muted}
            className={"min-h-[42px] px-[12px] rounded-[9px] bg-recall-paper text-recall-ink"}
            value={versionId}
          />
          <TextInput
            accessibilityLabel="Share token"
            autoCapitalize="none"
            onChangeText={setToken}
            placeholder="Share token, if required"
            placeholderTextColor={palette.muted}
            className={"min-h-[42px] px-[12px] rounded-[9px] bg-recall-paper text-recall-ink"}
            value={token}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || !versionId.trim()}
            onPress={() => void receive()}
            className={"min-h-[40px] justify-center items-center border-b border-recall-line"}
          >
            <Text className={"text-recall-darkGreen font-bold text-[12px]"}>
              Preview shared area
            </Text>
          </Pressable>
          {publication ? (
            <View className={"gap-[10px] py-[14px] border-t border-recall-line"}>
              <Text className={"text-recall-ink text-[14px] font-bold mt-[4px]"}>
                {publication.document.title}
              </Text>
              {publication.document.description ? (
                <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
                  {publication.document.description}
                </Text>
              ) : null}
              <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
                Attribution: {publication.attribution || "Not provided"} · License:{" "}
                {publication.license || "Not provided"}
              </Text>
              <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
                {publication.document.cards.length} cards
              </Text>
              {comparison ? (
                <View
                  accessibilityLabel="Upstream version comparison"
                  className={"gap-[6px] py-[10px] border-t border-recall-line"}
                >
                  <Text className={"text-recall-ink text-[14px] font-bold mt-[4px]"}>
                    Changes from your copy
                  </Text>
                  <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
                    Cards: +{comparison.cards.added.length} · ~{comparison.cards.changed.length} · −
                    {comparison.cards.removed.length}
                  </Text>
                  <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
                    Objectives: +{comparison.objectives.added.length} · ~
                    {comparison.objectives.changed.length} · −{comparison.objectives.removed.length}
                  </Text>
                  {comparison.metadata.length > 0 ? (
                    <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
                      Changed details: {comparison.metadata.map(({ field }) => field).join(", ")}
                    </Text>
                  ) : null}
                  <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
                    Counts include edits made to your copy.
                  </Text>
                </View>
              ) : null}
              {comparisonFailed ? (
                <Text
                  accessibilityRole="alert"
                  className={"text-recall-muted text-[12px] leading-[18px]"}
                >
                  The shared version loaded, but its differences could not be compared.
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void fork()}
                className={
                  "min-h-[42px] justify-center items-center px-[14px] rounded-[9px] bg-recall-darkGreen"
                }
              >
                <Text className={"text-recall-surface font-bold text-[12px]"}>
                  Add a personal copy
                </Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
      {forkConflict && publication && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
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
          className={"flex-1 items-center py-[9px] rounded-[9px] bg-recall-paper"}
        >
          <Text>Start a new copy attempt</Text>
        </Pressable>
      )}
      {publicationConflict && area ? (
        <Pressable
          className={
            "min-h-[42px] justify-center items-center px-[14px] rounded-[9px] bg-recall-darkGreen"
          }
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
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
          <Text className={"text-recall-surface font-bold text-[12px]"}>
            Start a new publication attempt
          </Text>
        </Pressable>
      ) : null}
      {notice ? (
        <Text accessibilityRole="alert" className={"text-recall-muted text-[12px] leading-[18px]"}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}
