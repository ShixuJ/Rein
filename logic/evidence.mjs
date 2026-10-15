// 原文的形状：**用户确认的那句 + 被纠正对象的一句引用**。
//
// 为什么两句：只看用户那句，过几个月未必想得起他当时在对什么说话；只看被纠正的那句，
// 又不知道他最后定的是什么。两句合起来才是"这条结论从哪来"。
//
// 两句都可能缺，所以渲染只做一件事——给了就写，按固定前缀排成行：
// - 新约束不一定在纠正谁 → 只有第一句；
// - 用户在面板直接写的一条 → 两句都没有（调用方给一句说明，不走这里）；
// - 引用一句话加进对话的场合 → 被引用的那句就是第二句。

import { oneLine } from "./item.mjs";

export const USER_PREFIX = "用户确认：";
export const CORRECTED_PREFIX = "被纠正：";
export const ORIGINAL_PREFIX = "原结论";

// 没有原文时讲的那句：手写进账本的条目、以及这个功能之前落的条目，都会看到它。
// 文案只有这一份——终端命令与 MCP 工具回的是同一句，别在两边各写一遍。
export const NO_EVIDENCE_NOTE =
  "（外部写入：不是从对话里写入的——手账本，或这个功能之前已经落成的条目。）";

const KNOWN_PREFIXES = [USER_PREFIX, CORRECTED_PREFIX, "用户：", "被纠正对象：", "原文："];

/**
 * 模型偶尔会把前缀自己写进来（"用户确认：XXX"）。再套一层就成了"用户确认：用户确认：XXX"，
 * 所以先剥掉一层已知前缀——只剥一个，剥出来的空串照样当没给。
 */
function stripLabel(text) {
  const value = oneLine(text);
  const hit = KNOWN_PREFIXES.find((prefix) => value.startsWith(prefix));
  return hit ? value.slice(hit.length).trim() : value;
}

/** 两句 → 存进 evidence 文件的那段文本。两句都给不出就返回空串（等于没留）。 */
export function renderEvidence({ user = "", corrected = "" } = {}) {
  const lines = [];
  const confirmed = stripLabel(user);
  const subject = stripLabel(corrected);

  if (confirmed) lines.push(`${USER_PREFIX}${confirmed}`);
  if (subject) lines.push(`${CORRECTED_PREFIX}${subject}`);

  return lines.join("\n");
}

/**
 * 「原结论 C-001：…」——取代时把被取代的那句附在原文末尾。
 *
 * 前两句说的是"这条从哪来"，这一行说的是"改之前是什么"。带上编号，是因为连着取代几次会
 * 攒下好几行——编号让它们能按顺序对上账本里的取代链。
 */
export function originalLine(id, statement) {
  const text = oneLine(statement);
  return text ? `${ORIGINAL_PREFIX} ${oneLine(id)}：${text}` : "";
}
