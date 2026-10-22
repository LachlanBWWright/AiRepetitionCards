import { Alert } from "react-native";
import { Effect, Either } from "effect";
import * as Crypto from "expo-crypto";
import { applyAnkiImport, type AnkiImportProposal } from "@recall/application";
import { pickAnkiImport } from "../../storage/interchange/native-anki-import";
import { palette } from "../state/AppEnvironment";
import type { AppCoreState } from "../useAppController";
import type { createAppWorkspaceActions } from "./AppWorkspaceActions";
export function createAppAnkiActions(
  model: Pick<
    AppCoreState & ReturnType<typeof createAppWorkspaceActions>,
    | "workspaceLifetime"
    | "authSession"
    | "workspace"
    | "mediaStore"
    | "setMessage"
    | "commitWorkspaceChange"
    | "setCacheWritable"
    | "setActiveAreaId"
    | "setShowAnswer"
  >,
) {
  const {
    workspaceLifetime,
    authSession,
    workspace,
    mediaStore,
    setMessage,
    commitWorkspaceChange,
    setCacheWritable,
    setActiveAreaId,
    setShowAnswer,
  } = model;
  async function importAnkiDeck(): Promise<void> {
    const generation = workspaceLifetime.generation();
    const authGeneration = authSession.current.generation;
    if (!workspace || !mediaStore) {
      setMessage("Local library storage is not ready yet.");
      return;
    }
    const areaColors = [palette.green, palette.coral, palette.violet, palette.amber];
    const picked = await Effect.runPromise(
      Effect.either(
        pickAnkiImport({
          color: areaColors[workspace.areas.length % areaColors.length] ?? palette.green,
          createId: () => Crypto.randomUUID(),
        }),
      ),
    );
    if (Either.isLeft(picked)) {
      setMessage("Anki import failed. Choose a supported .apkg package below 50 MB.");
      return;
    }
    if (!picked.right) return;
    if (
      workspaceLifetime.generation() !== generation ||
      authSession.current.generation !== authGeneration ||
      workspaceLifetime.isBlocked()
    ) {
      setMessage("Import discarded because this workspace or account changed.");
      return;
    }
    const proposal = picked.right;
    Alert.alert(
      "Review Anki import",
      `${proposal.area.title}\n${String(proposal.area.cards.length)} cards · ${String(proposal.reviewEvents.length)} reviews${proposal.excludedReviewCount > 0 ? ` · ${String(proposal.excludedReviewCount)} cram/reschedule entries excluded` : ""}\n\nMatching Anki cards update their content while keeping local scheduling and history. New cards retain imported review history. Supported schedules preserve due dates and intervals; other schedules are rebuilt.\n\n${(proposal.warnings ?? []).join("\n")}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Import",
          onPress: () => void acceptAnkiImport(proposal, generation, authGeneration),
        },
      ],
    );
  }
  async function acceptAnkiImport(
    proposal: AnkiImportProposal,
    generation: number,
    authGeneration: number,
  ): Promise<void> {
    if (!mediaStore) return;
    const accepted = await Effect.runPromise(
      Effect.either(
        commitWorkspaceChange((current) => applyAnkiImport(current, proposal), generation, {
          persistFirst: true,
          media: proposal.media,
          isCurrent: () => authSession.current.generation === authGeneration,
        }),
      ),
    );
    if (Either.isLeft(accepted)) {
      if (accepted.left._tag === "NativeWorkspacePersistenceFailed") {
        setCacheWritable(false);
        setMessage(
          accepted.left.mediaRollback
            ? "The import was not added. Local storage failed and some temporary attachments could not be removed."
            : "The import was not added because its workspace or attachments could not be saved.",
        );
      } else if (accepted.left._tag === "AnkiReimportFailure") {
        setMessage(
          accepted.left.reason === "ambiguous-matches"
            ? "Import stopped: matching Anki cards occur in multiple areas or are duplicated."
            : accepted.left.reason === "partial-note-family"
              ? "Import the complete shared-note family to update existing notes safely."
              : "The updated collection did not pass validation.",
        );
      } else setMessage("Import discarded because this workspace or account changed.");
      return;
    }
    setActiveAreaId(proposal.area.id);
    setShowAnswer(false);
    setMessage(
      `${String(proposal.area.cards.length)} Anki cards and ${String(proposal.reviewEvents.length)} reviews imported.`,
    );
  }
  return { importAnkiDeck, acceptAnkiImport } as const;
}
