import { NativeCollapsible } from "@recall/ui-native";
import { NativeBrowserSelection } from "./NativeBrowserSelection";
import { NativeBrowserColumns } from "./NativeBrowserColumns";
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
  onEdit,
}: {
  readonly workspace: Workspace;
  readonly area: LearningArea;
  readonly now: number;
  readonly save?: NativeStudyCommand | undefined;
  readonly onEdit?:
    ((area: LearningArea, card: import("@recall/domain").Assessment) => void) | undefined;
}) {
  const browser = useCardBrowser(
    workspace,
    area,
    now,
    save ? adaptStudyCommandSave(save) : undefined,
  );
  const [confirmation, setConfirmation] = useState("");
  const [showTags, setShowTags] = useState(false);
  const [viewOptions, setViewOptions] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  return (
    <View className="gap-3 border-t py-4">
      {browser.selected && (
        <NativeBrowserSelection
          selected={browser.selected}
          related={browser.related}
          onEdit={onEdit}
          onBack={() => {
            browser.setSelectedId("");
          }}
          disabled={browser.controls.busy}
        />
      )}
      <View className={browser.selected ? "hidden" : "gap-3"}>
        <Text className="font-semibold text-base text-recall-ink">Card browser</Text>
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
        <NativeCollapsible
          open={viewOptions}
          title="View options"
          onToggle={() => {
            setViewOptions(!viewOptions);
          }}
        >
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
            variant="secondary"
            label={browser.descending ? "Descending ↓" : "Ascending ↑"}
            onPress={() => {
              browser.setDescending(!browser.descending);
            }}
          />
          <Text className="text-sm text-recall-ink">Visible columns</Text>
          <NativeBrowserColumns
            selected={browser.columns}
            disabled={!save || browser.controls.busy}
            onToggle={browser.toggleColumn}
          />
        </NativeCollapsible>
        <NativeCollapsible
          open={showTags}
          title="Tag hierarchy"
          onToggle={() => {
            setShowTags(!showTags);
          }}
        >
          {browser.tags.map((tag) => (
            <NativeButton
              key={tag.tag}
              label={`${"· ".repeat(tag.depth)}${tag.tag} (${String(tag.count)})`}
              variant="secondary"
              onPress={() => {
                browser.setQuery(`tag:"${tag.tag}" OR tag:"${tag.tag}::*"`);
              }}
            />
          ))}
        </NativeCollapsible>
        {Either.isLeft(browser.matches) && (
          <Text className="text-sm text-recall-ink" accessibilityRole="alert">
            {browser.matches.left.message}
          </Text>
        )}
        <Text className="text-sm text-recall-ink">
          {browser.entries.length} matches · page {browser.page + 1}
        </Text>
        {browser.rows.map((entry) => (
          <View key={entry.card.id} className="gap-1 border-b pb-2">
            {browser.columns.map((column) => (
              <Text className="text-sm text-recall-ink" key={column}>
                {column}: {browserCell(entry, column)}
              </Text>
            ))}
            <NativeButton
              label="Inspect related cards"
              variant="secondary"
              onPress={() => {
                browser.setSelectedId(entry.card.id);
              }}
            />
          </View>
        ))}
        <NativeButton
          label="Previous page"
          variant="secondary"
          disabled={!browser.page}
          onPress={() => {
            browser.setPage(browser.page - 1);
          }}
        />
        <NativeButton
          label="Next page"
          variant="secondary"
          disabled={(browser.page + 1) * 50 >= browser.entries.length}
          onPress={() => {
            browser.setPage(browser.page + 1);
          }}
        />
        {browser.selectedId ? (
          <View>
            <Text className="font-semibold text-base text-recall-ink">Related cards</Text>
            {browser.related.map(({ area, card }) => (
              <Text className="text-sm text-recall-ink" key={card.id}>
                {area.title}: {card.front} → {card.back}
              </Text>
            ))}
            {!browser.related.length && (
              <Text className="text-sm text-recall-ink">
                No siblings or shared learning objectives.
              </Text>
            )}
          </View>
        ) : null}
        <NativeCollapsible
          open={replaceOpen}
          title="Find and replace"
          onToggle={() => {
            setReplaceOpen(!replaceOpen);
          }}
        >
          <Text className="text-sm text-recall-ink">
            Literal case-sensitive replacement in one subject, up to 500 matches. Front/back edit
            independent Basic cards; source note fields update all linked cards. Cloze source
            changes regenerate all linked siblings.
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
          <Text className="text-sm text-recall-ink">
            {browser.changes.length} cards would change.
          </Text>
          {browser.changes.slice(0, 3).map((change) => (
            <Text className="text-sm text-recall-ink" key={change.card.id}>
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
            variant="default"
            disabled={
              !browser.canApply || confirmation !== `REPLACE ${String(browser.changes.length)}`
            }
            onPress={() => {
              browser.apply();
              setConfirmation("");
            }}
          />
        </NativeCollapsible>
        {browser.controls.message ? (
          <Text className="text-sm text-recall-ink" accessibilityLiveRegion="polite">
            {browser.controls.message}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
