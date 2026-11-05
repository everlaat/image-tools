/** Human-readable byte size, e.g. "114.5 MB". Decimal units, as vendors quote. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB'];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log10(bytes) / 3),
  );
  const value = bytes / 1000 ** exponent;
  const unit = units[exponent] ?? 'B';
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${unit}`;
}

export function formatPercent(loaded: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((loaded / total) * 100));
}
