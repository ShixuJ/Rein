// 把账本"念成人话"的那几句。两个入口共用同一份：终端命令（bin/rein.mjs）与 MCP 工具的
// 文本回话。分开各写一套的后果是同一件事在两边慢慢说岔——措辞只留一份，在这里。
//
// 面板不走这里：它是图形界面，有自己的一套渲染（ui/panel.html 里，跟这里无关）。

import { isActive } from "./item.mjs";

/**
 * 一句话摘要。上限把条目挤出热块时必须说出来，否则那是"静默失效"：
 * 条目还在账本里、还是生效，却不再每轮注入了。
 */
export function describeLedger(state) {
  const parts = [`${state.active} 条生效、${state.total - state.active} 条已失效`];
  if (state.hotBlock?.dropped > 0) {
    parts.push(
      `热块这次只带前 ${state.hotBlock.shown} 条，另外 ${state.hotBlock.dropped} 条超出上限（${state.hotBlock.maxItems}）——它们仍在账本里，但不再每轮注入`
    );
  }
  return `${parts.join("；")}。`;
}

/** 失效原因说成人话：取代有链，退休就一个字。 */
export function statusLabel(item) {
  if (item?.status === "retired") return "已退休";
  const match = /^superseded by (C-\d+)$/.exec(String(item?.status ?? ""));
  return match ? `已由 ${match[1]} 取代` : String(item?.status ?? "");
}

/**
 * 终端里的整份账本：生效在前、失效在后，一条一行。
 *
 * 返回行数组而不是一整段字符串：调用方自己决定怎么接（stdout、还是拼进别的输出）。
 */
export function ledgerLines(state, { includeInactive = true } = {}) {
  const items = Array.isArray(state?.items) ? state.items : [];
  if (items.length === 0) return ["账本还是空的。"];

  const active = items.filter(isActive);
  const inactive = items.filter((item) => !isActive(item));
  const lines = [describeLedger(state), "", `生效 ${active.length} 条`];

  if (active.length === 0) {
    lines.push("  （没有）");
  } else {
    for (const item of active) {
      lines.push(`  ${item.id} · ${item.type} · ${item.date}：${item.statement}`);
    }
  }

  if (includeInactive && inactive.length > 0) {
    lines.push("", `已失效 ${inactive.length} 条`);
    for (const item of inactive) {
      lines.push(`  ${item.id} · ${statusLabel(item)}：${item.statement}`);
    }
  }

  if (state?.archived?.count > 0) {
    lines.push("", `归档 ${state.archived.count} 条（在 ALIGNMENT-ARCHIVE.md 里，条目一条没删）`);
  }

  return lines;
}
