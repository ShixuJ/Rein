import assert from "node:assert/strict";
import test from "node:test";

import { parseLedger, serializeLedger } from "./ledger.mjs";

const ITEMS = [
  {
    id: "C-001",
    type: "concept-alignment",
    date: "2026-10-04",
    statement: "确认项指的是我们同意这么说，不含真伪判定。",
    source: "2026-10-04 · thread 01a104a1",
    status: "active"
  },
  {
    id: "C-002",
    type: "direction-correction",
    date: "2026-10-04",
    statement: "不要再往 docs/ 里加新目录，文档统一放 docs/agents/。",
    source: "2026-10-04 · thread 01a104a1 · 修正回答 #37",
    status: "superseded by C-003"
  }
];

test("序列化再解析，条目原样回来", () => {
  assert.deepEqual(parseLedger(serializeLedger(ITEMS)), ITEMS);
});

test("解析再序列化再解析，字节一致", () => {
  const once = serializeLedger(ITEMS);
  const twice = serializeLedger(parseLedger(once));
  assert.equal(twice, once);
});

test("生效的和失效的分到不同区，且失效条目不丢", () => {
  const text = serializeLedger(ITEMS);
  const activeSection = text.slice(text.indexOf("## 生效中"), text.indexOf("## 已失效"));
  const retiredSection = text.slice(text.indexOf("## 已失效"));

  assert.match(activeSection, /C-001/);
  assert.doesNotMatch(activeSection, /C-002/);
  assert.match(retiredSection, /C-002/);
  assert.match(retiredSection, /superseded by C-003/);
});

test("空账本也能解析，并且写出占位而不是空白", () => {
  const text = serializeLedger([]);
  assert.match(text, /_（暂无）_/);
  assert.deepEqual(parseLedger(text), []);
});

test("断言里的全角冒号不会截断字段", () => {
  const tricky = [{ ...ITEMS[0], statement: "命名规则：中文给人看，slug 给代码用。" }];
  assert.deepEqual(parseLedger(serializeLedger(tricky)), tricky);
});
