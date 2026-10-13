import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// 入口是 skills/<name>/SKILL.md：清单要声明 skills 目录，文件要真的存在、frontmatter
// 要有 name 与 description——否则 skill 装不上，而且是安静的失败。

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(REPO, ".codex-plugin", "plugin.json");

function readManifest() {
  return readFile(MANIFEST, "utf8").then(JSON.parse);
}

function frontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(String(text));
  if (!match) return null;

  const fields = {};
  for (const line of match[1].split("\n")) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (pair) fields[pair[1]] = pair[2].replace(/^"(.*)"$/, "$1");
  }

  return { fields, body: match[2] };
}

test("清单声明的 skills 目录存在", async () => {
  const manifest = await readManifest();
  assert.equal(typeof manifest.skills, "string");

  const dir = join(REPO, manifest.skills);
  assert.ok((await stat(dir)).isDirectory(), `${manifest.skills} 不是目录`);
});

test("每个 skill 都是带 name 与 description 的 SKILL.md，且有正文", async () => {
  const manifest = await readManifest();
  const root = join(REPO, manifest.skills);
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  assert.ok(names.length > 0, "skills 目录里一个 skill 都没有");

  for (const name of names) {
    const parsed = frontmatter(await readFile(join(root, name, "SKILL.md"), "utf8"));

    assert.ok(parsed, `${name}/SKILL.md 没有 frontmatter`);
    assert.equal(parsed.fields.name, name, `${name}/SKILL.md 的 name 与目录名不一致`);
    assert.ok(parsed.fields.description?.trim(), `${name}/SKILL.md 缺 description`);
    assert.ok(parsed.body.trim().length > 0, `${name}/SKILL.md 只有 frontmatter`);
  }
});

test("清单声明的图标真的在——路径写错了不报错，只是静默没有图标", async () => {
  const manifest = await readManifest();

  for (const field of ["composerIcon", "logo"]) {
    const path = manifest.interface?.[field];

    assert.ok(path, `interface.${field} 没声明`);
    assert.ok(path.startsWith("./"), `interface.${field} 得是 ./ 开头的插件根相对路径`);
    assert.ok((await stat(join(REPO, path))).size > 0, `${path} 不在，或者是空文件`);
  }
});
