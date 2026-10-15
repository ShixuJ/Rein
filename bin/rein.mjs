#!/usr/bin/env node
// rein 的终端命令：不进模型，直接把账本念出来。
//
// 为什么要有它：桌面版的面板得由宿主打开（侧栏入口、或 `codex://` 链接），而 CLI 里根本
// 没有面板——MCP App 在 CLI 还没开。可"看一眼账本"这件事本来就不该过模型：它只是读几个
// 文件。所以给终端一条直路，顺手让脚本与 CI 也能拿到账本。
//
// 边界：这里**只读**。改条目（改标签、取代、退休）要写回账本，那是面板与落地表单的活。

import { NO_EVIDENCE_NOTE } from "../logic/evidence.mjs";
import { readLedgerState } from "../logic/ledger-state.mjs";
import { ledgerLines } from "../logic/ledger-text.mjs";
import { LEDGER_FILENAME, localDir, readEvidence, stateDir } from "../logic/store.mjs";

const COMMANDS = ["open", "list", "evidence", "path"];

const USAGE = [
  "rein — 看一眼对齐账本（不进模型）",
  "",
  "用法：rein [命令] [选项]",
  "",
  "命令：",
  "  open              打印整本账本：生效在前、已失效在后（默认命令；list 是它的别名）",
  "  evidence C-0NN    某条结论落地时留下的原文（用户当时那句话）",
  "  path              账本文件与本地数据目录在哪",
  "",
  "选项：",
  "  --root <目录>     项目根目录（默认：当前目录）",
  "  --json            机器可读（脚本、CI 用）",
  "  -h, --help        这段话",
  "",
  "只读。改条目请用桌面版的面板，或对话里的落地表单。"
].join("\n");

/** argv → { command, target, root, json, help }。手写而不引依赖：选项就三个。 */
function parseArgv(argv) {
  const parsed = { command: null, target: null, root: null, json: false, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "-h" || token === "--help") {
      parsed.help = true;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--root") {
      const value = argv[index + 1];
      if (value == null || value.startsWith("--")) {
        return { error: "--root 后面要跟一个目录。" };
      }
      parsed.root = value;
      index += 1;
      continue;
    }
    if (token.startsWith("--")) {
      return { error: `不认识的选项：${token}` };
    }

    if (parsed.command === null) {
      parsed.command = token;
      continue;
    }
    if (parsed.target === null) {
      parsed.target = token;
      continue;
    }
    return { error: `多出来一个参数：${token}` };
  }

  if (parsed.command !== null && !COMMANDS.includes(parsed.command)) {
    return { error: `不认识的命令：${parsed.command}` };
  }

  return parsed;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function main(argv) {
  const parsed = parseArgv(argv);

  if (parsed.error) {
    fail(`${parsed.error}\n\n${USAGE}`);
    return;
  }
  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const command = parsed.command ?? "open";
  const root = parsed.root ?? process.cwd();

  if (command === "path") {
    const lines = [
      `项目：${root}`,
      `账本：${stateDir(root)}/${LEDGER_FILENAME}`,
      `本地数据（收件箱、原文）：${localDir(root)}`
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
    return;
  }

  if (command === "evidence") {
    const id = String(parsed.target ?? "").trim();
    if (!id) {
      fail("要看哪一条？写成 `rein evidence C-0NN`。");
      return;
    }

    const text = await readEvidence(root, id);
    // 没有原文不是错误，是"这条不是从对话里落的"——说明白就行，别给一块空白。
    process.stdout.write(`${id} 的原文：\n\n${text ?? NO_EVIDENCE_NOTE}\n`);
    return;
  }

  // open / list
  const state = await readLedgerState(root);
  if (parsed.json) {
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${ledgerLines(state).join("\n")}\n`);
}

await main(process.argv.slice(2));
