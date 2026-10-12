import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

// logic/ 是宿主无关的纯逻辑层，这条测试盯着它。
// 它只允许 import 相对路径和 node: 内置模块——出现 mcp、codex、协议相关的东西就红。

const LOGIC_DIR = dirname(fileURLToPath(import.meta.url));
const IMPORT_PATTERN = /^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm;

test("logic/ 不 import 任何宿主相关模块", async () => {
  const files = (await readdir(LOGIC_DIR))
    .filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"))
    .sort();

  assert.ok(files.length > 0, "logic/ 里应该有实现文件");

  for (const name of files) {
    const source = await readFile(join(LOGIC_DIR, name), "utf8");
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1];
      assert.ok(
        specifier.startsWith(".") || specifier.startsWith("node:"),
        `${name} imports "${specifier}" —— logic/ 只能依赖相对路径和 node: 内置模块`
      );
    }
  }
});
