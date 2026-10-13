import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { renderHotBlock } from "./hot-block.mjs";
import { isActive } from "./item.mjs";
import { parseLedger } from "./ledger.mjs";
import {
  addRestatements,
  archiveInactive,
  commitItems,
  countArchived,
  localDir,
  markPanelOpen,
  PANEL_OPEN_TTL_MS,
  readEvidence,
  readInbox,
  readItems,
  readSessionMarker,
  retireItem,
  retireAll,
  reviseItem,
  stateDir,
  takePanelOpen,
  takeRestatements,
  writeInbox,
  writeSessionMarker
} from "./store.mjs";

const DATE = "2026-10-04";
const AT = "2026-10-05T10:12:00.000Z";

// 状态目录默认落在 $REIN_HOME，把它指到临时目录，别碰真实的 ~/.codex。
process.env.REIN_HOME = await mkdtemp(join(tmpdir(), "rein-home-"));

async function scratchDir() {
  return mkdtemp(join(tmpdir(), "rein-store-"));
}

// 账本 / 归档落在哪由 stateDir 决定（默认是数据目录，项目里有账本才回项目）；
// 收件箱与原文永远在机器本地的 localDir 里，不进项目。
const ledgerFile = (root) => join(stateDir(root), "ALIGNMENT.md");
const archiveFile = (root) => join(stateDir(root), "ALIGNMENT-ARCHIVE.md");
const inboxFile = (root) => join(localDir(root), ".rein", "inbox.md");

const OLD_BLOCK = [
  "<!-- rein:begin -->",
  "## 已确认前提（由 rein 维护，勿手改）",
  "",
  "- [C-001] concept-alignment：旧的受注块。",
  "<!-- rein:end -->"
].join("\n");

test("第一条落地就长出账本", async () => {
  const root = await scratchDir();
  const { created } = await commitItems(
    root,
    [{ statement: "确认项不含真伪判定。", type: "concept-alignment" }],
    { date: DATE, source: "test" }
  );

  assert.equal(created.length, 1);
  assert.equal(created[0].id, "C-001");

  const ledger = await readFile(ledgerFile(root), "utf8");
  assert.match(ledger, /C-001/);
  assert.match(ledger, /确认项不含真伪判定。/);
});

test("默认不把账本写进项目——落到插件的数据目录里", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "甲。" }], { date: DATE });

  // 项目根一个字节没多
  await assert.rejects(() => stat(join(root, "ALIGNMENT.md")), { code: "ENOENT" });
  // 账本写进了数据目录
  assert.notEqual(ledgerFile(root), join(root, "ALIGNMENT.md"));
  assert.match(await readFile(ledgerFile(root), "utf8"), /甲。/);
});

test("项目里已经有 ALIGNMENT.md：账本回到项目里（可 diff、能进 PR）", async () => {
  const root = await scratchDir();
  await writeFile(join(root, "ALIGNMENT.md"), "# ALIGNMENT\n", "utf8");

  await commitItems(root, [{ statement: "甲。" }], { date: DATE });

  assert.equal(stateDir(root), root, "有账本就认项目里那本");
  assert.match(await readFile(join(root, "ALIGNMENT.md"), "utf8"), /甲。/);
});

test("第二条接着编号", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "第一条。" }], { date: DATE });
  const { created } = await commitItems(root, [{ statement: "第二条。" }], { date: DATE });

  assert.equal(created[0].id, "C-002");
  assert.deepEqual((await readItems(root)).map((item) => item.id), ["C-001", "C-002"]);
});

test("用户自己的 AGENTS.md 内容一个字节不动", async () => {
  const root = await scratchDir();
  const original = "# AGENTS\n\n## Agent skills\n\n用户的内容。\n";
  await writeFile(join(root, "AGENTS.md"), original, "utf8");

  await commitItems(root, [{ statement: "某条。" }], { date: DATE });

  assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), original);
});

