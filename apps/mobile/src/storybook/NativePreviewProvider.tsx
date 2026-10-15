import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

/** Standalone native screen stories need the context normally supplied by navigation. */
export function NativePreviewProvider({ children }: { readonly children: ReactNode }) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
      }}
    >
      {children}
    </SafeAreaProvider>
  );
}
