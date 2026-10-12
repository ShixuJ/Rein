import assert from "node:assert/strict";
import test from "node:test";

import { createEntry, deliverable, parseInbox, serializeInbox } from "./inbox.mjs";

const AT = "2026-10-05T10:12:00.000Z";

function entry(text, session = "") {
  return createEntry(text, { at: AT, session });
}

test("空收件箱也能序列化，且能读回来", () => {
  assert.deepEqual(parseInbox(serializeInbox([])), []);
});

test("序列化再解析，字段一个不差", () => {
  const entries = [entry("先别重构，把这轮的钩子验完。", "side-1"), entry("另一段。")];
  assert.deepEqual(parseInbox(serializeInbox(entries)), entries);
});

test("文本压成一行——收件箱是行式文件，不能留换行", () => {
  const [only] = parseInbox(serializeInbox([entry("第一行\n第二行")]));
  assert.equal(only.text, "第一行 第二行");
});

test("没写文本的空条目读不回来", () => {
  assert.deepEqual(parseInbox("### 2026-10-05T10:12:00.000Z\n写入者：x\n文本：\n"), []);
});

test("侧聊里一条都不投——这是新开侧聊也吃不掉条目的原因", () => {
  const entries = [entry("甲。", "side-1")];

  assert.deepEqual(deliverable(entries, { session: "side-2", isMain: false }), []);
  assert.deepEqual(deliverable(entries, { session: "side-1", isMain: false }), []);
});

test("主线程投递，且不投给写入者自己", () => {
  const entries = [entry("甲。", "side-1")];

  assert.deepEqual(deliverable(entries, { session: "main-1", isMain: true }), entries);
  assert.deepEqual(deliverable(entries, { session: "side-1", isMain: true }), []);
});

test("写入者未知时照样投——宁可晚一轮到，不能丢", () => {
  const entries = [entry("甲。")];

  assert.deepEqual(deliverable(entries, { session: "main-1", isMain: true }), entries);
});

test("投递只挑该投的，其余原样留在收件箱", () => {
  const entries = [entry("这条是自己写的，不投。", "side-1"), entry("这条投。", "side-0")];
  const taken = deliverable(entries, { session: "side-1", isMain: true });

  assert.deepEqual(taken, [entry("这条投。", "side-0")]);
  assert.deepEqual(
    entries.filter((item) => !taken.includes(item)),
    [entry("这条是自己写的，不投。", "side-1")]
  );
});
