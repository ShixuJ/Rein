import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_TYPES } from "./config.mjs";
import {
  COMMON_LABEL,
  commitCommonItems,
  importFromCommon,
  promoteToCommon,
  readCommonState,
  retireCommonItem,
  reviseCommonItem
} from "./common-ledger.mjs";
import { isActive } from "./item.mjs";
import {
  commitItems,
  commonDir,
  readCommonEvidence,
  readCommonItems,
  readEvidence,
  readItems,
  retireItem,
  stateDir,
  writeCommonEvidence,
  writeCommonLedger
} from "./store.mjs";

// 状态目录默认落在 $REIN_HOME，把它指到临时目录，别碰真实的 ~/.codex。
process.env.REIN_HOME = await mkdtemp(join(tmpdir(), "rein-home-"));

const DATE = "2026-10-04";
const TODAY = "2026-10-16";

/** 一个假的"项目"：只要是个绝对路径就行，账本位置由 stateDir 算。 */
async function scratchProject() {
  return mkdtemp(join(tmpdir(), "rein-project-"));
}

const ledgerFile = (root) => join(stateDir(root), "ALIGNMENT.md");

const nameOf = (root) => root.split("/").filter(Boolean).pop();

test("保留标签不能带空白", () => {
  // 标题行是 `### C-001 · <token> · <日期>`，token 认的是 \S+——
  // 带空白就写不进文件，或者写进去解析不回来。
  assert.ok(COMMON_LABEL.length > 0);
  assert.ok(!/\s/.test(COMMON_LABEL), `保留标签不能带空白：${COMMON_LABEL}`);
});

test("保留标签不能撞上出厂的任何一个类型", () => {
  // 撞上的话，分栏就分不清"这条是通用的"和"这条是这个分类的"。
  for (const { slug, label } of DEFAULT_TYPES) {
    assert.notEqual(COMMON_LABEL, slug, "别用类型 slug 当保留标签");
    assert.notEqual(COMMON_LABEL, label, "别用类型的显示名当保留标签");
  }
});

test("写进通用账本：编号自增、标签补齐、原文跟着落", async () => {
  await writeCommonLedger([]);

  const { created } = await commitCommonItems(
    [{ statement: "通用前提。", type: "concept-alignment" }, { statement: "照抄上来的，没带标签。" }],
    { date: "2026-10-16", source: "来自 Rein · C-003", evidence: "原话。" }
  );

  assert.deepEqual(
    created.map((item) => item.id),
    ["C-001", "C-002"]
  );
  assert.equal(created[0].type, "concept-alignment", "推上来的那条带着自己的分类");
  assert.equal(created[1].type, COMMON_LABEL, "没带标签就补保留标签——别让 undefined 漏进文件");

  assert.equal(await readCommonEvidence("C-001"), "原话。");
});

test("通用账本的状态：生效与总数分开算，失效条目照样看得见", async () => {
  await writeCommonLedger([
    {
      id: "C-001",
      type: COMMON_LABEL,
      date: "2026-10-16",
      statement: "还在用的。",
      source: "",
      status: "active"
    },
    {
      id: "C-002",
      type: COMMON_LABEL,
      date: "2026-10-16",
      statement: "退休了的。",
      source: "",
      status: "retired"
    }
  ]);

  const state = await readCommonState();
  assert.equal(state.active, 1);
  assert.equal(state.total, 2);
  assert.equal(state.items.length, 2, "失效的也给它——不然历史就看不见了");
});

// --- 两条搬运 ---------------------------------------------------------------

test("推上去：源账本一个字节都不动，通用账本多一条带原分类的", async () => {
  await writeCommonLedger([]);
  const root = await scratchProject();
  const { created } = await commitItems(
    root,
    [{ statement: "通用前提：命名用中文。", type: "concept-alignment" }],
    { date: DATE, source: "thread 01a1", evidence: "那句原话。" }
  );

  const before = await readFile(ledgerFile(root), "utf8");
  const result = await promoteToCommon(root, { id: created[0].id, date: TODAY });

  assert.equal(result.ok, true);
  assert.equal(result.action, "promoted");
  assert.equal(result.item.type, "concept-alignment", "原分类跟着上来——推上来之前它是什么就是什么");
  assert.equal(result.item.date, DATE, "日期沿用源那条：那是结论定下来的日子");
  assert.equal(result.item.source, `项目 ${nameOf(root)} · ${created[0].id} · ${TODAY}`);
  assert.equal(await readCommonEvidence(result.item.id), "那句原话。", "原文跟着复制一份");
  assert.equal(await readFile(ledgerFile(root), "utf8"), before, "源账本一个字节没动");
});