test("没有 AGENTS.md 时不凭空造一个", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "某条。" }], { date: DATE });

  await assert.rejects(() => stat(join(root, "AGENTS.md")), { code: "ENOENT" });
});

test("老仓库的受注块被摘掉，其余内容逐字节不变", async () => {
  const root = await scratchDir();
  const original = `# AGENTS\n\n## Agent skills\n\n用户的内容。\n\n${OLD_BLOCK}\n`;
  await writeFile(join(root, "AGENTS.md"), original, "utf8");

  await commitItems(root, [{ statement: "新的一条。" }], { date: DATE });

  const agents = await readFile(join(root, "AGENTS.md"), "utf8");
  assert.doesNotMatch(agents, /rein:begin/);
  assert.doesNotMatch(agents, /旧的受注块/);
  assert.equal(agents, "# AGENTS\n\n## Agent skills\n\n用户的内容。\n");
});

test("受注块在文件中间时不把上下文粘在一起", async () => {
  const root = await scratchDir();
  await writeFile(
    join(root, "AGENTS.md"),
    `上面。\n\n${OLD_BLOCK}\n\n下面。\n`,
    "utf8"
  );

  await commitItems(root, [{ statement: "某条。" }], { date: DATE });

  assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), "上面。\n\n下面。\n");
});

test("同一次落地里的多条断言编号连续", async () => {
  const root = await scratchDir();
  const { created } = await commitItems(
    root,
    [{ statement: "甲。" }, { statement: "乙。" }, { statement: "丙。" }],
    { date: DATE }
  );

  assert.deepEqual(created.map((item) => item.id), ["C-001", "C-002", "C-003"]);
  assert.deepEqual((await readItems(root)).map((item) => item.id), ["C-001", "C-002", "C-003"]);
});

test("落地时把配置一并带回来，类型按配置解析", async () => {
  const root = await scratchDir();
  await mkdir(join(root, ".rein"), { recursive: true });
  await writeFile(join(root, ".rein", "config.toml"), '[types.foo]\nlabel = "新花样"\n', "utf8");

  const { created, config } = await commitItems(
    root,
    [{ statement: "甲。", type: "foo" }, { statement: "乙。" }],
    { date: DATE }
  );

  assert.deepEqual(created.map((item) => item.type), ["foo", "concept-alignment"]);
  assert.match(JSON.stringify(config), /新花样/);
});

test("复述写进收件箱，投递一次就没了", async () => {
  const root = await scratchDir();
  await addRestatements(root, ["把这段带回去。", "还有这段。"], { at: AT, session: "side-1" });

  assert.match(await readFile(inboxFile(root), "utf8"), /把这段带回去。/);

  const taken = await takeRestatements(root, { session: "main-1", isMain: true });
  assert.deepEqual(
    taken.map((entry) => entry.text),
    ["把这段带回去。", "还有这段。"]
  );
  assert.deepEqual(await readInbox(root), []);
});

test("收件箱投空之后，文件被摘掉——不留一个只有表头的空文件", async () => {
  const root = await scratchDir();
  await addRestatements(root, ["只此一条。"], { at: AT, session: "side-1" });
  await takeRestatements(root, { session: "main-1", isMain: true });

  await assert.rejects(() => stat(inboxFile(root)), { code: "ENOENT" });
  assert.deepEqual(await readInbox(root), [], "文件不在就是空收件箱");
});

test("本来就没有收件箱文件时，摘空也不报错", async () => {
  const root = await scratchDir();
  await writeInbox(root, []);

  assert.deepEqual(await readInbox(root), []);
});

test("侧聊问一句吃不掉收件箱——新开的侧聊也不行", async () => {
  const root = await scratchDir();
  await addRestatements(root, ["甲。"], { at: AT, session: "side-1" });

  assert.deepEqual(await takeRestatements(root, { session: "side-2", isMain: false }), []);
  assert.deepEqual(
    (await readInbox(root)).map((entry) => entry.text),
    ["甲。"]
  );
});

