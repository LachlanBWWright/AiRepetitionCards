import { readRef } from "../../read-ref";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { ActivityLibrary, LearningActivity } from "@recall/domain";
import {
  applyActivityPluginMigration,
  builtinActivityRegistry,
  decodeActivityPluginPayloadJson,
  exportUnsupportedActivity,
  findActivityPlugin,
  previewActivityPluginMigration,
  validateAuthoredActivity,
} from "@recall/application";
import type { ActivityPluginMigrationPreview, ActivityRegistry } from "@recall/application";
import { Effect, Either } from "effect";
import { NativeSelect, NativeTextField } from "@recall/ui-native";
import { NativeButton } from "../ui/NativeButton";

export type NativeActivityPluginToolsProps = {
  readonly library: ActivityLibrary;
  readonly registry?: ActivityRegistry;
  readonly areaId: string;
  readonly objectiveId: string;
  readonly createId: () => string;
  readonly platform: "native";
  readonly onSave: (library: ActivityLibrary) => Promise<boolean>;
  readonly disabled?: boolean;
};

type ActivityPlugin = ActivityRegistry[number];

function SavedActivityRow({
  activity,
  installed,
  migrationTarget,
  disabled,
  onExport,
  onMigration,
}: {
  readonly activity: LearningActivity;
  readonly installed: ActivityPlugin | undefined;
  readonly migrationTarget: ActivityPlugin | undefined;
  readonly disabled: boolean;
  readonly onExport: () => void;
  readonly onMigration: () => void;
}) {
  const installedDescription = installed
    ? ` · ${installed.capabilities.platforms.join(" and ")} · ${installed.capabilities.assessment} assessment`
    : " · plugin unavailable; original payload and history are preserved";
  return (
    <View className="gap-2 rounded-xl border border-recall-line p-3">
      <Text className="font-bold">{activity.title}</Text>
      <Text className="text-sm text-recall-muted">
        {activity.pluginId} · v{activity.pluginVersion}
        {installedDescription}
      </Text>
      {!installed && (
        <>
          <Text>{activity.fallback}</Text>
          <NativeButton
            label="Prepare full activity export"
            tone="soft"
            disabled={disabled}
            onPress={onExport}
          />
        </>
      )}
      {migrationTarget && (
        <NativeButton
          label={`Preview migration to v${String(migrationTarget.version)}`}
          tone="soft"
          disabled={disabled}
          onPress={onMigration}
        />
      )}
    </View>
  );
}

