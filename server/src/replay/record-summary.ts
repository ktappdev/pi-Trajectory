/**
 * Single-line summaries for each trajectory record kind.
 *
 * These appear in the ledger cell (the `text` column) and are kept short:
 * CSS truncation preserves the available preview width.
 */
import type { TrajectoryRecordKind } from '@pi-trajectory/shared'

type SummaryInput =
  | { kind: 'user'; text: string }
  | { kind: 'context'; text: string; customType?: string }
  | { kind: 'message'; text: string; isError: boolean; errorMessage?: string }
  | { kind: 'tool'; toolName: string; args: unknown; result: string; isError: boolean }
  | { kind: 'compacted'; tokensBefore: number; summary: string }
  | { kind: 'branch-summary'; summary: string }
  | { kind: 'bash'; command: string; exitCode: number | undefined; cancelled: boolean }
  | { kind: 'model-change'; provider: string; modelId: string }
  | { kind: 'thinking-change'; level: string }
  | { kind: 'system'; sections?: readonly { label: string }[]; tools?: readonly { name: string }[] }

const MAX_SUMMARY = 160

function truncate(text: string, max = MAX_SUMMARY): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max - 1)}…`
}

/** Summarize a record for the ledger cell. */
export function summarizeRecord(input: SummaryInput): string {
  switch (input.kind) {
    case 'user':
      return truncate(input.text) || '(empty user message)'

    case 'context':
      return truncate(input.customType ? `[${input.customType}] ${input.text}` : input.text)

    case 'message':
      if (input.isError) {
        return truncate(`⚠ ${input.errorMessage ?? 'assistant error'}`)
      }
      return truncate(input.text) || '(empty assistant message)'

    case 'tool': {
      const argsPreview = input.args !== undefined ? ` ${JSON.stringify(input.args)}` : ''
      const arrow = input.isError ? ' ✕→' : ' →'
      const resultPreview = truncate(input.result, 80)
      return truncate(`${input.toolName}${argsPreview}${arrow} ${resultPreview}`)
    }

    case 'compacted':
      return `Compacted ${(input.tokensBefore ?? 0).toLocaleString('en-US')} tokens`

    case 'branch-summary':
      return truncate(`Branch summary: ${input.summary}`)

    case 'bash': {
      const status = input.cancelled ? ' (cancelled)' : input.exitCode !== undefined ? ` (exit ${input.exitCode})` : ''
      return truncate(`$ ${input.command}${status}`)
    }

    case 'model-change':
      return `Model → ${input.provider}/${input.modelId}`

    case 'thinking-change':
      return `Thinking → ${input.level}`

    case 'system': {
      const sectionCount = input.sections?.length ?? 0
      const toolCount = input.tools?.length ?? 0
      return `System prompt${sectionCount > 0 ? ` · ${sectionCount} sections` : ''}${toolCount > 0 ? ` · ${toolCount} tools` : ''}`
    }
  }
}

/** Kind display label for the ledger's kind column. */
export function kindLabel(kind: TrajectoryRecordKind): string {
  switch (kind) {
    case 'system': return 'SYSTEM'
    case 'user': return 'USER'
    case 'context': return 'CONTEXT'
    case 'compacted': return 'COMPACTED'
    case 'message': return 'ASSISTANT'
    case 'tool': return 'TOOL'
    case 'subtool': return 'SUBTOOL'
    case 'steering': return 'STEER'
    case 'model-change': return 'MODEL'
    case 'thinking-change': return 'THINK'
    case 'bash': return 'BASH'
    case 'branch-summary': return 'BRANCH'
    case 'error': return 'ERROR'
  }
}
