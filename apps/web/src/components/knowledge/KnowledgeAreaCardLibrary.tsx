"use client";

import type { LearningArea, StudyCard } from "@recall/domain";
import { useId, useState } from "react";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";

type KnowledgeAreaCardLibraryProps = {
  readonly area: LearningArea;
  readonly onEdit: (card: StudyCard) => void;
  readonly onDelete: (card: StudyCard) => void;
  readonly onAdd: () => void;
};

export function KnowledgeAreaCardLibrary({
  area,
  onEdit,
  onDelete,
  onAdd,
}: KnowledgeAreaCardLibraryProps) {
  const fieldId = useId();
  const [search, setSearch] = useState("");
  const [objectiveFilter, setObjectiveFilter] = useState("");
  const objectives = area.objectives ?? [];
  const legacyObjectives = [...new Set(area.cards.map((card) => card.objective))].filter(
    (title) => !objectives.some((objective) => objective.title === title),
  );
  const query = search.trim().toLocaleLowerCase();
  const filteredCards = area.cards.filter((card) => {
    const matchesQuery = [card.front, card.back, ...(card.tags ?? [])].some((value) =>
      value.toLocaleLowerCase().includes(query),
    );
    const matchesObjective =
      !objectiveFilter ||
      objectives.some(
        (objective) =>
          `id:${objective.id}` === objectiveFilter &&
          ((card.objectiveIds ?? []).includes(objective.id) || card.objective === objective.title),
      ) ||
      `title:${card.objective}` === objectiveFilter;
    return matchesQuery && matchesObjective;
  });

  return (
    <section aria-labelledby={`${fieldId}-title`} style={{ marginTop: 32 }}>
      <div className="section-title-row">
        <div>
          <p className="eyebrow">{area.title}</p>
          <h2 id={`${fieldId}-title`}>Your cards</h2>
        </div>
        <Button size="small" onClick={onAdd}>
          Add a card
        </Button>
      </div>
      <p>Browse and edit every card, including those scheduled for later.</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBlock: 20 }}>
        <label htmlFor={`${fieldId}-search`} style={{ display: "grid", gap: 8, flex: "1 1 240px" }}>
          Search cards
          <input
            id={`${fieldId}-search`}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Question, answer or tag"
            style={{ padding: 12, borderRadius: 10, border: "1px solid #deded5" }}
          />
        </label>
        {(objectives.length > 0 || legacyObjectives.length > 0) && (
          <label
            htmlFor={`${fieldId}-objective`}
            style={{ display: "grid", gap: 8, flex: "1 1 200px" }}
          >
            Learning objective
            <select
              id={`${fieldId}-objective`}
              value={objectiveFilter}
              onChange={(event) => setObjectiveFilter(event.target.value)}
              style={{ padding: 12, borderRadius: 10, border: "1px solid #deded5" }}
            >
              <option value="">All objectives</option>
              {objectives.map((objective) => (
                <option key={objective.id} value={`id:${objective.id}`}>
                  {objective.title}
                </option>
              ))}
              {legacyObjectives.map((title) => (
                <option key={title} value={`title:${title}`}>
                  {title}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <p role="status" aria-live="polite">
        {filteredCards.length} of {area.cards.length} cards
      </p>
      {filteredCards.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 16 }}>
          {filteredCards.map((card) => (
            <li key={card.id} className="summary-card" style={{ padding: 24 }}>
              <h3 style={{ marginTop: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {card.front}
              </h3>
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{card.back}</p>
              <p>
                {card.objective} · Next review:{" "}
                <time dateTime={card.schedule.due}>{card.schedule.due.slice(0, 10)}</time>
              </p>
              {(card.tags ?? []).length > 0 && (
                <p aria-label="Tags">{card.tags?.map((tag) => `#${tag}`).join(" ")}</p>
              )}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => onEdit(card)}
                  aria-label={`Edit card: ${card.front}`}
                >
                  Edit card
                </Button>
                <Button
                  size="small"
                  variant="danger"
                  onClick={() => onDelete(card)}
                  aria-label={`Delete card: ${card.front}`}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={area.cards.length === 0 ? "Start your card library" : "No matching cards"}
          description={
            area.cards.length === 0
              ? "Add your first question and answer to start studying."
              : "Try another search or learning objective."
          }
          action={
            area.cards.length === 0 ? (
              <Button size="small" onClick={onAdd}>
                Add a card
              </Button>
            ) : (
              <Button
                size="small"
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  setObjectiveFilter("");
                }}
              >
                Clear filters
              </Button>
            )
          }
        />
      )}
    </section>
  );
}
