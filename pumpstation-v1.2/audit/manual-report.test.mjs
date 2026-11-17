import assert from "node:assert/strict";
import { parseManualReport, serializeManualReport } from "../src/lib/manual-report.ts";

const legacy = "تیغه‌های صافی تمیز شد؛ لرزش غیرعادی پمپ مشاهده شد.";
assert.deepEqual(parseManualReport(legacy), { operations: legacy, failures: "" });
console.log("PASS | manual report | legacy text remains visible as operations");

const fields = {
  operations: "روغن‌کاری یاتاقان پمپ P-03 انجام شد.",
  failures: "لرزش غیرعادی پمپ P-05؛ بازدید فنی لازم است.",
};
assert.deepEqual(parseManualReport(serializeManualReport(fields)), fields);
console.log("PASS | manual report | operations and failure notice round-trip separately");

const malformed = "[[PUMPSTATION_MANUAL_REPORT_V1]]\nnot-json";
assert.deepEqual(parseManualReport(malformed), { operations: malformed, failures: "" });
console.log("PASS | manual report | malformed marker does not discard old text");
