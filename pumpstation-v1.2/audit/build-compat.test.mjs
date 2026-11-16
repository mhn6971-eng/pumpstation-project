import assert from "node:assert/strict";
import nextConfig from "../next.config.ts";

assert.equal(nextConfig.experimental?.cpus, 2, "build concurrency must stay low for Windows stations");
console.log("PASS | Next build | page-data worker count is capped at 2");
