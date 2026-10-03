import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Effect, Either } from "effect";
import * as Linking from "expo-linking";
import { designTokens } from "@recall/design-tokens";
import {
  confirmNativeMagicLink,
  sendNativeMagicLink,
  supabaseAuthClient,
} from "../storage/supabase-auth";

const palette = designTokens.color;

export function NativeAccountPanel({
  onSync,
  conflictAreas,
  onUseServerVersion,
  onImport,
  onExport,
  onBackupRestore,
  onBackupExport,
}: {
  readonly onSync: () => Promise<string>;
  readonly conflictAreas: readonly string[] | null;
  readonly onUseServerVersion: () => Promise<string>;
  readonly onImport: () => Promise<string>;
  readonly onExport: () => Promise<string>;
  readonly onBackupRestore: () => Promise<string>;
  readonly onBackupExport: () => Promise<string>;
}) {
  const [email, setEmail] = useState("");
  const [account, setAccount] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);

  useEffect(() => {
    const client = supabaseAuthClient;
    if (!client) return;
    let active = true;
    const loadSession = Effect.tryPromise({
      try: () => client.auth.getSession(),
      catch: () => ({ _tag: "SessionReadError" }) as const,
    });
    void Effect.runPromise(Effect.either(loadSession)).then((result) => {
      if (active && Either.isRight(result))
        setAccount(result.right.data.session?.user.email ?? null);
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (active) setAccount(session?.user.email ?? null);
    });
    const handleUrl = (url: string | null) => {
      if (!url) return;
      void Effect.runPromise(Effect.either(confirmNativeMagicLink(url))).then((result) => {
        if (active)
          setNotice(
            Either.isRight(result) && result.right
              ? "Signed in. Your account is ready to sync."
              : "The sign-in link could not be verified.",
          );
      });
    };
    const initialUrl = Effect.tryPromise({
      try: () => Linking.getInitialURL(),
      catch: () => ({ _tag: "InitialLinkReadError" }) as const,
    });
    void Effect.runPromise(Effect.either(initialUrl)).then((result) => {
      if (Either.isRight(result)) handleUrl(result.right);
    });
    const subscription = Linking.addEventListener("url", ({ url }) => handleUrl(url));
    return () => {
      active = false;
      subscription.remove();
      data.subscription.unsubscribe();
    };
  }, []);

  async function requestLink() {
    setBusy(true);
    setNotice(null);
    const result = await Effect.runPromise(Effect.either(sendNativeMagicLink(email.trim())));
    setBusy(false);
    setNotice(
      Either.isRight(result) && result.right
        ? "Check your email for a sign-in link."
        : "Could not send a sign-in link. Check your email and connection.",
    );
  }

  async function syncNow() {
    setSyncBusy(true);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: onSync,
          catch: () => ({ _tag: "NativeSyncRequestError" }) as const,
        }),
      ),
    );
    setSyncBusy(false);
    setNotice(
      Either.isRight(result) ? result.right : "Sync failed. Your offline data is still saved.",
    );
  }

  async function applyServerVersion() {
    setResolvingConflict(true);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: onUseServerVersion,
          catch: () => ({ _tag: "ConflictResolutionError" }) as const,
        }),
      ),
    );
    setResolvingConflict(false);
    setNotice(Either.isRight(result) ? result.right : "The server content could not be loaded.");
  }

  async function runFileAction(action: () => Promise<string>) {
    setFileBusy(true);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: action,
          catch: () => ({ _tag: "NativeFileActionError" }) as const,
        }),
      ),
    );
    setFileBusy(false);
    setNotice(Either.isRight(result) ? result.right : "The file action could not be completed.");
  }

  return (
    <View style={styles.panel}>
      <View style={styles.heading}>
        <Text style={styles.title}>Cloud account</Text>
        {account ? <Text style={styles.signedIn}>{account}</Text> : null}
      </View>
      <View style={styles.fileActions}>
        <Pressable
          accessibilityRole="button"
          disabled={fileBusy}
          onPress={() => void runFileAction(onImport)}
          style={styles.fileButton}
        >
          <Text style={styles.fileButtonText}>{fileBusy ? "Working…" : "Import area or ZIP"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={fileBusy}
          onPress={() => void runFileAction(onExport)}
          style={styles.fileButton}
        >
          <Text style={styles.fileButtonText}>Export area package</Text>
        </Pressable>
      </View>
      <View style={styles.fileActions}>
        <Pressable
          accessibilityRole="button"
          disabled={fileBusy}
          onPress={() => void runFileAction(onBackupRestore)}
          style={styles.fileButton}
        >
          <Text style={styles.fileButtonText}>Restore private backup</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={fileBusy}
          onPress={() => void runFileAction(onBackupExport)}
          style={styles.fileButton}
        >
          <Text style={styles.fileButtonText}>Export private backup</Text>
        </Pressable>
      </View>
      {account ? (
        <>
          <Pressable
            accessibilityRole="button"
            disabled={syncBusy || resolvingConflict}
            onPress={() => void syncNow()}
            style={styles.button}
          >
            {syncBusy ? (
              <ActivityIndicator color={palette.surface} />
            ) : (
              <Text style={styles.buttonText}>Sync now</Text>
            )}
          </Pressable>
          {conflictAreas ? (
            <View style={styles.conflict}>
              <Text style={styles.conflictTitle}>Server version is ready to review</Text>
              <Text style={styles.notice}>
                {conflictAreas.length
                  ? conflictAreas.join(" · ")
                  : "All learning areas were deleted on the server."}
              </Text>
              <Text style={styles.notice}>
                Loading it replaces local area content and keeps review history.
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={resolvingConflict || syncBusy}
                onPress={() => void applyServerVersion()}
                style={styles.buttonSoft}
              >
                {resolvingConflict ? (
                  <ActivityIndicator color={palette.darkGreen} />
                ) : (
                  <Text style={styles.buttonSoftText}>Use server version</Text>
                )}
              </Pressable>
            </View>
          ) : null}
        </>
      ) : (
        <View style={styles.form}>
          <TextInput
            accessibilityLabel="Email address"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={palette.muted}
            style={styles.input}
            value={email}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || email.trim().length === 0}
            onPress={() => void requestLink()}
            style={styles.button}
          >
            {busy ? (
              <ActivityIndicator color={palette.surface} />
            ) : (
              <Text style={styles.buttonText}>Email sign-in link</Text>
            )}
          </Pressable>
        </View>
      )}
      {notice || !supabaseAuthClient ? (
        <Text accessibilityRole="alert" style={styles.notice}>
          {notice ?? "Add the Supabase mobile environment values to enable cloud sign-in."}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 10,
    padding: 14,
    backgroundColor: palette.surface,
    borderTopColor: palette.line,
    borderTopWidth: 1,
  },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { color: palette.ink, fontSize: 15, fontWeight: "700" },
  signedIn: { color: palette.darkGreen, fontSize: 12 },
  form: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1,
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: palette.paper,
    color: palette.ink,
  },
  button: {
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: palette.darkGreen,
  },
  buttonText: { color: palette.surface, fontWeight: "700", fontSize: 12 },
  conflict: { gap: 7, padding: 10, borderRadius: 10, backgroundColor: palette.paper },
  fileActions: { flexDirection: "row", gap: 8 },
  fileButton: {
    flex: 1,
    minHeight: 38,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: palette.paper,
  },
  fileButtonText: { color: palette.darkGreen, fontWeight: "700", fontSize: 12 },
  conflictTitle: { color: palette.ink, fontWeight: "700", fontSize: 13 },
  buttonSoft: {
    minHeight: 40,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: palette.green,
  },
  buttonSoftText: { color: palette.darkGreen, fontWeight: "700", fontSize: 12 },
  notice: { color: palette.muted, fontSize: 12 },
});
