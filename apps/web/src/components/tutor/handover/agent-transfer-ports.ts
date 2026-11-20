import { Effect } from "effect";
import { MAX_AGENT_JSON_BYTES } from "@recall/application";
import type { AgentTransferPorts } from "@recall/react";

export const browserAgentTransferPorts: AgentTransferPorts = {
  copy: (text) =>
    Effect.tryPromise({
      try: () => navigator.clipboard.writeText(text),
      catch: () => ({
        message:
          "Could not copy. Select the handover text and copy it manually, or save the JSON file.",
      }),
    }),
  save: (text) =>
    Effect.try({
      try: () => {
        const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "recall-agent-handover.json";
        link.click();
        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 1000);
      },
      catch: () => ({
        message: "Could not save the handover file. Copy the handover text instead.",
      }),
    }),
  pick: () =>
    Effect.async<string | null, { readonly message: string }>((resume) => {
      const picker = document.createElement("input");
      picker.type = "file";
      picker.accept = ".json,application/json";
      picker.addEventListener(
        "cancel",
        () => {
          resume(Effect.succeed(null));
        },
        { once: true },
      );
      picker.addEventListener(
        "change",
        () => {
          const file = picker.files?.[0];
          if (!file) {
            resume(Effect.succeed(null));
            return;
          }
          if (file.size > MAX_AGENT_JSON_BYTES) {
            resume(Effect.fail({ message: "The JSON exceeds the 2 MB import limit." }));
            return;
          }
          resume(
            Effect.tryPromise({
              try: () => file.text(),
              catch: () => ({ message: "Could not read this JSON file." }),
            }),
          );
        },
        { once: true },
      );
      picker.click();
      return Effect.sync(() => {
        picker.remove();
      });
    }),
};
