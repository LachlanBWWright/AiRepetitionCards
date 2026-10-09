/// <reference types="nativewind/types" />

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  NavigationContainer,
  DefaultTheme,
  useNavigationContainerRef,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import {
  createBottomTabNavigator,
  type BottomTabNavigationOptions,
} from "@react-navigation/bottom-tabs";
import {
  createNativeBottomTabNavigator,
  type NativeBottomTabIcon,
  type NativeBottomTabNavigationOptions,
} from "@react-navigation/bottom-tabs/unstable";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { designTokens } from "@recall/design-tokens";
import { NativeSelect } from "@recall/ui-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { NativeAppTab, nativeAppTabs, type NativeAppTabParamList } from "../navigation";

type NativeAppPanels = Readonly<Record<NativeAppTab, ReactNode>>;
type NativeAppShellContextValue = {
  readonly panels: NativeAppPanels;
  readonly areas: NativeAppShellProps["areas"];
  readonly activeAreaId: string | null;
  readonly onSelectArea: ((areaId: string) => void) | undefined;
  readonly selectionDisabled: boolean;
  readonly navigateToTab: (tab: NativeAppTab) => void;
};

export type NativeAppShellProps = {
  readonly today: ReactNode;
  readonly library: ReactNode;
  readonly tutor: ReactNode;
  readonly sharing: ReactNode;
  readonly account: ReactNode;
  readonly initialTab?: NativeAppTab;
  readonly activeTab?: NativeAppTab;
  readonly onTabChange?: (tab: NativeAppTab) => void;
  readonly areas?: readonly {
    readonly id: string;
    readonly title: string;
    readonly color: string;
  }[];
  readonly activeAreaId?: string | null;
  readonly onSelectArea?: (areaId: string) => void;
  readonly selectionDisabled?: boolean;
};

const usePlatformTabBar =
  Platform.OS !== "web" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
const NativeTab = usePlatformTabBar
  ? createNativeBottomTabNavigator<NativeAppTabParamList>()
  : null;
const StandardTab = usePlatformTabBar ? null : createBottomTabNavigator<NativeAppTabParamList>();
const NavigationContext = createContext<NativeAppShellContextValue | null>(null);
const palette = designTokens.color;
type NativeTabIconResource = `ic_${"today" | "library" | "tutor" | "sharing" | "account"}`;
function nativeIconOption(
  iosIcon: NativeBottomTabIcon,
  androidDrawable: NativeTabIconResource,
): Pick<NativeBottomTabNavigationOptions, "tabBarIcon"> | Readonly<Record<string, never>> {
  if (Platform.OS === "ios") return { tabBarIcon: iosIcon };
  if (Platform.OS === "android")
    return { tabBarIcon: { type: "image", source: { uri: androidDrawable } } };
  return {};
}
const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: palette.paper,
    card: palette.surface,
    border: palette.line,
    primary: palette.darkGreen,
    text: palette.ink,
    notification: palette.coral,
  },
};
const tabOptions: Readonly<Record<NativeAppTab, NativeBottomTabNavigationOptions>> = {
  [NativeAppTab.Today]: {
    title: NativeAppTab.Today,
    tabBarLabel: NativeAppTab.Today,
    ...nativeIconOption({ type: "sfSymbol", name: "calendar" }, "ic_today"),
  },
  [NativeAppTab.Library]: {
    title: NativeAppTab.Library,
    tabBarLabel: NativeAppTab.Library,
    ...nativeIconOption({ type: "sfSymbol", name: "books.vertical" }, "ic_library"),
  },
  [NativeAppTab.Tutor]: {
    title: NativeAppTab.Tutor,
    tabBarLabel: NativeAppTab.Tutor,
    ...nativeIconOption({ type: "sfSymbol", name: "bubble.left.and.bubble.right" }, "ic_tutor"),
  },
  [NativeAppTab.Sharing]: {
    title: NativeAppTab.Sharing,
    tabBarLabel: NativeAppTab.Sharing,
    ...nativeIconOption({ type: "sfSymbol", name: "square.and.arrow.up" }, "ic_sharing"),
  },
  [NativeAppTab.Account]: {
    title: NativeAppTab.Account,
    tabBarLabel: NativeAppTab.Account,
    ...nativeIconOption({ type: "sfSymbol", name: "person.crop.circle" }, "ic_account"),
  },
};
const webSymbols: Readonly<Record<NativeAppTab, string>> = {
  [NativeAppTab.Today]: "◷",
  [NativeAppTab.Library]: "▤",
  [NativeAppTab.Tutor]: "◌",
  [NativeAppTab.Sharing]: "↗",
  [NativeAppTab.Account]: "○",
};
function webTabOption(tab: NativeAppTab): BottomTabNavigationOptions {
  return {
    title: tab,
    tabBarLabel: tab,
    tabBarIcon: ({ color, size }) => (
      <Text style={{ color, fontSize: size }}>{webSymbols[tab]}</Text>
    ),
  };
}
const webTabOptions: Readonly<Record<NativeAppTab, BottomTabNavigationOptions>> = {
  [NativeAppTab.Today]: webTabOption(NativeAppTab.Today),
  [NativeAppTab.Library]: webTabOption(NativeAppTab.Library),
  [NativeAppTab.Tutor]: webTabOption(NativeAppTab.Tutor),
  [NativeAppTab.Sharing]: webTabOption(NativeAppTab.Sharing),
  [NativeAppTab.Account]: webTabOption(NativeAppTab.Account),
};

