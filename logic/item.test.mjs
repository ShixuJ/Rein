import assert from "node:assert/strict";
import test from "node:test";

import { createItem, nextId, oneLine, successorOf, supersede } from "./item.mjs";

test("编号取最大值加一，不复用失效编号", () => {
  assert.equal(nextId([]), "C-001");
  assert.equal(nextId([{ id: "C-001" }, { id: "C-009" }]), "C-010");
  assert.equal(nextId([{ id: "C-009" }, { id: "C-002" }]), "C-010");
});

test("超过三位数也不截断", () => {
  assert.equal(nextId([{ id: "C-999" }]), "C-1000");
});

test("断言被压成一行", () => {
  assert.equal(oneLine("  第一行\n第二行\t第三行  "), "第一行 第二行 第三行");
});

test("创建条目时补上默认类型和状态", () => {
  const item = createItem(
    { statement: "  某条断言  " },
    { id: "C-001", date: "2026-10-04", source: "来源", defaultType: "concept-alignment" }
  );
  assert.deepEqual(item, {
    id: "C-001",
    type: "concept-alignment",
    date: "2026-10-04",
    statement: "某条断言",
    source: "来源",
    status: "active"
  });
});

test("草稿自带的类型优先于建议类型", () => {
  const item = createItem(
    { statement: "某条断言", type: "error-correction" },
    { id: "C-001", date: "2026-10-04", defaultType: "concept-alignment" }
  );
  assert.equal(item.type, "error-correction");
});

test("supersede 只改旧条目的状态，不删历史", () => {
  const items = [
    { id: "C-001", status: "active" },
    { id: "C-002", status: "active" }
  ];
  const result = supersede(items, "C-001", "C-002");

  assert.equal(result.length, 2);
  assert.equal(result[0].status, "superseded by C-002");
  assert.equal(result[1].status, "active");
  assert.equal(items[0].status, "active", "原数组不该被改");
});

test("successorOf 读得回取代者，别的失效原因读成 null", () => {
  assert.equal(successorOf({ status: "superseded by C-014" }), "C-014");
  assert.equal(successorOf({ status: "active" }), null);
  assert.equal(successorOf({ status: "retired" }), null);
  assert.equal(successorOf({}), null);
  assert.equal(successorOf(null), null);
});