test("收件箱按项目分开：A 项目的复述 B 项目吃不到", async () => {
  const a = await scratchDir();
  const b = await scratchDir();
  await addRestatements(a, ["甲项目的复述。"], { at: AT, session: "side-1" });

  assert.deepEqual(await takeRestatements(b, { session: "main-b", isMain: true }), []);
  assert.deepEqual(
    (await takeRestatements(a, { session: "main-a", isMain: true })).map((entry) => entry.text),
    ["甲项目的复述。"]
  );
});

test("没有账本的项目也能写收件箱——目录按需长出来", async () => {
  const root = await scratchDir();
  await addRestatements(root, ["甲。"], { at: AT });

  await assert.rejects(() => stat(ledgerFile(root)), { code: "ENOENT" });
  assert.deepEqual(
    (await readInbox(root)).map((entry) => entry.text),
    ["甲。"]
  );
});

test("项目里放了账本，复述也不在项目里留下 .rein——收件箱是机器本地的", async () => {
  const root = await scratchDir();
  await writeFile(join(root, "ALIGNMENT.md"), "# ALIGNMENT\n", "utf8");

  await addRestatements(root, ["把这段带回去。"], { at: AT, session: "side-1" });

  // 账本回到项目里（可 diff、能进 PR），但收件箱没有：项目根不该凭空长出 .rein/
  assert.equal(stateDir(root), root, "有账本时账本层回到项目");
  assert.notEqual(localDir(root), root, "本地层永远不在项目里");
  await assert.rejects(() => stat(join(root, ".rein")), { code: "ENOENT" });
  assert.match(await readFile(inboxFile(root), "utf8"), /把这段带回去。/);
});

test("取代：新条目照落，旧条目标成 superseded by 新编号，历史留着", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "旧的写法。" }], { date: DATE });

  const { created, replaced, warnings, items } = await commitItems(
    root,
    [{ statement: "新的写法。", supersedes: "C-001" }],
    { date: DATE }
  );

  assert.deepEqual(created.map((item) => item.id), ["C-002"]);
  assert.deepEqual(replaced, [{ from: "C-001", to: "C-002" }]);
  assert.deepEqual(warnings, []);

  const old = items.find((item) => item.id === "C-001");
  assert.equal(old.status, "superseded by C-002");
  assert.equal(old.statement, "旧的写法。", "旧条目的断言一个字节都不动");

  const ledger = await readFile(ledgerFile(root), "utf8");
  assert.match(ledger, /状态：superseded by C-002/);
  assert.ok(ledger.indexOf("## 已失效") < ledger.indexOf("旧的写法。"), "旧条目落在已失效区");
});

test("取代的目标不在账本里：断言照落，只丢关系，并且报出来", async () => {
  const root = await scratchDir();

  const { created, replaced, warnings } = await commitItems(
    root,
    [{ statement: "新的写法。", supersedes: "C-099" }],
    { date: DATE }
  );

  assert.deepEqual(created.map((item) => item.id), ["C-001"], "用户确认过的断言不能因为填错编号就丢");
  assert.deepEqual(replaced, []);
  assert.match(warnings[0], /C-099 不在账本里/);
});

test("同一次取代被重放：不重复长出第二条断言", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "旧的写法。" }], { date: DATE });
  await commitItems(root, [{ statement: "新的写法。", supersedes: "C-001" }], { date: DATE });

  const { created, replaced, warnings, items } = await commitItems(
    root,
    [{ statement: "新的写法。", supersedes: "C-001" }],
    { date: DATE }
  );

  assert.deepEqual(created, []);
  assert.deepEqual(replaced, []);
  assert.equal(items.length, 2, "账本里还是那两条");
  assert.match(warnings[0], /已经由 C-002 取代/);
});

