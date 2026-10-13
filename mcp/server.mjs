#!/usr/bin/env node
// rein — MCP server
//
// 工具面很薄，逻辑全在 logic/。这个文件只做三件事：把工具暴露给模型、把面板资源递给宿主、
// 把结果翻译成人话。任何"对齐"的判断都不该写在这里。

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

import { listTypes } from "../logic/config.mjs";
import { DESTINATIONS } from "../logic/destination.mjs";
import { renderEvidence } from "../logic/evidence.mjs";
import { buildLandingForm, readLandingAnswers } from "../logic/landing-form.mjs";
import {
  addRestatements,
  archiveInactive,
  commitItems,
  countArchived,
  markPanelOpen,
  readConfig,
  readEvidence,
  readItems,
  readSessionMarker,
  retireAll,
  retireItem,
  takePanelOpen,
  reviseItem
} from "../logic/store.mjs";
import { isActive } from "../logic/item.mjs";
import { DEFAULT_MAX_ITEMS, selectHotBlock } from "../logic/hot-block.mjs";
import { hookFreshness, humanAgo } from "../logic/hook-status.mjs";
import { injectVersion } from "../logic/version.mjs";

const APP_MIME = "text/html;profile=mcp-app";

const PANEL_URI = "ui://rein/panel.html";

