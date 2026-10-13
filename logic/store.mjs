// 账本等状态文件的读写。宿主无关：只有文件系统，没有 MCP、没有 Codex。
//
// 状态分成两层，按性质分（见下面的 localDir / stateDir）：
// - **账本层**（账本、归档）：默认写进插件的数据目录（$REIN_HOME，默认 ~/.codex/rein）；
//   项目里**已经存在** ALIGNMENT.md 时就改用项目里那本——想要 diff / 能进 PR 就 opt-in。
// - **本地层**（收件箱、原文）：永远在 $REIN_HOME 下按项目路径哈希分开存，**从不进项目**。

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { defaultConfig, parseConfig, resolveType, suggestedType } from "./config.mjs";
import { originalLine } from "./evidence.mjs";
import { HOT_BLOCK_BEGIN, removeHotBlock } from "./hot-block.mjs";
import { createEntry, deliverable, parseInbox, serializeInbox } from "./inbox.mjs";
import {
  createItem,
  isActive,
  nextId,
  oneLine,
  retire,
  successorOf,
  supersede
} from "./item.mjs";
import { orderById, parseLedger, serializeArchive, serializeLedger } from "./ledger.mjs";

export const LEDGER_FILENAME = "ALIGNMENT.md";
export const ARCHIVE_FILENAME = "ALIGNMENT-ARCHIVE.md";
export const AGENTS_FILENAME = "AGENTS.md";
export const CONFIG_PATH = join(".rein", "config.toml");
export const INBOX_PATH = join(".rein", "inbox.md");
export const EVIDENCE_DIR = "evidence";

async function readIfExists(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// 同一个目录有时写成 "/x/y"，有时写成 "/x/y/"，而这一层的缓存与文件都以字符串为键。
// 归一化的地方只在这里，别处按原样传。
export function normalizeRoot(root) {
  const text = String(root ?? "").trim();
  return text.length > 1 ? text.replace(/\/+$/, "") : text;
}

// 插件自己的用户级数据根。$REIN_HOME 可覆盖（测试用它指到临时目录）。
function reinHome() {
  const home = process.env.HOME || homedir();
  return process.env.REIN_HOME || join(home, ".codex", "rein");
}

/**
 * 机器本地的状态目录：`$REIN_HOME/projects/<项目哈希>/`。**永远不在用户项目里。**
 *
 * 收件箱与原文都落在这里——它们是**每台机器各一份、每轮在变、跟仓库无关**的派生状态：
 * 收件箱是"侧聊→主线"的一次性投递，原文是本地回溯用的旁证。它们不该跟着账本一起
 * opt-in 进项目（否则一次复述就在用户仓库里凭空长出 `.rein/`，`git status` 也脏了）。
 */
export function localDir(root) {
  return join(reinHome(), "projects", sessionKey(normalizeRoot(root)));
}

/**
 * **账本层**的状态文件（账本、归档）落在哪个目录。
 *
 * - 项目里已经有 `ALIGNMENT.md` → 用项目根：回归"项目层账本"，可 diff、能进 PR。
 * - 否则 → 插件的数据目录 `$REIN_HOME/projects/<项目哈希>/`，不碰你的工作区。
 *
 * 判据只看账本在不在：想 opt-in 到项目层，在项目里放一个 `ALIGNMENT.md` 就行（内容随意）。
 * 收件箱与原文不走这里——它们永远是机器本地的（见 localDir）。
 */
export function stateDir(root) {
  const base = normalizeRoot(root);
  if (existsSync(join(base, LEDGER_FILENAME))) return base;
  return localDir(base);
}

export async function readConfig(root) {
  const base = normalizeRoot(root);
  // 配置是**人写**的（不会被自动创建），所以项目里放一份就一直生效；
  // 项目里没有才去状态目录找。
  const project = await readIfExists(join(base, CONFIG_PATH));
  if (project) return parseConfig(project);

  const dir = stateDir(base);
  const stored = dir === base ? null : await readIfExists(join(dir, CONFIG_PATH));
  return stored ? parseConfig(stored) : defaultConfig();
}

export async function readItems(root) {
  const text = await readIfExists(join(stateDir(root), LEDGER_FILENAME));
  return text ? parseLedger(text) : [];
}

/**
 * 归档文件里的条目。**只有编号要用它**——热块、面板、取代目标都只看账本。
 * 理由：归档会把条目挪出账本，如果编号只从账本算，下一个新条目就会重用归档里的编号。
 */
async function readArchived(root) {
  const text = await readIfExists(join(stateDir(root), ARCHIVE_FILENAME));
  return text ? parseLedger(text) : [];
}

// ---------------------------------------------------------------------------
// 收件箱：复述的一次性投递区
// ---------------------------------------------------------------------------

export async function readInbox(root) {
  const text = await readIfExists(join(localDir(root), INBOX_PATH));
  return text ? parseInbox(text) : [];
}

export async function writeInbox(root, entries) {
  const base = normalizeRoot(root);
  const file = join(localDir(base), INBOX_PATH);

  // 空了就把文件摘掉，不留一个只有表头的空文件。读到"文件不在"仍是空收件箱。
  if (entries.length === 0) {
    await rm(file, { force: true });
    return;
  }

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, serializeInbox(entries), "utf8");
}

