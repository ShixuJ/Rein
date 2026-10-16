// "账本此刻长什么样"——面板、MCP 工具、终端命令看到的必须是同一份，所以它只在这里算。
//
// 只读、只汇总：条目、类型表、热块的真实口径、归档条数、钩子新鲜度。写入不在这层。
//
// 两本账各一个入口：项目那本 `readLedgerState`、跨项目那本 `readCommonLedgerState`。

import { COMMON_LABEL, readCommonState } from "./common-ledger.mjs";
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
    // 保留标签一起递出去：面板要靠它把"从通用账本引来的"挑出来分到另一组，而这三个字
    // 只允许有一处真源（common-ledger.mjs）——面板自己抄一份，改说法时就会漏一处。
    commonLabel: COMMON_LABEL,
    active,
    total: items.length,
    archived: { count: archived },
    hotBlock: { maxItems, shown: hot.shown.length, dropped: hot.dropped },
    hook
  };
}

/**
 * 通用账本此刻长什么样，给面板那一页。
 *
 * `types` 拿的是**当前项目**的配置：通用账本不属于任何项目，没有自己的词表，而面板上
 * 那排标签按钮总得从某处来——用你此刻打开的这个项目，是最不意外的选择。`book` 是给
 * 面板的分流信号：两种账本的 payload 长得像，它得知道这次该画哪一页。
 *
 * 三样这里**没有**：`hook`（「钩子在不在跑」讲的是某个项目的注入，跟这本账没关系）、
 * `archived`（通用账本先不做归档，失效条目就留在它自己的"已失效"区）、
 * `hotBlock`（它不参与每轮注入，没有上限这回事）。
 */
export async function readCommonLedgerState(root) {
  const config = await readConfig(root);
  const { items, active, total } = await readCommonState();

  return {
    root,
    book: "common",
    items,
    types: listTypes(config),
    commonLabel: COMMON_LABEL,
    active,
    total
  };
}
