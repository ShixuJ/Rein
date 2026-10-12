#!/usr/bin/env node
// rein 的"每轮生效"通道。
//
// 在 UserPromptSubmit 时刻运行——也就是用户按下回车之后、模型开始这一轮之前。
// 因为是在那一刻现读账本，侧聊刚落的、面板刚改的、手改的，只要在下一次提问前
// 落盘，就一定会被带上。AGENTS.md 的受管区块做不到这一点（它只在会话开始读一次）。
//
// 边界：解析、渲染、上限全在 logic/ 里，这里只做"读 stdin → 调纯函数 → 写 stdout"。
// 任何失败都不该挡住用户的提问，所以出错一律静默退出，绝不 output 半截东西。

import { appendFileSync, existsSync } from "node:fs";

import { isActive } from "../logic/item.mjs";
import { renderHotBlock, selectHotBlock } from "../logic/hot-block.mjs";
import {
  readConfig,
  readItems,
  takeRestatements,
  writeSessionMarker
} from "../logic/store.mjs";

// 效力规则必须写死在这里，而且必须是三级——不是两级。
//
// 注入是贴在用户当前这条消息**后面**到达的。如果只说"与上文对话冲突时以此为准"，
// 那么当用户这句话正好与某条已确认项相反时，模型看到的顺序是"用户的话 → 这条前提"，
// 后出现的反而占了上风。那是错的：用户此刻的要求永远优先。
const HEADER = [
  "以下是本项目当前生效的已确认前提（来自 `ALIGNMENT.md`，由 rein 维护，每次提问时现渲染）。",
  "效力：与更早的对话冲突时，以此为准；**但用户当前这条消息里的要求优先于这里**。"
].join("\n");

// 复述是用户刚从侧聊带回来的一段，不是账本里的长期前提。它只出现这一次，
// 效力按"用户当前这条消息"算——所以它比已确认前提更优先。
//
// 复述要**显眼**：它是一次性的，用户得能一眼看见"这段回来了"。所以标题加粗，
// 条目用引用块，并且明说"在你的回复里也照样标出来"——不然它会淹在正文里。
const RESTATEMENT_HEADER = [
  "**以下是用户刚从侧聊带回来的一次性复述**（到达即消费，下一条提问不会再带上）。",
  "它不进账本；效力等同于用户当前这条消息，优先于上面的已确认前提。",
  "**这一轮回复里要把它原样说出来，并用加粗或引用标出来，让它一眼可见**——别改写、别总结。"
].join("\n");

// 可选追踪：这个标记文件存在时，每次触发都记一行 session / turn，排查会话归属用。
// 用标记文件而不是环境变量——钩子命令大概是直接 exec 的，不保证过 shell。
const TRACE_MARKER = "/tmp/rein-hook-trace.on";
const TRACE_PATH = "/tmp/rein-hook-trace.log";

async function buildContext(rawInput) {
  let input = {};
  try {
    input = JSON.parse(rawInput);
  } catch {
    return null;
  }

  // cwd 就是项目根。钩子对任何项目都可能触发，没有账本的项目什么都不注入。
  const root = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();

  // 侧聊是临时的、没有 rollout 文件，所以 transcript_path 为 null；主线程非 null。
  // 这是判别"在不在侧聊里"的唯一可靠信号（agent_type / agent_id 两边都不给）。
  const session = {
    session_id: input.session_id ?? null,
    transcript: input.transcript_path ?? null,
    side: !input.transcript_path,
    at: new Date().toISOString()
  };

  // MCP 工具调用里没有会话信息，所以 rein_land 读不到"自己是在主线程还是侧聊里被调的"。
  // 这一轮是哪个会话，只有钩子知道——记下来给工具用。按项目根分开，两个项目不会串。
  await writeSessionMarker(root, session).catch(() => {});

  if (existsSync(TRACE_MARKER)) {
    try {
      appendFileSync(
        TRACE_PATH,
        [
          new Date().toISOString(),
          `event=${input.hook_event_name ?? "?"}`,
          `session=${input.session_id ?? "?"}`,
          `turn=${input.turn_id ?? "?"}`,
          `agent_type=${input.agent_type ?? "?"}`,
          `agent_id=${input.agent_id ?? "?"}`,
          `transcript=${input.transcript_path ?? "null"}`,
          `cwd=${root}`
        ].join("\t") + "\n",
        "utf8"
      );
    } catch {
      // 追踪写不进去不该影响注入。
    }
  }

  const items = await readItems(root).catch(() => []);
  const active = items.filter(isActive).length;

  // 收件箱只投给主线程，且投递即消费。写回失败时 takeRestatements 返回空——
  // 条目留着，下一轮再来，宁可晚到也不要重复。
  const restatements = await takeRestatements(root, {
    session: session.session_id ?? "",
    isMain: !session.side
  }).catch(() => []);

  if (active === 0 && restatements.length === 0) return null;

  const config = await readConfig(root).catch(() => null);
  const maxItems = Number(config?.hot_block_max_items);
  const options = Number.isFinite(maxItems) && maxItems > 0 ? { maxItems } : {};
  const block = renderHotBlock(items, options);
  const hot = selectHotBlock(items, options);

  // 这行 provenance 是给验证用的：AGENTS.md 的受注块里没有它，
  // 所以只要它在上下文里出现，就只可能来自钩子。
  // `items` 是这一次真的进了热块的条数；上限把生效项挤出去时补一个 `dropped=`，
  // 否则"有条目静默退出每轮注入"这件事从这行上看不出来。
  const stamp = new Date().toISOString();
  const provenance = [
    `<!-- rein:inject at=${stamp}`,
    `items=${hot.shown.length}`,
    hot.dropped > 0 ? `dropped=${hot.dropped}` : "",
    `restatements=${restatements.length} -->`
  ]
    .filter(Boolean)
    .join(" ");

  const parts = [HEADER, "", block];

  if (restatements.length > 0) {
    parts.push("", RESTATEMENT_HEADER, "", ...restatements.map((entry) => `> ${entry.text}`));
  }

  parts.push("", provenance);
  return parts.join("\n");
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
});
process.stdin.on("end", async () => {
  let context = null;
  try {
    context = await buildContext(raw);
  } catch {
    context = null;
  }

  if (!context) {
    process.exit(0);
  }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: context
      }
    }) + "\n"
  );
});
