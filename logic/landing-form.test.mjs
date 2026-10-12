import assert from "node:assert/strict";
import test from "node:test";

import { parseConfig } from "./config.mjs";
import { buildLandingForm, readLandingAnswers } from "./landing-form.mjs";

const CONFIG = parseConfig("");

function form(candidates) {
  return buildLandingForm(candidates, CONFIG);
}

test("一条候选一个字段——向导一问一页，两个字段就是两页", () => {
  const { properties, slots } = form([{ statement: "甲。", destination: "land" }]);

  assert.deepEqual(Object.keys(properties), ["c1"]);
  assert.deepEqual(slots.map((slot) => slot.key), ["c1"]);
});

test("那句话就是那一页的问题文字——它得和选项在同一页上", () => {
  const { properties } = form([{ statement: "先别重构。" }]);

  assert.equal(properties.c1.title, "先别重构。");
});

test("选项文字各自带解释，且与 enum 逐项对齐", () => {
  const { properties } = form([{ statement: "甲。", destination: "restate" }]);
  const choice = properties.c1;

  assert.equal(choice.enum.length, choice.enumNames.length);
  assert.equal(choice.enum[0], "Restate", "建议的那一项排第一");
  choice.enum.forEach((label, index) => {
    assert.ok(
      choice.enumNames[index].startsWith(label),
      `第 ${index} 项的文字要以 ${label} 开头`
    );
  });
});

test("顶部只留一行标题：没有说明书，但也不能空着", () => {
  assert.equal(form([{ statement: "甲。" }]).message, "这条去哪？");
  assert.equal(form([{ statement: "甲。" }, { statement: "乙。" }]).message, "逐条选去哪");
});

test("顶部那行不带说明书——建议在描述里、进度由向导自己写", () => {
  const { message } = form([{ statement: "甲。" }, { statement: "乙。" }]);

  assert.doesNotMatch(message, /描述里写着/);
  assert.doesNotMatch(message, /共\s*\d+\s*条/);
  assert.doesNotMatch(message, /Skip/);
});

test("建议写在条目自己的描述里", () => {
  const { properties } = form([
    { statement: "甲。", destination: "land", type: "error-correction" }
  ]);

  assert.match(properties.c1.description, /建议 Align/);
  assert.match(properties.c1.description, /标签 错误纠正/);
  // 只有一条候选时"第 1 条"是废话——它就在唯一那一页上。
  assert.doesNotMatch(properties.c1.description, /第 1 条/);
});

test("多条候选才编号", () => {
  const { properties } = form([{ statement: "甲。" }, { statement: "乙。" }]);

  assert.match(properties.c2.description, /^第 2 条 · 建议/);
});

test("多条候选各占一个字段，编号跟着走", () => {
  const { properties } = form([{ statement: "甲。" }, { statement: "乙。" }]);

  assert.deepEqual(Object.keys(properties), ["c1", "c2"]);
  assert.equal(properties.c2.title, "乙。");
});

test("没给建议时落到不落地，选项顺序跟着变", () => {
  const { properties } = form([{ statement: "甲。" }]);
  const choice = properties.c1;

  assert.equal(choice.enum[0], "Ignore");
  assert.equal(choice.default, "Ignore");
  assert.deepEqual(new Set(choice.enum), new Set(["Align", "Restate", "Ignore"]));
});

// --- 回传怎么读 -------------------------------------------------------------

function answers(candidates, content) {
  const { slots } = form(candidates);
  return readLandingAnswers(slots, content);
}

test("选 Align 的落地，选 Restate 的复述", () => {
  const { chosen, restatements } = answers(
    [
      { statement: "甲。", type: "error-correction", destination: "land" },
      { statement: "乙。", destination: "restate" }
    ],
    { c1: "Align", c2: "Restate" }
  );

  assert.deepEqual(chosen, [{ statement: "甲。", type: "error-correction", supersedes: "" }]);
  assert.deepEqual(restatements, ["乙。"]);
});

test("没回传这个 key 就是没动过，按建议走", () => {
  const land = answers([{ statement: "甲。", destination: "land" }], {});
  assert.deepEqual(land.chosen.map((item) => item.statement), ["甲。"]);

  const restate = answers([{ statement: "乙。", destination: "restate" }], {});
  assert.deepEqual(restate.restatements, ["乙。"]);
});

test("选 Ignore 的两边都不进，什么都不写", () => {
  const { chosen, restatements } = answers([{ statement: "甲。" }], { c1: "Ignore" });

  assert.deepEqual(chosen, []);
  assert.deepEqual(restatements, []);
});

test("认不出来的值退回不落地——少留痕比多留痕安全", () => {
  const { chosen, restatements } = answers([{ statement: "甲。", destination: "land" }], {
    c1: "随便什么"
  });

  assert.deepEqual(chosen, []);
  assert.deepEqual(restatements, []);
});

test("回传带解释的整句也认（表单上显示的就是整句）", () => {
  const { chosen } = answers([{ statement: "甲。" }], { c1: "Align · 写进账本，以后每轮带上" });

  assert.deepEqual(chosen.map((item) => item.statement), ["甲。"]);
});

test("supersedes 跟着候选走，没写的补空串", () => {
  const { chosen } = answers(
    [
      { statement: "新的。", destination: "land", supersedes: " C-001 " },
      { statement: "另一条。", destination: "land" }
    ],
    { c1: "Align", c2: "Align" }
  );

  assert.deepEqual(chosen.map((item) => item.supersedes), ["C-001", ""]);
});

test("什么都没回传时按建议走，不是全丢", () => {
  const { chosen, restatements } = answers(
    [
      { statement: "甲。", destination: "land" },
      { statement: "乙。", destination: "restate" },
      { statement: "丙。", destination: "ignore" }
    ],
    undefined
  );

  assert.deepEqual(chosen.map((item) => item.statement), ["甲。"]);
  assert.deepEqual(restatements, ["乙。"]);
});
