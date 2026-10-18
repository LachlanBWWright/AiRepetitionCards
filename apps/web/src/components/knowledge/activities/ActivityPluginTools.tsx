"use client";

import { readRef } from "@/lib/read-ref";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityLibrary, LearningActivity } from "@recall/domain";
import {
  applyActivityPluginMigration,
  builtinActivityRegistry,
  decodeActivityPluginPayloadJson,
  exportUnsupportedActivity,
  inspectActivityPluginCompatibility,
  previewActivityPluginMigration,
  validateAuthoredActivity,
} from "@recall/application";
import type { ActivityPluginMigrationPreview, ActivityRegistry } from "@recall/application";
import { Effect, Either } from "effect";
import { Button, Input, Label, Textarea } from "@recall/ui-web";
import { SavedActivityPluginRow } from "./SavedActivityPluginRow";

export type ActivityPluginToolsProps = {
  readonly library: ActivityLibrary;
  readonly registry?: ActivityRegistry;
  readonly areaId: string;
  readonly objectiveId: string;
  readonly createId: () => string;
  readonly platform: "web" | "native";
  readonly onSave: (library: ActivityLibrary) => Promise<boolean>;
  readonly disabled?: boolean;
};

export function WebActivityPluginTools(props: ActivityPluginToolsProps) {
  const registry = props.registry ?? builtinActivityRegistry;
  const available = useMemo(
    () => registry.filter((plugin) => plugin.capabilities.platforms.includes(props.platform)),
    [props.platform, registry],
  );
  const [pluginId, setPluginId] = useState(available[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [payload, setPayload] = useState(
    '{\n  "prompts": ["Explain the idea."],\n  "rubric": "Accurate explanation with an example.",\n  "reference": ""\n}',
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

  const create = async () => {
    if (!selected || props.disabled) return;
    const areaId = props.areaId;
    setBusy(true);
    const decodedPayload = await Effect.runPromise(
      Effect.either(decodeActivityPluginPayloadJson(payload)),
    );
    if (!readRef(alive) || currentAreaId.current !== areaId) return;
    if (Either.isLeft(decodedPayload)) {
      setMessage(decodedPayload.left.message);
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
            payload: decodedPayload.right,
          },
          props.platform,
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
    const next = { ...props.library, activities: [...props.library.activities, authored.right] };
    const saved = await saveLibrary(next);
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
    const next = {
      ...props.library,
      activities: props.library.activities.map((entry) =>
        entry.id === applied.right.id ? applied.right : entry,
      ),
    };
    const saved = await saveLibrary(next);
    if (!readRef(alive) || currentAreaId.current !== areaId) return;
    setMessage(
      saved ? "Approved migration saved as a new content revision." : "Migration was not saved.",
    );
    setPreview(null);
  };

  const prepareUnsupportedExport = async (activity: LearningActivity) => {
    const areaId = props.areaId;
    const output = await Effect.runPromise(
      Effect.either(exportUnsupportedActivity(activity, registry)),
    );
    if (!readRef(alive) || currentAreaId.current !== areaId) return;
    setExportJson(Either.isRight(output) ? output.right.json : output.left.message);
  };
  return (
    <section className="grid gap-3 rounded-lg border p-4" aria-label="Activity plugin tools">
      <h3 className="font-semibold">Activity plugin tools</h3>
      <p className="text-sm text-muted-foreground">
        Only already installed plugins can validate activity data. Imported content cannot install
        code or run automatic grading.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {available.map((plugin) => {
          const compatibility = inspectActivityPluginCompatibility(
            plugin,
            props.platform,
            plugin.capabilities.assessment,
          );
          return (
            <button
              key={plugin.id}
              type="button"
              disabled={props.disabled}
              aria-pressed={pluginId === plugin.id}
              className="rounded-md border p-3 text-left"
              onClick={() => {
                setPluginId(plugin.id);
              }}
            >
              <span className="block font-medium">
                {plugin.label} · v{plugin.version}
              </span>
              <span className="block text-sm text-muted-foreground">
                {compatibility.platform} · {plugin.capabilities.assessment} assessment ·{" "}
                {plugin.capabilities.offline ? "offline" : "online"}
                {plugin.capabilities.execution ? " · code execution capability" : ""}
              </span>
            </button>
          );
        })}
      </div>
      {selected && (
        <div className="grid gap-2">
          <Label htmlFor="plugin-tool-title">Activity title</Label>
          <Input
            id="plugin-tool-title"
            value={title}
            maxLength={300}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            disabled={props.disabled}
          />
          <Label htmlFor="plugin-tool-payload">Version {selected.version} payload (JSON)</Label>
          <Textarea
            id="plugin-tool-payload"
            value={payload}
            maxLength={100_000}
            rows={7}
            onChange={(event) => {
              setPayload(event.target.value);
            }}
            disabled={props.disabled}
          />
          <Button
            disabled={props.disabled || busy}
            onClick={() => {
              void create();
            }}
          >
            Validate and save activity
          </Button>
        </div>
      )}
      <div className="grid gap-2">
        <h4 className="font-medium">Saved activities</h4>
        {props.library.activities
          .filter((activity) => activity.areaId === props.areaId)
          .map((activity) => (
            <SavedActivityPluginRow
              key={activity.id}
              activity={activity}
              registry={registry}
              disabled={props.disabled ?? false}
              onPrepareExport={prepareUnsupportedExport}
              onPrepareMigration={prepareMigration}
            />
          ))}
      </div>
      {preview && (
        <div className="grid gap-2 rounded-md border p-3">
          <p>{preview.proposal.summary}</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">
            {JSON.stringify(preview.proposal.proposal, null, 2)}
          </pre>
          <div className="flex gap-2">
            <Button disabled={props.disabled} onClick={() => void applyMigration()}>
              Approve and apply migration
            </Button>
            <Button
              disabled={props.disabled}
              variant="secondary"
              onClick={() => {
                setPreview(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {exportJson && (
        <Textarea aria-label="Activity export JSON" readOnly value={exportJson} rows={6} />
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