// 版本号只有一个真源：插件清单。**运行时读**，代码里不写死——清单说了算（装到哪个目录、
// 要不要重装都看它），代码里再抄一份只会带来"看着是新的、跑的其实是旧副本"。
// 读不到就报 0.0.0：版本号不值得让 server 起不来。面板里的占位符也用它替换。
const MANIFEST_URL = new URL("../.codex-plugin/plugin.json", import.meta.url);
const SERVER_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(MANIFEST_URL, "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// 没有原文时讲的那句：手写进账本的条目、以及这个功能之前落的条目，都会看到它。
// 文案只有这一份——面板与 CLI 拿到的是同一句，别在两边各写一遍。
const NO_EVIDENCE_NOTE = "（外部写入：不是从对话里写入的——手账本，或这个功能之前已经落成的条目。）";

// 落地之后怎么回报用户：**只说结果，一句话**。模型容易照着工具结果的形状回报——
// 文件名、session id、字段名都是内部细节，用户要知道的只是"去哪了"。
const REPLY_RULE = [
  "**怎么回报用户：一句话说结果就够。**",
  "- 写进账本的 →「已落地 C-019」（有编号就带上），可以补半句「从下一轮起每轮带上」。",
  "- 复述的 →「已复述，会在你下次提问时到达，只带一次。」",
  "- 要你当轮说的那一段 → 原样说出来，加粗或引用；这一条不能只报「已复述」。",
  "- **不许提**文件名、路径、session id、工具名、字段名（inline / inboxed 这类），也别把这份结果的结构复述一遍。"
].join("\n");

const RESOURCES = new Map([
  [PANEL_URI, { file: new URL("../ui/panel.html", import.meta.url), name: "rein panel" }]
]);

const STATEMENT_SCHEMA = {
  type: "object",
  properties: {
    statement: {
      type: "string",
      description: "一句话断言。选「复述」时，这段文本就是被带回主线的那段，尽量照抄原话。"
    },
    type: {
      type: "string",
      description: "分类标签，只影响账本与热块里的行首前缀；写 slug 或中文都认，省略时用配置里的第一个。"
    },
    supersedes: {
      type: "string",
      description:
        "这条断言取代哪个已确认项（写 C-0NN）。用于用户说「那条不对了/过时了，应该是 X」的场合：旧条目会被标成 superseded，保留在账本的历史里，不再每轮注入。省略就是新增一条，不碰任何旧条目。"
    }
  },
  required: ["statement"],
  additionalProperties: false
};

const CANDIDATE_SCHEMA = {
  type: "object",
  properties: {
    ...STATEMENT_SCHEMA.properties,
    destination: {
      type: "string",
      enum: DESTINATIONS.map((entry) => entry.slug),
      description:
        "你建议这条去哪，每条都要给。表单会默认停在这一项，用户随时改。land=写进账本、以后每轮都带上；restate=只在主线下一次提问里带上一次（命令式的、用完就失效的内容，或够不上一条已确认项的片段，用这个）；ignore=不留痕（不值得留、但值得让用户看一眼的，用这个）。"
    }
  },
  required: ["statement"],
  additionalProperties: false
};

const TOOLS = [
  {
    // 只对面板可见（见下面的 _meta）：模型碰不到它，就没法绕过表单自己写账本。
    name: "rein_one",
    title: "直接写一条进账本",
    description:
      "面板专用，模型不要调。把一条断言直接写进 ALIGNMENT.md，不弹表单——用户非常确定、不想走表单时的快车道。写进去就是每轮带上，所以只适合长期前提，不适合命令式/一次性的内容。",
    inputSchema: {
      type: "object",
      properties: {
        statement: { type: "string", description: "要写进账本的那句话。" },
        type: { type: "string", description: "分类标签（slug 或中文）；省略时用配置里的第一个。" },
        root: { type: "string", description: "项目根目录的绝对路径。" }
      },
      required: ["statement"],
      additionalProperties: false
    },
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "rein_land",
    title: "落地（原生表单）",
    description:
      "把候选断言交给用户，用宿主原生的 elicitation 表单逐条选去哪：「Align」写进 ALIGNMENT.md 以后每轮带上、「Restate」只带回主线说一次、「Ignore」不留痕。表单是**一问一页**的向导，每条候选就是那一页的问题（问题文字就是你写的 statement），下面三个选项。表单默认停在你在每条候选上给的 destination 建议上；用户整张表单都不想决定时按 skip，账本不动。主线程和侧聊都能用——在侧聊里用它，就是把结论搬回主线的正路。root 省略时用插件进程的工作目录，主 Agent 应当把当前工作区的绝对路径传进来。**顺手把原文也交出来**：`evidence` = 用户确认时那句话、`corrected` = 被纠正对象的一句引用（可选）——侧聊是临时的，错过落地这一刻，这条结论的来龙去脉以后就找不回来了。",
    inputSchema: {
      type: "object",
      properties: {
        candidates: {
          type: "array",
          description: "待用户逐条确认的候选断言。",
          items: CANDIDATE_SCHEMA
        },
        root: { type: "string", description: "项目根目录的绝对路径。" },
        source: { type: "string", description: "这批断言来自哪里，写进账本条目的来源字段。" },
        evidence: {
          type: "string",
          description:
            "原文的第一句：**用户确认这条结论时说的那句话**，照抄，别总结、别改写。作用范围是一轮，整批共用。它只能由你交出来（侧聊没有落盘、事后没处可查），落地这一刻不交，这条结论以后就回溯不到来路了。写进本地一份，不进账本、不进项目。"
        },
        corrected: {
          type: "string",
          description:
            "原文的第二句（可选）：**被纠正 / 被收紧的那个对象的一句引用**——通常是上一条回答里的那一句原话。用户「选中一句话加进聊天」的场合，引用的那句写在这里。这条结论没有在纠正谁（纯粹新增一个约束）就省略。"
        }
      },
      required: ["candidates"],
      additionalProperties: false
    }
  },
  {
    name: "rein_list",
    title: "看当前对齐了什么",
    description:
      "读回账本，列出当前生效与已失效的已确认项，并说明热块这次带了哪几条（上限之外的不再每轮注入）。只读，不开面板。",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "项目根目录的绝对路径。" }
      },
      additionalProperties: false
    }
  },
  {
    name: "rein_open_ledger",
    title: "打开对齐账本",
    description:
      "打开账本面板：列出当前生效与已失效的已确认项，可以改标签、取代（改措辞）、退休。用户说「看看对齐了什么」「把某条改掉」时用它；只想知道内容、不想开面板就用 rein_list。落地仍然只走 rein_land 的原生表单，这个面板不落地。",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "项目根目录的绝对路径。" }
      },
      additionalProperties: false
    },
    _meta: { ui: { resourceUri: PANEL_URI, visibility: ["model", "app"] } }
  },
  {
    name: "rein_take_open",
    title: "取走这次展开侧栏的机会",
    description:
      "面板专用，模型不要调。面板挂载后用它问一句「这一次该由我把侧栏展开吗」——只有刚被 rein_open_ledger 打开的那一次能取到 true，历史里重新挂载的面板取到 false，所以上滑聊天记录不会把侧栏抢走。取过即消费。",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "项目根目录的绝对路径。" }
      },
      required: ["root"],
      additionalProperties: false
    },
    // 只给面板看：进不了模型的工具面，也就不会被误调。
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "rein_retire_all",
    title: "退休全部生效项",
    description:
      "面板专用，模型不要调。一次性把**所有生效项**退休：条目一条不删地留在账本里、状态变成 retired，热块从下一轮起为空。不可逆（没有恢复动作，要回来只能重新落一条）。面板上那个按钮会先要一次确认，模型不该在用户没明确要求时碰它。",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "项目根目录的绝对路径。" }
      },
      required: ["root"],
      additionalProperties: false
    },
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "rein_archive",
    title: "归档失效条目",
    description:
      "面板专用，模型不要调。把**已经失效**的已确认项从 ALIGNMENT.md 挪进 ALIGNMENT-ARCHIVE.md：账本正文与面板因此干净下来，条目一条不删（归档不等于删除）。热块本来就只出生效项，所以注入那边毫无变化。",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "项目根目录的绝对路径。" }
      },
      required: ["root"],
      additionalProperties: false
    },
    _meta: { ui: { visibility: ["app"] } }
  },
  {
    name: "rein_edit",
    title: "改一条已确认项",
    description:
      "改一条已确认项，给账本面板用，也可以直接由主 Agent 调用。改措辞会走取代（旧的保留、标成失效，历史不丢）；只改标签是原地改；retire 是退休（不再生效，也没有后继者）。只对当前生效的条目不生效的会报错。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "要改的已确认项编号，例如 C-013。" },
        statement: { type: "string", description: "新的措辞。与旧的不同就会落成一条新条目并取代旧的。" },
        type: { type: "string", description: "新的标签。只改标签时原地改，不留历史。" },
        retire: { type: "boolean", description: "true = 退休这条（不再每轮注入）。与 statement 不要同时给。" },
        root: { type: "string", description: "项目根目录的绝对路径。" }
      },
      required: ["id"],
      additionalProperties: false
    }
  },
  {
    name: "rein_evidence",
    title: "看一条结论的原文",
    description:
      "读回某条已确认项落地时留下的原文：用户确认的那句 + 被纠正对象的一句引用（取代过的还会附上「原结论」）。用于用户问「这条当初是因为什么才落的」。**只在用户明确要看时才调它**——原文不进账本、也不会自动出现在你的上下文里。原文只存在本地，账本文件（ALIGNMENT.md）里没有它；没留过原文的条目会明说没有。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "要看的已确认项编号，例如 C-013。" },
        root: { type: "string", description: "项目根目录的绝对路径。" }
      },
      required: ["id"],
      additionalProperties: false
    },
    _meta: { ui: { visibility: ["model", "app"] } }
  }
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

