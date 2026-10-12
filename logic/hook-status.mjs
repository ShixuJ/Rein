// 「钩子还在不在跑」的判据。纯函数，不碰文件。
//
// 钩子在每次提问时刷新会话标记（见 store.mjs 的 writeSessionMarker）。而工具调用总是发生在
// 某一轮里，那一轮开始前钩子就该跑过一次——所以标记很旧、或者压根没有，就说明钩子大概率
// 没在运行。最常见的两处原因：装完没重启 app、重装/升级后没重新过信任。
//
// 只判新鲜度，不做别的；提示文案由调用方拼。阈值给得宽松（15 分钟）：一轮跑很久也不会误报。

export const HOOK_STALE_MS = 15 * 60 * 1000;

/**
 * marker（store.readSessionMarker 的返回值）→ `{ lastRunAt, ageMs, recent }`。
 * 读不出时间时三项都退化成 null / false。
 */
export function hookFreshness(marker, { now = Date.now(), staleMs = HOOK_STALE_MS } = {}) {
  const at = marker?.at ? Date.parse(marker.at) : NaN;
  if (!Number.isFinite(at)) return { lastRunAt: null, ageMs: null, recent: false };

  const ageMs = now - at;
  return { lastRunAt: new Date(at).toISOString(), ageMs, recent: ageMs <= staleMs };
}

/** 毫秒 → 「刚刚 / 42 分钟 / 3 小时 / 5 天」。 */
export function humanAgo(ms) {
  const seconds = Math.max(0, Math.round(Number(ms) / 1000));
  if (seconds < 90) return "刚刚";

  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} 分钟`;

  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} 小时`;

  return `${Math.round(hours / 24)} 天`;
}
