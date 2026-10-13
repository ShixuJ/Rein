import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { VERSION_TOKEN, injectVersion } from "./version.mjs";

// 版本只有一个真源：插件清单（装到哪个目录、要不要重装都看它）。两条规矩盯着它：
//
// 1. 清单与 `package.json` 由**人**手改，两处必须一致——漏一处的后果是安静的。
// 2. **代码里不写死版本号**：server 运行时读清单，面板用占位符、由 server 替换。
//    写死的那两处正是"代码看着是新的、跑的其实是旧副本"的经典来源。

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(relative) {
  return readFile(join(REPO, relative), "utf8");
}

test("清单与 package.json 的版本号一致", async () => {
  const manifest = JSON.parse(await read(".codex-plugin/plugin.json"));
  const pkg = JSON.parse(await read("package.json"));

  assert.ok(manifest.version, "清单里没有 version");
  assert.equal(pkg.version, manifest.version, "package.json 与清单的版本号不一致");
});

test("server 运行时读清单，代码里不写死版本号", async () => {
  const server = await read("mcp/server.mjs");

  assert.doesNotMatch(server, /version:\s*"\d+\./, "server.mjs 里写死了版本号——应当运行时读清单");
  assert.match(server, /\.codex-plugin\/plugin\.json/, "server.mjs 没去读插件清单");
});

test("面板用占位符，不写死版本号", async () => {
  const panel = await read("ui/panel.html");
  const appInfo = new RegExp(
    `appInfo:\\s*\\{\\s*name:\\s*"rein-panel",\\s*version:\\s*"${VERSION_TOKEN}"`
  );

  assert.match(panel, appInfo, "面板的 appInfo 应当用占位符");
  assert.doesNotMatch(panel, /version:\s*"\d+\.\d+/, "panel.html 里写死了版本号");
});

test("占位符换成真实版本号，别的字节不动", () => {
  assert.equal(injectVersion(`a${VERSION_TOKEN}b`, "9.9.9"), "a9.9.9b");
  assert.equal(injectVersion(`${VERSION_TOKEN} × 2 ${VERSION_TOKEN}`, "1.2.3"), "1.2.3 × 2 1.2.3");
  assert.equal(injectVersion("没有占位符", "9.9.9"), "没有占位符");
});