export function NativeActivityPluginTools(props: NativeActivityPluginToolsProps) {
  const registry = props.registry ?? builtinActivityRegistry;
  const available = registry.filter((plugin) => plugin.capabilities.platforms.includes("native"));
  const [pluginId, setPluginId] = useState(available[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [payload, setPayload] = useState(
    '{"prompts":["Explain the idea."],"rubric":"Accurate explanation with an example.","reference":""}',
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    activity: LearningActivity;
    proposal: ActivityPluginMigrationPreview;
  } | null>(null);
  const [exportJson, setExportJson] = useState("");
  const alive = useRef(true);
  const currentAreaId = useRef(props.areaId);
  useEffect(() => {
    currentAreaId.current = props.areaId;
  }, [props.areaId]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const saveLibrary = async (library: ActivityLibrary): Promise<boolean> => {
    const result = await Effect.runPromise(
      Effect.either(Effect.tryPromise({ try: () => props.onSave(library), catch: () => false })),
    );
    return Either.isRight(result) && result.right;
  };
  const selected = registry.find((plugin) => plugin.id === pluginId);

  async function exportActivity(activity: LearningActivity) {
    const result = await Effect.runPromise(
      Effect.either(exportUnsupportedActivity(activity, registry)),
    );
    if (!readRef(alive) || currentAreaId.current !== props.areaId) return;
    setExportJson(Either.isRight(result) ? result.right.json : result.left.message);
  }

  const savedActivities = props.library.activities
    .filter((activity) => activity.areaId === props.areaId)
    .map((activity) => {
      const installed = findActivityPlugin(registry, activity);
      const migrationTarget = registry
        .filter(
          (plugin) => plugin.id === activity.pluginId && plugin.version > activity.pluginVersion,
        )
        .sort((left, right) => right.version - left.version)[0];
      return (
        <SavedActivityRow
          key={activity.id}
          activity={activity}
          installed={installed}
          migrationTarget={migrationTarget}
          disabled={Boolean(props.disabled)}
          onExport={() => {
            void exportActivity(activity);
          }}
          onMigration={() => {
            void prepareMigration(activity);
          }}
        />
      );
    });

  const create = async () => {
    if (!selected || props.disabled) return;
    const areaId = props.areaId;
    setBusy(true);
    const decoded = await Effect.runPromise(
      Effect.either(decodeActivityPluginPayloadJson(payload)),
    );
    if (!readRef(alive) || currentAreaId.current !== areaId) return;
    if (Either.isLeft(decoded)) {
      setMessage(decoded.left.message);
      setBusy(false);
      return;
    }
    const authored = await Effect.runPromise(
      Effect.either(
        validateAuthoredActivity(
          {
            id: props.createId(),
            areaId: props.areaId,
            title: title.trim() || selected.label,
            pluginId: selected.id,
            pluginVersion: selected.version,
            revision: 1,
            objectiveIds: [props.objectiveId],
            fallback: title.trim() || selected.label,
            payload: decoded.right,
          },
          "native",
          selected.capabilities.assessment,
          registry,
        ),
      ),
    );
    if (!readRef(alive) || currentAreaId.current !== areaId) return;
    if (Either.isLeft(authored)) {
      setMessage(authored.left.message);
      setBusy(false);
      return;
    }
    const saved = await saveLibrary({
      ...props.library,
      activities: [...props.library.activities, authored.right],
    });
    if (!readRef(alive) || currentAreaId.current !== areaId) return;
    setMessage(saved ? "Validated activity saved." : "Activity was not saved. Retry when ready.");
    setBusy(false);
  };

  const prepareMigration = async (activity: LearningActivity) => {
    if (props.disabled) return;
    const areaId = props.areaId;
    const target = registry
      .filter(
        (plugin) => plugin.id === activity.pluginId && plugin.version > activity.pluginVersion,
      )
      .sort((left, right) => right.version - left.version)[0];
    if (!target) return;
    const result = await Effect.runPromise(
      Effect.either(previewActivityPluginMigration(activity, target.version, registry)),
    );
    if (!readRef(alive) || currentAreaId.current !== areaId) return;
    if (Either.isLeft(result)) setMessage(result.left.message);
    else {
      setPreview({ activity, proposal: result.right });
      setMessage(result.right.summary);
    }
  };

  const applyMigration = async () => {
    if (!preview || props.disabled) return;
    const areaId = props.areaId;
    const applied = await Effect.runPromise(
      Effect.either(
        applyActivityPluginMigration(preview.activity, preview.proposal, true, registry),
      ),
    );
    if (!readRef(alive) || currentAreaId.current !== areaId) return;
    if (Either.isLeft(applied)) {
      setMessage(applied.left.message);
      return;
    }
    const activities = props.library.activities.map((entry) =>
      entry.id === applied.right.id ? applied.right : entry,
    );
    const saved = await saveLibrary({ ...props.library, activities });
    if (!readRef(alive) || currentAreaId.current !== areaId) return;
    setMessage(
      saved ? "Approved migration saved as a new content revision." : "Migration was not saved.",
    );
    setPreview(null);
  };

  return (
    <View className="gap-3 rounded-xl border border-recall-line bg-recall-surface p-4">
      <Text accessibilityRole="header" className="text-lg font-bold">
        Activity plugin tools
      </Text>
      <Text className="text-sm text-recall-muted">
        Only installed plugins can validate activity data. Imported content cannot install code or
        run automatic grading.
      </Text>
      <NativeSelect
        label="Installed plugin"
        value={pluginId}
        options={available.map((plugin) => ({
          value: plugin.id,
          label: `${plugin.label} · v${String(plugin.version)}`,
        }))}
        onValueChange={setPluginId}
        disabled={Boolean(props.disabled)}
      />
      {selected && (
        <>
          <Text className="text-sm text-recall-muted">
            native · {selected.capabilities.assessment} assessment ·{" "}
            {selected.capabilities.offline ? "offline" : "online"}
            {selected.capabilities.execution ? " · code execution capability" : ""}
          </Text>
          <NativeTextField
            label="Activity title"
            value={title}
            onChangeText={setTitle}
            editable={!props.disabled}
            maxLength={300}
          />
          <NativeTextField
            label={`Version ${String(selected.version)} payload (JSON)`}
            value={payload}
            onChangeText={setPayload}
            editable={!props.disabled}
            multiline
            maxLength={100_000}
          />
          <NativeButton
            label="Validate and save activity"
            disabled={props.disabled || busy}
            onPress={() => void create()}
          />
        </>
      )}
      <Text className="font-bold">Saved activities</Text>
      {savedActivities}
      {preview && (
        <View className="gap-2 rounded-xl border border-recall-line p-3">
          <Text>{preview.proposal.summary}</Text>
          <Text className="text-xs">{JSON.stringify(preview.proposal.proposal, null, 2)}</Text>
          <NativeButton
            label="Approve and apply migration"
            disabled={Boolean(props.disabled)}
            onPress={() => void applyMigration()}
          />
          <NativeButton
            label="Cancel"
            tone="soft"
            disabled={Boolean(props.disabled)}
            onPress={() => {
              setPreview(null);
            }}
          />
        </View>
      )}
      {exportJson ? (
        <NativeTextField
          label="Full activity export JSON"
          value={exportJson}
          onChangeText={() => undefined}
          editable={false}
          multiline
        />
      ) : null}
      {message ? <Text accessibilityRole="alert">{message}</Text> : null}
    </View>
  );
}
