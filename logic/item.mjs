// 已确认项的数据模型。纯函数：不碰文件系统、不碰任何协议。

const ID_PATTERN = /^C-(\d+)$/;

export function isActive(item) {
  return item.status === "active";
}

/** 把任意文本压成一行——断言必须是"一句话"。 */
export function oneLine(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/** 下一个编号。永远取最大值加一，不复用已失效的编号。 */
export function nextId(items) {
  let max = 0;
  for (const item of items) {
    const match = ID_PATTERN.exec(item.id ?? "");
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `C-${String(max + 1).padStart(3, "0")}`;
}

export function createItem(draft, { id, date, source = "", defaultType }) {
  return {
    id,
    type: draft.type ?? defaultType,
    date,
    statement: oneLine(draft.statement),
    source,
    status: "active"
  };
}

/**
 * 旧的让位给新的：不删旧条目，只把它的状态改成 `superseded by <新 id>`。
 * "我们曾以为是 X、后来改成 Y"本身就是对齐价值。
 */
export function supersede(items, oldId, newId) {
  return items.map((item) =>
    item.id === oldId ? { ...item, status: `superseded by ${newId}` } : item
  );
}

/**
 * 从状态里读回取代者。只认 `superseded by C-0NN` 这一种写法——
 * 别的失效原因（将来若有）读出来就是 null，调用方必须自己判空。
 */
export function successorOf(item) {
  const match = /^superseded by (C-\d+)$/.exec(String(item?.status ?? ""));
  return match ? match[1] : null;
}

/**
 * 退休：这条不再生效，但**没有后继者**。
 *
 * 与 supersede 的区别只在"有没有新的那句"：取代说的是"改成这样说"，退休说的是"这话不用再管了"。
 * 两者都不删条目——热块只出 active，所以失效的当场不再注入，历史留在文件里。
 */
export function retire(items, id) {
  return items.map((item) => (item.id === id ? { ...item, status: "retired" } : item));
}
