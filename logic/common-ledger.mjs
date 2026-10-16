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

import { originalLine } from "./evidence.mjs";
import { createItem, isActive, nextId, oneLine, retire, supersede } from "./item.mjs";
import {
  commitItems,
  deleteCommonEvidence,
  normalizeRoot,
  readCommonEvidence,
  readCommonItems,
  readConfig,
  readEvidence,
  readItems,
  writeCommonEvidence,
  writeCommonLedger
} from "./store.mjs";

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

// 两条搬运的返回形状是同一套：没做成是 `ok: false` + 一句 `reason`（编号不在、那条已失效），
// 做成了带 `action`（promoted / imported）与 `item`。`items` 给面板重画用，是**这件事发生在
// 那本账**：推上去 → 通用账本，引下来 → 项目这本；`config` 始终是项目那份，面板拿它渲染标签。
//
// 目标里已经有一条同样的，不算失败：要的结果本来就在那儿，`action: "exists"` 报一声就行。

/** 项目名取路径末段——跟面板那把「切换」一个口径，两处显示的名字得是同一个。 */
function projectName(root) {
  const parts = normalizeRoot(root).split("/").filter(Boolean);
  return parts[parts.length - 1] ?? normalizeRoot(root);
}

/**
 * `项目 Rein · C-003 · 2026-10-16`——开头那段说的是"这条从哪本账来"，两边写法对齐：
 * 项目这边是 `项目 <名字>`，通用那边就是保留标签本身（`通用账本`）。
 *
 * 不带"来自"：字段名就是「来源」，再写一遍是重复。空的那几段不写，
 * 别让 undefined 落到账本里。
 */
function sourceLine(...parts) {
  return parts.filter((part) => part != null && part !== "").join(" · ");
}

/**
 * 目标账本里已经有同一句（一字不差、**还在生效**）就不重复写。
 *
 * 判据是文字而不是编号：编号是各账自己的，两边对不上；而"推两次长出两条一样的"是
 * 用户最不希望看到的结果。已失效的不算——那说明这条当初被退休过，现在再引一次
 * 是个新的决定，该让它进来。
 */
function findDuplicate(items, statement) {
  const text = oneLine(statement);
  return items.find((item) => isActive(item) && item.statement === text) ?? null;
}

/**
 * 项目的一条 → 通用账本。
 *
 * **源那条一个字节都不动**：这是复制，不是搬运——"这条也属于通用"并不等于
 * "它不再属于这个项目"，两边的账各算各的。原文跟着复制一份（同一台机器，免费），
 * 不然通用账本这边点「原文」只会说"外部写入"。
 *
 * 日期沿用源那条的：那是这条结论定下来的日子，推上来只是换了个地方放。
 * 哪天推的写在来源里。
 */
export async function promoteToCommon(root, { id, date } = {}) {
  const items = await readItems(root);
  const source = items.find((item) => item.id === id);

  if (!source) return { ok: false, reason: `${id} 不在这个项目的账本里。`, items };
  if (!isActive(source)) {
    return {
      ok: false,
      reason: `${id} 已经失效（${source.status}）——失效的条目不值得推给通用账本。`,
      items
    };
  }

  const known = await readCommonItems();
  const duplicate = findDuplicate(known, source.statement);
  if (duplicate) {
    return {
      ok: true,
      action: "exists",
      existing: duplicate.id,
      items: known,
      config: await readConfig(root)
    };
  }

  const evidence = await readEvidence(root, source.id);
  const { created, items: after } = await commitCommonItems(
    [{ statement: source.statement, type: source.type }],
    {
      date: source.date,
      source: sourceLine(`项目 ${projectName(root)}`, source.id, date),
      evidence: evidence ?? ""
    }
  );

  return {
    ok: true,
    action: "promoted",
    item: created[0],
    items: after,
    config: await readConfig(root)
  };
}

/**
 * 通用账本的一条 → 项目这本。
 *
 * 编号在项目账本里**重新分配**（`commitItems` 现成的：编号取最大加一、归档里的也算，
 * 原文、AGENTS.md 里旧受注块的清理都白送）。所以推过来的不是"C-004"，是一条新的
 * 本项目条目——它到了这儿就跟别的条目一样，能就地改、就地退休。
 *
 * 标签换成保留标签：项目账本要能一眼分出"这条是引来的"，而分类是各项目自己的词表，
 * 跟着过来只会是个陌生 slug。原分类在通用账本那边仍然看得到。
 */