test("取代一条已经失效、但断言不同的条目：新条目照落，旧的链不动", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "第一版。" }, { statement: "第二版。" }], { date: DATE });
  await commitItems(root, [{ statement: "第三版。", supersedes: "C-001" }], { date: DATE });

  const { created, warnings, items } = await commitItems(
    root,
    [{ statement: "第四版。", supersedes: "C-001" }],
    { date: DATE }
  );

  assert.deepEqual(created.map((item) => item.id), ["C-004"]);
  assert.equal(items.find((item) => item.id === "C-001").status, "superseded by C-003", "原有的链没被改写");
  assert.match(warnings[0], /已经是失效条目/);
});

test("“这一轮在哪”的标记按项目分开存，读不到就是不认识", async () => {
  const a = await scratchDir();
  const b = await scratchDir();

  assert.equal(await readSessionMarker(a), null);

  await writeSessionMarker(a, { session_id: "main-1", transcript: "/tmp/rollout.jsonl", at: AT });

  assert.equal((await readSessionMarker(a)).session_id, "main-1");
  assert.equal(await readSessionMarker(b), null);
});

test("改措辞 = 取代：旧的留在原地，新的接上编号", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "旧的措辞。", type: "detail-completion" }], { date: DATE });

  const result = await reviseItem(root, {
    id: "C-001",
    statement: "新的措辞。",
    date: DATE,
    source: "账本面板 · 取代 C-001"
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, "superseded");
  assert.equal(result.item.id, "C-002");
  assert.equal(result.item.type, "detail-completion", "类型跟着旧条目走，除非同时改了标签");
  assert.equal(result.items.find((item) => item.id === "C-001").status, "superseded by C-002");
  assert.equal(result.items.find((item) => item.id === "C-001").statement, "旧的措辞。");
});

test("只改标签：原地改，不留历史", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "某条。", type: "detail-completion" }], { date: DATE });

  const result = await reviseItem(root, { id: "C-001", type: "错误纠正", date: DATE });

  assert.equal(result.action, "relabelled");
  assert.deepEqual(result.items.map((item) => item.id), ["C-001"], "没有长出新条目");
  assert.equal(result.items[0].type, "error-correction");
  assert.equal(result.items[0].statement, "某条。");
});

test("措辞没变、标签也没变：什么都不写", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "某条。" }], { date: DATE });

  const result = await reviseItem(root, { id: "C-001", statement: "某条。", date: DATE });
  assert.equal(result.action, "unchanged");
  assert.deepEqual(result.items.map((item) => item.id), ["C-001"]);
});

test("失效的条目不给改——用户多半点错了", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "第一版。" }], { date: DATE });
  await commitItems(root, [{ statement: "第二版。", supersedes: "C-001" }], { date: DATE });

  const result = await reviseItem(root, { id: "C-001", statement: "又想改回来。", date: DATE });
  assert.equal(result.ok, false);
  assert.match(result.reason, /已经失效/);
  assert.equal(result.items.length, 2);
});

test("改一条不存在的编号：报出来，不写任何东西", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "某条。" }], { date: DATE });

  const result = await reviseItem(root, { id: "C-099", statement: "无中生有。", date: DATE });
  assert.equal(result.ok, false);
  assert.match(result.reason, /C-099 不在账本里/);
  assert.equal(result.items.length, 1);
});

test("退休：条目留在账本里，但不再生效", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "过时的那条。" }, { statement: "还在用的。" }], { date: DATE });

  const result = await retireItem(root, { id: "C-001" });

  assert.equal(result.ok, true);
  assert.equal(result.action, "retired");
  assert.equal(result.items.find((item) => item.id === "C-001").status, "retired");
  assert.equal(result.items.find((item) => item.id === "C-001").statement, "过时的那条。");

  const ledger = await readFile(ledgerFile(root), "utf8");
  assert.match(ledger, /状态：retired/);
  assert.ok(ledger.indexOf("## 已失效") < ledger.indexOf("过时的那条。"));
});

