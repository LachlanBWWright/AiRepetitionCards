"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { Effect, Either, Schema } from "effect";
import {
  formatTagInput,
  parseTagInput,
  toKnowledgeArea,
  updateAreaSettings,
  workspaceAuthoringBaseline,
  type AreaSettings,
} from "@recall/application";
import { ObjectiveIdSchema, type LearningArea } from "@recall/domain";
import { Button } from "@/components/ui/Button";

export type AreaSettingsSaveFailure = {
  readonly _tag: "AreaSettingsSaveFailure";
  readonly reason: "stale-content" | "storage" | "paused" | "unavailable";
  readonly message: string;
};

type Props = {
  readonly area: LearningArea;
  readonly onSave: (
    settings: AreaSettings,
    expectedBaseline: string,
  ) => Effect.Effect<LearningArea, AreaSettingsSaveFailure>;
  readonly readLatest?: () => LearningArea | null;
  readonly initialDraftArea?: LearningArea;
  readonly initialSaveFailure?: AreaSettingsSaveFailure;
  readonly createId?: () => string;
};
const fieldStyle: CSSProperties = { display: "grid", gap: 6 };
const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid var(--border, #d8ded3)",
  borderRadius: 8,
  background: "var(--surface, #fff)",
  color: "inherit",
  font: "inherit",
};
const panelStyle: CSSProperties = {
  display: "grid",
  gap: 16,
  border: "1px solid var(--border, #d8ded3)",
  borderRadius: 12,
  padding: 20,
};
const nullable = (value: string): string | null => (value.trim() ? value : null);
const initialSettings = (area: LearningArea): AreaSettings => {
  const exported = Effect.runSync(Effect.either(toKnowledgeArea(area, true, true)));
  return {
    description: area.description ?? null,
    language: area.language ?? "en",
    tags: area.tags ?? [],
    licence: area.licence ?? null,
    attribution: area.attribution ?? null,
    ai: area.ai ?? {
      tutorInstructions: "",
      quizInstructions: null,
      cardGenerationInstructions: null,
    },
    objectives: area.objectives ?? (Either.isRight(exported) ? exported.right.objectives : []),
  };
};

function baselineOf(area: LearningArea): string {
  return (
    workspaceAuthoringBaseline(
      { schemaVersion: 1, reviews: 0, reviewEvents: [], areas: [area] },
      { kind: "update-area-settings", areaId: area.id, settings: initialSettings(area) },
    ) ?? ""
  );
}

