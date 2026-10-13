// 收件箱：复述的一次性投递区。
//
// 复述是表单上的两个目的地之一（另一个是"落地"，表单上叫 Align）：用户想把侧聊里的一段带回主线程，
// 又不觉得它够得上一条已确认项。这段先落在这里，由钩子在**下一个主线程的提问**上注入
// 一次，注入即删除——它不靠对话历史承重，也不进账本。
//
// 收件箱落在**机器本地**的目录里（见 store.mjs 的 localDir）：$REIN_HOME 下按项目路径哈希
// 分开放，**永远不进用户项目**——它是每台机器各一份、用完就没的派生状态，不该跟着账本一起
// opt-in 进项目。按项目分开存，所以同一个 app 里两个项目不会互相吃掉对方的复述。

import { oneLine } from "./item.mjs";

const HEADING = /^### (.+)$/;
const SESSION_PREFIX = "写入者：";
const TEXT_PREFIX = "文本：";

export function createEntry(text, { at, session = "" } = {}) {
  return { at: String(at ?? ""), session: String(session ?? ""), text: oneLine(text) };
}

export function serializeInbox(entries) {
  const lines = [
    "# rein 收件箱",
    "",
    "待投递的复述。在下一条主线程的提问上注入一次，随即删除。由 rein 维护，勿手改。",
    "",
    "## 待投递",
    ""
  ];

  if (entries.length === 0) {
    lines.push("_（暂无）_", "");
  } else {
    for (const entry of entries) {
      lines.push(`### ${entry.at}`, `${SESSION_PREFIX}${entry.session}`, `${TEXT_PREFIX}${entry.text}`, "");
    }
  }

  return lines.join("\n");
}

export function parseInbox(text) {
  const entries = [];
  let current = null;

  for (const rawLine of String(text ?? "").split("\n")) {
    const line = rawLine.trimEnd();
    const heading = HEADING.exec(line);

    if (heading) {
      current = { at: heading[1], session: "", text: "" };
      entries.push(current);
      continue;
    }

    if (!current) continue;
    if (line.startsWith(SESSION_PREFIX)) current.session = line.slice(SESSION_PREFIX.length);
    else if (line.startsWith(TEXT_PREFIX)) current.text = line.slice(TEXT_PREFIX.length);
  }

  return entries.filter((entry) => entry.text !== "");
}

/**
 * 投递规则：只投给主线程，且不投给写入者自己。
 *
 * 判据是 `transcript_path`：主线程有一份 rollout 文件，侧聊是临时的、它是 null。
 * 这条判据挡住了"新开一个侧聊把条目认领走"——新侧聊的 session_id 与写入者不同，
 * 只按 session 判会误投。
 *
 * 写入者未知时（收件箱是在钩子没跑过的项目里写下的）照样投递：宁可晚一轮到，不能丢。
 */
export function deliverable(entries, { session = "", isMain } = {}) {
  if (!isMain) return [];
  return entries.filter((entry) => !entry.session || entry.session !== session);
}
