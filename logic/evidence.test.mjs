import assert from "node:assert/strict";
import test from "node:test";

import { originalLine, renderEvidence } from "./evidence.mjs";

test("两句都在：用户确认在前，被纠正在后", () => {
  assert.equal(
    renderEvidence({ user: "版本固定在 0.1.0。", corrected: "版本号我顺手升到 0.2.0。" }),
    "用户确认：版本固定在 0.1.0。\n被纠正：版本号我顺手升到 0.2.0。"
  );
});

test("没在纠正谁：只写用户那句", () => {
  assert.equal(renderEvidence({ user: "日志一律走 stderr。" }), "用户确认：日志一律走 stderr。");
});

test("只有被纠正的那句也认——宁可少一半，不要丢", () => {
  assert.equal(renderEvidence({ corrected: "我给这里加了层缓存。" }), "被纠正：我给这里加了层缓存。");
});

test("两句都没有：空串，等于没留原文", () => {
  assert.equal(renderEvidence({}), "");
  assert.equal(renderEvidence(), "");
  assert.equal(renderEvidence({ user: "   ", corrected: "" }), "");
});

test("模型自己带了前缀：剥掉一层，不套成两层", () => {
  assert.equal(renderEvidence({ user: "用户确认：用 snake_case。" }), "用户确认：用 snake_case。");
  assert.equal(renderEvidence({ corrected: "被纠正对象：这里其实是毫秒。" }), "被纠正：这里其实是毫秒。");
});

test("多行 / 多空格被压成一行——原文是行式文件里的一段", () => {
  assert.equal(
    renderEvidence({ user: "第一行\n  第二行" }),
    "用户确认：第一行 第二行"
  );
});

test("原结论那行带编号——取代几次之后能按顺序对上取代链", () => {
  assert.equal(originalLine("C-001", "旧的措辞。"), "原结论 C-001：旧的措辞。");
});

test("没有旧的说法就不写那一行", () => {
  assert.equal(originalLine("C-001", "   "), "");
  assert.equal(originalLine("C-001", null), "");
});
