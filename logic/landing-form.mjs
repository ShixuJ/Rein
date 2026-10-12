// 落地表单的形状：**一条候选 = 一个字段**。
//
// 放在 logic/ 里是为了能测：键名、选项顺序、`enumNames` 与 `enum` 的对齐，错一样，
// 用户的选择就会静默落空（认不出来的目的地会退回 Ignore，点完什么都不发生）。
//
// 形状由宿主的 elicitation 表单决定：
//
// 1. **按字段翻页的分步向导。** 一个字段一页，所以"内容框 + 选项"两个字段就是两页，
//    用户得先翻过去才能选。
// 2. **选择型字段不吃 default。** string + enum/oneOf/anyOf 初始化时一律跳过，default
//    只对文本、布尔、数字生效。所以"默认停在建议上"只能靠枚举顺序 + 条目描述里的
//    「建议 X」+ 提交时对空值的处理。
// 3. **选项只有 `{const, title}` 两个位置**，放不下 hover 说明。所以每个选项的解释
//    并进它的文字里（`enumNames`）。
//
// 于是候选句子只能放在**字段标题**上——它和选项在同一页，是它唯一的去处。
// 想改措辞，落地之后在账本面板里点「修改」（走取代）。

import { listTypes, resolveType, suggestedType, typeLabel } from "./config.mjs";
import {
  DESTINATIONS,
  destinationChoice,
  destinationLabel,
  destinationSlug,
  suggestionSlug
} from "./destination.mjs";

export function buildLandingForm(candidates, config) {
  const types = listTypes(config);
  const fallbackType = suggestedType(config);
  const properties = {};
  const slots = [];

  candidates.forEach((candidate, index) => {
    const key = `c${index + 1}`;
    const suggestion = suggestionSlug(candidate?.destination);
    const type = resolveType(config, candidate?.type ?? fallbackType);
    // 只有一条候选时"第 1 条"是废话——它就在唯一那一页上。
    const prefix = candidates.length > 1 ? `第 ${index + 1} 条 · ` : "";
    // 建议的那一项排最前面：宿主若不认 default，枚举的第一项就是落点，效果一样。
    const order = [
      suggestion,
      ...DESTINATIONS.map((entry) => entry.slug).filter((slug) => slug !== suggestion)
    ];

    properties[key] = {
      type: "string",
      // 那句话就是这一页的问题：用户在同一页上既能读到它，也能选它去哪。
      title: String(candidate?.statement ?? ""),
      description: `${prefix}建议 ${destinationLabel(suggestion)} · 标签 ${typeLabel(types, type)}`,
      enum: order.map((slug) => destinationLabel(slug)),
      enumNames: order.map((slug) => destinationChoice(slug)),
      default: destinationLabel(suggestion)
    };

    slots.push({ key, candidate, suggestion, type });
  });

  // 表单顶部只留一行标题，不是说明书：建议在每条的描述里，进度由向导自己写。
  // 但也不能空着——它是那张卡的头部，空着问题文字会直接贴到框顶。
  // message 是必填字段，所以永远给一个非空值。
  const message = candidates.length === 1 ? "这条去哪？" : "逐条选去哪";

  return { message, properties, slots };
}
/**
 * 表单回传 → 决定：哪几条落地、哪几条复述。
 *
 * 两种"没动过"要分清：
 * - 选择型字段**没有**回传这个 key（宿主不预选，见 buildLandingForm 的说明）→ 按建议走。
 * - 回传了一个认不出来的值 → 退回 Ignore：少留痕比多留痕安全，而且 Ignore 是唯一
 *   "点错了也看不出代价"的落点（destination.mjs 里写的兜底逻辑）。
 */
export function readLandingAnswers(slots, content) {
  const chosen = [];
  const restatements = [];

  for (const { key, candidate, suggestion, type } of slots) {
    const raw = content?.[key];
    const picked = typeof raw === "string" && raw.trim() ? raw.trim() : destinationLabel(suggestion);
    const destination = destinationSlug(picked);
    const statement = String(candidate?.statement ?? "");

    if (destination === "land") {
      chosen.push({
        statement,
        type,
        supersedes: typeof candidate?.supersedes === "string" ? candidate.supersedes.trim() : ""
      });
    } else if (destination === "restate") {
      restatements.push(statement);
    }
  }

  return { chosen, restatements };
}
