import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_TYPES } from "./config.mjs";
import { COMMON_LABEL, commitCommonItems, readCommonState } from "./common-ledger.mjs";
import { readCommonEvidence, writeCommonLedger } from "./store.mjs";

// 状态目录默认落在 $REIN_HOME，把它指到临时目录，别碰真实的 ~/.codex。
process.env.REIN_HOME = await mkdtemp(join(tmpdir(), "rein-home-"));

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
