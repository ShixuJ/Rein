import assert from "node:assert/strict";
import test from "node:test";

import { HOOK_STALE_MS, hookFreshness, humanAgo } from "./hook-status.mjs";

const NOW = Date.parse("2026-10-11T10:00:00.000Z");
const at = (ms) => ({ at: new Date(ms).toISOString() });

test("新鲜的标记：recent=true，带回 lastRunAt 与 ageMs", () => {
  assert.deepEqual(hookFreshness(at(NOW - 1000), { now: NOW }), {
    lastRunAt: "2026-10-11T09:59:59.000Z",
    ageMs: 1000,
    recent: true
  });
});

test("很旧的标记：recent=false——钩子大概率没在跑", () => {
  assert.equal(hookFreshness(at(NOW - HOOK_STALE_MS - 1), { now: NOW }).recent, false);
  assert.equal(hookFreshness(at(NOW - HOOK_STALE_MS), { now: NOW }).recent, true, "刚到期还算数");
});

test("没有标记、或时间读不出来：recent=false、lastRunAt=null", () => {
  const missing = { lastRunAt: null, ageMs: null, recent: false };
  assert.deepEqual(hookFreshness(null, { now: NOW }), missing);
  assert.deepEqual(hookFreshness({}, { now: NOW }), missing);
  assert.deepEqual(hookFreshness({ at: "不是时间" }, { now: NOW }), missing);
});

test("humanAgo 分档", () => {
  assert.equal(humanAgo(5_000), "刚刚");
  assert.equal(humanAgo(10 * 60_000), "10 分钟");
  assert.equal(humanAgo(3 * 3_600_000), "3 小时");
  assert.equal(humanAgo(5 * 86_400_000), "5 天");
});