/** Mount with an area-specific key when changing the selected area. */
export function KnowledgeAreaSettings({
  area,
  onSave,
  createId = () => crypto.randomUUID(),
  readLatest,
  initialDraftArea,
  initialSaveFailure,
}: Props) {
  const prefix = useId();
  const [draftArea, setDraftArea] = useState(initialDraftArea ?? area);
  const [draft, setDraft] = useState(() => initialSettings(initialDraftArea ?? area));
  const [tags, setTags] = useState(() => formatTagInput((initialDraftArea ?? area).tags ?? []));
  const saving = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [feedback, setFeedback] = useState<{
    readonly kind: "error" | "saved";
    readonly text: string;
  } | null>(initialSaveFailure ? { kind: "error", text: initialSaveFailure.message } : null);
  const update = (changes: Partial<AreaSettings>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setFeedback(null);
  };
  const addObjective = () => {
    const id = Schema.decodeUnknownEither(ObjectiveIdSchema)(createId());
    if (Either.isLeft(id)) {
      setFeedback({
        kind: "error",
        text: "An objective ID could not be created. Please try again.",
      });
      return;
    }
    update({
      objectives: [
        ...draft.objectives,
        { id: id.right, title: "", description: null, prerequisiteIds: [] },
      ],
    });
  };
  const reload = () => {
    if (saving.current) return;
    if (!window.confirm("Discard your draft and load the latest knowledge area settings?")) return;
    const latest = readLatest ? readLatest() : area;
    if (!latest || latest.id !== draftArea.id) {
      setFeedback({
        kind: "error",
        text: "This knowledge area is no longer available. Your draft is preserved.",
      });
      return;
    }
    setDraftArea(latest);
    setDraft(initialSettings(latest));
    setTags(formatTagInput(latest.tags ?? []));
    setFeedback(null);
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving.current) return;
    const parsedTags = parseTagInput(tags);
    if (Either.isLeft(parsedTags)) {
      setFeedback({ kind: "error", text: parsedTags.left.message });
      return;
    }
    const settings = { ...draft, tags: parsedTags.right };
    const validated = Effect.runSync(Effect.either(updateAreaSettings(draftArea, settings)));
    if (Either.isLeft(validated)) {
      setFeedback({ kind: "error", text: validated.left.message });
      return;
    }
    saving.current = true;
    setBusy(true);
    setFeedback(null);
    const result = await Effect.runPromise(Effect.either(onSave(settings, baselineOf(draftArea))));
    saving.current = false;
    if (!mounted.current) return;
    setBusy(false);
    if (Either.isLeft(result)) {
      setFeedback({ kind: "error", text: result.left.message });
      return;
    }
    setDraftArea(result.right);
    setDraft(initialSettings(result.right));
    setTags(formatTagInput(result.right.tags ?? []));
    setFeedback({ kind: "saved", text: "Knowledge area settings saved on this device." });
  };
  const instructions = [
    {
      key: "tutorInstructions",
      label: "Tutor instructions",
      help: "Guide how the tutor explains and asks questions.",
    },
    {
      key: "quizInstructions",
      label: "Quiz instructions",
      help: "Describe the kinds of questions you want to practice.",
    },
    {
      key: "cardGenerationInstructions",
      label: "Card generation instructions",
      help: "Guide the style and detail of proposed cards.",
    },
  ] as const;

  return (
    <form
      className="knowledge-area-settings"
      aria-busy={busy}
      onSubmit={save}
      style={{ display: "grid", gap: 20 }}
    >
      <div>
        <h2 style={{ marginBottom: 6 }}>Knowledge area settings</h2>
        <p style={{ margin: 0 }}>Shape {area.title} and the learning goals your cards support.</p>
      </div>
      <fieldset
        disabled={busy}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "grid", gap: 20 }}
      >
        {feedback && (
          <p
            role={feedback.kind === "error" ? "alert" : "status"}
            style={{ margin: 0, color: feedback.kind === "error" ? "#a12e20" : "inherit" }}
          >
            {feedback.text}
          </p>
        )}
        <section aria-labelledby={`${prefix}-details`} style={panelStyle}>
          <h3 id={`${prefix}-details`} style={{ margin: 0 }}>
            Details and attribution
          </h3>
          <label style={fieldStyle}>
            Description
            <textarea
              style={inputStyle}
              rows={3}
              value={draft.description ?? ""}
              onChange={(event) => update({ description: nullable(event.target.value) })}
            />
          </label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 16,
            }}
          >
            <label style={fieldStyle}>
              Language
              <input
                style={inputStyle}
                required
                maxLength={80}
                placeholder="en"
                value={draft.language}
                onChange={(event) => update({ language: event.target.value })}
              />
            </label>
            <label style={fieldStyle}>
              Tags
              <textarea
                style={inputStyle}
                rows={2}
                placeholder="biology, cells"
                value={tags}
                onChange={(event) => {
                  setTags(event.target.value);
                  setFeedback(null);
                }}
              />
              <small>
                Separate with commas; quote a tag containing commas, double embedded quotes.
              </small>
            </label>
            <label style={fieldStyle}>
              License
              <input
                style={inputStyle}
                maxLength={120}
                placeholder="e.g. CC BY 4.0"
                value={draft.licence ?? ""}
                onChange={(event) => update({ licence: nullable(event.target.value) })}
              />
            </label>
            <label style={fieldStyle}>
              Attribution
              <textarea
                style={inputStyle}
                rows={2}
                maxLength={500}
                placeholder="Credit the original author or source."
                value={draft.attribution ?? ""}
                onChange={(event) => update({ attribution: nullable(event.target.value) })}
              />
            </label>
          </div>
        </section>
        <section aria-labelledby={`${prefix}-ai`} style={panelStyle}>
          <h3 id={`${prefix}-ai`} style={{ margin: 0 }}>
            AI preferences
          </h3>
          <p style={{ margin: 0 }}>
            These preferences guide AI suggestions. Review proposals before adding them to your
            area.
          </p>
          {instructions.map(({ key, label, help }) => (
            <label key={key} style={fieldStyle}>
              {label}
              <textarea
                style={inputStyle}
                rows={3}
                maxLength={2000}
                value={draft.ai[key] ?? ""}
                onChange={(event) =>
                  update({
                    ai: {
                      ...draft.ai,
                      [key]:
                        key === "tutorInstructions"
                          ? event.target.value
                          : nullable(event.target.value),
                    },
                  })
                }
              />
              <small>
                {help} {(draft.ai[key] ?? "").length}/2,000 characters
              </small>
            </label>
          ))}
        </section>
        <section aria-labelledby={`${prefix}-objectives`} style={panelStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <h3 id={`${prefix}-objectives`} style={{ margin: 0 }}>
              Learning objectives
            </h3>
            <Button
              variant="secondary"
              size="small"
              onClick={addObjective}
              disabled={draft.objectives.length >= 200}
            >
              Add objective
            </Button>
          </div>
          <p style={{ margin: 0 }}>
            Connect goals with prerequisites. Removing a goal unlinks its cards while preserving
            their review progress.
          </p>
          <small>{draft.objectives.length}/200 objectives</small>
          {draft.objectives.length === 0 && (
            <p style={{ margin: 0 }}>No objectives yet. Add a goal to organize your cards.</p>
          )}
          {draft.objectives.map((objective, index) => (
            <fieldset key={objective.id} style={{ ...panelStyle, minWidth: 0 }}>
              <legend>Objective {index + 1}</legend>
              <label style={fieldStyle}>
                Title
                <input
                  style={inputStyle}
                  required
                  value={objective.title}
                  onChange={(event) =>
                    update({
                      objectives: draft.objectives.map((item) =>
                        item.id === objective.id ? { ...item, title: event.target.value } : item,
                      ),
                    })
                  }
                />
              </label>
              <label style={fieldStyle}>
                Description
                <textarea
                  style={inputStyle}
                  rows={2}
                  value={objective.description ?? ""}
                  onChange={(event) =>
                    update({
                      objectives: draft.objectives.map((item) =>
                        item.id === objective.id
                          ? { ...item, description: nullable(event.target.value) }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
                <legend style={{ marginBottom: 8 }}>Prerequisites</legend>
                {draft.objectives.length < 2 && (
                  <small>Add another objective to choose prerequisites.</small>
                )}
                {draft.objectives
                  .filter((item) => item.id !== objective.id)
                  .map((prerequisite) => (
                    <label key={prerequisite.id} style={{ display: "flex", gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={objective.prerequisiteIds.includes(prerequisite.id)}
                        onChange={(event) =>
                          update({
                            objectives: draft.objectives.map((item) =>
                              item.id === objective.id
                                ? {
                                    ...item,
                                    prerequisiteIds: event.target.checked
                                      ? [...item.prerequisiteIds, prerequisite.id]
                                      : item.prerequisiteIds.filter((id) => id !== prerequisite.id),
                                  }
                                : item,
                            ),
                          })
                        }
                      />
                      {prerequisite.title || "Untitled objective"}
                    </label>
                  ))}
              </fieldset>
              <div>
                <Button
                  variant="danger"
                  size="small"
                  onClick={() =>
                    update({
                      objectives: draft.objectives
                        .filter((item) => item.id !== objective.id)
                        .map((item) => ({
                          ...item,
                          prerequisiteIds: item.prerequisiteIds.filter((id) => id !== objective.id),
                        })),
                    })
                  }
                >
                  Remove objective
                </Button>
              </div>
            </fieldset>
          ))}
        </section>
        <div>
          <Button type="submit">{busy ? "Saving settings…" : "Save settings"}</Button>
          <Button variant="secondary" onClick={reload}>
            Reload latest settings
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