/** Keeps tab scenes mounted and delegates mobile tabs to native iOS/Android controls. */
export function NativeAppShell({
  today,
  library,
  tutor,
  sharing,
  account,
  initialTab = NativeAppTab.Today,
  activeTab,
  onTabChange,
  areas = [],
  activeAreaId = null,
  onSelectArea,
  selectionDisabled = false,
}: NativeAppShellProps) {
  const navigationRef = useNavigationContainerRef<NativeAppTabParamList>();
  const [localTab, setLocalTab] = useState<NativeAppTab>(initialTab);
  const contextValue: NativeAppShellContextValue = {
    panels: { Today: today, Library: library, Tutor: tutor, Sharing: sharing, Account: account },
    areas,
    activeAreaId,
    onSelectArea,
    selectionDisabled,
    navigateToTab: (tab) => {
      if (navigationRef.isReady()) navigationRef.navigate(tab);
    },
  };
  const selectedTab = activeTab ?? localTab;

  useEffect(() => {
    if (
      activeTab &&
      navigationRef.isReady() &&
      navigationRef.getCurrentRoute()?.name !== activeTab
    ) {
      navigationRef.navigate(activeTab);
    }
  }, [activeTab, navigationRef]);

  const synchronizeSelectedTab = () => {
    const currentTab = navigationRef.getCurrentRoute()?.name;
    if (!currentTab) return;
    setLocalTab((current) => (current === currentTab ? current : currentTab));
    onTabChange?.(currentTab);
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View className="dark flex-1 bg-recall-paper">
        <NavigationContext.Provider value={contextValue}>
          <NavigationContainer
            ref={navigationRef}
            theme={navigationTheme}
            onReady={synchronizeSelectedTab}
            onStateChange={synchronizeSelectedTab}
          >
            {StandardTab ? (
              <StandardTab.Navigator
                initialRouteName={selectedTab}
                screenListeners={{ tabPress: () => Keyboard.dismiss() }}
                screenOptions={{
                  headerShown: false,
                  tabBarActiveTintColor: palette.darkGreen,
                  tabBarInactiveTintColor: palette.muted,
                  tabBarStyle: { backgroundColor: palette.surface },
                }}
              >
                {nativeAppTabs.map((tab) => (
                  <StandardTab.Screen
                    key={tab}
                    name={tab}
                    component={NativeAppPanelScreen}
                    options={webTabOptions[tab]}
                  />
                ))}
              </StandardTab.Navigator>
            ) : NativeTab ? (
              <NativeTab.Navigator
                initialRouteName={selectedTab}
                screenListeners={{ tabPress: () => Keyboard.dismiss() }}
                screenOptions={{
                  headerShown: false,
                  tabBarActiveTintColor: palette.darkGreen,
                  tabBarInactiveTintColor: palette.muted,
                  tabBarActiveIndicatorColor: palette.green,
                  tabBarLabelVisibilityMode: "labeled",
                  tabBarStyle: { backgroundColor: palette.surface },
                }}
              >
                {nativeAppTabs.map((tab) => (
                  <NativeTab.Screen
                    key={tab}
                    name={tab}
                    component={NativeAppPanelScreen}
                    options={tabOptions[tab]}
                  />
                ))}
              </NativeTab.Navigator>
            ) : null}
          </NavigationContainer>
        </NavigationContext.Provider>
      </View>
    </SafeAreaProvider>
  );
}

function NativeAppPanelScreen() {
  const context = useContext(NavigationContext);
  const route = useRoute<RouteProp<NativeAppTabParamList, NativeAppTab>>();
  if (!context) return null;
  const {
    panels,
    areas = [],
    activeAreaId = null,
    onSelectArea,
    selectionDisabled = false,
    navigateToTab,
  } = context;
  const tab = route.name;
  if (tab === NativeAppTab.Today)
    return <View className="flex-1 bg-recall-paper">{panels[NativeAppTab.Today]}</View>;

  return (
    <SafeAreaView className="flex-1 bg-recall-paper" edges={Platform.OS === "web" ? [] : ["top"]}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View className="grow gap-recall-lg p-recall-md">
            {tab !== NativeAppTab.Account && areas.length > 0 && onSelectArea && (
              <NativeSelect
                label="Learning area"
                value={activeAreaId ?? ""}
                options={[
                  { label: "Choose area", value: "" },
                  ...areas.map((area) => ({ label: area.title, value: area.id })),
                ]}
                disabled={selectionDisabled}
                onValueChange={(areaId) => {
                  if (areaId) onSelectArea(areaId);
                }}
              />
            )}
            {tab === NativeAppTab.Tutor && !panels[NativeAppTab.Tutor] ? (
              <View className="gap-recall-md">
                <Text className="text-base leading-6 text-recall-muted">
                  Choose a learning area in Library to practice.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => navigateToTab(NativeAppTab.Library)}
                  className="self-start rounded-control bg-recall-green p-recall-md"
                >
                  <Text className="font-semibold text-recall-darkGreen">Open Library</Text>
                </Pressable>
              </View>
            ) : (
              panels[tab]
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
