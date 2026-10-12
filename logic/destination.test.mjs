import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DESTINATION,
  DESTINATIONS,
  destinationChoice,
  destinationLabel,
  destinationSlug,
  suggestionSlug
} from "./destination.mjs";

test("三个目的地就是表单上的三个选项，顺序稳定", () => {
  assert.deepEqual(
    DESTINATIONS.map((entry) => entry.label),
    ["Align", "Restate", "Ignore"]
  );
});

test("slug 与表单标签来回换", () => {
  for (const { slug, label } of DESTINATIONS) {
    assert.equal(destinationLabel(slug), label);
    assert.equal(destinationSlug(label), slug);
  }
});

test("认不出来的 slug 与标签都退回兜底", () => {
  assert.equal(destinationLabel("nonsense"), destinationLabel(DEFAULT_DESTINATION));
  assert.equal(destinationSlug("随便什么"), DEFAULT_DESTINATION);
  assert.equal(suggestionSlug(undefined), DEFAULT_DESTINATION);
  assert.equal(suggestionSlug(null), DEFAULT_DESTINATION);
  assert.equal(suggestionSlug(""), DEFAULT_DESTINATION);
});

test("旧词都落到 Ignore", () => {
  // 老 skill 文本或模型的旧习惯会写这几个词，一律等同于"不落地"。
  assert.equal(suggestionSlug("ignore"), "ignore");
  assert.equal(suggestionSlug("skip"), DEFAULT_DESTINATION);
  assert.equal(suggestionSlug("不落地"), DEFAULT_DESTINATION);
  assert.equal(destinationSlug("不落地"), DEFAULT_DESTINATION);
});

test("模型写 slug 或写标签都认", () => {
  assert.equal(suggestionSlug("land"), "land");
  assert.equal(suggestionSlug("Restate"), "restate");
  assert.equal(suggestionSlug("  Align  "), "land");
  assert.equal(suggestionSlug("landed"), DEFAULT_DESTINATION);
});

test("每个目的地都带一句说明，表单要拿它解释选项", () => {
  for (const { hint } of DESTINATIONS) {
    assert.equal(typeof hint, "string");
    assert.ok(hint.length > 0);
  }
});

test("选项文字是「标签 · 一句解释」", () => {
  assert.equal(destinationChoice("restate"), "Restate · 只带回主线说一次");
  assert.equal(destinationChoice("land"), "Align · 写进账本，以后每轮带上");
});

test("回传的是带解释的整句也认——认不出来会静默落成 Ignore，代价太大", () => {
  assert.equal(destinationSlug("Restate · 只带回主线说一次"), "restate");
  assert.equal(destinationSlug("Align · 写进账本，以后每轮带上"), "land");
  assert.equal(destinationSlug("Ignore · 不留痕"), "ignore");
});