test("退休过的条目再退休：幂等，不报错", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "过时的那条。" }], { date: DATE });
  await retireItem(root, { id: "C-001" });

  const again = await retireItem(root, { id: "C-001" });
  assert.equal(again.ok, true);
  assert.equal(again.action, "unchanged");
  assert.equal(again.items.length, 1);
});

test("取代过的条目不能再退休——已经失效了", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "第一版。" }], { date: DATE });
  await commitItems(root, [{ statement: "第二版。", supersedes: "C-001" }], { date: DATE });

  const result = await retireItem(root, { id: "C-001" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /不用再退休/);
  assert.equal(result.items.find((item) => item.id === "C-001").status, "superseded by C-002");
});

test("展开侧栏的机会只能取走一次——历史回放的面板取不到", async () => {
  const root = await scratchDir();
  await markPanelOpen(root);

  assert.equal(await takePanelOpen(root), true);
  assert.equal(await takePanelOpen(root), false, "取过就消费掉了");
});

test("没放过标记时取不到", async () => {
  const root = await scratchDir();
  assert.equal(await takePanelOpen(root), false);
});

test("陈标记会过期——放了标记但面板一直没挂载，不能以后被误取", async () => {
  const root = await scratchDir();
  const at = 1_700_000_000_000;
  await markPanelOpen(root, { at });

  assert.equal(await takePanelOpen(root, { now: at + PANEL_OPEN_TTL_MS }), true, "刚到期还算数");
  await markPanelOpen(root, { at });
  assert.equal(await takePanelOpen(root, { now: at + PANEL_OPEN_TTL_MS + 1 }), false);
});

test("两个项目各记各的展开标记", async () => {
  const a = await scratchDir();
  const b = await scratchDir();
  await markPanelOpen(a);

  assert.equal(await takePanelOpen(b), false);
  assert.equal(await takePanelOpen(a), true);
});

test("全部退休：生效项一起变成 retired，条目一条不删", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "甲。" }, { statement: "乙。" }], { date: DATE });
  await commitItems(root, [{ statement: "丙的旧版。" }], { date: DATE });
  await commitItems(root, [{ statement: "丙。", supersedes: "C-003" }], { date: DATE });
  await retireItem(root, { id: "C-001" });

  const before = await readItems(root);
  const result = await retireAll(root);
  const after = await readItems(root);

  assert.equal(result.ok, true);
  assert.equal(result.action, "retired-all");
  assert.deepEqual(result.retired, ["C-002", "C-004"], "只动生效的那些");
  assert.equal(after.length, before.length, "条数不变——退休不是删除");
  assert.deepEqual(after.map((item) => item.id), before.map((item) => item.id));
  assert.equal(after.filter(isActive).length, 0);
  // 已经失效的（retired / superseded）原样留着，不被改写。
  assert.equal(after.find((item) => item.id === "C-001").status, "retired");
  assert.equal(after.find((item) => item.id === "C-003").status, "superseded by C-004");
});

test("全部退休之后，热块空了", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "甲。" }, { statement: "乙。" }], { date: DATE });

  const { items } = await retireAll(root);
  const block = renderHotBlock(items);

  assert.doesNotMatch(block, /甲。|乙。/);
  assert.match(block, /_（暂无）_/);
});

test("没有生效项时全部退休什么都不做", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "甲。" }], { date: DATE });
  await retireItem(root, { id: "C-001" });

  const before = await readFile(ledgerFile(root), "utf8");
  const result = await retireAll(root);

  assert.equal(result.action, "unchanged");
  assert.deepEqual(result.retired, []);
  assert.equal(await readFile(ledgerFile(root), "utf8"), before, "一个字都不该写");
});

// --- 归档 -------------------------------------------------------------------

async function archiveText(root) {
  return readFile(archiveFile(root), "utf8");
}

