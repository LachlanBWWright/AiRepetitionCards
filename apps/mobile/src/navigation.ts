export const NativeAppTab = {
  Today: "Today",
  Library: "Library",
  Tutor: "Tutor",
  Sharing: "Sharing",
  Account: "Account",
} as const;

export type NativeAppTab = (typeof NativeAppTab)[keyof typeof NativeAppTab];

export type NativeAppTabParamList = {
  readonly [NativeAppTab.Today]: undefined;
  readonly [NativeAppTab.Library]: undefined;
  readonly [NativeAppTab.Tutor]: undefined;
  readonly [NativeAppTab.Sharing]: undefined;
  readonly [NativeAppTab.Account]: undefined;
};

export const nativeAppTabs = [
  NativeAppTab.Today,
  NativeAppTab.Library,
  NativeAppTab.Tutor,
  NativeAppTab.Sharing,
  NativeAppTab.Account,
] as const satisfies readonly NativeAppTab[];
