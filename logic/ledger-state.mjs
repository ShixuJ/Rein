// "账本此刻长什么样"——面板、MCP 工具、终端命令看到的必须是同一份，所以它只在这里算。
//
// 只读、只汇总：条目、类型表、热块的真实口径、归档条数、钩子新鲜度。写入不在这层。

import { listTypes } from "./config.mjs";
import { DEFAULT_MAX_ITEMS, selectHotBlock } from "./hot-block.mjs";
import { hookFreshness } from "./hook-status.mjs";
import { isActive } from "./item.mjs";
import { countArchived, readConfig, readItems, readSessionMarker } from "./store.mjs";

export async function readLedgerState(root) {
  const config = await readConfig(root);
  const items = await readItems(root);
  const active = items.filter(isActive).length;

  // 热块的真实窗口：上限之外的那些仍在账本里、仍是 active，但不再每轮注入。
  // 面板与终端都要把这件事说出来，不然一条已确认项会静默退出注入而谁也看不见。
  const configured = Number(config?.hot_block_max_items);
  const maxItems = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_ITEMS;
  const hot = selectHotBlock(items, { maxItems });

  // 归档里的条目不进面板（面板就是嫌它们太长才要归档），只报个数字，
  // 让人知道历史没丢、去哪儿找。
  const archived = await countArchived(root).catch(() => 0);

  // 「钩子还在不在跑」——这是最容易静默失效的一环（装完没重启、重装后没重新信任）。
  const hook = hookFreshness(await readSessionMarker(root).catch(() => null));

  return {
    root,
    // 这里**不带**任何原文信息：账本状态是给模型看的，原文是给用户看的，
    // 面板要用时自己点开去 rein_evidence 取——模型不会因此背上原文。
    items,
    types: listTypes(config),
    active,
    total: items.length,
    archived: { count: archived },
    hotBlock: { maxItems, shown: hot.shown.length, dropped: hot.dropped },
    hook
  };
}
