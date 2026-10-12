import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// 版本号要**四处**一致：插件清单、`package.json`、MCP server 自报的 `serverInfo`、
// 面板握手时自报的 `appInfo`。漏掉一处的后果是安静的——宿主只在版本号变了才重装，
// 于是代码看着是新的、跑的还是旧副本。

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(relative) {
  return readFile(join(REPO, relative), "utf8");
}

function pick(text, pattern, label) {
  const found = pattern.exec(text)?.[1];
  assert.ok(found, `${label} 里没找到版本号`);
  return found;
}

test("四处版本号一致：清单 / package.json / serverInfo / 面板 appInfo", async () => {
  const manifest = JSON.parse(await read(".codex-plugin/plugin.json"));
  const pkg = JSON.parse(await read("package.json"));
  const server = pick(
    await read("mcp/server.mjs"),
    /serverInfo:\s*\{\s*name:\s*"rein",\s*version:\s*"([^"]+)"/,
    "mcp/server.mjs 的 serverInfo"
  );
  const panel = pick(
    await read("ui/panel.html"),
    /appInfo:\s*\{\s*name:\s*"rein-panel",\s*version:\s*"([^"]+)"/,
    "ui/panel.html 的 appInfo"
  );

  assert.equal(server, manifest.version, "serverInfo 与清单的版本号不一致");
  assert.equal(pkg.version, manifest.version, "package.json 与清单的版本号不一致");
  assert.equal(panel, manifest.version, "面板 appInfo 与清单的版本号不一致");
});
