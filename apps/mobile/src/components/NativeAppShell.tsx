import { useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { designTokens } from "@recall/design-tokens";

export type NativeAppTab = "Today" | "Library" | "Tutor" | "Sharing" | "Account";
export type NativeAppShellProps = {
  readonly today: ReactNode;
  readonly library: ReactNode;
  readonly tutor: ReactNode;
  readonly sharing: ReactNode;
  readonly account: ReactNode;
  readonly initialTab?: NativeAppTab;
  readonly areas?: readonly {
    readonly id: string;
    readonly title: string;
    readonly color: string;
  }[];
  readonly activeAreaId?: string | null;
  readonly onSelectArea?: (areaId: string) => void;
  readonly selectionDisabled?: boolean;
};
const tabs: readonly NativeAppTab[] = ["Today", "Library", "Tutor", "Sharing", "Account"];
const descriptions: Readonly<Record<Exclude<NativeAppTab, "Today">, string>> = {
  Library: "Organize your learning areas and cards.",
  Tutor: "Practice with your AI tutor and review its proposals.",
  Sharing: "Publish learning content and receive shared areas.",
  Account: "Manage your account, sync and local data.",
};

/** Scenes stay mounted so switching tabs preserves drafts and pending operations. */
export function NativeAppShell({
  today,
  library,
  tutor,
  sharing,
  account,
  initialTab = "Today",
  areas = [],
  activeAreaId = null,
  onSelectArea,
  selectionDisabled = false,
}: NativeAppShellProps) {
  const [selectedTab, setSelectedTab] = useState<NativeAppTab>(initialTab);
  const panels: Readonly<Record<NativeAppTab, ReactNode>> = {
    Today: today,
    Library: library,
    Tutor: tutor,
    Sharing: sharing,
    Account: account,
  };
  return (
    <View style={styles.shell}>
      <View style={styles.scenes}>
        {tabs.map((tab) => {
          const active = selectedTab === tab;
          return (
            <View
              key={tab}
              style={[styles.scene, !active && styles.hidden]}
              accessibilityElementsHidden={!active}
              importantForAccessibility={active ? "auto" : "no-hide-descendants"}
            >
              {tab === "Today" ? (
                panels[tab]
              ) : (
                <SafeAreaView style={styles.safeArea}>
                  <KeyboardAvoidingView
                    style={styles.scene}
                    behavior={Platform.OS === "ios" ? "padding" : "height"}
                  >
                    <ScrollView
                      contentContainerStyle={styles.content}
                      keyboardShouldPersistTaps="handled"
                      keyboardDismissMode="on-drag"
                    >
                      <View style={styles.heading}>
                        <Text style={styles.eyebrow}>RECALL</Text>
                        <Text accessibilityRole="header" style={styles.title}>
                          {tab}
                        </Text>
                        <Text style={styles.description}>{descriptions[tab]}</Text>
                        {tab !== "Account" && areas.length > 0 && onSelectArea && (
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.areaList}
                            keyboardShouldPersistTaps="handled"
                          >
                            {areas.map((area) => (
                              <Pressable
                                key={area.id}
                                accessibilityRole="button"
                                accessibilityLabel={`Select ${area.title}`}
                                accessibilityState={{
                                  selected: activeAreaId === area.id,
                                  disabled: selectionDisabled,
                                }}
                                disabled={selectionDisabled}
                                onPress={() => onSelectArea(area.id)}
                                style={[
                                  styles.areaChip,
                                  activeAreaId === area.id && { backgroundColor: area.color },
                                  selectionDisabled && styles.pressed,
                                ]}
                              >
                                <Text style={styles.areaText}>{area.title}</Text>
                              </Pressable>
                            ))}
                          </ScrollView>
                        )}
                      </View>
                      {tab === "Tutor" && !panels.Tutor ? (
                        <View style={styles.empty}>
                          <Text style={styles.description}>
                            Add or select a learning area to start practicing with your tutor.
                          </Text>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => setSelectedTab("Library")}
                            style={styles.selectedTab}
                          >
                            <Text style={styles.emptyAction}>Open Library</Text>
                          </Pressable>
                        </View>
                      ) : (
                        panels[tab]
                      )}
                    </ScrollView>
                  </KeyboardAvoidingView>
                </SafeAreaView>
              )}
            </View>
          );
        })}
      </View>
      <SafeAreaView style={styles.navigationSafeArea}>
        <View style={styles.navigation} accessibilityLabel="Main navigation">
          {tabs.map((tab) => (
            <Pressable
              key={tab}
              accessibilityRole="button"
              accessibilityLabel={`${tab} tab`}
              accessibilityState={{ selected: selectedTab === tab }}
              onPress={() => {
                Keyboard.dismiss();
                setSelectedTab(tab);
              }}
              style={({ pressed }) => [
                styles.tab,
                selectedTab === tab && styles.selectedTab,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.tabText, selectedTab === tab && styles.selectedTabText]}>
                {tab}
              </Text>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </View>
  );
}

const palette = designTokens.color;
const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: palette.paper },
  scenes: { flex: 1, minHeight: 0 },
  scene: { flex: 1 },
  hidden: { display: "none" },
  safeArea: { flex: 1, backgroundColor: palette.paper },
  content: { padding: designTokens.spacing.md, gap: designTokens.spacing.lg, flexGrow: 1 },
  heading: { gap: designTokens.spacing.xs },
  areaList: { gap: designTokens.spacing.xs, paddingVertical: designTokens.spacing.xs },
  areaChip: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: designTokens.spacing.md,
    borderRadius: designTokens.radius.pill,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  areaText: { color: palette.ink, fontSize: 14, fontWeight: "600" },
  empty: { gap: designTokens.spacing.md },
  emptyAction: { padding: designTokens.spacing.md, color: palette.darkGreen, fontWeight: "600" },
  eyebrow: { fontSize: 12, fontWeight: "700", color: palette.muted, letterSpacing: 2 },
  title: { fontSize: 32, fontWeight: "700", color: palette.ink },
  description: { fontSize: 16, lineHeight: 24, color: palette.muted },
  navigationSafeArea: {
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderColor: palette.line,
  },
  navigation: { flexDirection: "row", padding: designTokens.spacing.xs, gap: 4 },
  tab: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: designTokens.radius.control,
  },
  selectedTab: { backgroundColor: palette.green },
  pressed: { opacity: 0.7 },
  tabText: { fontSize: 12, fontWeight: "600", color: palette.muted },
  selectedTabText: { color: palette.darkGreen },
});