export async function importFromCommon(root, { id, date } = {}) {
  const known = await readCommonItems();
  const source = known.find((item) => item.id === id);

  if (!source) return { ok: false, reason: `${id} 不在通用账本里。` };
  if (!isActive(source)) {
    return { ok: false, reason: `${id} 已经失效（${source.status}）——失效的条目不值得引进来。` };
  }

  const items = await readItems(root);
  const duplicate = findDuplicate(items, source.statement);
  if (duplicate) {
    return {
      ok: true,
      action: "exists",
      existing: duplicate.id,
      items,
      config: await readConfig(root)
    };
  }

  const evidence = await readCommonEvidence(source.id);
  const { created, items: after, config } = await commitItems(
    root,
    [{ statement: source.statement, type: COMMON_LABEL }],
    {
      date: source.date,
      source: sourceLine(COMMON_LABEL, source.id, date),
      evidence: evidence ?? ""
    }
  );

  return { ok: true, action: "imported", item: created[0], items: after, config };
}

// --- 通用账本自己的"改" -----------------------------------------------------
//
// 跟项目账本那套（store.mjs 的 reviseItem / retireItem）是同一个规矩，一个字都不改：
// **改措辞 → 取代**（旧的那句一个字节不动，落一条新的标成 `superseded by`，原文跟着新编号走，
// 末尾附上「原结论」）；**只改标签 → 就地改**；**不要了 → 退休**。条目一条不删。
//
// 唯一的差别：这里没有配置可查（通用账本不属于任何项目），所以标签原样收下，
// 不做 `resolveType` 那种回落——回落到哪个项目的词表都不对。

/** 取代时把原文挪到新编号下，再把被取代的那句附在末尾——跟项目账本一条规矩。 */
async function carryCommonEvidence(fromId, toId, statement) {
  const carried = await readCommonEvidence(fromId);
  if (carried) await writeCommonEvidence(toId, carried);
  await deleteCommonEvidence(fromId);

  const previous = originalLine(fromId, statement);
  if (!previous) return;

  const current = await readCommonEvidence(toId);
  await writeCommonEvidence(toId, current ? `${current}\n${previous}` : previous);
}

/**
 * 通用账本里的"改"。
 *
 * 标签没给就是**沿用这条自己的**，不是兜底成保留标签：改个措辞不该让它在面板里
 * 从这一栏跳到那一栏。
 */
export async function reviseCommonItem({ id, statement, type, date, source = "" } = {}) {
  const items = await readCommonItems();
  const target = items.find((item) => item.id === id);

  if (!target) return { ok: false, reason: `${id} 不在通用账本里。`, items };
  if (!isActive(target)) {
    return { ok: false, reason: `${id} 已经失效（${target.status}），没有可改的东西。`, items };
  }

  const nextStatement = statement == null ? null : oneLine(statement);
  const nextType = type == null ? null : oneLine(type);

  if (nextStatement && nextStatement !== target.statement) {
    const fresh = nextId(items);
    const created = {
      ...target,
      id: fresh,
      statement: nextStatement,
      type: nextType ?? target.type,
      date,
      source: source || `账本面板 · 取代 ${id}`,
      status: "active"
    };
    const after = [...supersede(items, id, fresh), created];

    await writeCommonLedger(after);
    await carryCommonEvidence(id, fresh, target.statement);

    return { ok: true, action: "superseded", item: created, replacedId: id, items: after };
  }

  if (nextType && nextType !== target.type) {
    const changed = { ...target, type: nextType };
    const after = items.map((item) => (item.id === id ? changed : item));
    await writeCommonLedger(after);
    return { ok: true, action: "relabelled", item: changed, items: after };
  }

  return { ok: true, action: "unchanged", item: target, items };
}

/** 退休：这条不再生效，没有后继者。原文一起退休——跟项目账本一个规矩。 */
export async function retireCommonItem({ id } = {}) {
  const items = await readCommonItems();
  const target = items.find((item) => item.id === id);

  if (!target) return { ok: false, reason: `${id} 不在通用账本里。`, items };
  if (target.status === "retired") return { ok: true, action: "unchanged", item: target, items };
  if (!isActive(target)) {
    return { ok: false, reason: `${id} 已经失效（${target.status}）——取代过的条目不用再退休。`, items };
  }

  const after = retire(items, id);
  await writeCommonLedger(after);
  await deleteCommonEvidence(id);

  return { ok: true, action: "retired", item: after.find((item) => item.id === id), items: after };
}