test("推上去：通用账本里已经有同一句，就不重复写", async () => {
  await writeCommonLedger([]);
  const first = await scratchProject();
  const one = await commitItems(first, [{ statement: "同一句。" }], { date: DATE });
  await promoteToCommon(first, { id: one.created[0].id, date: TODAY });

  // 另一本项目账本里也有同一句——再推一次不该长出第二条。
  const second = await scratchProject();
  const two = await commitItems(second, [{ statement: "同一句。" }], { date: DATE });
  const result = await promoteToCommon(second, { id: two.created[0].id, date: TODAY });

  assert.equal(result.ok, true);
  assert.equal(result.action, "exists");
  assert.equal(result.existing, "C-001", "报出通用账本里那条的编号，好让人去看");
  assert.equal((await readCommonItems()).length, 1);
});

test("推上去：编号不在账本里、或者那条已经失效，都不推", async () => {
  await writeCommonLedger([]);
  const root = await scratchProject();

  const missing = await promoteToCommon(root, { id: "C-099", date: TODAY });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /C-099/);

  const { created } = await commitItems(root, [{ statement: "这条要退休。" }], { date: DATE });
  await retireItem(root, { id: created[0].id });

  const retired = await promoteToCommon(root, { id: created[0].id, date: TODAY });
  assert.equal(retired.ok, false);
  assert.match(retired.reason, /失效/);
  assert.equal((await readCommonItems()).length, 0, "退回的时候一条都没写进去");
});

test("引下来：编号在项目账本里重新分配，标签换成保留标签，原文跟过来", async () => {
  await writeCommonLedger([]);
  const common = await commitCommonItems(
    [{ statement: "通用前提。", type: "direction-correction" }],
    { date: DATE, source: "手写", evidence: "通用那边的原话。" }
  );

  const root = await scratchProject();
  const seeded = await commitItems(root, [{ statement: "本项目自己的。" }], { date: DATE });
  assert.equal(seeded.created[0].id, "C-001");

  const result = await importFromCommon(root, { id: common.created[0].id, date: TODAY });

  assert.equal(result.action, "imported");
  assert.equal(result.item.id, "C-002", "编号是本项目账本里新分配的");
  assert.equal(result.item.type, COMMON_LABEL, "标签换成保留标签——分栏靠它");
  assert.equal(result.item.source, `${COMMON_LABEL} · ${common.created[0].id} · ${TODAY}`);
  assert.equal(await readEvidence(root, "C-002"), "通用那边的原话。");
  assert.equal((await readItems(root)).length, 2, "本项目原来那条还在");
});

test("引下来：项目账本里已经有同一句，就不重复", async () => {
  await writeCommonLedger([]);
  const common = await commitCommonItems([{ statement: "两本都有。" }], { date: DATE });

  const root = await scratchProject();
  await commitItems(root, [{ statement: "两本都有。" }], { date: DATE });

  const result = await importFromCommon(root, { id: common.created[0].id, date: TODAY });

  assert.equal(result.action, "exists");
  assert.equal(result.existing, "C-001");
  assert.equal((await readItems(root)).length, 1);
});

test("退休本地那份副本：通用账本一个字节都不动", async () => {
  await writeCommonLedger([]);
  const common = await commitCommonItems([{ statement: "通用的一条。" }], { date: DATE });

  const root = await scratchProject();
  const imported = await importFromCommon(root, { id: common.created[0].id, date: TODAY });
  assert.equal(imported.action, "imported");

  const before = await readFile(join(commonDir(), "ALIGNMENT.md"), "utf8");
  const retired = await retireItem(root, { id: imported.item.id });

  assert.equal(retired.action, "retired");
  assert.equal(retired.item.status, "retired");
  assert.equal(
    await readFile(join(commonDir(), "ALIGNMENT.md"), "utf8"),
    before,
    "退的是本项目这份副本，源头一个字都不该动"
  );
  assert.equal((await readItems(root)).filter(isActive).length, 0, "本地那条不再生效");
  assert.equal((await readCommonItems()).filter(isActive).length, 1, "通用账本那条还生效着");
});

