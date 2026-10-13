// 热块的渲染。
//
// 热块不是文件，是钩子在每次提问那一刻从 ALIGNMENT.md 现渲染出来的东西。这里两件事：
// 把生效项渲染成块、把 AGENTS.md 里的旧受管区块摘掉。
// 为什么不把热块写进 AGENTS.md：它只在 app 重启或线程重载时读一次，做不到每轮生效。

import { isActive } from "./item.mjs";

export const HOT_BLOCK_BEGIN = "<!-- rein:begin -->";
export const HOT_BLOCK_END = "<!-- rein:end -->";

// 热块上限的出厂默认值。只在这里定义一次：config.mjs 的 `DEFAULT_CONFIG` 从这里取。
export const DEFAULT_MAX_ITEMS = 20;

/**
 * 挑出这一次真正要进热块的条目。
 *
 * 上限（`hot_block_max_items`）到了以后，最早的生效项仍在账本里，但不再每轮注入——
 * 也就是"悄无声息地失效"。返回 total / dropped 就是为了让这件事能被看见：
 * 钩子把它写进注入行，面板把它写在生效区标题旁边。
 */
export function selectHotBlock(items, { maxItems = DEFAULT_MAX_ITEMS } = {}) {
  const active = items.filter(isActive);
  const limit = Number(maxItems);
  // 上限读不成数字时**全给**，不静默丢掉任何一条。
  const shown = Number.isFinite(limit) && limit >= 0 ? active.slice(-limit) : active;
  return { shown, total: active.length, dropped: active.length - shown.length };
}

export function renderHotBlock(items, options = {}) {
  const { shown: active } = selectHotBlock(items, options);

  const lines = [
    HOT_BLOCK_BEGIN,
    "## 已确认前提（由 rein 维护，勿手改）",
    ""
  ];

  if (active.length === 0) {
    lines.push("_（暂无）_");
  } else {
    for (const item of active) {
      lines.push(`- [${item.id}] ${item.type}：${item.statement}`);
    }
  }

  lines.push(HOT_BLOCK_END);
  return lines.join("\n");
}

/** 把受管区块从文件里摘掉，其余内容保持原样；没有区块就原样返回。 */
export function removeHotBlock(text) {
  const source = String(text ?? "");
  const begin = source.indexOf(HOT_BLOCK_BEGIN);
  const end = source.indexOf(HOT_BLOCK_END);

  if (begin === -1 || end === -1 || end < begin) return source;

  const before = source.slice(0, begin).trimEnd();
  const after = source.slice(end + HOT_BLOCK_END.length).trimStart().trimEnd();
  const merged = [before, after].filter(Boolean).join("\n\n");

  return merged ? `${merged}\n` : "";
}