// server→host 请求。MCP 是双向的：处理 tools/call 时可以向宿主发一条请求（例如
// elicitation/create），宿主渲染界面，用户的选择按 id 回到这里。落地表单走的就是它。
const PENDING = new Map();
let serverRequestSeq = 0;

// 等用户填表的超时。必须**短于** `.mcp.json` 的 `tool_timeout_sec`（现在是 600），
// 否则宿主先掐断工具调用，我们连自己超时的机会都没有。也别往小里调：填完表单要不少时间。
const HOST_REQUEST_TIMEOUT_MS = 480_000;

function requestHost(method, params, { timeoutMs = HOST_REQUEST_TIMEOUT_MS } = {}) {
  const id = `rein-${++serverRequestSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (PENDING.delete(id)) {
        reject(new Error(`宿主在 ${Math.round(timeoutMs / 1000)}s 内没有回应 ${method}`));
      }
    }, timeoutMs);
    PENDING.set(id, {
      resolve: (value) => { clearTimeout(timer); resolve(value); },
      reject: (error) => { clearTimeout(timer); reject(error); }
    });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function failure(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function localDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function resolveRoot(params) {
  const root = params?.root ?? process.env.CODEX_WORKSPACE_ROOT ?? process.cwd();
  return String(root);
}

/** 取代与警告这两段在落地之后要出，写一次。 */
function linkLines({ replaced = [], warnings = [] }) {
  const lines = [];

  if (replaced.length > 0) {
    lines.push(`取代：${replaced.map((entry) => `${entry.from} → ${entry.to}`).join("、")}。旧条目没删，标成失效留在账本里。`);
  }
  if (warnings.length > 0) {
    lines.push(`注意：\n${warnings.map((warning) => `- ${warning}`).join("\n")}`);
  }

  return lines;
}

/** 面板要的东西：账本原文 + 当前类型表。改完之后也回这一份，面板照着重渲染。 */
async function ledgerState(root) {
  const config = await readConfig(root);
  const items = await readItems(root);
  const active = items.filter(isActive).length;
  // 热块的真实窗口：上限之外的那些仍在账本里、仍是 active，但不再每轮注入。
  // 面板要把这件事说出来，不然一条已确认项会静默退出注入而谁也看不见。
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
    active,
    total: items.length,
    archived: { count: archived },
    hotBlock: { maxItems, shown: hot.shown.length, dropped: hot.dropped },
    hook
  };
}

/** 账本的一句话摘要。上限把条目挤出热块时必须说出来，否则那是静默失效。 */
function describeLedger(state) {
  const parts = [`${state.active} 条生效、${state.total - state.active} 条已失效`];
  if (state.hotBlock?.dropped > 0) {
    parts.push(
      `热块这次只带前 ${state.hotBlock.shown} 条，另外 ${state.hotBlock.dropped} 条超出上限（${state.hotBlock.maxItems}）——它们仍在账本里，但不再每轮注入`
    );
  }
  return `${parts.join("；")}。`;
}

/** 钩子看起来没在跑时的一句话提示；正常就返回空串。 */
function hookHint(hook) {
  if (hook?.recent) return "";
  const detail = hook?.ageMs == null ? "还没见它跑过" : `最后一次留下痕迹是 ${humanAgo(hook.ageMs)}前`;
  return `提示：每轮注入的钩子好像没在运行（${detail}）。刚装好、重装或升级过的话，重启 app，再去「设置 → Hooks」把 rein 的钩子过一遍信任。`;
}

function withHookHint(text, hook) {
  const hint = hookHint(hook);
  return hint ? `${text}\n\n${hint}` : text;
}

function describeEdit(result, types = []) {
  const label = (slug) => types.find((entry) => entry.slug === slug)?.label ?? slug;

  switch (result.action) {
    case "superseded":
      return `${result.item.id} 已经落地，${result.replacedId} 标成失效——旧措辞留在账本的历史里。`;
    case "relabelled":
      return `${result.item.id} 的标签改成「${label(result.item.type)}」。`;
    case "retired":
      return `${result.item.id} 退休：不再每轮注入，条目留在账本里。`;
    default:
      return "没有变化。";
  }
}

async function callTool(name, params) {
  switch (name) {
    case "rein_one": {
      const root = resolveRoot(params);
      const statement = String(params?.statement ?? "").trim();
      if (!statement) {
        throw Object.assign(new Error("要写哪一句？statement 不能为空"), { code: -32602 });
      }

      const { created } = await commitItems(root, [{ statement, type: params?.type }], {
        date: localDate(),
        source: "账本面板 · 直接写",
        // 这条不是从对话里来的——原文位置注明它是用户本人写的，别留一个说不清的空档。
        evidence: "用户本人在账本面板直接写入（没有对话原文）。"
      });
      const state = await ledgerState(root);
      const message = `已写入 ${created[0]?.id ?? ""}——从下一轮起每轮带上。`;

      return {
        content: [{ type: "text", text: message }],
        structuredContent: { ...state, ok: true, message }
      };
    }

    case "rein_list": {
      const state = await ledgerState(resolveRoot(params));
      const body = state.items.length
        ? `${describeLedger(state)}\n${[...state.items].reverse()
            .map((item) => `${item.id} · ${item.type} · ${item.status}：${item.statement}`)
            .join("\n")}`
        : "账本还是空的。";
      return {
        content: [{ type: "text", text: withHookHint(body, state.hook) }],
        structuredContent: state
      };
    }

    case "rein_open_ledger": {
      const root = resolveRoot(params);
      const state = await ledgerState(root);

      // 放一个一次性的待取标记：面板挂载后会来取，取到才展开侧栏。
      // 历史回放取不到——所以上滑聊天记录不会把侧栏一次次抢走。
      await markPanelOpen(root).catch(() => {});

      return {
        content: [
          {
            type: "text",
            text: withHookHint(
              `账本已打开：${describeLedger(state)}面板里可以改标签、取代、退休；落地仍然走 rein_land 的表单。`,
              state.hook
            )
          }
        ],
        structuredContent: state
      };
    }

    case "rein_take_open": {
      const open = await takePanelOpen(resolveRoot(params));
      return {
        content: [{ type: "text", text: open ? "这次可以展开。" : "这次不展开。" }],
        structuredContent: { open }
      };
    }

    case "rein_retire_all": {
      const root = resolveRoot(params);
      const result = await retireAll(root);
      const state = await ledgerState(root);
      const message =
        result.retired.length === 0
          ? "没有生效项可退休，账本没动。"
          : `已退休 ${result.retired.length} 条（${result.retired.join("、")}）——条目都留在账本里，热块从下一轮起不再带它们。`;

      return {
        content: [{ type: "text", text: message }],
        structuredContent: { ...state, ok: result.ok, action: result.action, retired: result.retired, message }
      };
    }

    case "rein_archive": {
      const root = resolveRoot(params);
      const result = await archiveInactive(root);
      const state = await ledgerState(root);
      const message =
        result.archived.length === 0
          ? "没有失效条目可归档，账本没动。"
          : `已归档 ${result.archived.length} 条（${result.archived.join("、")}）——它们进了 ALIGNMENT-ARCHIVE.md，一条没删，只是不再列在账本与面板里。`;

      return {
        content: [{ type: "text", text: message }],
        structuredContent: { ...state, ok: result.ok, action: result.action, archivedIds: result.archived, message }
      };
    }

    case "rein_edit": {
      const root = resolveRoot(params);
      const id = String(params?.id ?? "").trim();

      if (!id) {
        throw Object.assign(new Error("要改哪一条？id 不能为空（例如 C-013）"), { code: -32602 });
      }

      const result =
        params?.retire === true
          ? await retireItem(root, { id })
          : await reviseItem(root, {
              id,
              statement: params?.statement,
              type: params?.type,
              date: localDate(),
              source: `账本面板 · 取代 ${id}`
            });

      const state = await ledgerState(root);
      const message = result.ok ? describeEdit(result, state.types) : `没改动：${result.reason}`;

      return {
        content: [{ type: "text", text: message }],
        structuredContent: {
          ...state,
          ok: result.ok,
          action: result.action ?? null,
          message
        }
      };
    }

    case "rein_evidence": {
      const root = resolveRoot(params);
      const id = String(params?.id ?? "").trim();

      if (!id) {
        throw Object.assign(new Error("要看哪一条？id 不能为空（例如 C-013）"), { code: -32602 });
      }

      const text = await readEvidence(root, id);
      // 没有原文不是错误，是"这条不是从对话里落的"。照样回一句说明，别给一块空白——
      // 面板与 CLI 讲同一句话，真假由 hasEvidence 区分。
      const shown = text ?? NO_EVIDENCE_NOTE;

      return {
        content: [{ type: "text", text: `${id} 的原文：\n\n${shown}` }],
        structuredContent: { id, text: shown, hasEvidence: Boolean(text) }
      };
    }

    case "rein_land": {
      const root = resolveRoot(params);
      const candidates = Array.isArray(params?.candidates) ? params.candidates : [];

      if (candidates.length === 0) {
        return {
          content: [{ type: "text", text: "没有候选断言，什么都没做。" }],
          structuredContent: { created: [] }
        };
      }

      // 用户唯一要判断的事是"这段东西去哪"；类型只是标签，由模型在背后给。表单的形状
      // （一条候选一个字段、选项文字里带解释）全在 logic/landing-form.mjs 里，有测试盯着。
      const config = await readConfig(root);
      const { message, properties, slots } = buildLandingForm(candidates, config);

      let response;
      try {
        response = await requestHost("elicitation/create", {
          mode: "form",
          message,
          requestedSchema: { type: "object", properties, required: [] }
        });
      } catch (error) {
        const message = String(error?.message ?? error);
        return {
          content: [{ type: "text", text: `没拿到表单结果：${message}。账本未改动。` }],
          structuredContent: { created: [], error: message }
        };
      }

      if (response?.action !== "accept") {
        const action = response?.action ?? null;
        return {
          content: [
            {
              type: "text",
              text: action === "decline" ? "用户跳过了表单，账本未改动。" : "表单被关掉了，账本未改动。"
            }
          ],
          structuredContent: { created: [], action }
        };
      }

      // 回传的值怎么读，全在 logic/landing-form.mjs 的 readLandingAnswers 里——那里有测试。
      const { chosen, restatements } = readLandingAnswers(slots, response?.content);

      if (chosen.length === 0 && restatements.length === 0) {
        return {
          content: [{ type: "text", text: "没有任何一条被选中，账本未改动。" }],
          structuredContent: { created: [] }
        };
      }

      let created = [];
      let replaced = [];
      let warnings = [];
      if (chosen.length > 0) {
        ({ created, replaced, warnings } = await commitItems(root, chosen, {
          date: localDate(),
          source: params?.source ?? localDate(),
          // 原文只能在这一刻拿到（侧聊是临时的），整批共用一条——作用范围是一轮。
          // 形状（用户确认的那句 + 被纠正对象的一句引用）在这里定，别指望模型自己排版。
          evidence: renderEvidence({ user: params?.evidence, corrected: params?.corrected })
        }));
      }

      // 复述去哪，取决于"这轮是在主线程还是侧聊里"。工具调用里没有会话信息，
      // 所以读钩子在这次提问时留下的标记。认不出来（钩子没跑过、或是全新项目）就按
      // 侧聊处理——写进收件箱最坏是晚一轮到；当成主线程当场说出来，则可能随侧聊一起消失。
      const marker = await readSessionMarker(root).catch(() => null);
      const inMainThread = Boolean(marker) && marker.side !== true;

      const inline = inMainThread ? restatements : [];
      let inboxed = [];

      if (restatements.length > 0 && !inMainThread) {
        try {
          inboxed = await addRestatements(root, restatements, {
            at: new Date().toISOString(),
            session: marker?.session_id ?? ""
          });
        } catch {
          // 收件箱写不动，就退回当场说出来——写在回复里总比丢掉强。
          inline.push(...restatements);
        }
      }

      const sections = [];
      if (created.length > 0) {
        sections.push(
          `已落地 ${created.length} 条：\n${created
            .map((item) => `${item.id} · ${item.type} · ${item.statement}`)
            .join("\n")}`
        );
      }
      sections.push(...linkLines({ replaced, warnings }));
      if (inline.length > 0) {
        sections.push(
          `需要你**在这一轮回复里原样说出来**的复述（没写任何文件，别改写成结论）——说的时候用加粗或引用标出来，让它在一段叙述里一眼可见：\n${inline
            .map((text) => `- ${text}`)
            .join("\n")}`
        );
      }
      if (inboxed.length > 0) {
        sections.push(
          `已放进收件箱 ${inboxed.length} 条，会在主线的下一次提问时自动带上（你现在不用复述）：\n${inboxed
            .map((entry) => `- ${entry.text}`)
            .join("\n")}`
        );
      }
      if (created.length === 0 && inline.length === 0 && inboxed.length === 0) {
        sections.push("用户逐条选了不落地（Ignore）——这次没有写任何文件。");
      }
      sections.push(REPLY_RULE);

      return {
        content: [{ type: "text", text: sections.join("\n\n") }],
        structuredContent: { created, replaced, warnings, inline, inboxed }
      };
    }

    default:
      throw Object.assign(new Error(`unknown tool: ${name}`), { code: -32602 });
  }
}

async function handle(message) {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case "initialize":
      result(id, {
        protocolVersion: params?.protocolVersion ?? "2026-01-26",
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false }
        },
        serverInfo: { name: "rein", version: SERVER_VERSION }
      });
      return;

    case "notifications/initialized":
      return;

    case "tools/list":
      result(id, { tools: TOOLS });
      return;

    case "tools/call": {
      try {
        result(id, await callTool(params?.name, params?.arguments ?? {}));
      } catch (error) {
        failure(id, error?.code ?? -32603, String(error?.message ?? error));
      }
      return;
    }

    case "resources/list":
      result(id, {
        resources: [...RESOURCES].map(([uri, entry]) => ({
          uri,
          name: entry.name,
          mimeType: APP_MIME
        }))
      });
      return;

    case "resources/read": {
      const uri = String(params?.uri ?? "");
      const entry = RESOURCES.get(uri);
      if (!entry) {
        failure(id, -32602, `unknown resource: ${uri}`);
        return;
      }
      // 每次从磁盘读：宿主会缓存面板资源，但如果它来问，我们至少给最新的。
      // 面板里的版本号是个占位符，在这里换成清单里的真版本——面板因此不用手写版本号。
      result(id, {
        contents: [
          {
            uri,
            mimeType: APP_MIME,
            text: injectVersion(await readFile(entry.file, "utf8"), SERVER_VERSION)
          }
        ]
      });
      return;
    }

    case "ping":
      result(id, {});
      return;

    default:
      if (isRequest) failure(id, -32601, `method not found: ${method}`);
  }
}

const input = createInterface({ input: process.stdin, terminal: false });

// 请求一条一条按顺序处理。宿主本来就是一次一条、等回应，但真出现并发时（几条请求挤在一个
// chunk 里）会让读和写半途交叉——比如列表抢在落地写盘之前读。串起来就与收到的顺序一致。
//
// 宿主对我们请求的**应答**不能进这条链：链上正卡着等应答的那个调用，应答排到它后面就死锁。
let chain = Promise.resolve();

input.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }

  // 没有 method 的是应答（对我们 server→host 请求的回复），不是新请求：立刻处理，不排队。
  // 认不出来的 id 直接丢掉——回一个 "method not found" 给它只会污染日志。
  if (message.method === undefined) {
    const entry = PENDING.get(message.id);
    if (!entry) return;
    PENDING.delete(message.id);
    if (message.error) {
      entry.reject(
        Object.assign(new Error(message.error.message ?? "宿主请求失败"), {
          code: message.error.code
        })
      );
    } else {
      entry.resolve(message.result);
    }
    return;
  }

  chain = chain.then(() =>
    handle(message).catch((error) => {
      if (message.id !== undefined && message.id !== null) {
        failure(message.id, -32603, `internal error: ${error?.message ?? error}`);
      }
    })
  );
});

// stdin 关闭后不强行退出：resources/read 与写文件都是异步的，
// 抢在它们写回之前 exit 会丢响应。交给事件循环自然结束。
