import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

// 面板是全仓最容易被误改、又最难被测的一块——脚本抛错时它只是静静地不工作，没有报错。
// 这几条盯的是"改完会不会静默坏掉"：脚本能不能编译、工具名有没有写错、两个入口还在不在。

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const PANEL = join(REPO, "ui", "panel.html");
const SERVER = join(REPO, "mcp", "server.mjs");

async function panelSource() {
  return readFile(PANEL, "utf8");
}

function scriptOf(html) {
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, "panel.html 里找不到 <script>");
  return match[1];
}

test("面板脚本能编译", async () => {
  // 只编译、不执行。
  new vm.Script(scriptOf(await panelSource()));
});

test("面板引用的每个 rein_* 工具都在 server 的工具表里", async () => {
  const html = await panelSource();
  const server = await readFile(SERVER, "utf8");

  const wired = new Set([...server.matchAll(/name:\s*"(rein_[a-z_]+)"/g)].map((m) => m[1]));
  const used = new Set([...html.matchAll(/"(rein_[a-z_]+)"/g)].map((m) => m[1]));

  assert.ok(used.size > 0, "面板一个 rein_* 都没引用？");
  for (const name of used) {
    assert.ok(wired.has(name), `面板引用了 ${name}，但 server 的工具表里没有它`);
  }
});

test("脚本取的每个 id，HTML 里都得有——id 打错在这块是静默的", async () => {
  const html = await panelSource();
  const script = scriptOf(html);

  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  const asked = [...script.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);

  assert.ok(asked.length > 0, "一个 id 都没取？");
  for (const id of asked) {
    assert.ok(ids.has(id), `脚本取了 #${id}，但 HTML 里没有这个 id——它会静静地拿到 null`);
  }
});

test("条目按钮叫「修改」；直接写一条会带上标签", async () => {
  const script = scriptOf(await panelSource());

  assert.match(script, /button\("修改"/);
  assert.doesNotMatch(script, /button\("改"/);
  // 两页各有一条「直接写一条」（项目账本 / 通用账本），两条都得把标签交出去——
  // 服务端那边标签缺失会兜底，但面板不该指望它兜。
  for (const name of ["rein_one", "rein_common_one"]) {
    assert.match(
      script,
      new RegExp(`call\\("${name}",\\s*\\{\\s*statement,\\s*type:`),
      `${name} 那一条没把标签交出去`
    );
  }
});
