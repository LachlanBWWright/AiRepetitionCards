export type StudyDay = { readonly startsAt: number; readonly endsAt: number };

/** Explicit timestamp; local calendar construction preserves DST-length study days. */
export function localStudyDay(now: number, startHour = 0): StudyDay {
  const date = new Date(now);
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate(), startHour);
  const offset = now < today.getTime() ? -1 : 0;
  return {
    startsAt: new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + offset,
      startHour,
    ).getTime(),
    endsAt: new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + offset + 1,
      startHour,
    ).getTime(),
  };
}
