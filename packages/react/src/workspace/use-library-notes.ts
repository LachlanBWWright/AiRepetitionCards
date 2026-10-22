"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Effect, Either } from "effect";
import {
  emptyLibraryNotes,
  reconcileLibraryNotesWrite,
  type LibraryNotes,
  type LibraryNotesStore,
} from "@recall/application";
import type { StoredMediaAsset } from "@recall/local-store";

export function useLibraryNotes(store: LibraryNotesStore) {
  const [state, setState] = useState({
    scope: store.scope,
    notes: emptyLibraryNotes,
    loaded: false,
  });
  const stateRef = useRef(state);
  const [error, setError] = useState<string | null>(null);
  const [persistenceStatus, setPersistenceStatus] = useState<
    "saved-locally" | "synchronized" | "awaiting-sync" | "conflicted"
  >(store.persistenceStatus?.() ?? "saved-locally");
  const [revision, setRevision] = useState(0);
  const changeVersion = useRef(0);
  const lane = useRef<Promise<boolean>>(Promise.resolve(true));
  const lifecycle = useRef(0);
  const pendingAssets = useRef(new Map<string, StoredMediaAsset>());
  const writtenAssetIds = useRef(new Set<string>());
  useEffect(() => {
    let active = true;
    lifecycle.current += 1;
    const readVersion = changeVersion.current;
    void lane.current
      .then(() => Effect.runPromise(Effect.either(store.read)))
      .then((result) => {
        if (!active) return;
        if (Either.isLeft(result)) {
          const next = { ...stateRef.current, loaded: false };
          stateRef.current = next;
          setState(next);
          setError(result.left.message);
          setPersistenceStatus("conflicted");
          return;
        }
        if (
          stateRef.current.scope === store.scope &&
          stateRef.current.loaded &&
          changeVersion.current !== readVersion
        )
          return;
        if (stateRef.current.scope !== store.scope) {
          pendingAssets.current.clear();
          writtenAssetIds.current.clear();
        }
        const next = { scope: store.scope, notes: result.right, loaded: true };
        stateRef.current = next;
        setState(next);
        setError(null);
        setPersistenceStatus(store.persistenceStatus?.() ?? "saved-locally");
      });
    return () => {
      active = false;
      lifecycle.current += 1;
    };
  }, [store, revision]);
  const enqueueWrite = useCallback(() => {
    const lifetime = lifecycle.current;
    lane.current = lane.current.then(async () => {
      const current = stateRef.current;
      if (lifetime !== lifecycle.current || current.scope !== store.scope || !current.loaded)
        return false;
      // Coalesce queued edits from the current state, including earlier cloud merges.
      const notes = current.notes;
      const staged = [...pendingAssets.current.values()];
      const saved = await Effect.runPromise(Effect.either(store.write(notes, staged)));
      if (lifetime !== lifecycle.current || stateRef.current.scope !== store.scope) return false;
      if (Either.isLeft(saved)) {
        setError(saved.left.message);
        setPersistenceStatus(saved.left.recovery ?? "conflicted");
        return false;
      }
      for (const asset of staged) {
        writtenAssetIds.current.add(asset.reference.id);
        if (pendingAssets.current.get(asset.reference.id) === asset)
          pendingAssets.current.delete(asset.reference.id);
      }
      const merged = Effect.runSync(
        Effect.either(reconcileLibraryNotesWrite(notes, stateRef.current.notes, saved.right)),
      );
      if (Either.isLeft(merged)) {
        setError(merged.left.message);
        return false;
      }
      const next = { ...stateRef.current, notes: merged.right };
      stateRef.current = next;
      setState(next);
      setError(null);
      setPersistenceStatus(store.persistenceStatus?.() ?? "saved-locally");
      return true;
    });
  }, [store]);
  const update = useCallback(
    (change: (notes: LibraryNotes) => LibraryNotes, assets: readonly StoredMediaAsset[] = []) => {
      const current = stateRef.current;
      if (current.scope !== store.scope || !current.loaded) return;
      const notes = change(current.notes);
      const freshAssets = assets.filter(
        (asset) => !writtenAssetIds.current.has(asset.reference.id),
      );
      if (JSON.stringify(notes) === JSON.stringify(current.notes) && freshAssets.length === 0)
        return;
      changeVersion.current += 1;
      for (const asset of freshAssets) pendingAssets.current.set(asset.reference.id, asset);
      const next = { ...current, notes };
      stateRef.current = next;
      setState(next);
      enqueueWrite();
    },
    [store, enqueueWrite],
  );
  const retry = useCallback(() => {
    if (!stateRef.current.loaded || stateRef.current.scope !== store.scope) {
      setRevision((value) => value + 1);
      return;
    }
    enqueueWrite();
  }, [store, enqueueWrite]);
  const flush = useCallback(
    () =>
      stateRef.current.scope === store.scope && stateRef.current.loaded
        ? lane.current
        : Promise.resolve(false),
    [store],
  );
  const getCurrentNotes = useCallback(
    () =>
      stateRef.current.scope === store.scope && stateRef.current.loaded
        ? stateRef.current.notes
        : null,
    [store],
  );
  return {
    flush,
    getCurrentNotes,
    notes: state.scope === store.scope ? state.notes : emptyLibraryNotes,
    loaded: state.scope === store.scope && state.loaded,
    update,
    error,
    persistenceStatus,
    persistenceLocation: store.persistenceLocation?.() ?? "tab",
    retry,
  };
}