export async function addRestatements(root, texts, { at, session = "" } = {}) {
  const entries = await readInbox(root);
  const added = texts.map((text) => createEntry(text, { at, session }));
  await writeInbox(root, [...entries, ...added]);
  return added;
}

/**
 * 投递并消费：挑出该给这一轮的复述，同时把它们从收件箱里删掉。
 *
 * 写回失败就一条都不投——条目还在收件箱里，下一轮还会来。宁可晚到，不要重复。
 */
export async function takeRestatements(root, { session = "", isMain } = {}) {
  const entries = await readInbox(root);
  const taken = deliverable(entries, { session, isMain });
  if (taken.length === 0) return [];

  try {
    await writeInbox(
      root,
      entries.filter((entry) => !taken.includes(entry))
    );
  } catch {
    return [];
  }

  return taken;
}

// ---------------------------------------------------------------------------
// 原文：每条结论从哪来
// ---------------------------------------------------------------------------

// 账本会越长越大，退休某条时人容易犯迷糊——"这条当初是因为什么才落的？"。所以每条落地的
// 结论留一份**原文**：它所依据的那一轮对话里用户的原话。
//
// 为什么必须在**落地那一刻**留：侧聊是临时的、没有 rollout 文件，一段在侧聊里谈成的结论，
// 它的原文在侧聊关掉之后就查不到了。事后没有源可回溯，只能由模型在调 rein_land 时交出来。
//
// 只留机器本地（`$REIN_HOME/projects/<hash>/evidence/`），**不进账本、不进项目**：账本要能
// 进 PR、要能跨机器，而原文是本地审计用的旁证。条目的编号就是指针——面板按编号现读现显。
//
// 生命周期跟着结论走：**取代 → 原文跟着新条目走**（"改措辞不改原文"）；**退休 → 一起退休**。

function evidenceFile(root, id) {
  return join(localDir(root), EVIDENCE_DIR, `${id}.md`);
}

