// 版本号的形状：一个占位符 + 一次替换。
//
// 版本只有一个真源——插件清单 `.codex-plugin/plugin.json`：装到哪个目录、要不要重装，都由它决定。
// 所以代码里**不再手写**版本号：server 启动时读清单，面板留占位符、由 server 把面板递出去时替换。
//
// 手写的那两处（server 的 serverInfo、面板的 appInfo）正是"代码看着是新的、跑的其实是旧副本"
// 的经典来源——顺手也把"改版本要动源码"这件事去掉了。

export const VERSION_TOKEN = "__REIN_VERSION__";

/** 把面板里的占位符换成真实版本号。没有占位符就原样返回，别的字节一个不动。 */
export function injectVersion(text, version) {
  return String(text ?? "").replaceAll(VERSION_TOKEN, String(version ?? ""));
}
