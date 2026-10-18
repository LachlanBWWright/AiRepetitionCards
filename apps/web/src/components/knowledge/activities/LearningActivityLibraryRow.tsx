import type { LearningActivity } from "@recall/domain";
import { findActivityPlugin, type ActivityRegistry } from "@recall/application";
import { Button } from "@recall/ui-web";

export function LearningActivityLibraryRow({
  activity,
  registry,
  disabled,
  creating,
  onStart,
  onEdit,
  onArchive,
}: {
  readonly activity: LearningActivity;
  readonly registry: ActivityRegistry;
  readonly disabled: boolean;
  readonly creating: boolean;
  readonly onStart: (activity: LearningActivity) => void;
  readonly onEdit: (activity: LearningActivity) => void;
  readonly onArchive: (activity: LearningActivity) => void;
}) {
  const availableOnWeb =
    findActivityPlugin(registry, activity)?.capabilities.platforms.includes("web") ?? false;
  return (
    <article className="grid gap-2 rounded-lg border p-3">
      <h3 className="font-semibold">
        {activity.title}
        {activity.archived ? " · Archived" : ""}
      </h3>
      <p className="whitespace-pre-wrap text-sm text-muted-foreground">{activity.fallback}</p>
      <Button
        variant="secondary"
        disabled={disabled || creating || activity.archived || !availableOnWeb}
        onClick={() => {
          onStart(activity);
        }}
      >
        {availableOnWeb ? "Start activity" : "Unavailable on web"}
      </Button>
      <Button
        variant="secondary"
        disabled={disabled || creating || !availableOnWeb}
        onClick={() => {
          onEdit(activity);
        }}
      >
        Edit activity
      </Button>
      <Button
        variant="secondary"
        disabled={disabled || creating}
        onClick={() => {
          onArchive(activity);
        }}
      >
        {activity.archived ? "Restore activity" : "Archive activity"}
      </Button>
    </article>
  );
}
