"use client";

import { useEffect, useRef, useState } from "react";
import { Effect, Either } from "effect";
import {
  applySelectedDeckUpdate,
  diffKnowledgeAreas,
  verifyMediaAsset,
  type PublishingApi,
  type PublishedMediaGateway,
} from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import type { StoredMediaAsset } from "@recall/local-store";

export type DeckUpdateProps = {
  readonly current: KnowledgeArea;
  readonly upstream: KnowledgeArea;
  readonly versionId: string;
  readonly token?: string;
  readonly publishing: PublishingApi;
  readonly media: PublishedMediaGateway;
  readonly createId: () => string;
  readonly onSave: (
    area: KnowledgeArea,
    versionId: string,
    advanceBaseline: boolean,
    assets: readonly StoredMediaAsset[],
  ) => Promise<boolean>;
};
export type DeckUpdateChoice = { readonly id: string; readonly label: string };

export function useDeckUpdate(props: DeckUpdateProps) {
  const { current: currentArea, upstream, versionId, token } = props;
  const currentKey = JSON.stringify(currentArea);
  const upstreamKey = JSON.stringify(upstream);
  const generation = useRef(0);
  const [baseline, setBaseline] = useState<KnowledgeArea | null>(null);
  const [choices, setChoices] = useState<readonly DeckUpdateChoice[]>([]);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [conflicts, setConflicts] = useState<readonly string[]>([]);
  const [confirmConflicts, setConfirmConflicts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const requestBusy = useRef(false);
  useEffect(() => {
    const scope = ++generation.current;
    requestBusy.current = false;
    void Promise.resolve().then(() => {
      if (generation.current !== scope) return;
      setBaseline(null);
      setChoices([]);
      setSelected([]);
      setConflicts([]);
      setConfirmConflicts(false);
      setMessage(null);
      setBusy(false);
    });
    return () => {
      generation.current += 1;
    };
  }, [currentKey, upstreamKey, versionId, token]);

  async function load() {
    if (requestBusy.current || !props.current.forkedFromVersionId) return;
    requestBusy.current = true;
    const scope = generation.current;
    setBusy(true);
    const result = await Effect.runPromise(
      Effect.either(props.publishing.read(props.current.forkedFromVersionId, props.token)),
    );
    if (generation.current !== scope) return;
    requestBusy.current = false;
    setBusy(false);
    if (Either.isLeft(result)) {
      setMessage("The original version could not be read. Your deck is unchanged.");
      return;
    }
    const changes = Effect.runSync(
      Effect.either(
        diffKnowledgeAreas({ baseline: result.right.version.content, candidate: props.upstream }),
      ),
    );
    if (Either.isLeft(changes)) {
      setMessage("These versions could not be compared.");
      return;
    }
    const items: DeckUpdateChoice[] = [];
    for (const [kind, entries] of [
      ["Objective", changes.right.objectives],
      ["Card", changes.right.cards],
      ["Activity", changes.right.activities],
    ] as const) {
      const label = (
        item:
          | KnowledgeArea["objectives"][number]
          | KnowledgeArea["cards"][number]
          | NonNullable<KnowledgeArea["activities"]>[number],
      ) => ("title" in item ? item.title : item.kind === "basic" ? item.front : item.text);
      for (const item of entries.added)
        items.push({
          id: item.sourceId ?? item.id,
          label: `Add ${kind.toLowerCase()}: ${label(item)}`,
        });
      for (const item of entries.changed)
        items.push({
          id: item.after.sourceId ?? item.after.id,
          label: `Update ${kind.toLowerCase()}: ${label(item.after)}`,
        });
      for (const item of entries.removed)
        items.push({
          id: item.sourceId ?? item.id,
          label: `Remove ${kind.toLowerCase()}: ${label(item)}`,
        });
    }
    setBaseline(result.right.version.content);
    setChoices(items);
    setMessage(
      items.length === 0
        ? changes.right.metadata.some((change) => change.field === "noteLibrary")
          ? "This release changes shared notes or templates without generated cards. Add a fresh personal copy to receive those changes safely."
          : "There are no card, objective, or activity changes to apply."
        : null,
    );
  }
  function toggle(id: string, checked: boolean) {
    setSelected((previous) =>
      checked ? [...new Set([...previous, id])] : previous.filter((value) => value !== id),
    );
    setConflicts([]);
    setConfirmConflicts(false);
  }
  async function save() {
    if (requestBusy.current || !baseline || selected.length === 0) return;
    requestBusy.current = true;
    const scope = generation.current;
    setBusy(true);
    setMessage(null);
    const result = Effect.runSync(
      Effect.either(
        applySelectedDeckUpdate({
          baseline,
          current: props.current,
          upstream: props.upstream,
          selectedSourceIds: selected,
          confirmedConflictSourceIds: confirmConflicts ? conflicts : [],
          newIds: Object.fromEntries(selected.map((id) => [id, props.createId()])),
        }),
      ),
    );
    if (Either.isLeft(result)) {
      if (generation.current !== scope) return;
      requestBusy.current = false;
      setBusy(false);
      if (result.left.reason === "local-conflict") {
        setConflicts(result.left.sourceIds);
        setMessage(
          result.left.message ??
            "Selected items have local edits. Confirm replacing those edits, or deselect the items.",
        );
      } else
        setMessage(
          "These changes could not be applied. Include required objective changes and retry.",
        );
      return;
    }
    const refs = [
      ...new Map(
        props.upstream.cards
          .flatMap((card) => card.media ?? [])
          .map((reference) => [reference.id, reference]),
      ).values(),
    ].filter((reference) =>
      result.right.area.cards.some((card) => card.media?.some((item) => item.id === reference.id)),
    );
    const assets: StoredMediaAsset[] = [];
    for (const reference of refs) {
      const asset = await Effect.runPromise(
        Effect.either(props.media.read(props.versionId, reference, props.token)),
      );
      if (
        Either.isLeft(asset) ||
        !asset.right ||
        !verifyMediaAsset(asset.right) ||
        asset.right.reference.id !== reference.id ||
        asset.right.reference.byteLength !== reference.byteLength ||
        asset.right.reference.mimeType !== reference.mimeType
      ) {
        if (generation.current !== scope) return;
        requestBusy.current = false;
        setBusy(false);
        setMessage("An attachment could not be verified. Your deck is unchanged.");
        return;
      }
      assets.push(asset.right);
    }
    if (generation.current !== scope) return;
    const saved = await props.onSave(
      result.right.area,
      props.versionId,
      choices.every((choice) => selected.includes(choice.id)),
      assets,
    );
    if (generation.current !== scope) return;
    requestBusy.current = false;
    setBusy(false);
    setMessage(
      saved
        ? "Selected changes saved. Your review history is preserved."
        : "Save was not confirmed. Your selection is retained; retry when storage is available.",
    );
    if (saved) {
      setSelected([]);
      setConflicts([]);
      setConfirmConflicts(false);
    }
  }
  return {
    baseline,
    choices,
    selected,
    conflicts,
    confirmConflicts,
    setConfirmConflicts,
    busy,
    message,
    load,
    toggle,
    save,
  };
}
