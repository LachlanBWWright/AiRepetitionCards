import { useDeferredValue, useMemo, useState } from "react";
import { equationSelection, insertEquation, type RichSelection } from "@recall/application";

export function useEquationEditor(validate: (source: string, display: boolean) => string | null) {
  const [draft, setDraft] = useState<{
    readonly value: string;
    readonly selection: RichSelection;
    readonly source: string;
    readonly display: boolean;
    readonly maxLength: number;
  } | null>(null);
  const deferred = useDeferredValue(draft);
  const error = useMemo(() => {
    if (!deferred?.source.trim()) return null;
    const syntax = validate(deferred.source, deferred.display);
    if (syntax) return syntax;
    return insertEquation(deferred.value, deferred.selection, deferred.source, deferred.display)
      .value.length > deferred.maxLength
      ? "This equation exceeds the card field’s character limit. Shorten the equation or surrounding text."
      : null;
  }, [deferred, validate]);
  const open = (value: string, selection: RichSelection, maxLength = Infinity) => {
    setDraft({
      value,
      selection,
      maxLength: maxLength > 0 ? maxLength : Infinity,
      ...equationSelection(value, selection),
    });
  };
  return {
    draft,
    error,
    pending: draft !== deferred,
    canInsert: Boolean(draft?.source.trim()) && !error && draft === deferred,
    open,
    close: () => {
      setDraft(null);
    },
    setSource: (source: string) => {
      setDraft((current) => (current ? { ...current, source } : null));
    },
    setDisplay: (display: boolean) => {
      setDraft((current) => (current ? { ...current, display } : null));
    },
    edit: () =>
      draft && !error && Boolean(draft.source.trim()) && draft === deferred
        ? insertEquation(draft.value, draft.selection, draft.source, draft.display)
        : null,
  };
}
