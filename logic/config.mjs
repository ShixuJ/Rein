// .rein/config.toml 的读取。
//
// 类型是开放集合：增删类型只改配置，不改代码。所以下面这张默认值表是**唯一**允许出现
// 类型 slug 的地方——logic/no-hardcoded-types.test.mjs 盯着这一条。
//
// 类型只是**标签**：只决定账本与热块里的行首前缀，不决定行为——要不要每轮生效由用户在
// 表单上选目的地决定。所以这里只有 slug 与中文标签的映射。
//
// 只认"顶层键 + [types.<slug>] 段"，够薄闭环用。

import { DEFAULT_MAX_ITEMS } from "./hot-block.mjs";

/** 出厂默认类型表。顺序就是账本与热块里的展示顺序。 */
export const DEFAULT_TYPES = [
  { slug: "concept-alignment", label: "概念对齐" },
  { slug: "error-correction", label: "错误纠正" },
  { slug: "direction-correction", label: "方向纠偏" },
  { slug: "detail-completion", label: "细节填充" }
];

// 上限的默认值取自热块那边（renderHotBlock 用的就是这个数），只定义一次。
export const DEFAULT_CONFIG = { hot_block_max_items: DEFAULT_MAX_ITEMS, types: {} };

/** 已知类型列表。顺序稳定，标签回落成 slug。 */
export function listTypes(config) {
  return Object.entries(config?.types ?? {}).map(([slug, entry]) => ({
    slug,
    label: entry?.label ?? slug
  }));
}

/** slug → 中文标签。认不出来就原样回落成 slug。 */
export function typeLabel(types, slug) {
  return types.find((entry) => entry.slug === slug)?.label ?? slug;
}

/** 模型的候选断言没给类型时的兜底：列表里的第一个。 */
export function suggestedType(config) {
  return listTypes(config)[0]?.slug;
}

/**
 * 模型给的类型 → 已知 slug。写 slug 或写中文标签都认；认不出来就用兜底。
 * 类型只是标签，标错只影响账本与热块里的前缀，不影响任何行为。
 */
export function resolveType(config, value) {
  const text = String(value ?? "").trim();
  const types = listTypes(config);
  const match = types.find((type) => type.slug === text) ?? types.find((type) => type.label === text);
  return match?.slug ?? suggestedType(config);
}

/** 出厂配置：默认类型先铺进 types，配置文件再往上盖。 */
export function defaultConfig() {
  const types = {};
  for (const { slug, ...rest } of DEFAULT_TYPES) types[slug] = { ...rest };
  return { hot_block_max_items: DEFAULT_CONFIG.hot_block_max_items, types };
}

function parseValue(raw) {
  const value = raw.replace(/\s+#.*$/, "").trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value.replace(/^"(.*)"$/, "$1");
}

export function parseConfig(text) {
  const config = defaultConfig();
  let section = null;

  for (const rawLine of String(text ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const table = /^\[(.+)\]$/.exec(line);
    if (table) {
      section = table[1];
      if (section.startsWith("types.")) {
        const slug = section.slice("types.".length);
        config.types[slug] ??= {};
      }
      continue;
    }

    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!pair) continue;

    const [, key, rawValue] = pair;
    const value = parseValue(rawValue);

    if (section === null) {
      config[key] = value;
    } else if (section.startsWith("types.")) {
      config.types[section.slice("types.".length)][key] = value;
    }
  }

  return config;
}