/** 留一份原文。空文本等于没留——顺手把旧的那份摘掉。 */
export async function writeEvidence(root, id, text) {
  const value = String(text ?? "").trim();
  if (!value) return deleteEvidence(root, id);

  const file = evidenceFile(root, id);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${value}\n`, "utf8");
}

export async function readEvidence(root, id) {
  const text = await readIfExists(evidenceFile(root, id));
  return text && text.trim() ? text.trim() : null;
}

export async function deleteEvidence(root, id) {
  await rm(evidenceFile(root, id), { force: true });
}

/** 往已有原文后面接一行。取代时用：前面几行说"从哪来"，这一行说"改之前是什么"。 */
export async function appendEvidence(root, id, line) {
  const value = String(line ?? "").trim();
  if (!value) return;

  const current = await readEvidence(root, id);
  await writeEvidence(root, id, current ? `${current}\n${value}` : value);
}

/** 原文换一条结论挂：取代时把旧的那份挪到新编号下，旧的删掉，不留孤儿。 */
async function moveEvidence(root, fromId, toId, { fallback = null } = {}) {
  const carried = fallback ?? (await readEvidence(root, fromId));
  if (!carried) return;
  await writeEvidence(root, toId, carried);
  await deleteEvidence(root, fromId);
}

// ---------------------------------------------------------------------------
// "这一轮在哪"：主线程还是侧聊
// ---------------------------------------------------------------------------

// MCP 工具调用里没有会话信息——server 不知道自己是主线程调的还是侧聊调的。钩子知道
// （它有 session_id 与 transcript_path）。所以钩子每次提问时把"这一轮在哪"记下来，
// rein_land 读它：在主线程里落的"复述"当场说出来，在侧聊里落的才进收件箱。
//
// 放 tmp 而不是项目里：这是个每轮都变的派生物，塞进项目会让 git status 一直脏。
// 按项目根分开存，两个项目同时开着也不会串。
//
// 路径写死 /tmp，不用 os.tmpdir()：钩子是宿主直接 exec 的（带着 TMPDIR），MCP server
// 只拿到 HOME 与 PATH（没有 TMPDIR，os.tmpdir() 会退回 /tmp）——用 os.tmpdir() 两边
// 会各写各的，标记永远读不到。按 uid 分一层，免得同机器上两个用户互相踩。

const SESSION_DIR = join("/tmp", `rein-session-${typeof process.getuid === "function" ? process.getuid() : "u"}`);

function sessionKey(root) {
  return createHash("sha1").update(normalizeRoot(root)).digest("hex").slice(0, 16);
}

function sessionFile(root) {
  return join(SESSION_DIR, `${sessionKey(root)}.json`);
}

export async function writeSessionMarker(root, payload) {
  await mkdir(SESSION_DIR, { recursive: true });
  await writeFile(sessionFile(root), JSON.stringify(payload), "utf8");
}

export async function readSessionMarker(root) {
  const text = await readIfExists(sessionFile(root));
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 这一次该不该把侧栏抢过来
// ---------------------------------------------------------------------------

// 面板每次被**挂载**都会跑一遍它自己的脚本——包括你上滑聊天记录时，宿主把历史里的
// MCP App 重新挂载起来。所以"一挂载就展开"会让翻历史时侧栏被反复抢开。
//
// 于是"要不要展开"做成一次性的：rein_open_ledger 被调用时在这里放一个待取标记，
// 面板挂载后调 rein_take_open 来取。取过就没了——历史回放取不到，也就抢不走侧栏。
// 带 TTL 是因为"放了标记但面板始终没挂载"（工具失败、宿主没渲染）时会留下一个陈标记，
// 不能让它以后被误取。

export const PANEL_OPEN_TTL_MS = 120_000;

function panelOpenFile(root) {
  return join(SESSION_DIR, `${sessionKey(root)}.open`);
}

/** 放一个"下一次面板挂载可以展开"的待取标记。 */
export async function markPanelOpen(root, { at = Date.now() } = {}) {
  await mkdir(SESSION_DIR, { recursive: true });
  await writeFile(panelOpenFile(root), String(at), "utf8");
}

/** 取走这一次的展开机会。取过就消费掉——取不到、或者已经过期，都是 false。 */
export async function takePanelOpen(root, { now = Date.now() } = {}) {
  const file = panelOpenFile(root);
  const text = await readIfExists(file);
  await rm(file, { force: true });
  if (!text) return false;

  const at = Number(text);
  return Number.isFinite(at) && now - at <= PANEL_OPEN_TTL_MS;
}

/**
 * 落地：写账本。热块不落文件——它由 UserPromptSubmit 钩子在每次提问时现渲染。
 * 顺手做的一件事：AGENTS.md 里若还留着旧的受管区块，把它摘掉；只碰区块本身，其余不动。
 *
 * draft 上可以带 `supersedes: "C-0NN"`：这条新条目取代某条已有的。旧条目不删，
 * 状态改成 `superseded by <新 id>` 并移进"已失效"区，链留在文件里。
 *
 * options 上的 `evidence` 是**整批共用**的一段原文（作用范围是一轮，见上面"原文"一节）：
 * 每条新条目都留一份；取代别人的那些，把旧条目的原文挪过来（新原文给了就用新的），
 * 再把被取代的那句作为「原结论」附在后面。
 */
export async function commitItems(root, drafts, { date, source = "", evidence = "" } = {}) {
  const base = normalizeRoot(root);
  const config = await readConfig(base);
  const existing = await readItems(base);
  // 归档里的条目不参与"能不能取代"的判定（它们不在账本里了），但参与编号——见 readArchived。
  const archived = await readArchived(base);
  const suggested = suggestedType(config);

  const created = [];
  const replaced = [];
  const warnings = [];
  let known = existing;

  for (const draft of drafts) {
    // 取代的目标先解析。目标不存在、或者已经失效时**照样落地**——断言是用户在表单上确认过的，
    // 不能因为模型填错编号就丢掉；丢掉的只是"取代"这层关系，并且当场报出来。
    let target = null;

    if (draft.supersedes) {
      target = known.find((item) => item.id === draft.supersedes) ?? null;

      if (!target) {
        const wasArchived = archived.some((item) => item.id === draft.supersedes);
        warnings.push(
          wasArchived
            ? `${draft.supersedes} 已经归档（见 ${ARCHIVE_FILENAME}）——新条目照落，但没有可取代的对象。`
            : `${draft.supersedes} 不在账本里——新条目照落，但没有可取代的对象。`
        );
      } else if (!isActive(target)) {
        const successorId = successorOf(target);
        const successor = successorId ? known.find((item) => item.id === successorId) : null;

        if (successor && successor.statement === oneLine(draft.statement)) {
          // 同一次取代被重放（模型重试、用户又点了一遍）：不再长出一条重复的断言。
          warnings.push(`${target.id} 已经由 ${successor.id} 取代，同一条断言没有重复落地。`);
          continue;
        }

        warnings.push(`${target.id} 已经是失效条目（${target.status}）——新条目照落，没有改它。`);
        target = null;
      }
    }

    // 编号把归档也算上：不然归档之后新条目会重用旧编号，取代链就指不清了。
    const item = createItem(draft, { id: nextId([...known, ...archived]), date, source, defaultType: suggested });
    created.push(item);
    known = [...known, item];

    if (target) {
      known = supersede(known, target.id, item.id);
      replaced.push({ from: target.id, to: item.id });
    }
  }

  await writeLedger(base, known);

  // 原文：先给每条新条目落一份（整批共用），再把被取代的那些的原文挪过来，
  // 最后把被取代的那句也附上——"改之前是什么"。
  for (const item of created) {
    if (evidence) await writeEvidence(base, item.id, evidence);
  }
  for (const { from, to } of replaced) {
    await moveEvidence(base, from, to, { fallback: evidence || null });
    const previous = existing.find((item) => item.id === from);
    if (previous) await appendEvidence(base, to, originalLine(from, previous.statement));
  }

  // AGENTS.md 永远是**项目**文件（不是状态文件），所以用 base 而不是 stateDir。
  const agentsPath = join(base, AGENTS_FILENAME);
  const agents = await readIfExists(agentsPath);
  if (agents !== null && agents.includes(HOT_BLOCK_BEGIN)) {
    await writeFile(agentsPath, removeHotBlock(agents), "utf8");
  }

  return { created, items: known, config, replaced, warnings };
}

/** 账本改动之后统一从这里写，省得每处都记着 serialize 与目录。 */
async function writeLedger(root, items) {
  const dir = stateDir(root);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, LEDGER_FILENAME), serializeLedger(items), "utf8");
}

/**
 * 面板上的"改"。
 *
 * - 改措辞 → **取代**：旧的那句一个字节都不动，落成一条新条目，旧的标成 `superseded by`。
 *   想法变了就该留痕，这是账本的第一原则。
 * - 只改标签 → 原地改类型。标签只是给人看的前缀，改了不留历史没有损失。
 *
 * 不是 active 的条目不给改：已经失效的东西改它没有意义，用户多半是点错了。
 */
export async function reviseItem(root, { id, statement, type, date, source = "" } = {}) {
  const base = normalizeRoot(root);
  const config = await readConfig(base);
  const items = await readItems(base);
  const target = items.find((item) => item.id === id);

  if (!target) return { ok: false, reason: `${id} 不在账本里。`, items, config };
  if (!isActive(target)) {
    return { ok: false, reason: `${id} 已经失效（${target.status}），没有可改的东西。`, items, config };
  }

  const nextStatement = statement == null ? null : oneLine(statement);
  const nextType = type == null ? null : resolveType(config, type);

  if (nextStatement && nextStatement !== target.statement) {
    const { created, items: after } = await commitItems(
      base,
      [{ statement: nextStatement, type: nextType ?? target.type, supersedes: id }],
      { date, source: source || `账本面板 · 取代 ${id}` }
    );
    return {
      ok: true,
      action: "superseded",
      item: created[0] ?? null,
      replacedId: id,
      items: after,
      config
    };
  }

  if (nextType && nextType !== target.type) {
    const changed = { ...target, type: nextType };
    const after = items.map((item) => (item.id === id ? changed : item));
    await writeLedger(base, after);
    return { ok: true, action: "relabelled", item: changed, items: after, config };
  }

  return { ok: true, action: "unchanged", item: target, items, config };
}

/** 退休：这条不再生效，没有后继者。同样只对 active 的条目动手。 */
export async function retireItem(root, { id } = {}) {
  const base = normalizeRoot(root);
  const config = await readConfig(base);
  const items = await readItems(base);
  const target = items.find((item) => item.id === id);

  if (!target) return { ok: false, reason: `${id} 不在账本里。`, items, config };
  if (target.status === "retired") {
    return { ok: true, action: "unchanged", item: target, items, config };
  }
  if (!isActive(target)) {
    return { ok: false, reason: `${id} 已经失效（${target.status}）——取代过的条目不用再退休。`, items, config };
  }

  const after = retire(items, id);
  await writeLedger(base, after);
  // 退休一起退休：这条不再生效，它那份原文也没有留下的理由了。
  await deleteEvidence(base, id);
  return { ok: true, action: "retired", item: after.find((item) => item.id === id), items: after, config };
}

/**
 * 一次性退休所有生效项（面板上的「全部退休」）。
 *
 * 这是**批量**的退休，不是删除：条目一条不少地留在账本里、状态变成 `retired`，
 * 热块从下一轮起就空了。失效条目不动（它们本来就不生效）。
 * 一次写盘——别写成"循环调 retireItem"，那样中途失败会留下半个账本。
 */
export async function retireAll(root) {
  const base = normalizeRoot(root);
  const config = await readConfig(base);
  const items = await readItems(base);
  const targets = items.filter(isActive).map((item) => item.id);

  if (targets.length === 0) {
    return { ok: true, action: "unchanged", retired: [], items, config };
  }

  const after = items.map((item) => (isActive(item) ? { ...item, status: "retired" } : item));
  await writeLedger(base, after);
  for (const id of targets) await deleteEvidence(base, id);

  return { ok: true, action: "retired-all", retired: targets, items: after, config };
}

/**
 * 归档：把失效条目从账本挪进 `ALIGNMENT-ARCHIVE.md`。
 *
 * **不是删除**——条目一条不少地留在归档文件里，账本正文与面板因此干净下来，
 * 热块本来就不带它们，所以注入那边毫无变化。
 *
 * 两步写的顺序是刻意的：**先写归档，再削账本**。反过来的话，第二步失败就等于把历史
 * 弄丢了；这个顺序最坏也只是"两处都有"，而且按 id 去重，重跑一次就收敛。
 */
export async function archiveInactive(root) {
  const base = normalizeRoot(root);
  const config = await readConfig(base);
  const items = await readItems(base);
  const inactive = items.filter((item) => !isActive(item));

  if (inactive.length === 0) {
    return { ok: true, action: "unchanged", archived: [], items, config };
  }

  const previous = await readArchived(base);
  const moved = orderById(inactive);
  const movedIds = new Set(moved.map((item) => item.id));
  // 按 id 去重：上一次归档写成功了、削账本失败了的话，重跑不会留下两份。
  const merged = [...previous.filter((item) => !movedIds.has(item.id)), ...moved];

  const dir = stateDir(base);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ARCHIVE_FILENAME), serializeArchive(merged), "utf8");

  const kept = items.filter(isActive);
  await writeLedger(base, kept);
  // 失效条目的原文本该在退休/取代时就清掉了；这里补一刀，免得改名换姓之后留下孤儿。
  for (const id of movedIds) await deleteEvidence(base, id);

  return {
    ok: true,
    action: "archived",
    archived: moved.map((item) => item.id),
    items: kept,
    config
  };
}

/** 归档里有多少条。面板拿它显示"已归档 N 条"，不把条目本身读进面板。 */
export async function countArchived(root) {
  return (await readArchived(root)).length;
}
