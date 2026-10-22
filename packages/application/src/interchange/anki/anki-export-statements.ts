import { sha1 } from "@noble/hashes/legacy.js";
import type { LearningArea, ReviewEvent } from "@recall/domain";
import type { AnkiSqlStatement } from "./anki-export";
import { buildAnkiExportNotes } from "./anki-export-notes";

const schema = `CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn); CREATE INDEX ix_cards_usn on cards (usn); CREATE INDEX ix_revlog_usn on revlog (usn); CREATE INDEX ix_cards_nid on cards (nid); CREATE INDEX ix_cards_sched on cards (did, queue, due); CREATE INDEX ix_revlog_cid on revlog (cid); CREATE INDEX ix_notes_csum on notes (csum);`;
const statement = (sql: string, parameters: AnkiSqlStatement["parameters"]): AnkiSqlStatement => ({
  sql,
  parameters,
});

/** Standard schema-11 package. No synthetic review rows are generated. */
export function buildAnkiExportStatements(
  area: LearningArea,
  options: {
    readonly now: Date;
    readonly includeScheduling?: boolean;
    readonly reviewEvents?: readonly ReviewEvent[];
    readonly suspendedCardIds?: readonly string[];
  },
): readonly AnkiSqlStatement[] {
  const seconds = Math.floor(options.now.getTime() / 1000);
  const created = Math.floor(seconds / 86400) * 86400;
  const deckId = seconds * 1000;
  const exported = buildAnkiExportNotes(area, deckId, seconds);
  const deck = {
    id: deckId,
    name: area.title,
    mod: seconds,
    usn: -1,
    desc: area.description ?? "",
    dyn: 0,
    collapsed: false,
    browserCollapsed: false,
    conf: 1,
    extendNew: 0,
    extendRev: 0,
    newToday: [0, 0],
    revToday: [0, 0],
    lrnToday: [0, 0],
    timeToday: [0, 0],
  };
  const deckConfig = {
    id: 1,
    name: "Default",
    mod: seconds,
    usn: -1,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    new: {
      bury: true,
      delays: [1, 10],
      initialFactor: 2500,
      ints: [1, 4, 0],
      order: 1,
      perDay: 20,
    },
    rev: { bury: true, ease4: 1.3, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2 },
    lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
  };
  const rows: AnkiSqlStatement[] = [
    statement(schema, []),
    statement("INSERT INTO col VALUES (1,?,?,?,?,0,-1,0,?,?,?,?,?)", [
      created,
      options.now.getTime(),
      options.now.getTime(),
      11,
      JSON.stringify({
        nextPos: area.cards.length + 1,
        curDeck: deckId,
        activeDecks: [deckId],
        newSpread: 0,
        collapseTime: 1200,
        timeLim: 0,
        estTimes: true,
        dueCounts: true,
      }),
      JSON.stringify(exported.models),
      JSON.stringify({ [deckId]: deck }),
      JSON.stringify({ 1: deckConfig }),
      "{}",
    ]),
  ];
  for (const note of exported.notes) {
    rows.push(
      statement("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
        note.id,
        note.guid,
        note.modelId,
        seconds,
        -1,
        ` ${note.tags.map((tag) => tag.replace(/\s+/g, "_")).join(" ")} `,
        note.fields,
        note.front,
        new DataView(sha1(new TextEncoder().encode(note.front)).buffer).getUint32(0),
        0,
        "",
      ]),
    );
  }
  for (const [index, card] of area.cards.entries()) {
    const note = exported.cards[index];
    if (!note) continue;
    const schedule = card.schedule;
    const reviewed = options.includeScheduling && schedule.state !== 0;
    const queue = reviewed ? (schedule.state === 2 ? 2 : 1) : 0;
    const type = reviewed ? schedule.state : 0;
    const due = reviewed
      ? queue === 1
        ? Math.floor(Date.parse(schedule.due) / 1000)
        : Math.round((Date.parse(schedule.due) / 1000 - created) / 86400)
      : index + 1;
    rows.push(
      statement("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
        deckId + 2000 + index,
        note.noteId,
        deckId,
        note.ordinal,
        seconds,
        -1,
        type,
        options.includeScheduling && options.suspendedCardIds?.includes(card.id) ? -1 : queue,
        due,
        reviewed ? Math.max(1, Math.round(schedule.scheduled_days)) : 0,
        2500,
        reviewed ? schedule.reps : 0,
        reviewed ? schedule.lapses : 0,
        0,
        0,
        0,
        0,
        reviewed
          ? JSON.stringify({
              s: schedule.stability,
              d: schedule.difficulty,
              ...(schedule.last_review
                ? { lrt: Math.floor(Date.parse(schedule.last_review) / 1000) }
                : {}),
            })
          : "",
      ]),
    );
  }
  if (options.includeScheduling) {
    const cardIds = new Map(area.cards.map((card, index) => [card.id, deckId + 2000 + index]));
    for (const event of options.reviewEvents ?? []) {
      const cardId = cardIds.get(event.cardId);
      if (!cardId) continue;
      rows.push(
        statement("INSERT INTO revlog VALUES (?,?,?,?,?,?,?,?,?)", [
          Date.parse(event.effectiveReviewedAt ?? event.ratedAt),
          cardId,
          -1,
          { again: 1, hard: 2, good: 3, easy: 4 }[event.rating],
          0,
          0,
          0,
          Math.min(60000, event.elapsedMs ?? 0),
          1,
        ]),
      );
    }
  }
  return rows;
}
