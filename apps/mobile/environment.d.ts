export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      readonly EXPO_PUBLIC_RECALL_API_URL?: string;
      readonly EXPO_PUBLIC_RECALL_ACTIVITY_API_URL?: string;
      readonly EXPO_PUBLIC_SUPABASE_URL?: string;
      readonly EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
      readonly EAS_PROJECT_ID?: string;
      readonly EAS_BUILD_PROJECT_ID?: string;
      readonly EXPO_ACCOUNT_OWNER?: string;
    }
  }
}
