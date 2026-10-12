#!/bin/sh
# rein 的 node 启动壳：两个入口（MCP server 与 UserPromptSubmit 钩子）都从这里过一道。
#
# 为什么需要它：宿主从 Dock/Finder 启动时的 PATH 是 launchd 那一套
# （/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin），**Homebrew 的 /opt/homebrew/bin 不在里头**。
# 写死 `/opt/homebrew/bin/node` 会在换机器、改用 nvm/Volta、或换成 Intel Mac（Homebrew 在
# /usr/local）时**静默**断掉——node 找不到，我们自己的代码一行都跑不到。
#
# 所以这里按固定顺序找，找到就 exec（顺序是刻意的：先看显式指定，再看常见安装位置，
# 宿主 PATH 是兜底——它上面那个 node 未必是用户在用的那个）：
#
#   1. $REIN_NODE                 显式指定；**设了就用它，不再往下猜**
#   2. /opt/homebrew/bin/node      Apple Silicon Homebrew
#   3. /usr/local/bin/node         Intel Homebrew / 手动装
#   4. nvm 里版本号最大的那个
#   5. Volta / asdf / fnm 的 shim
#   6. 宿主 PATH 上的 node
#   7. 应用自带的 cua_node         最后一条命
#
# 找不到：往 $REIN_NODE_LOG（默认 /tmp/rein-node.log）留一行，并以**退出码 0** 结束——
# 钩子绝不能挡住用户的提问。那个文件同时记着"上一次用的是哪个 node、什么版本"。

LOG="${REIN_NODE_LOG:-/tmp/rein-node.log}"

# 覆盖式记录：只留最后一次，免得每轮提问都往文件里追加一行。
record() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo '-')" "$1" >"$LOG" 2>/dev/null || true
}

# nvm 里版本号最大的那个 node；没有就什么都不输出。
nvm_node() {
  [ -n "${HOME:-}" ] || return 0
  ls -1d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1
}

find_node() {
  if [ -n "${REIN_NODE:-}" ]; then
    [ -x "$REIN_NODE" ] && printf '%s\n' "$REIN_NODE"
    return 0
  fi

  for candidate in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "$(nvm_node)" \
    "${HOME:-}/.volta/bin/node" \
    "${HOME:-}/.asdf/shims/node" \
    "${HOME:-}/.local/share/fnm/aliases/default/bin/node" \
    "$(command -v node 2>/dev/null)" \
    /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node
  do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 0
}

NODE="$(find_node)"

# 排查用：只报"会用哪个 node"，不启动任何东西。
if [ "${1:-}" = "--which" ]; then
  [ -n "$NODE" ] && printf '%s\n' "$NODE"
  exit 0
fi

if [ -z "$NODE" ]; then
  record "找不到 node（找过 REIN_NODE / Homebrew / nvm / Volta / asdf / fnm / PATH / 应用自带）——rein 这次的钩子与工具都没起来。"
  exit 0
fi

if [ "$#" -eq 0 ]; then
  record "node=$NODE 但没有指定要跑哪个脚本。"
  exit 0
fi

SCRIPT="$1"
shift

record "node=$NODE version=$("$NODE" -v 2>/dev/null || echo '?') script=$SCRIPT"
exec "$NODE" "$SCRIPT" "$@"
