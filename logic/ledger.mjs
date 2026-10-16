// ALIGNMENT.md 的序列化与反序列化。格式稳定优先于好看：round-trip 必须字节一致。

import { isActive } from "./item.mjs";

const HEADING = /^### (C-\d+) · (\S+) · (\d{4}-\d{2}-\d{2})$/;

const FIELDS = [
  ["断言：", "statement"],
  ["来源：", "source"],
  ["状态：", "status"]
];

function renderItem(item) {
  return [
    `### ${item.id} · ${item.type} · ${item.date}`,
    `断言：${item.statement}`,
    `来源：${item.source}`,
    `状态：${item.status}`
  ];
}

/**
 * 文件头。条目的**形状**只有一份（上面 renderItem 那几行），但"这是哪本账"不一样：
 * 项目账本是这个项目的，通用账本跨项目。所以头拎出来当参数传进来，序列化本身不管它。
 */
const PROJECT_HEADER = [
  "# ALIGNMENT",
  "",
  "这个项目的对齐账本。由 rein 维护（对话里落地、面板里改动都会写到这里）；失效条目",
  "保留在下方以便追溯——取代与退休都不删条目。",
  "",
  "<!--",
  "  人也可以直接改它：它只是普通 Markdown，`git diff` 读得懂。条目长相如下，",
  "  插件只认这个形状（其余文字一律忽略，所以随便加注释）：",
  "",
  "    ### C-001 · <类型> · 2026-10-16",
  "    断言：一句话就是这条结论。",
  "    来源：侧聊 · 2026-10-16 · 那轮在聊什么",
  "    状态：active",
  "",
  "  类型就是 .rein/config.toml 里定义的那些标签；状态那几个字是插件写的",
  "  （active / retired / superseded by C-0NN），尽量别手改。每轮注入的是",
  "  「生效中」里最新的 N 条，上限与标签见 .rein/config.toml。",
  "-->"
];

const COMMON_HEADER = [
  "# ALIGNMENT（通用）",
  "",
  "跨项目的通用前提。由 rein 维护：项目账本可以把一条推上来，也可以把这里的一条引进去。",
  "两边都是你手动发起的复制，源条目一个字节都不动——这里改了不会追着改项目里的那份。",
  "",
  "<!--",
  "  条目的形状与项目账本完全一样（见那份文件里的说明），编号是这本账自己的。",
  "  它**不参与每轮注入**：想让它生效，把它引到某个项目里。",
  "-->"
];

export const LEDGER_HEADERS = { project: PROJECT_HEADER, common: COMMON_HEADER };

/**
 * 账本正文。默认是项目账本那份头，`header` 换成 `LEDGER_HEADERS.common` 就是通用账本——
 * 除了头，两本账写出字节的形状完全一样。
 */
export function serializeLedger(items, { header = PROJECT_HEADER } = {}) {
  const active = items.filter(isActive);
  const retired = items.filter((item) => !isActive(item));

  const lines = [...header, "", "## 生效中", ""];

  if (active.length === 0) lines.push("_（暂无）_", "");
  for (const item of active) lines.push(...renderItem(item), "");

  lines.push("## 已失效", "");

  if (retired.length === 0) lines.push("_（暂无）_", "");
  for (const item of retired) lines.push(...renderItem(item), "");

  return lines.join("\n");
}

/**
 * 归档文件（`ALIGNMENT-ARCHIVE.md`）：装**已经失效**的条目。
 *
 * 与账本同一套条目格式，`parseLedger` 能直接读——归档只是"换个地方放"，不是删除。
 * 账本正文与面板因此不长草，而历史一条不少。
 */
export function serializeArchive(items) {
  // 按编号排：归档是一份时间线，编号就是创建的先后。
  // 账本那边不动——它的失效区顺序保持写入时的样子。
  const ordered = orderById(items);

  const lines = [
    "# ALIGNMENT-ARCHIVE",
    "",
    "已经失效的已确认项（取代过的、退休的）。由 rein 维护，勿手改。",
    "条目永不删除——它们从 `ALIGNMENT.md` 挪到这里，只是不再参与每轮注入。",
    "要查「我们曾以为是 X、后来改成 Y」那段历史时看这个文件。",
    "",
    "## 已失效",
    ""
  ];

  if (ordered.length === 0) lines.push("_（暂无）_", "");
  for (const item of ordered) lines.push(...renderItem(item), "");

  return lines.join("\n");
}

function idNumber(id) {
  const match = /^C-(\d+)$/.exec(String(id ?? ""));
  return match ? Number(match[1]) : 0;
}

/** 按编号排序（编号就是创建的先后）。归档文件与"归档了哪几条"的回报都用它。 */
export function orderById(items) {
  return [...items].sort((a, b) => idNumber(a.id) - idNumber(b.id));
}

export function parseLedger(text) {
  const items = [];
  let current = null;

  for (const rawLine of String(text ?? "").split("\n")) {
    const line = rawLine.trimEnd();
    const heading = HEADING.exec(line);

    if (heading) {
      current = {
        id: heading[1],
        type: heading[2],
        date: heading[3],
        statement: "",
        source: "",
        status: "active"
      };
      items.push(current);
      continue;
    }

    if (!current) continue;

    for (const [prefix, field] of FIELDS) {
      if (line.startsWith(prefix)) {
        current[field] = line.slice(prefix.length);
        break;
      }
    }
  }

  return items;
}
