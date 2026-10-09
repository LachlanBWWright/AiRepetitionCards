"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Effect, Either, Fiber, Schema } from "effect";
import {
  searchWorkspace,
  type WorkspaceSearchKind,
  type WorkspaceSearchNotebook,
  type WorkspaceSearchResult,
} from "@recall/application";
import type { Workspace } from "@recall/domain";
import {
  Alert,
  AlertDescription,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web";
import { Badge } from "@recall/ui-web/components/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@recall/ui-web/components/command";
import { Label } from "@recall/ui-web/components/label";
import { loadBrowserWorkspaceSearchNotebooks } from "@/features/search/load-search-notebooks";
import {
  localWritesBlocked,
  subscribeLocalWrites,
} from "@/features/workspace/local-write-coordinator";
import "@/lib/desktop-api";

const StatusReply = Schema.Struct({
  _tag: Schema.Literal("Success"),
  value: Schema.Struct({ activeClientId: Schema.NullOr(Schema.String) }),
});
const activeProfile = (): Effect.Effect<string | null, string> =>
  Effect.gen(function* () {
    const bridge = window.recallDesktop?.chatgpt;
    if (!bridge) return null;
    const raw = yield* Effect.tryPromise({
      try: bridge.status,
      catch: () => "ChatGPT account status is unavailable. Retry search.",
    });
    const decoded = Schema.decodeUnknownEither(StatusReply)(raw);
    if (Either.isLeft(decoded))
      return yield* Effect.fail("ChatGPT account status is unavailable. Retry search.");
    return decoded.right.value.activeClientId;
  });
const labels: Readonly<Record<WorkspaceSearchKind, string>> = {
  area: "Area",
  card: "Card",
  objective: "Objective",
  concept: "Concept",
  material: "Material",
  passage: "Source passage",
  claim: "Study topic",
  conversation: "Tutor discussion",
  suggestion: "Suggestion",
};
export type WorkspaceSearchPanelProps = {
  readonly workspace: Workspace;
  readonly ownershipKey: string;
  readonly onOpenResult: (result: WorkspaceSearchResult) => void;
  readonly initialQuery?: string;
  readonly demoNotebooks?: readonly WorkspaceSearchNotebook[];
};

export function WorkspaceSearchPanel({
  workspace,
  ownershipKey,
  onOpenResult,
  initialQuery = "",
  demoNotebooks,
}: WorkspaceSearchPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<WorkspaceSearchKind | "all">("all");
  const [records, setRecords] = useState<readonly WorkspaceSearchNotebook[]>(demoNotebooks ?? []);
  const [indexedOwner, setIndexedOwner] = useState(ownershipKey);
  const [loading, setLoading] = useState(demoNotebooks === undefined);
  const [message, setMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [unreadable, setUnreadable] = useState(0);
  const epoch = useRef(0);
  const profile = useRef<string | null>(null);
  const owner = useRef(ownershipKey);

  useEffect(() => {
    owner.current = ownershipKey;
    const token = ++epoch.current;
    if (demoNotebooks !== undefined) return;
    const fiber = Effect.runFork(
      Effect.gen(function* () {
        setRecords([]);
        setLoading(true);
        setMessage(null);
        setUnreadable(0);
        if (localWritesBlocked())
          return yield* Effect.fail("Reload the app to search the current library.");
        const clientId = yield* activeProfile();
        const namespaces = [
          "hosted",
          "hosted:card-refinements",
          ...(clientId ? [`chatgpt:${clientId}`, `chatgpt:${clientId}:card-refinements`] : []),
        ];
        const loaded = yield* loadBrowserWorkspaceSearchNotebooks(workspace, namespaces);
        if ((yield* activeProfile()) !== clientId)
          return yield* Effect.fail("The ChatGPT account changed. Retry search.");
        if (epoch.current !== token || localWritesBlocked()) return;
        profile.current = clientId;
        setIndexedOwner(ownershipKey);
        setRecords(loaded.notebooks);
        setUnreadable(loaded.unreadableCount);
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            if (epoch.current === token) setMessage(error);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (epoch.current === token) setLoading(false);
          }),
        ),
      ),
    );
    const invalidate = () => {
      ++epoch.current;
      setRecords([]);
      setLoading(false);
      setMessage("The local library changed. Retry search.");
    };
    const cancel = () => {
      ++epoch.current;
    };
    const unsubscribe = subscribeLocalWrites(invalidate);
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      cancel();
      unsubscribe();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [workspace, ownershipKey, demoNotebooks, revision]);
  const results = useMemo(
    () =>
      searchWorkspace(
        workspace,
        demoNotebooks ?? (indexedOwner === ownershipKey ? records : []),
        query,
        {
          limit: 200,
          ...(filter === "all" ? {} : { kinds: [filter] }),
        },
      ),
    [workspace, records, demoNotebooks, indexedOwner, ownershipKey, query, filter],
  );
  function open(result: WorkspaceSearchResult) {
    if (demoNotebooks !== undefined) {
      onOpenResult(result);
      return;
    }
    const token = epoch.current;
    const expectedOwner = ownershipKey;
    Effect.runFork(
      activeProfile().pipe(
        Effect.flatMap((clientId) =>
          Effect.sync(() => {
            if (epoch.current !== token || owner.current !== expectedOwner || localWritesBlocked())
              return;
            if (clientId !== profile.current) {
              setRecords([]);
              setMessage("The ChatGPT account changed. Retry search.");
              return;
            }
            onOpenResult(result);
          }),
        ),
        Effect.catchAll((error) =>
          Effect.sync(() => {
            if (epoch.current === token) setMessage(error);
          }),
        ),
      ),
    );
  }
  return (
    <section aria-label="Search library" className="grid gap-4">
      <Command
        shouldFilter={false}
        aria-label="Search library"
        className="overflow-hidden rounded-xl border bg-background shadow-sm"
      >
        <CommandInput
          id="workspace-search"
          aria-label="Search library"
          autoFocus
          value={query}
          maxLength={500}
          placeholder="Cards, topics, source text…"
          onValueChange={setQuery}
        />
        {query.trim() && (
          <p role="status" className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            {results.length === 200 ? "200+" : results.length}{" "}
            {results.length === 1 ? "result" : "results"}
          </p>
        )}
        <CommandList aria-label="Search results" className="min-h-48 max-h-[min(55dvh,28rem)]">
          {query.trim() ? (
            <>
              <CommandEmpty className="px-6 py-12">
                No matching results. Try a different title or topic.
              </CommandEmpty>
              <CommandGroup heading="Results">
                {results.map((result) => (
                  <CommandItem
                    key={result.id}
                    value={result.id}
                    disabled={
                      demoNotebooks === undefined && (loading || indexedOwner !== ownershipKey)
                    }
                    onSelect={() => open(result)}
                    className="items-start gap-1 whitespace-normal rounded-lg px-3 py-3"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{result.areaTitle}</Badge>
                      <Badge variant="outline">{labels[result.kind]}</Badge>
                    </span>
                    <strong>{result.title}</strong>
                    <span className="font-normal">{result.snippet}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : (
            <CommandEmpty>
              <span className="mx-auto flex max-w-sm flex-col items-center gap-2 px-4 py-10 text-center">
                <span className="text-sm font-medium text-foreground">
                  Find anything in your workspace
                </span>
                <span className="font-normal leading-relaxed">
                  Search cards, study materials, source passages, and saved tutor discussions.
                </span>
              </span>
            </CommandEmpty>
          )}
        </CommandList>
      </Command>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor="workspace-search-kind" className="text-sm font-medium">
            Filter results
          </Label>
          <p className="text-xs text-muted-foreground">Choose what to include in search</p>
        </div>
        <Select
          value={filter}
          onValueChange={(next) => {
            if (next === "all" || Object.hasOwn(labels, next))
              setFilter(next as WorkspaceSearchKind | "all");
          }}
        >
          <SelectTrigger
            id="workspace-search-kind"
            aria-label="Filter results"
            className="w-44 bg-background"
          >
            <SelectValue placeholder="Everything" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everything</SelectItem>
            {Object.entries(labels).map(([kind, label]) => (
              <SelectItem key={kind} value={kind}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {loading && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading saved materials and discussions…
        </p>
      )}
      {message && (
        <Alert variant="destructive">
          <AlertDescription>
            {message}{" "}
            <Button
              variant="link"
              size="small"
              type="button"
              className="h-auto p-0 align-baseline"
              onClick={() => setRevision((value) => value + 1)}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {unreadable > 0 && (
        <Alert>
          <AlertDescription>
            {unreadable} saved notebooks could not be read. Their data has been preserved.
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
