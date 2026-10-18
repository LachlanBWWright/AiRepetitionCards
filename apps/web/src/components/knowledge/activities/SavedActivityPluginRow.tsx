import type { LearningActivity } from "@recall/domain";
import { findActivityPlugin, type ActivityRegistry } from "@recall/application";
import { Button } from "@recall/ui-web";

export function SavedActivityPluginRow({
  activity,
  registry,
  disabled,
  onPrepareExport,
  onPrepareMigration,
}: {
  readonly activity: LearningActivity;
  readonly registry: ActivityRegistry;
  readonly disabled: boolean;
  readonly onPrepareExport: (activity: LearningActivity) => Promise<void>;
  readonly onPrepareMigration: (activity: LearningActivity) => Promise<void>;
}) {
  const installed = findActivityPlugin(registry, activity);
  const migrationTarget = registry
    .filter((plugin) => plugin.id === activity.pluginId && plugin.version > activity.pluginVersion)
    .sort((left, right) => right.version - left.version)[0];
  const status = installed
    ? `${installed.capabilities.platforms.join(" and ")} · ${installed.capabilities.assessment} assessment`
    : "plugin unavailable; original payload and history are preserved";
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <p className="font-medium">{activity.title}</p>
      <p className="text-sm text-muted-foreground">
        {activity.pluginId} · v{String(activity.pluginVersion)} · {status}
      </p>
      {!installed && (
        <>
          <p className="text-sm">{activity.fallback}</p>
          <Button
            disabled={disabled}
            variant="secondary"
            onClick={() => {
              void onPrepareExport(activity);
            }}
          >
            Prepare full activity export
          </Button>
        </>
      )}
      {migrationTarget && (
        <Button
          disabled={disabled}
          variant="secondary"
          onClick={() => {
            void onPrepareMigration(activity);
          }}
        >
          Preview migration to v{migrationTarget.version}
        </Button>
      )}
    </div>
  );
}
