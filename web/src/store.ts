import type { TrajectorySnapshot } from '@pi-trajectory/shared'
import { create } from 'zustand'

interface TrajectoryStore {
  readonly snapshot: TrajectorySnapshot | null
  readonly selectedRecordId: string | null
  readonly collapsedTurns: ReadonlySet<number>
  readonly collapsedAssistants: ReadonlySet<string>
  readonly searchQuery: string
  setSnapshot(snapshot: TrajectorySnapshot | null): void
  selectRecord(recordId: string | null): void
  toggleTurn(turn: number): void
  setCollapsedTurns(turns: ReadonlySet<number>): void
  toggleAssistant(recordId: string): void
  setCollapsedAssistants(recordIds: ReadonlySet<string>): void
  setSearchQuery(query: string): void
}

export const useTrajectoryStore = create<TrajectoryStore>((set) => ({
  snapshot: null,
  selectedRecordId: null,
  collapsedTurns: new Set(),
  collapsedAssistants: new Set(),
  searchQuery: '',
  setSnapshot: (snapshot) => set({ snapshot, selectedRecordId: null, collapsedTurns: new Set(), collapsedAssistants: new Set(), searchQuery: '' }),
  selectRecord: (selectedRecordId) => set({ selectedRecordId }),
  toggleTurn: (turn) => set((state) => {
    const collapsedTurns = new Set(state.collapsedTurns)
    collapsedTurns.has(turn) ? collapsedTurns.delete(turn) : collapsedTurns.add(turn)
    return { collapsedTurns }
  }),
  setCollapsedTurns: (collapsedTurns) => set({ collapsedTurns: new Set(collapsedTurns) }),
  toggleAssistant: (recordId) => set((state) => {
    const collapsedAssistants = new Set(state.collapsedAssistants)
    collapsedAssistants.has(recordId) ? collapsedAssistants.delete(recordId) : collapsedAssistants.add(recordId)
    return { collapsedAssistants }
  }),
  setCollapsedAssistants: (collapsedAssistants) => set({ collapsedAssistants: new Set(collapsedAssistants) }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
}))
