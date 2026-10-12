import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// run-node.sh 的两个入口（MCP server 与钩子）都靠它找 node。它的失败方式决定了插件是
// "静默不回话"还是"留一行给人看"，所以这几条盯的是：找得到、参数透传、指定就用指定的、
// 找不到时**不挡提问**（退出码 0）且 stdout 干净。

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const LAUNCHER = join(REPO, "scripts", "run-node.sh");

async function scratch() {
  return mkdtemp(join(tmpdir(), "rein-launcher-"));
}

function run(args, env = {}) {
  const options = {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  };

  try {
    return { status: 0, stdout: execFileSync("/bin/sh", [LAUNCHER, ...args], options) };
  } catch (error) {
    return { status: error.status ?? 1, stdout: String(error.stdout ?? "") };
  }
}

test("--which 报出一个真实存在的 node", async () => {
  const dir = await scratch();
  const picked = run(["--which"], { REIN_NODE: "", REIN_NODE_LOG: join(dir, "n.log") }).stdout.trim();

  assert.ok(picked, "一个 node 都没找到");
  assert.ok(existsSync(picked), `${picked} 不存在`);
});

test("真的用那个 node 把脚本跑起来，参数原样透传", async () => {
  const dir = await scratch();
  const script = join(dir, "probe.mjs");
  await writeFile(script, "console.log(JSON.stringify(process.argv.slice(2)));\n", "utf8");

  const result = run([script, "甲", "乙"], { REIN_NODE_LOG: join(dir, "n.log") });

  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout.trim()), ["甲", "乙"]);
});

test("REIN_NODE 指定了就用它，不再往下猜", async () => {
  const dir = await scratch();
  const fake = join(dir, "fake-node");
  await writeFile(fake, '#!/bin/sh\necho "FAKE $*"\n', "utf8");
  await chmod(fake, 0o755);

  const result = run(["/tmp/whatever.mjs", "x"], {
    REIN_NODE: fake,
    REIN_NODE_LOG: join(dir, "n.log")
  });

  assert.equal(result.stdout.trim(), "FAKE /tmp/whatever.mjs x");
});

test("一个 node 都找不到：退出码 0，留一行日志，stdout 干净", async () => {
  const dir = await scratch();
  const log = join(dir, "n.log");

  const result = run(["whatever.mjs"], {
    REIN_NODE: join(dir, "根本没有这个"),
    REIN_NODE_LOG: log
  });

  // 退出码必须是 0：钩子绝不能挡住用户的提问。
  assert.equal(result.status, 0);
  // stdout 必须干净：那是钩子写 hookSpecificOutput 的地方，混进去一个字都会破协议。
  assert.equal(result.stdout, "");
  assert.match(await readFile(log, "utf8"), /找不到 node/);
});

test("成功时日志记着用的是哪个 node、什么版本", async () => {
  const dir = await scratch();
  const log = join(dir, "n.log");
  const script = join(dir, "probe.mjs");
  await writeFile(script, "console.log('ok');\n", "utf8");

  run([script], { REIN_NODE_LOG: log });
  const written = await readFile(log, "utf8");

  assert.match(written, /node=.+node/);
  assert.match(written, /version=v\d+/);
  assert.match(written, new RegExp(`script=${script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});
