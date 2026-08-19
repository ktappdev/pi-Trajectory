import type { TrajectoryRecord } from '@pi-trajectory/shared'

export class TrajectorySearchIndex {
  private records: readonly TrajectoryRecord[] = []
  private normalized = new Map<string, string>()

  update(records: readonly TrajectoryRecord[]): void {
    this.records = records
    const activeIds = new Set(records.map((record) => record.recordId))
    for (const id of this.normalized.keys()) if (!activeIds.has(id)) this.normalized.delete(id)
  }

  search(query: string): ReadonlySet<string> | null {
    const needle = normalize(query)
    if (needle.length === 0) return null
    return new Set(this.records.filter((record) => this.text(record).includes(needle)).map((record) => record.recordId))
  }

  private text(record: TrajectoryRecord): string {
    const cached = this.normalized.get(record.recordId)
    if (cached !== undefined) return cached
    const value = normalize([record.kind, record.summary, record.toolName, record.inputDetail, record.outputDetail, record.thinkingDetail, record.provider, record.model].filter((part): part is string => part !== undefined).join('\n'))
    this.normalized.set(record.recordId, value)
    return value
  }
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}
