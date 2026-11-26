/** The days before a personal puzzle comes back, by how far along it is:
 * found at the last of these, it's learnt and retired. */
export const PUZZLE_INTERVAL_DAYS = [1, 3, 7, 14, 30] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export type Schedule = {
  step: number;
  dueAt: Date;
  retiredAt: Date | null;
};

/** Where a personal puzzle goes after a try: found, a step further on - or
 * retired, found at the last step; missed, back to the first. */
export function nextSchedule(
  step: number,
  solved: boolean,
  now: Date,
): Schedule {
  if (!solved) {
    return {
      step: 0,
      dueAt: new Date(now.getTime() + PUZZLE_INTERVAL_DAYS[0] * DAY_MS),
      retiredAt: null,
    };
  }
  const last = PUZZLE_INTERVAL_DAYS.length - 1;
  if (step >= last) return { step: last, dueAt: now, retiredAt: now };
  const next = step + 1;
  return {
    step: next,
    dueAt: new Date(now.getTime() + PUZZLE_INTERVAL_DAYS[next] * DAY_MS),
    retiredAt: null,
  };
}
