import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import process from "node:process";
import { emptyNodeBuiltinsPlugin } from "./browserNodeBuiltinsPlugin.mjs";

const testEntries = (await readdir("test", { recursive: true }))
  .filter((entry) => entry.endsWith(".test.ts"))
  .map((entry) => `test/${entry}`)
  .sort();

for (const entryPoint of testEntries) {
  await build({
    entryPoints: [entryPoint],
    bundle: true,
    target: "firefox115",
    write: false,
    plugins: [emptyNodeBuiltinsPlugin],
  });
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "node_modules/mocha/bin/mocha.js", "test/**/*.test.ts"],
  { stdio: "inherit" },
);

process.exitCode = result.status ?? 1;
