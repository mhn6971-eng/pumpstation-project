const STRUCTURED_NOTE_PREFIX = "[[PUMPSTATION_MANUAL_REPORT_V1]]\n";

export type ManualReportFields = {
  operations: string;
  failures: string;
};

/** Old notes remain readable as the operations field; the DB column stays unchanged. */
export function parseManualReport(text: string): ManualReportFields {
  if (!text.startsWith(STRUCTURED_NOTE_PREFIX)) return { operations: text, failures: "" };
  try {
    const value = JSON.parse(text.slice(STRUCTURED_NOTE_PREFIX.length)) as Partial<ManualReportFields>;
    if (typeof value.operations === "string" && typeof value.failures === "string") {
      return { operations: value.operations, failures: value.failures };
    }
  } catch {
    // A malformed marker is kept visible as a legacy note instead of discarded.
  }
  return { operations: text, failures: "" };
}

export function serializeManualReport(fields: ManualReportFields): string {
  return `${STRUCTURED_NOTE_PREFIX}${JSON.stringify({
    operations: fields.operations.trim(),
    failures: fields.failures.trim(),
  })}`;
}
