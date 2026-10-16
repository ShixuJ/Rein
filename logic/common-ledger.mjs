// 通用账本：跨项目的那本"库"。
//
// 它不是一层——**不参与每轮注入**。所以热块、上限、编号规则、钩子一个字都不用动；
// 它的用处只有一个：通用条目只写一次，然后在项目之间手动复用。
//
// 它跟项目账本用同一套形状（同一个 parseLedger / serializeLedger，只是文件头不同）、
// 同一套编号规则；区别是它不属于任何项目，所以没有 root，也没有归档。
//
// 项目与它之间的复用靠**复制**，不靠引用：账本一旦跟着别处变，"这条到底是谁的"就说不
// 清了，而"要不要同步、什么时候同步、同步失败怎么办"会立刻变成一整套要维护的机制。
// 代价是同一句在几处就有几份、改措辞要改几处——换来的是零同步、零修复。

import { createItem, isActive, nextId, oneLine } from "./item.mjs";
import { readCommonItems, writeCommonEvidence, writeCommonLedger } from "./store.mjs";

/**
 * 从通用账本引到项目里的条目，带的**保留标签**。
 *
 * 它填在 `type` 那个槽里——账本格式里唯一能放一个自由 token、又不必改格式的地方。
 * 三件事靠它：面板把"从通用账本引来的"分到另一栏、热块里一眼看出这条是通用的、
 * 你改标签的时候它跟着变（改掉就不再是那一栏的）。
 *
 * **它不进 `.rein/config.toml` 那套类型**：类型是各项目的开放集合，可以被增删改名；
 * 这个标签不行——某个项目把它删掉或者改了字，分栏就崩了。所以它由代码给定，
 * 改标签那排 chips 里也不出现它（手动把一条标成"通用账本"是撒谎）。
 *
 * 不能带空白：标题行是 `### C-001 · <token> · <日期>`，token 认的是 `\S+`。
 */
export const COMMON_LABEL = "通用账本";

/** 通用账本此刻长什么样。计数跟项目账本分开算——两本账，不混在一起。 */
export async function readCommonState() {
  const items = await readCommonItems();
  return { items, active: items.filter(isActive).length, total: items.length };
}

/**
 * 写进通用账本：项目账本那条 `commitItems` 的平行版。
 *
 * 少掉的三件事都是"只有项目账本才有"的：没有归档（通用账本先不做归档，失效条目留在
 * 它自己的"已失效"区），不碰 AGENTS.md（它不是谁的项目文件），不读配置——标签由调用方
 * 给（推上来时带的是那条自己的分类，没有"配置里的第一个"可兜底）。
 *
 * 编号用 `nextId`，跟项目账本同一套规则：取最大加一，不复用已失效的编号。
 */
export async function commitCommonItems(drafts, { date, source = "", evidence = "" } = {}) {
  const known = await readCommonItems();
  const created = [];

  for (const draft of drafts) {
    // 标签必给：漏了的话标题行会写成 `### C-001 · undefined · …`，那是个坏文件。
    // 兜底用保留标签——"这条是通用的"至少不会说谎。
    const type = oneLine(draft.type ?? "") || COMMON_LABEL;
    const item = createItem({ ...draft, type }, { id: nextId(known), date, source });

    created.push(item);
    known.push(item);
  }

  await writeCommonLedger(known);

  for (const item of created) {
    if (evidence) await writeCommonEvidence(item.id, evidence);
  }

  return { created, items: known };
}
