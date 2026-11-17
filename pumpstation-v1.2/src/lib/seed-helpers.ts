import { addDaysToDay, operationalDay } from "@/lib/jalali";

/** چند روز آخر (برای نمودار و داده نمونه) */
export async function jelaliSeedDays() {
  const op = operationalDay();
  return [5, 4, 3, 2, 1, 0].map((delta) => addDaysToDay(op.day, -delta));
}

export function padSeedValue(value: number, digits = 2) {
  return value.toFixed(digits);
}
