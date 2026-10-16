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

function styleOf(html) {
  const match = /<style>([\s\S]*?)<\/style>/.exec(html);
  assert.ok(match, "panel.html 里找不到 <style>");
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

test("认不认得出「从通用账本引来的」，靠 server 递过来的保留标签", async () => {
  const script = scriptOf(await panelSource());

  // 那三个字只允许有一处真源（logic/common-ledger.mjs）。面板这边但凡自己抄一份，
  // 改说法时就会漏——分栏会静默地一栏都不分。
  assert.match(script, /item\.type === state\.commonLabel/, "挑出引来的条目要看 state.commonLabel");
  assert.match(script, /groupHead\(state\.commonLabel\)/, "分组小标题也用那个标签");
});

test("「已失效」默认是收着的", async () => {
  const html = await panelSource();
  const folds = [...html.matchAll(/<button class="fold" id="([^"]+)" aria-expanded="([^"]+)"/g)];

  // 两页各一个：本项目那本、通用账本那本。
  assert.equal(folds.length, 2, "两页各该有一个折叠三角");
  for (const [, id, expanded] of folds) {
    assert.equal(expanded, "false", `${id} 在标记里就该是收着的`);
  }

  // 标记只管首屏那一下，真正的默认值是脚本里这个开关。
  assert.match(scriptOf(html), /let inactiveOpen = false/, "开关本身也得默认是关的");
});

test("「直接写一条」的加号跟着「本项目」那一组走", async () => {
  const html = await panelSource();
  const script = scriptOf(html);

  // 它写进去的是本项目的条目，所以住在「本项目」的标题行上——动作贴着它要作用的那份列表。
  assert.equal([...html.matchAll(/id="addOne"/g)].length, 1, "加号只有一个");
  assert.match(
    html,
    /<div class="head groupRow" id="projectGroup">[\s\S]*?id="addOne"/,
    "加号应该住在「本项目」的标题行里"
  );

  // 而这一行与写作表单是静态节点：渲染时得把它们搬进生效区，不然它们就没地方待了。
  assert.match(script, /activeEl\.append\(projectGroupEl, writeOneEl\)/);
});

test("样式里 var() 用到的变量，都得有定义", async () => {
  const style = styleOf(await panelSource());

  const defined = new Set([...style.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((match) => match[1]));
  const used = new Set([...style.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]));

  assert.ok(used.size > 0 && defined.size > 0, "一个变量都没扫出来？扫法得跟着写法改");
  for (const name of used) {
    // 变量名写错一个字母不会报错，那条描边/底色就静静地不画——跟 id 打错是同一类坏法。
    assert.ok(defined.has(name), `${name} 没有定义`);
  }
});

test("结构色两个主题各自有值", async () => {
  const style = styleOf(await panelSource());
  const dark = /@media \(prefers-color-scheme: dark\) \{([\s\S]*?)\n      \}/.exec(style);

  assert.ok(dark, "找不到夜间模式那一段");

  // 线、分隔、灰底小块这几条是画结构用的：半透明灰当"墨"只对浅色底成立，
  // 深色底上得换成白的 alpha，否则就是一层雾。
  for (const name of ["--line", "--line-strong", "--fill", "--fill-strong"]) {
    assert.match(dark[1], new RegExp(`${name}:`), `夜间模式没给 ${name} 自己的值`);
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
