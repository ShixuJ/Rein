import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// 这个文件必须**先设好标记目录、再 import store**：store 在模块加载时就把 SESSION_DIR
// 定下来了。测试绝不碰真机上那份 /tmp/rein-session-<uid>/——app 正用着它，往里写一条
// 未来时间的标记，就会把"当前项目"认到测试目录头上，而且没人会发现。
const MARKER_DIR = await mkdtemp(join(tmpdir(), "rein-session-test-"));
process.env.REIN_SESSION_DIR = MARKER_DIR;

const { listRecentProjects, mostRecentProjectRoot, readSessionMarker, writeSessionMarker } =
  await import("./store.mjs");

/** 每条用例从"一条标记都没有"开始，用例之间不靠执行顺序。 */
async function clearMarkers() {
  for (const name of await readdir(MARKER_DIR)) {
    await rm(join(MARKER_DIR, name), { force: true });
  }
}

after(async () => {
  await rm(MARKER_DIR, { recursive: true, force: true }).catch(() => {});
});

test("标记里带着项目根——面板从 UI 入口打开时，就靠它认出“当前项目”", async () => {
  await clearMarkers();
  const root = await mkdtemp(join(tmpdir(), "rein-project-"));

  await writeSessionMarker(root, {
    session_id: "main-1",
    transcript: "/tmp/rollout.jsonl",
    at: "2026-01-01T00:00:00.000Z"
  });

  const marker = await readSessionMarker(root);
  assert.equal(marker.root, root, "根得存在内容里：文件名是哈希，反推不回去");
  assert.equal(marker.session_id, "main-1", "原有的字段一个不动");

  await rm(root, { recursive: true, force: true });
});

test("最近一次提问的项目 = 标记里最新的那个；一条标记都没有就是 null", async () => {
  await clearMarkers();
  assert.equal(mostRecentProjectRoot(), null, "一条标记都没有时认不出项目");

  const older = await mkdtemp(join(tmpdir(), "rein-older-"));
  const newer = await mkdtemp(join(tmpdir(), "rein-newer-"));

  await writeSessionMarker(older, { session_id: "old", at: "2026-01-01T00:00:00.000Z" });
  await writeSessionMarker(newer, { session_id: "new", at: "2026-06-01T00:00:00.000Z" });
  assert.equal(mostRecentProjectRoot(), newer);

  // 更早的那个项目再提问一次（覆盖写）：答案不该被它往回拽。
  await writeSessionMarker(older, { session_id: "old-again", at: "2025-01-01T00:00:00.000Z" });
  assert.equal(mostRecentProjectRoot(), newer);

  await rm(older, { recursive: true, force: true });
  await rm(newer, { recursive: true, force: true });
});

test("标记坏掉、或者没带根：跳过它，别把当前项目带偏", async () => {
  await clearMarkers();

  const good = await mkdtemp(join(tmpdir(), "rein-good-"));
  await writeSessionMarker(good, { session_id: "good", at: "2026-03-01T00:00:00.000Z" });
  await writeFile(join(MARKER_DIR, "broken.json"), "{ 这不是 JSON", "utf8");

  assert.equal(mostRecentProjectRoot(), good);

  await rm(good, { recursive: true, force: true });
});

// 面板的「切换」用的就是这份名单：宿主不告诉 MCP App 你在哪个项目，
// 猜不准的时候只能把最近提问过的摆出来让人自己点。
test("最近提问过的项目：新的在前，同一个项目只出现一次", async () => {
  await clearMarkers();

  const older = await mkdtemp(join(tmpdir(), "rein-older-"));
  const newer = await mkdtemp(join(tmpdir(), "rein-newer-"));

  await writeSessionMarker(older, { session_id: "o1", at: "2026-01-01T00:00:00.000Z" });
  await writeSessionMarker(newer, { session_id: "n1", at: "2026-06-01T00:00:00.000Z" });
  // older 又提问了一次：它排到前面，且不重复出现。
  await writeSessionMarker(older, { session_id: "o2", at: "2026-09-01T00:00:00.000Z" });

  const list = listRecentProjects();
  assert.deepEqual(
    list.map((entry) => entry.path),
    [older, newer]
  );
  assert.equal(list[0].name, older.split("/").filter(Boolean).pop(), "名字取末段，给按钮用");
  assert.equal(list[0].at, "2026-09-01T00:00:00.000Z");
  assert.equal(listRecentProjects({ limit: 1 }).length, 1);
});
