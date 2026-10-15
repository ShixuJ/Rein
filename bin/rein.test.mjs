import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const BIN = join(dirname(fileURLToPath(import.meta.url)), "rein.mjs");

// 每条用例自己的数据目录（REIN_HOME）：真正的 ~/.codex/rein 一个字都不动。
async function scratchProject() {
  const home = await mkdtemp(join(tmpdir(), "rein-cli-home-"));
  const project = await mkdtemp(join(tmpdir(), "rein-cli-project-"));
  return { home, project };
}

async function rein(args, { home, project }) {
  try {
    const { stdout, stderr } = await run(process.execPath, [BIN, ...args, "--root", project], {
      env: { ...process.env, REIN_HOME: home }
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    // 非零退出码时 execFile 会抛——结果挂在 error 上，取回来照常断言。
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("rein：把账本念出来——生效在前、失效在后，都不经过模型", async () => {
  const { home, project } = await scratchProject();
  process.env.REIN_HOME = home;

  const { commitItems, retireItem } = await import("../logic/store.mjs");
  await commitItems(
    project,
    [{ statement: "结论甲。", type: "concept-alignment" }, { statement: "结论乙。" }],
    { date: "2026-10-15" }
  );
  await retireItem(project, { id: "C-002" });

  const { stdout } = await rein([], { home, project });

  assert.match(stdout, /1 条生效、1 条已失效。/);
  assert.match(stdout, /C-001 · concept-alignment · 2026-10-15：结论甲。/);
  assert.match(stdout, /C-002 · 已退休：结论乙。/);

  await rm(home, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
});

test("rein --json：脚本拿到的是和 MCP 工具同一份状态", async () => {
  const { home, project } = await scratchProject();
  process.env.REIN_HOME = home;

  const { commitItems } = await import("../logic/store.mjs");
  await commitItems(project, [{ statement: "只有这一条。" }], { date: "2026-10-15" });

  const { stdout } = await rein(["--json"], { home, project });
  const state = JSON.parse(stdout);

  assert.equal(state.root, project);
  assert.equal(state.active, 1);
  assert.equal(state.items[0].statement, "只有这一条。");

  await rm(home, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
});

test("rein evidence：没留过原文的那条，回一句说明而不是空白", async () => {
  const { home, project } = await scratchProject();

  const { stdout } = await rein(["evidence", "C-001"], { home, project });
  assert.match(stdout, /C-001 的原文/);
  assert.match(stdout, /外部写入/);

  await rm(home, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
});

test("rein path：告诉终端用户账本到底在哪", async () => {
  const { home, project } = await scratchProject();

  const { stdout } = await rein(["path"], { home, project });
  assert.match(stdout, /账本：.*ALIGNMENT\.md/);

  await rm(home, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
});

test("不认识的命令：退出码 1，并把这行命令的用法说出来", async () => {
  const { home, project } = await scratchProject();

  const result = await rein(["写着玩"], { home, project });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /不认识的命令/);
  assert.match(result.stderr, /用法：rein/);

  await rm(home, { recursive: true, force: true });
  await rm(project, { recursive: true, force: true });
});
