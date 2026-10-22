import { useState } from "react";
import { useCardBrowser, adaptStudyCommandSave } from "@recall/react";
import { Either } from "effect";
import { Text, View } from "react-native";
import type { LearningArea, Workspace } from "@recall/domain";
import { browserCell, browserColumns, type BrowserColumn } from "@recall/application";
import { NativeSelect, NativeTextField } from "@recall/ui-native";
import { NativeButton } from "../ui/NativeButton";
import type { NativeStudyCommand } from "../../hooks/use-native-study-command";
export function NativeCardBrowser({
  workspace,
  area,
  now,
  save,
}: {
  readonly workspace: Workspace;
  readonly area: LearningArea;
  readonly now: number;
  readonly save?: NativeStudyCommand | undefined;
}) {
  const browser = useCardBrowser(
    workspace,
    area,
    now,
    save ? adaptStudyCommandSave(save) : undefined,
  );
  const [confirmation, setConfirmation] = useState("");
  const [showTags, setShowTags] = useState(false);
  return (
    <View className="gap-3 border-t py-4">
      <Text className="font-bold">Card browser</Text>
      <NativeTextField
        label="Search cards and notes"
        value={browser.query}
        onChangeText={browser.setQuery}
        maxLength={500}
      />
      <NativeSelect
        label="Browser mode"
        value={browser.mode}
        onValueChange={browser.setMode}
        options={[
          { label: "Cards", value: "cards" },
          { label: "Notes", value: "notes" },
        ]}
      />
      <NativeSelect
        label="Browser scope"
        value={browser.scope}
        onValueChange={browser.setScope}
        options={[
          { label: area.title, value: "subject" },
          { label: "All subjects", value: "all" },
        ]}
      />
      <NativeSelect
        label="Sort by"
        value={browser.sort}
        options={browserColumns.map((column) => ({ label: column, value: column }))}
        onValueChange={(value) => {
          if (browserColumns.includes(value as BrowserColumn))
            browser.setSort(value as BrowserColumn);
        }}
      />
      <NativeButton
        tone="soft"
        label={browser.descending ? "Descending ↓" : "Ascending ↑"}
        onPress={() => {
          browser.setDescending(!browser.descending);
        }}
      />
      <Text>Visible columns</Text>
      <View className="flex-row flex-wrap gap-2">
        {browserColumns.map((column) => (
          <NativeButton
            key={column}
            tone="soft"
            disabled={!save || browser.controls.busy}
            label={`${browser.columns.includes(column) ? "✓ " : ""}${column}`}
            onPress={() => {
              browser.toggleColumn(column);
            }}
          />
        ))}
      </View>
      <NativeButton
        label={showTags ? "Hide tag hierarchy" : "Show tag hierarchy"}
        tone="soft"
        onPress={() => {
          setShowTags(!showTags);
        }}
      />
      {showTags &&
        browser.tags.map((tag) => (
          <NativeButton
            key={tag.tag}
            label={`${"· ".repeat(tag.depth)}${tag.tag} (${String(tag.count)})`}
            tone="soft"
            onPress={() => {
              browser.setQuery(`tag:"${tag.tag}" OR tag:"${tag.tag}::*"`);
            }}
          />
        ))}
      {Either.isLeft(browser.matches) && (
        <Text accessibilityRole="alert">{browser.matches.left.message}</Text>
      )}
      <Text>
        {browser.entries.length} matches · page {browser.page + 1}
      </Text>
      {browser.rows.map((entry) => (
        <View key={entry.card.id} className="gap-1 border-b pb-2">
          {browser.columns.map((column) => (
            <Text key={column}>
              {column}: {browserCell(entry, column)}
            </Text>
          ))}
          <NativeButton
            label="Inspect related cards"
            tone="soft"
            onPress={() => {
              browser.setSelectedId(entry.card.id);
            }}
          />
        </View>
      ))}
      <NativeButton
        label="Previous page"
        tone="soft"
        disabled={!browser.page}
        onPress={() => {
          browser.setPage(browser.page - 1);
        }}
      />
      <NativeButton
        label="Next page"
        tone="soft"
        disabled={(browser.page + 1) * 50 >= browser.entries.length}
        onPress={() => {
          browser.setPage(browser.page + 1);
        }}
      />
      {browser.selectedId ? (
        <View>
          <Text className="font-bold">Related cards</Text>
          {browser.related.map(({ area, card }) => (
            <Text key={card.id}>
              {area.title}: {card.front} → {card.back}
            </Text>
          ))}
          {!browser.related.length && <Text>No siblings or shared learning objectives.</Text>}
        </View>
      ) : null}
      <Text className="font-bold">Find and replace</Text>
      <Text>
        Literal case-sensitive replacement in one subject, up to 500 matches. Front/back edit
        independent Basic cards; source note fields update all linked cards. Cloze source changes
        regenerate all linked siblings.
      </Text>
      <NativeSelect
        label="Replacement field"
        value={browser.field}
        options={[
          { label: "Front", value: "front" },
          { label: "Back", value: "back" },
          { label: "Cloze source", value: "cloze" },
          { label: "Source note field", value: "note" },
        ]}
        onValueChange={(value) => {
          if (value === "front" || value === "back" || value === "cloze" || value === "note")
            browser.setField(value);
        }}
      />
      {browser.field === "note" && (
        <NativeTextField
          label="Source field name"
          value={browser.noteField}
          onChangeText={browser.setNoteField}
        />
      )}
      <NativeTextField label="Find" value={browser.find} onChangeText={browser.setFind} />
      <NativeTextField
        label="Replace with"
        value={browser.replacement}
        onChangeText={browser.setReplacement}
      />
      <Text>{browser.changes.length} cards would change.</Text>
      {browser.changes.slice(0, 3).map((change) => (
        <Text key={change.card.id}>
          {change.before} → {change.after}
        </Text>
      ))}
      <NativeTextField
        label={`Type REPLACE ${String(browser.changes.length)} to confirm the current preview`}
        value={confirmation}
        onChangeText={setConfirmation}
      />
      <NativeButton
        label="Apply replacement"
        tone="soft"
        disabled={!browser.canApply || confirmation !== `REPLACE ${String(browser.changes.length)}`}
        onPress={() => {
          browser.apply();
          setConfirmation("");
        }}
      />
      {browser.controls.message ? (
        <Text accessibilityLiveRegion="polite">{browser.controls.message}</Text>
      ) : null}
    </View>
  );
}
