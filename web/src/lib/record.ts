import type { TrajectoryRecord, TrajectoryRecordKind } from '@pi-trajectory/shared'

const labels: Record<TrajectoryRecordKind, string> = {
  system: 'SYSTEM', user: 'USER', context: 'CONTEXT', compacted: 'COMPACT', message: 'ASSISTANT', tool: 'TOOL', subtool: 'SUBTOOL', steering: 'STEER', 'model-change': 'MODEL', 'thinking-change': 'THINK', bash: 'BASH', 'branch-summary': 'BRANCH', error: 'ERROR',
}

export function kindLabel(kind: TrajectoryRecordKind): string {
  return labels[kind]
}

export function recordTone(record: TrajectoryRecord): 'input' | 'model' | 'tool' | 'change' | 'error' {
  if (record.kind === 'tool' || record.kind === 'subtool' || record.kind === 'bash') return 'tool'
  if (record.kind === 'message') return 'model'
  if (record.kind === 'error' || record.isError === true) return 'error'
  if (record.kind === 'model-change' || record.kind === 'thinking-change' || record.kind === 'compacted' || record.kind === 'branch-summary') return 'change'
  return 'input'
}

export function formatTokens(tokens: number | undefined): string {
  return tokens === undefined ? '—' : new Intl.NumberFormat().format(tokens)
}

export function formatCost(cost: number | undefined): string {
  return cost === undefined ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(cost)
}

export function formatTimestamp(timestamp: number | null | undefined): string {
  return timestamp === null || timestamp === undefined || timestamp === 0 ? 'Not recorded' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(timestamp)
}

export function systemRecordLabel(record: TrajectoryRecord): string {
  if (record.kind !== 'system' || record.previousPromptAnatomy === undefined) return 'Initial System Prompt'
  const promptChanged = record.promptAnatomy?.prompt !== record.previousPromptAnatomy.prompt
  const toolsChanged = JSON.stringify(record.promptAnatomy?.tools ?? []) !== JSON.stringify(record.previousPromptAnatomy.tools ?? [])
  if (promptChanged && toolsChanged) return 'System Prompt and Tools Updated'
  if (promptChanged) return 'System Prompt Updated'
  if (toolsChanged) return 'Tools Updated'
  return 'Initial System Prompt'
}

export function prettyJson(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try { return JSON.stringify(JSON.parse(value) as unknown, null, 2) } catch { return value }
}
