import type { StructuredTaskDraft } from '../../../services/app-service'

type Item = StructuredTaskDraft['items'][number]

/** Equal weights use hundredths so the last item absorbs rounding. */
export function defaultItemWeights(items: readonly Item[]): number[] {
  if (!items.length) return []
  const base = Math.floor(10000 / items.length)
  return items.map((_, index) => index === items.length - 1
    ? (10000 - base * (items.length - 1)) / 100 : base / 100)
}

export function itemWeightLabels(items: readonly Item[]): string[] {
  const defaults = defaultItemWeights(items)
  return items.map((item, index) => String(item.weightPercent ?? defaults[index] ?? 0))
}

export function updateItemWeight(items: readonly Item[], itemId: string, raw: string): Item[] | null {
  const input = raw.trim()
  const value = Number(input)
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(input) || !Number.isFinite(value)
    || value <= 0 || value > 100 || !items.some(item => item.id === itemId)) return null
  const defaults = defaultItemWeights(items)
  return items.map((item, index) => ({ ...item,
    weightPercent: item.id === itemId ? value : item.weightPercent ?? defaults[index] }))
}

export function itemWeightError(items: readonly Item[]): string | null {
  if (items.every(item => item.weightPercent === undefined)) return null
  if (items.some(item => item.weightPercent === undefined || !Number.isFinite(item.weightPercent)
    || item.weightPercent <= 0 || item.weightPercent > 100)) return '请为每项设置有效的计分权重'
  const total = items.reduce((sum, item) => sum + item.weightPercent!, 0)
  return Math.abs(total - 100) < 0.000001 ? null : `计分权重合计须为 100%，当前为 ${Number(total.toFixed(2))}%`
}