test("引下来：编号不在、或者已经失效，都不动项目账本", async () => {
  await writeCommonLedger([]);
  const root = await scratchProject();

  const missing = await importFromCommon(root, { id: "C-007", date: TODAY });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /C-007/);
  assert.ok(!existsSync(ledgerFile(root)), "连账本都不该给它建出来");

  const common = await commitCommonItems([{ statement: "通用那边退休了的。" }], { date: DATE });
  await writeCommonLedger([
    { ...common.created[0], status: "retired" }
  ]);

  const retired = await importFromCommon(root, { id: common.created[0].id, date: TODAY });
  assert.equal(retired.ok, false);
  assert.match(retired.reason, /失效/);
  assert.equal((await readItems(root)).length, 0);
});

// --- 通用账本自己的"改" -----------------------------------------------------

test("通用账本里改措辞：取代，标签沿用，原文跟着走", async () => {
  await writeCommonLedger([]);
  const { created } = await commitCommonItems(
    [{ statement: "旧的写法。", type: "concept-alignment" }],
    { date: DATE }
  );
  await writeCommonEvidence(created[0].id, "当时那句原话。");

  // 只给措辞、不给标签——标签必须沿用，不能兜底成保留标签。
  const result = await reviseCommonItem({
    id: created[0].id,
    statement: "新的写法。",
    date: TODAY
  });

  assert.equal(result.action, "superseded");
  assert.equal(result.item.id, "C-002");
  assert.equal(result.item.statement, "新的写法。");
  assert.equal(result.item.type, "concept-alignment", "改措辞不该让它在面板里跳到「通用账本」那栏");

  const items = await readCommonItems();
  assert.equal(items.length, 2, "条目一条不删：旧的那句留在账里");
  assert.equal(items.find((item) => item.id === "C-001").status, "superseded by C-002");

  assert.equal(
    await readCommonEvidence("C-002"),
    "当时那句原话。\n原结论 C-001：旧的写法。",
    "原文跟着新编号，末尾附上改之前是什么"
  );
  assert.equal(await readCommonEvidence("C-001"), null, "旧编号下不留孤儿");
});

test("通用账本里只改标签：就地改，不长新条目", async () => {
  await writeCommonLedger([]);
  const { created } = await commitCommonItems([{ statement: "一句。" }], { date: DATE });

  const result = await reviseCommonItem({ id: created[0].id, type: "细节填充" });

  assert.equal(result.action, "relabelled");
  assert.equal(result.item.id, "C-001");
  assert.equal(result.item.type, "细节填充");
  assert.equal((await readCommonItems()).length, 1);
});

test("通用账本里退休：条目留着，原文一起退休", async () => {
  await writeCommonLedger([]);
  const { created } = await commitCommonItems([{ statement: "不要了。" }], { date: DATE });
  await writeCommonEvidence(created[0].id, "原话。");

  const result = await retireCommonItem({ id: created[0].id });

  assert.equal(result.action, "retired");
  assert.equal(result.item.status, "retired");
  assert.equal((await readCommonItems()).length, 1, "退休不删条目");
  assert.equal(await readCommonEvidence(created[0].id), null);
});

test("通用账本里改不动失效的，也改不动不存在的", async () => {
  await writeCommonLedger([]);
  const { created } = await commitCommonItems([{ statement: "退休了的。" }], { date: DATE });
  await retireCommonItem({ id: created[0].id });

  const retired = await reviseCommonItem({ id: created[0].id, statement: "想改。" });
  assert.equal(retired.ok, false);
  assert.match(retired.reason, /失效/);

  const missing = await reviseCommonItem({ id: "C-099", statement: "想改。" });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /C-099/);
});
