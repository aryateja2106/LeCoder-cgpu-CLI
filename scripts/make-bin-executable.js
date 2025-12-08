#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const target = path.resolve(__dirname, "..", "dist", "src", "index.js");

try {
  fs.accessSync(target);
  fs.chmodSync(target, 0o755);
  console.log(`Made executable: ${target}`);
} catch (err) {
  console.error(`Unable to set executable bit on ${target}:`, err.message);
  // Do not fail build; just warn.
}
