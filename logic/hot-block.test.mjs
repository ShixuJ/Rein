import assert from "node:assert/strict";
import test from "node:test";

import { renderHotBlock, removeHotBlock, selectHotBlock } from "./hot-block.mjs";

const ITEMS = [
  {
    id: "C-001",
    type: "concept-alignment",
    date: "2026-10-04",
    statement: "确认项指的是我们同意这么说。",
    source: "s",
    status: "active"
  },
  {
    id: "C-002",
    type: "error-correction",
    date: "2026-10-04",
    statement: "端口是 8080，不是 3000。",
    source: "s",
    status: "superseded by C-003"
  }
];

test("热块只装生效中的条目", () => {
  const block = renderHotBlock(ITEMS);
  assert.match(block, /C-001/);
  assert.doesNotMatch(block, /C-002/);
});

test("超过上限时截断，账本不受影响", () => {
  const many = Array.from({ length: 5 }, (_, index) => ({
    ...ITEMS[0],
    id: `C-10${index}`,
    statement: `第 ${index} 条`
  }));
  const block = renderHotBlock(many, { maxItems: 2 });
  assert.equal(block.match(/^- \[C-/gm).length, 2);
});

test("挑窗口：没到上限时一条不落", () => {
  const { shown, total, dropped } = selectHotBlock(ITEMS, { maxItems: 20 });

  assert.deepEqual(shown.map((item) => item.id), ["C-001"]);
  assert.equal(total, 1, "失效的不算进上限");
  assert.equal(dropped, 0);
});

test("挑窗口：超出上限的条数被数出来——它们是静默失效的那批", () => {
  const many = Array.from({ length: 5 }, (_, index) => ({
    ...ITEMS[0],
    id: `C-10${index}`,
    statement: `第 ${index} 条`
  }));
  const { shown, total, dropped } = selectHotBlock(many, { maxItems: 2 });

  assert.equal(shown.length, 2);
  assert.equal(total, 5);
  assert.equal(dropped, 3);
});

test("挑窗口：上限读不成数字时全给，不静默丢条目", () => {
  const many = Array.from({ length: 3 }, (_, index) => ({ ...ITEMS[0], id: `C-20${index}` }));
  const { shown, dropped } = selectHotBlock(many, { maxItems: Number("不是数字") });

  assert.equal(shown.length, 3);
  assert.equal(dropped, 0);
});

const WITH_BLOCK = [
  "# AGENTS",
  "",
  "## Agent skills",
  "",
  "这里是用户自己的内容。",
  "",
  renderHotBlock(ITEMS),
  ""
].join("\n");

test("退役：没有区块时原样返回", () => {
  const original = "# AGENTS\n\n用户的内容。\n";
  assert.equal(removeHotBlock(original), original);
});

test("退役：摘掉区块，用户自己的内容一字不动", () => {
  const result = removeHotBlock(WITH_BLOCK);

  assert.doesNotMatch(result, /rein:begin/);
  assert.doesNotMatch(result, /我们同意这么说/);
  assert.equal(result, "# AGENTS\n\n## Agent skills\n\n这里是用户自己的内容。\n");
});

test("退役：区块在中间时不把上下文粘在一起", () => {
  const text = "上面。\n\n<!-- rein:begin -->\n中间\n<!-- rein:end -->\n\n下面。\n";
  assert.equal(removeHotBlock(text), "上面。\n\n下面。\n");
});