test("归档：失效条目挪进归档文件，账本只剩生效项，一条不丢", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "甲。" }, { statement: "乙。" }], { date: DATE });
  await commitItems(root, [{ statement: "丙。" }], { date: DATE });
  await retireItem(root, { id: "C-001" });
  await commitItems(root, [{ statement: "丁。", supersedes: "C-002" }], { date: DATE });

  const result = await archiveInactive(root);
  const ledger = await readItems(root);
  const archived = parseLedger(await archiveText(root));

  assert.equal(result.action, "archived");
  assert.deepEqual(result.archived, ["C-001", "C-002"]);
  assert.deepEqual(ledger.map((item) => item.id), ["C-003", "C-004"]);
  assert.deepEqual(archived.map((item) => item.id), ["C-001", "C-002"]);
  assert.equal(ledger.length + archived.length, 4, "条数守恒——归档不是删除");
  // 归档里那两条带着它们原来的状态，取代链还在。
  assert.equal(archived.find((item) => item.id === "C-002").status, "superseded by C-004");
  assert.equal(await countArchived(root), 2);
});

test("归档之后编号不倒退——不然新条目会重用归档里的编号", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "甲。" }, { statement: "乙。" }, { statement: "丙。" }], {
    date: DATE
  });

  // 让编号最大的那条失效再归档：账本里最大值退回 C-002。
  await retireItem(root, { id: "C-003" });
  await archiveInactive(root);
  assert.deepEqual((await readItems(root)).map((item) => item.id), ["C-001", "C-002"]);

  const { created } = await commitItems(root, [{ statement: "丁。" }], { date: DATE });
  assert.deepEqual(created.map((item) => item.id), ["C-004"], "编号要看归档，不能重用 C-003");
});

test("没有失效条目时归档什么都不做：连归档文件都不建", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "甲。" }], { date: DATE });

  const before = await readFile(ledgerFile(root), "utf8");
  const result = await archiveInactive(root);

  assert.equal(result.action, "unchanged");
  assert.deepEqual(result.archived, []);
  assert.equal(await readFile(ledgerFile(root), "utf8"), before);
  await assert.rejects(() => stat(archiveFile(root)), { code: "ENOENT" });
});

test("再归档一次：已有的不重复，新失效的追加", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "甲。" }, { statement: "乙。" }], { date: DATE });
  await retireItem(root, { id: "C-001" });
  await archiveInactive(root);

  const again = await archiveInactive(root);
  assert.equal(again.action, "unchanged", "已经没失效条目了");

  await retireItem(root, { id: "C-002" });
  await archiveInactive(root);
  const archived = parseLedger(await archiveText(root));

  assert.deepEqual(archived.map((item) => item.id), ["C-001", "C-002"]);
  assert.equal(archived.length, 2, "C-001 不该被写第二遍");
});

test("取代一条已经归档的条目：新条目照落，警告说清它在归档里", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "旧的。" }], { date: DATE });
  await retireItem(root, { id: "C-001" });
  await archiveInactive(root);

  const { created, warnings } = await commitItems(
    root,
    [{ statement: "新的。", supersedes: "C-001" }],
    { date: DATE }
  );

  assert.deepEqual(created.map((item) => item.id), ["C-002"]);
  assert.match(warnings.join("\n"), /已经归档/);
  assert.equal((await readItems(root)).length, 1, "归档那条不该被拽回账本");
});

// --- 原文（结论从哪来）------------------------------------------------------

const evidenceDir = (root) => join(localDir(root), "evidence");

test("落地时带上原文：按编号存一份，读得回来", async () => {
  const root = await scratchDir();
  const { created } = await commitItems(
    root,
    [{ statement: "渲染走服务端默认值。" }],
    { date: DATE, evidence: "那这个渲染到底按谁的值来？" }
  );

  assert.equal(await readEvidence(root, created[0].id), "那这个渲染到底按谁的值来？");
});

