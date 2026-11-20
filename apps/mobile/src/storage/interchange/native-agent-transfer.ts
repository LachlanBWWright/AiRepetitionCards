import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { Effect } from "effect";
import { MAX_AGENT_JSON_BYTES } from "@recall/application";
import type { AgentTransferPorts } from "@recall/react";

export const nativeAgentTransferPorts: AgentTransferPorts = {
  copy: (text) =>
    Effect.tryPromise({
      try: () => Clipboard.setStringAsync(text),
      catch: () => ({ message: "Could not copy the handover. Save the JSON file instead." }),
    }).pipe(Effect.asVoid),
  save: (text) =>
    Effect.gen(function* () {
      const available = yield* Effect.tryPromise({
        try: () => Sharing.isAvailableAsync(),
        catch: () => ({ message: "File sharing is unavailable." }),
      });
      if (!available)
        return yield* Effect.fail({
          message: "File sharing is unavailable. Copy the handover instead.",
        });
      const file = yield* Effect.try({
        try: () => new File(Paths.cache, "recall-agent-handover.json"),
        catch: () => ({ message: "Could not create the handover file." }),
      });
      yield* Effect.try({
        try: () => {
          file.write(text);
        },
        catch: () => ({ message: "Could not write the handover file." }),
      });
      yield* Effect.tryPromise({
        try: () =>
          Sharing.shareAsync(file.uri, {
            mimeType: "application/json",
            dialogTitle: "External AI handover",
          }),
        catch: () => ({ message: "Could not share the handover file." }),
      }).pipe(
        Effect.ensuring(
          Effect.try({
            try: () => {
              file.delete();
            },
            catch: () => ({ message: "Could not remove the temporary handover file." }),
          }).pipe(Effect.ignore),
        ),
      );
    }),
  pick: () =>
    Effect.gen(function* () {
      const selected = yield* Effect.tryPromise({
        try: () =>
          DocumentPicker.getDocumentAsync({
            type: ["application/json", "text/plain", "application/octet-stream"],
            multiple: false,
            copyToCacheDirectory: true,
          }),
        catch: () => ({ message: "Could not open the JSON file picker." }),
      });
      if (selected.canceled) return null;
      const asset = selected.assets[0];
      if (!asset) return null;
      const file = yield* Effect.try({
        try: () => new File(asset.uri),
        catch: () => ({ message: "Could not open the JSON file." }),
      });
      if ((asset.size ?? file.size) > MAX_AGENT_JSON_BYTES)
        return yield* Effect.fail({ message: "The JSON exceeds the 2 MB import limit." });
      return yield* Effect.tryPromise({
        try: () => file.text(),
        catch: () => ({ message: "Could not read the JSON file." }),
      });
    }),
};
