import type { Assessment } from "@recall/domain";

/** Fresh identities have no historical baseline or links to another note library. */
export function independentCardContent(card: Assessment): Assessment {
  const content = { ...card };
  delete content.importedSchedule;
  delete content.noteId;
  delete content.templateId;
  delete content.siblingId;
  return content;
}
