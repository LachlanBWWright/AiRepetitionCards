import { useId } from "react";
import { CardBrowserSelection } from "./CardBrowserSelection";
import { FieldError } from "@recall/ui-web/components/field";
import { Label } from "@recall/ui-web/components/label";
import { CardBrowserTable, columnLabels } from "./CardBrowserTable";
import { CardBrowserReplacement } from "./CardBrowserReplacement";
import { useCardBrowser } from "@recall/react";
import { Either } from "effect";
import type { Assessment, LearningArea, Workspace } from "@recall/domain";
import { browserColumns, type BrowserColumn } from "@recall/application";
import type { StudyCommandSave } from "@recall/react";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";
export function CardBrowser({
  workspace,
  area,
  now,
  save,
  onEdit,
}: {
  readonly workspace: Workspace;
  readonly area: LearningArea;
  readonly now: number;
  readonly save: StudyCommandSave;
  readonly onEdit?: ((card: Assessment) => void) | undefined;
}) {
  const queryErrorId = useId();
  const browser = useCardBrowser(workspace, area, now, save);
  const columnControls = browserColumns.map((column) => (
    <Label key={column} className="flex gap-2">
      <Checkbox
        checked={browser.columns.includes(column)}
        disabled={browser.controls.busy}
        onCheckedChange={() => {
          browser.toggleColumn(column);
        }}
      />
      {columnLabels[column]}
    </Label>
  ));
  const tagControls = browser.tags.map((tag) => (
    <Button
      key={tag.tag}
      variant="secondary"
      onClick={() => {
        browser.setQuery(`tag:"${tag.tag}" OR tag:"${tag.tag}::*"`);
      }}
    >
      {"· ".repeat(tag.depth)}
      {tag.tag} ({tag.count})
    </Button>
  ));
  return (
    <section className="grid min-w-0 gap-4" aria-label="Card browser">
      <h3 className="sr-only">Card browser</h3>
      <Label className="grid gap-2 text-sm font-medium">
        Search cards and notes
        <Input
          placeholder="Try tag:exam, note:Basic, or field:Front:ATP"
          aria-invalid={Either.isLeft(browser.matches)}
          aria-describedby={Either.isLeft(browser.matches) ? queryErrorId : undefined}
          value={browser.query}
          maxLength={500}
          onChange={(event) => {
            browser.setQuery(event.target.value);
          }}
        />
      </Label>
      <div className="grid min-w-0 items-center gap-3 sm:grid-cols-3">
        <Select value={browser.mode} onValueChange={browser.setMode}>
          <SelectTrigger aria-label="Browser mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cards">Cards</SelectItem>
            <SelectItem value="notes">Notes</SelectItem>
          </SelectContent>
        </Select>
        <Select value={browser.scope} onValueChange={browser.setScope}>
          <SelectTrigger aria-label="Browser scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="subject">{area.title}</SelectItem>
            <SelectItem value="all">All subjects</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={browser.sort}
          onValueChange={(value) => {
            if (browserColumns.includes(value as BrowserColumn))
              browser.setSort(value as BrowserColumn);
          }}
        >
          <SelectTrigger aria-label="Sort cards by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {browserColumns.map((column) => (
              <SelectItem key={column} value={column}>
                {columnLabels[column]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label className="flex gap-2">
          <Checkbox
            checked={browser.descending}
            onCheckedChange={(value) => {
              browser.setDescending(value === true);
            }}
          />
          Descending
        </Label>
      </div>
      <Accordion type="single" collapsible>
        <AccordionItem value="options">
          <AccordionTrigger className="text-muted-foreground">View options</AccordionTrigger>
          <AccordionContent className="grid gap-3">
            <div className="flex flex-wrap gap-4">{columnControls}</div>
            {browser.tags.length > 0 && (
              <div className="grid gap-2">
                <p className="text-sm font-medium">Filter by tag</p>
                <div className="flex flex-wrap gap-2">{tagControls}</div>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      {Either.isLeft(browser.matches) && (
        <FieldError id={queryErrorId}>{browser.matches.left.message}</FieldError>
      )}
      <p className="text-sm text-muted-foreground">
        {browser.entries.length} {browser.mode}. Select a row to see related cards.
      </p>
      <div
        className={
          browser.selected
            ? "grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]"
            : "min-w-0"
        }
      >
        {browser.selected && (
          <div className="lg:order-2">
            <CardBrowserSelection
              selected={browser.selected}
              onEdit={onEdit}
              onClose={() => {
                browser.setSelectedId("");
              }}
            />
          </div>
        )}
        <CardBrowserTable
          entries={browser.rows}
          columns={browser.columns}
          page={browser.page}
          onSelect={browser.setSelectedId}
        />
      </div>
      <div className="flex gap-2">
        <Button
          variant="default"
          disabled={!browser.page}
          onClick={() => {
            browser.setPage(browser.page - 1);
          }}
        >
          Previous page
        </Button>
        <Button
          variant="default"
          disabled={(browser.page + 1) * 50 >= browser.entries.length}
          onClick={() => {
            browser.setPage(browser.page + 1);
          }}
        >
          Next page
        </Button>
      </div>
      {browser.selectedId && (
        <div>
          <h4 className="font-semibold">Related cards</h4>
          {browser.related.length ? (
            browser.related.map(({ area, card }) => (
              <p key={card.id}>
                {area.title}: {card.front} → {card.back}
              </p>
            ))
          ) : (
            <p>No siblings or shared learning objectives.</p>
          )}
        </div>
      )}
      <CardBrowserReplacement browser={browser} />
      {browser.controls.message && <p role="status">{browser.controls.message}</p>}
    </section>
  );
}
