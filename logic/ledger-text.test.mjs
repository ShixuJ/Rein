import assert from "node:assert/strict";
import test from "node:test";

import { describeLedger, ledgerLines, statusLabel } from "./ledger-text.mjs";

function item(id, statement, status = "active", type = "concept-alignment", date = "2026-10-15") {
  return { id, statement, status, type, date };
}

function state({ items = [], maxItems = 20, archived = 0 } = {}) {
  const active = items.filter((entry) => entry.status === "active").length;
  return {
    root: "/tmp/项目",
    items,
    active,
    total: items.length,
    archived: { count: archived },
    hotBlock: { maxItems, shown: active, dropped: 0 },
    types: []
  };
}

test("摘要：没人被挤出热块时不提上限", () => {
  assert.equal(describeLedger(state({ items: [item("C-001", "甲。")] })), "1 条生效、0 条已失效。");
});

test("摘要：挤出热块的那几条必须被说出来——否则是静默失效", () => {
  const base = state({ items: [item("C-001", "甲。"), item("C-002", "乙。")], maxItems: 1 });
  const summary = describeLedger({ ...base, hotBlock: { maxItems: 1, shown: 1, dropped: 1 } });

  assert.match(summary, /热块这次只带前 1 条/);
  assert.match(summary, /另外 1 条超出上限（1）/);
});

test("终端里的账本：生效在前、已失效在后，退休与取代都说人话", () => {
  const lines = ledgerLines(
    state({
      items: [
        item("C-001", "旧的措辞。", "superseded by C-002"),
        item("C-002", "新的措辞。"),
        item("C-003", "不再成立的。", "retired")
      ],
      archived: 2
    })
  );

  assert.equal(lines[0], "1 条生效、2 条已失效。");
  assert.equal(lines[2], "生效 1 条");
  assert.equal(lines[3], "  C-002 · concept-alignment · 2026-10-15：新的措辞。");
  assert.ok(lines.includes("已失效 2 条"));
  assert.ok(lines.includes("  C-001 · 已由 C-002 取代：旧的措辞。"));
  assert.ok(lines.includes("  C-003 · 已退休：不再成立的。"));
  assert.ok(lines.includes("归档 2 条（在 ALIGNMENT-ARCHIVE.md 里，条目一条没删）"));
});

test("终端里的账本：空账本是一句话，不是一片空白", () => {
  assert.deepEqual(ledgerLines(state()), ["账本还是空的。"]);
});

test("终端里的账本：不想看失效项时，那一节整段不出现", () => {
  const lines = ledgerLines(
    state({ items: [item("C-001", "甲。"), item("C-002", "乙。", "retired")] }),
    { includeInactive: false }
  );

  assert.ok(lines.includes("生效 1 条"));
  assert.ok(!lines.some((line) => line.startsWith("已失效")));
  assert.ok(!lines.some((line) => line.includes("C-002")));
});

test("失效原因：认不出来就照原样写，别替它圆", () => {
  assert.equal(statusLabel(item("C-001", "甲。", "retired")), "已退休");
  assert.equal(statusLabel(item("C-001", "甲。", "superseded by C-009")), "已由 C-009 取代");
  assert.equal(statusLabel(item("C-001", "甲。", "some-new-state")), "some-new-state");
});
