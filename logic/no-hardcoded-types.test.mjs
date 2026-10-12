import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { DEFAULT_TYPES } from "./config.mjs";

// 四个 slug 只允许出现在默认值表里。类型是开放集合——增删类型只改 .rein/config.toml，
// 不改代码。

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULTS_FILE = join("logic", "config.mjs");

// skills/ 也要扫：主 Agent 读的那份 SKILL.md 同样不该写死类型。
const SCANNED_DIRS = ["logic", "mcp", "ui", "skills"];
const SCANNED_EXTENSIONS = [".mjs", ".html", ".md"];

async function sourceFiles(dir) {
  const files = [];

  for (const entry of await readdir(join(REPO, dir), { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(file)));
      continue;
    }
    if (entry.name.endsWith(".test.mjs")) continue;
    if (!SCANNED_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue;
    files.push(file);
  }

  return files;
}

async function allSourceFiles() {
  const files = [];
  for (const dir of SCANNED_DIRS) files.push(...(await sourceFiles(dir)));
  return files;
}

test("四个 slug 只出现在默认值表里", async () => {
  const offenders = [];

  for (const file of await allSourceFiles()) {
    const source = await readFile(join(REPO, file), "utf8");
    for (const { slug } of DEFAULT_TYPES) {
      if (file !== DEFAULTS_FILE && source.includes(slug)) {
        offenders.push(`${file} 里出现了 ${slug}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});
