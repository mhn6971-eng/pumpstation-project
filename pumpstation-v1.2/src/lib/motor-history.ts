export type MotorStateHistoryEntry = {
  id: number;
  fromState: string;
  toState: string;
  at: string;
};

/** Reconstruct a motor's state at the end of a day from its ordered transition log. */
export function motorStateAtDayEnd(currentState: string, entries: MotorStateHistoryEntry[], dayEnd: string): string {
  const ordered = [...entries].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
  const before = ordered.filter((entry) => entry.at <= dayEnd).at(-1);
  if (before) return before.toState;
  return ordered.find((entry) => entry.at > dayEnd)?.fromState ?? currentState;
}
