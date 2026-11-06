/** 展示格式化：金额始终整数分，展示保留 2 位小数 */

export function money(cents: number | null | undefined): string {
  return `¥${(((cents ?? 0) as number) / 100).toFixed(2)}`;
}

export function formatDate(value?: string | Date | null, withTime = false): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (!withTime) return day;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 倒计时文案：距离支付截止还剩多少 */
export function countdown(deadline: string | Date, now = Date.now()): string {
  const left = new Date(deadline).getTime() - now;
  if (left <= 0) return '已超时';
  const minutes = Math.floor(left / 60000);
  const seconds = Math.floor((left % 60000) / 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** 规格对象 → 「颜色 / 尺码」 */
export function specText(spec: Record<string, string> | null | undefined): string {
  if (!spec) return '';
  return Object.values(spec).filter(Boolean).join(' / ');
}
