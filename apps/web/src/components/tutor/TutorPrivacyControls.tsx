"use client";

import { useEffect, useState } from "react";
import { Effect, Fiber } from "effect";
import { Dialog } from "@recall/ui-web";
import { tutorPrivacyApi } from "@/lib/tutor-privacy-api";

type Policy = {
  readonly schemaVersion: 1;
  readonly retentionDays: number | null;
  readonly deletionAvailable: boolean;
};
export type TutorPrivacyState = {
  readonly policy: Policy | null;
  readonly confirming: boolean;
  readonly busy: boolean;
  readonly message: string | null;
};

export function TutorPrivacyView({
  state,
  disabled = false,
  local = false,
  onRequest,
  onCancel,
  onDelete,
}: {
  state: TutorPrivacyState;
  disabled?: boolean;
  local?: boolean;
  onRequest: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const retention = state.policy?.retentionDays;
  return (
    <section aria-label="Tutor privacy">
      <h3>Tutor privacy</h3>
      <p>
        Tutoring sends the selected learning area, your answers and relevant conversation to OpenAI.
        {local
          ? " Conversation history is saved on this device for this ChatGPT account."
          : " Conversation history is saved to your Recall account."}
      </p>
      {state.policy && (
        <p>
          {retention === null
            ? "Recall retains this tutor history until you clear it."
            : `Inactive tutor history becomes eligible for deletion after ${retention} ${retention === 1 ? "day" : "days"}.`}{" "}
          Clearing history removes conversations, quiz results and unapproved proposals. Your cards
          and review history stay saved. This does not delete data retained by OpenAI.
        </p>
      )}
      <button
        className="text-button"
        type="button"
        disabled={disabled || state.busy || !state.policy?.deletionAvailable}
        onClick={onRequest}
      >
        Clear tutor history
      </button>
      {state.message && !state.confirming && <p role="status">{state.message}</p>}
      {state.confirming && (
        <Dialog
          labelledBy="clear-tutor-history-title"
          onClose={state.busy ? () => undefined : onCancel}
        >
          <h2 id="clear-tutor-history-title">Clear tutor history?</h2>
          <p>
            This removes all{" "}
            {local
              ? "on-device tutor history for this ChatGPT account"
              : "tutor history in your Recall account"}
            , including saved conversations, quizzes and unapproved proposals. Your cards and
            reviews stay saved. This cannot be undone.
          </p>
          {state.message && <p role="status">{state.message}</p>}
          <button type="button" className="text-button" disabled={state.busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="text-button"
            disabled={state.busy || disabled}
            onClick={onDelete}
          >
            {state.busy ? "Clearing…" : "Clear tutor history"}
          </button>
        </Dialog>
      )}
    </section>
  );
}

export function TutorPrivacyControls({
  api = tutorPrivacyApi,
  onCleared,
  onBusyChange,
  disabled = false,
  local = false,
  demo = false,
}: {
  api?: typeof tutorPrivacyApi;
  onCleared: () => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
  local?: boolean;
  demo?: boolean;
}) {
  const [state, setState] = useState<TutorPrivacyState>({
    policy: demo
      ? { schemaVersion: 1, retentionDays: local ? null : 30, deletionAvailable: true }
      : null,
    confirming: false,
    busy: false,
    message: null,
  });
  useEffect(() => {
    if (demo) return;
    let mounted = true;
    const fiber = Effect.runFork(
      api.readPolicy().pipe(
        Effect.match({
          onFailure: () => {
            if (mounted)
              setState((current) => ({
                ...current,
                message: "Tutor privacy settings could not be loaded. Try again later.",
              }));
          },
          onSuccess: (policy) => {
            if (mounted) setState((current) => ({ ...current, policy, message: null }));
          },
        }),
      ),
    );
    return () => {
      mounted = false;
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [api, demo]);
  const clear = () => {
    if (disabled || state.busy || !state.policy?.deletionAvailable) return;
    if (demo) {
      onCleared();
      setState((current) => ({
        ...current,
        confirming: false,
        message: "Tutor history cleared. Your cards and reviews are still saved.",
      }));
      return;
    }
    onBusyChange(true);
    setState((current) => ({ ...current, busy: true, message: null }));
    Effect.runFork(
      api.deleteHistory("DELETE_TUTOR_HISTORY").pipe(
        Effect.match({
          onFailure: () => {
            onBusyChange(false);
            setState((current) => ({
              ...current,
              busy: false,
              message: "We could not confirm that tutor history was cleared. Try again.",
            }));
          },
          onSuccess: () => {
            onBusyChange(false);
            onCleared();
            setState((current) => ({
              ...current,
              busy: false,
              confirming: false,
              message: "Tutor history cleared. Your cards and reviews are still saved.",
            }));
          },
        }),
      ),
    );
  };
  return (
    <TutorPrivacyView
      state={state}
      disabled={disabled}
      local={local}
      onRequest={() => setState((current) => ({ ...current, confirming: true, message: null }))}
      onCancel={() => setState((current) => ({ ...current, confirming: false }))}
      onDelete={clear}
    />
  );
}
