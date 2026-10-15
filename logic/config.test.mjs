import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CONFIG,
  DEFAULT_TYPES,
  listTypes,
  parseConfig,
  renderConfigTemplate,
  suggestedType
} from "./config.mjs";
import { DEFAULT_MAX_ITEMS } from "./hot-block.mjs";

test("配置模板：解析回来就是出厂默认值，注释里带着怎么加一类标签", () => {
  const text = renderConfigTemplate();

  assert.match(text, /hot_block_max_items = 20/);
  assert.match(text, /\[types\.handoff\]/, "注释里要有加标签的样例，照着抄就行");

  const parsed = parseConfig(text);
  assert.equal(parsed.hot_block_max_items, DEFAULT_CONFIG.hot_block_max_items);
  assert.deepEqual(
    listTypes(parsed).map((type) => type.slug),
    DEFAULT_TYPES.map((type) => type.slug),
    "模板写出来的就是默认四类，顺序也一致"
  );
});

const SAMPLE = `
# 类型只是标签：增删类型只改这里。
hot_block_max_items = 5

[types.concept-alignment]

[types.error-correction]
label = "我错了"
`;

test("顶层键与类型段都能读出来", () => {
  const config = parseConfig(SAMPLE);
  assert.equal(config.hot_block_max_items, 5);
  assert.equal(config.types["error-correction"].label, "我错了");
});

test("类型只剩标签，不带任何行为字段", () => {
  const config = parseConfig("");
  for (const type of listTypes(config)) {
    assert.deepEqual(Object.keys(type).sort(), ["label", "slug"]);
  }
});

test("老配置里的 restate 被忽略，不影响标签", () => {
  // 老配置里可能残留 restate；它是纯粹的陌生键：不报错、不生效，标签照旧。
  const config = parseConfig(`
[types.error-correction]
restate = true
label = "错误纠正"
`);

  assert.deepEqual(listTypes(config).find((type) => type.slug === "error-correction"), {
    slug: "error-correction",
    label: "错误纠正"
  });
});

test("注释不会被当成值", () => {
  const config = parseConfig('hot_block_max_items = 7 # 上限\n');
  assert.equal(config.hot_block_max_items, 7);
});

test("空输入回落到默认值：上限 + 四个默认类型", () => {
  const config = parseConfig("");
  assert.equal(config.hot_block_max_items, DEFAULT_CONFIG.hot_block_max_items);
  assert.deepEqual(
    listTypes(config).map((type) => type.label),
    ["概念对齐", "错误纠正", "方向纠偏", "细节填充"]
  );
});

test("改配置能换掉某个类型的标签", () => {
  const config = parseConfig('[types.concept-alignment]\nlabel = "对齐口径"\n');
  assert.equal(listTypes(config)[0].label, "对齐口径");
});

test("上限的默认值只有一个来源：热块的 DEFAULT_MAX_ITEMS", () => {
  // 上限的默认值只能有一个来源——这里的数必须和热块的相等。
  assert.equal(DEFAULT_CONFIG.hot_block_max_items, DEFAULT_MAX_ITEMS);
});

test("第五类只写在配置里就出现", () => {
  const config = parseConfig(`${SAMPLE}\n[types.foo]\nlabel = "新花样"\n`);

  assert.deepEqual(listTypes(config).find((type) => type.slug === "foo"), {
    slug: "foo",
    label: "新花样"
  });
});

test("新类型没写 label 时，标签回落成 slug", () => {
  const config = parseConfig("[types.bar]\n");
  assert.equal(listTypes(config).find((type) => type.slug === "bar").label, "bar");
});

test("类型顺序稳定：默认四类在前，新类型按文件顺序追加", () => {
  const config = parseConfig("[types.zed]\n\n[types.alpha]\n");
  const slugs = listTypes(config).map((type) => type.slug);

  assert.deepEqual(slugs.slice(0, 4), [
    "concept-alignment",
    "error-correction",
    "direction-correction",
    "detail-completion"
  ]);
  assert.deepEqual(slugs.slice(-2), ["zed", "alpha"]);
});

test("兜底类型就是列表里的第一个", () => {
  const config = parseConfig("");
  assert.equal(suggestedType(config), listTypes(config)[0].slug);
});