test("没给原文就不留——连目录都不建", async () => {
  const root = await scratchDir();
  const { created } = await commitItems(root, [{ statement: "甲。" }], { date: DATE });

  assert.equal(await readEvidence(root, created[0].id), null);
  await assert.rejects(() => stat(evidenceDir(root)), { code: "ENOENT" });
});

test("取代：原文跟着新条目走，旧编号下不留（改措辞不改原文）", async () => {
  const root = await scratchDir();
  const { created } = await commitItems(root, [{ statement: "旧的写法。" }], {
    date: DATE,
    evidence: "原话。"
  });
  const first = created[0].id;

  const { created: second } = await commitItems(
    root,
    [{ statement: "新的写法。", supersedes: first }],
    { date: DATE }
  );

  assert.equal(
    await readEvidence(root, second[0].id),
    "原话。\n原结论 C-001：旧的写法。",
    "原文跟过来，后面附上被取代的那句"
  );
  assert.equal(await readEvidence(root, first), null, "旧编号下那份挪走了，不留孤儿");
});

test("取代时没有新原文：接着写「原结论」，不把旧结论丢掉", async () => {
  const root = await scratchDir();
  const { created } = await commitItems(root, [{ statement: "旧的写法。" }], { date: DATE });

  const { created: second } = await commitItems(
    root,
    [{ statement: "新的写法。", supersedes: created[0].id }],
    { date: DATE }
  );

  assert.equal(await readEvidence(root, second[0].id), "原结论 C-001：旧的写法。");
});

test("连着取代两次：原结论按顺序累加，取代链在原文里也读得出来", async () => {
  const root = await scratchDir();
  await commitItems(root, [{ statement: "第一版。" }], { date: DATE });
  await commitItems(root, [{ statement: "第二版。", supersedes: "C-001" }], { date: DATE });
  await commitItems(root, [{ statement: "第三版。", supersedes: "C-002" }], { date: DATE });

  assert.equal(
    await readEvidence(root, "C-003"),
    "原结论 C-001：第一版。\n原结论 C-002：第二版。"
  );
});

test("取代时给了新原文：用新的", async () => {
  const root = await scratchDir();
  const { created } = await commitItems(root, [{ statement: "旧的写法。" }], {
    date: DATE,
    evidence: "老原话。"
  });

  const { created: second } = await commitItems(
    root,
    [{ statement: "新的写法。", supersedes: created[0].id }],
    { date: DATE, evidence: "新原话。" }
  );

  assert.equal(await readEvidence(root, second[0].id), "新原话。\n原结论 C-001：旧的写法。", "用新原文，但旧结论照样附上");
  assert.equal(await readEvidence(root, created[0].id), null);
});

test("面板里改措辞（取代）也把原文带过去", async () => {
  const root = await scratchDir();
  const { created } = await commitItems(root, [{ statement: "旧的措辞。" }], {
    date: DATE,
    evidence: "原话。"
  });

  const result = await reviseItem(root, { id: created[0].id, statement: "新的措辞。", date: DATE });

  assert.equal(result.action, "superseded");
  assert.equal(await readEvidence(root, result.item.id), "原话。\n原结论 C-001：旧的措辞。");
  assert.equal(await readEvidence(root, created[0].id), null);
});

test("退休：原文一起退休", async () => {
  const root = await scratchDir();
  const { created } = await commitItems(root, [{ statement: "过时的那条。" }], {
    date: DATE,
    evidence: "原话。"
  });

  await retireItem(root, { id: created[0].id });

  assert.equal(await readEvidence(root, created[0].id), null);
});

test("全部退休：原文一起清掉", async () => {
  const root = await scratchDir();
  const { created } = await commitItems(root, [{ statement: "甲。" }, { statement: "乙。" }], {
    date: DATE,
    evidence: "原话。"
  });

  await retireAll(root);

  for (const item of created) assert.equal(await readEvidence(root, item.id), null);
});
