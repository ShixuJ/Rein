// 三个目的地：用户对每条候选断言唯一要判断的事，是"这段东西去哪"。
//
// - Align（落地）：写进 ALIGNMENT.md，之后每轮注入，直到退休。长期的约定、定义、边界用它。
// - Restate（复述）：进收件箱，交给主线的下一次提问说一次。用完一次就失效的内容用它——
//   命令式的要求、够不上一条已确认项的片段。
// - Ignore（不落地）：不留痕。一次给多条候选时，用户需要能逐条丢掉其中几条，而不是
//   为了丢掉一条把整张表单取消掉。
//
// 表单自带的 skip 按钮是另一回事：那是"整张表单我都不想决定"，不是逐条丢弃。
//
// 表单上显示英文（宿主原生表单的按钮本来就是英文）；中文文档里仍叫"落地"与"复述"。
// 类型不在其中：类型只是标签，由模型在背后给出。

export const DESTINATIONS = [
  { slug: "land", label: "Align", hint: "写进账本，以后每轮带上" },
  { slug: "restate", label: "Restate", hint: "只带回主线说一次" },
  { slug: "ignore", label: "Ignore", hint: "不留痕" }
];

/**
 * 认不出来时的落点。猜不出来就不能让一条断言悄悄进账本（它会每轮都出现），所以兜底是
 * 唯一不留痕的那一项。
 */
export const DEFAULT_DESTINATION = "ignore";

const FALLBACK = DESTINATIONS.find((entry) => entry.slug === DEFAULT_DESTINATION);

/** slug → 表单上的标签。认不出来的一律按兜底。 */
export function destinationLabel(slug) {
  return (DESTINATIONS.find((entry) => entry.slug === slug) ?? FALLBACK).label;
}

/** 表单上那一项显示的完整文字：英文标签 + 一句解释。表单顶部不再放图例，靠这个解释选项。 */
export function destinationChoice(slug) {
  const entry = DESTINATIONS.find((item) => item.slug === slug) ?? FALLBACK;
  return `${entry.label} · ${entry.hint}`;
}

/**
 * 表单回传的值 → slug。认不出来的一律按兜底。
 *
 * 容错一层：表单上的选项文字是「Restate · 只带回主线说一次」（`enumNames`），宿主理应回传
 * 枚举值 `Restate`，但万一它回传的是显示文字，`destinationSlug` 也认。认不出来的代价是
 * 静默落成 Ignore——用户点了什么都没发生，且看不出来——所以这里宁可宽一点。
 */
export function destinationSlug(label) {
  const text = String(label ?? "").trim();
  const exact = DESTINATIONS.find((entry) => entry.label === text || entry.slug === text);
  if (exact) return exact.slug;

  const head = text.split("·")[0]?.trim();
  return DESTINATIONS.find((entry) => entry.label === head)?.slug ?? DEFAULT_DESTINATION;
}

/**
 * 模型给的建议目的地 → slug。
 * 模型写 slug 或写标签都认；写别的（或干脆没写）就退回兜底。
 */
export function suggestionSlug(value) {
  const text = String(value ?? "").trim();
  const bySlug = DESTINATIONS.find((entry) => entry.slug === text);
  const byLabel = DESTINATIONS.find((entry) => entry.label === text);
  return bySlug?.slug ?? byLabel?.slug ?? DEFAULT_DESTINATION;
}
