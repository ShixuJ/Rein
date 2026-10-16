import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// 这里只**读** server.mjs 的源码，不 import 它——它是个可执行的脚本（import 下去
// readline 那个循环就跑起来了，测试直接挂住）。所以这个文件盯的是工具表本身。

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(REPO, "mcp", "server.mjs");

/** 按 `name: "rein_x"` 把工具表切开：名字 → 那个工具的定义那一段。 */
function toolBodies(source) {
  const parts = source.split(/\n\s*name:\s*"(rein_[a-z_]+)"/).slice(1);
  const tools = new Map();

  for (let index = 0; index < parts.length; index += 2) {
    tools.set(parts[index], parts[index + 1]);
  }

  return tools;
}

test("工具表里认得出每个工具的可见性", async () => {
  const tools = toolBodies(await readFile(SERVER, "utf8"));

  assert.ok(tools.size > 0, "一个工具都没切出来？切法得跟着 TOOLS 的写法一起改");
  assert.ok(tools.has("rein_land"), "rein_land 是模型的主入口，切不出来说明切法坏了");
});

test("通用账本的五个工具都在，而且只对面板可见——模型一个都碰不到", async () => {
  const tools = toolBodies(await readFile(SERVER, "utf8"));

  // "模型不碰通用账本"这条要成立，就得在**工具面**上成立：权限写在表里，一眼看得出，
  // 不靠提示词去劝。谁都碰不到它，才谈得上别的。
  const names = [
    "rein_common",
    "rein_common_one",
    "rein_common_edit",
    "rein_promote",
    "rein_import"
  ];

  for (const name of names) {
    const body = tools.get(name);

    assert.ok(body, `工具表里没有 ${name}`);
    assert.match(body, /visibility:\s*\["app"\]/, `${name} 必须只对面板可见`);
    assert.doesNotMatch(body, /visibility:\s*\["model"/, `${name} 不能让模型看见`);
  }
});
