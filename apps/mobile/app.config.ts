import type { ConfigContext, ExpoConfig } from "expo/config";
import { Either, Schema } from "effect";

const ProjectConfiguration = Schema.Struct({
  projectId: Schema.String.pipe(
    Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  ),
  owner: Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/)),
});

/** Local development does not require an Expo account; release preflight requires real linkage. */
export default function configureApp({ config }: ConfigContext): ExpoConfig {
  const project = Schema.decodeUnknownEither(ProjectConfiguration)({
    projectId: process.env.EAS_PROJECT_ID ?? process.env.EAS_BUILD_PROJECT_ID,
    owner: process.env.EXPO_ACCOUNT_OWNER,
  });
  return {
    ...config,
    name: "Recall",
    slug: "recall-learning",
    ...(Either.isRight(project)
      ? { owner: project.right.owner, extra: { eas: { projectId: project.right.projectId } } }
      : {}),
    ios: { ...config.ios, bundleIdentifier: "com.recall.study" },
    android: { ...config.android, package: "com.recall.study" },
  };
}
