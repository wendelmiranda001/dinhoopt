import type {
  DnsPreset,
  GamingTimerStatus,
  WindowsTweakApplyProgress,
  WindowsTweakResult,
  WindowsTweakState,
} from '@shared/types'
import { create } from 'zustand'

interface WindowsTweaksStoreState {
  tweaks: WindowsTweakState[]
  dnsPresets: DnsPreset[]
  selectedIds: Set<string>
  scanning: boolean
  applying: boolean
  progress: WindowsTweakApplyProgress | null
  lastResult: WindowsTweakResult | null
  revertResult: WindowsTweakResult | null
  expandedCategories: Set<string>
  gamingTimer: GamingTimerStatus | null
  gamingTimerLoading: boolean

  load: () => Promise<void>
  loadDnsPresets: () => Promise<void>
  apply: () => Promise<void>
  revert: () => Promise<void>
  toggle: (id: string) => void
  selectAll: () => void
  deselectAll: () => void
  toggleCategory: (cat: string) => void
  setDns: (primary: string, secondary?: string) => Promise<boolean>
  netshTcpApply: () => Promise<{ success: boolean; error?: string }>
  netshTcpRevert: () => Promise<{ success: boolean; error?: string }>
  loadGamingTimer: () => Promise<void>
  setGamingTimer: (
    settings: Partial<Pick<GamingTimerStatus, 'hpetOff' | 'tscSyncPolicy' | 'dynamicTickDisabled'>>,
  ) => Promise<{ success: boolean; errors: string[] }>
  revertGamingTimer: () => Promise<{ success: boolean; errors: string[] }>
  setAutoTuning: (action: 'apply' | 'revert') => Promise<{ success: boolean; error?: string }>
}

const defaultProgress: WindowsTweakApplyProgress = { current: 0, total: 0, currentTweak: '' }

export const useWindowsTweaksStore = create<WindowsTweaksStoreState>((set, get) => ({
  tweaks: [],
  dnsPresets: [],
  selectedIds: new Set(),
  scanning: false,
  applying: false,
  progress: null,
  lastResult: null,
  revertResult: null,
  expandedCategories: new Set(['mouse', 'network', 'system', 'gaming']),
  gamingTimer: null,
  gamingTimerLoading: false,

  load: async () => {
    set({ scanning: true })
    try {
      const tweaks = await window.dinho.windowsTweaksStatus()
      set({ tweaks, scanning: false })
    } catch {
      set({ scanning: false })
    }
  },

  loadDnsPresets: async () => {
    try {
      const dnsPresets = await window.dinho.windowsTweaksGetDnsPresets()
      set({ dnsPresets })
    } catch {
      /* ignore */
    }
  },

  apply: async () => {
    const { selectedIds } = get()
    if (selectedIds.size === 0) return

    set({ applying: true, progress: defaultProgress, lastResult: null })

    const cleanup = window.dinho.onWindowsTweaksApplyProgress((data) => {
      set({ progress: data })
    })

    try {
      const result = await window.dinho.windowsTweaksApply([...selectedIds])
      set({ lastResult: result, applying: false, selectedIds: new Set() })
      get().load()
    } catch {
      set({ applying: false })
    } finally {
      cleanup()
    }
  },

  revert: async () => {
    const { selectedIds } = get()
    if (selectedIds.size === 0) return

    set({ applying: true, progress: defaultProgress })

    const cleanup = window.dinho.onWindowsTweaksRevertProgress((data) => {
      set({ progress: data })
    })

    try {
      const result = await window.dinho.windowsTweaksRevert([...selectedIds])
      set({ revertResult: result, applying: false, selectedIds: new Set() })
      get().load()
    } catch {
      set({ applying: false })
    } finally {
      cleanup()
    }
  },

  toggle: (id) =>
    set((s) => {
      const sel = new Set(s.selectedIds)
      if (sel.has(id)) sel.delete(id)
      else sel.add(id)
      return { selectedIds: sel }
    }),

  selectAll: () =>
    set((s) => ({
      selectedIds: new Set(s.tweaks.filter((t) => !t.applied).map((t) => t.tweak.id)),
    })),

  deselectAll: () => set({ selectedIds: new Set() }),

  toggleCategory: (cat) =>
    set((s) => {
      const next = new Set(s.expandedCategories)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return { expandedCategories: next }
    }),

  setDns: async (primary, secondary) => {
    try {
      return await window.dinho.windowsTweaksSetDns(primary, secondary)
    } catch {
      return false
    }
  },

  netshTcpApply: async () => {
    try {
      return await window.dinho.windowsTweaksNetshTcp('apply')
    } catch {
      return { success: false, error: 'Failed to apply netsh TCP tweaks' }
    }
  },

  netshTcpRevert: async () => {
    try {
      return await window.dinho.windowsTweaksNetshTcp('revert')
    } catch {
      return { success: false, error: 'Failed to revert netsh TCP tweaks' }
    }
  },

  loadGamingTimer: async () => {
    set({ gamingTimerLoading: true })
    try {
      const gamingTimer = await window.dinho.gamingTimerGet()
      set({ gamingTimer, gamingTimerLoading: false })
    } catch {
      set({
        gamingTimer: {
          hpetOff: false,
          tscSyncPolicy: 'default',
          dynamicTickDisabled: false,
          autoTuningDisabled: false,
        },
        gamingTimerLoading: false,
      })
    }
  },

  setGamingTimer: async (settings) => {
    try {
      const result = await window.dinho.gamingTimerSet(settings)
      if (result.success) get().loadGamingTimer()
      return result
    } catch {
      return { success: false, errors: ['IPC call failed'] }
    }
  },

  revertGamingTimer: async () => {
    try {
      const result = await window.dinho.gamingTimerRevert()
      if (result.success) get().loadGamingTimer()
      return result
    } catch {
      return { success: false, errors: ['IPC call failed'] }
    }
  },

  setAutoTuning: async (action) => {
    try {
      const result = await window.dinho.gamingAutoTuning(action)
      if (result.success) get().loadGamingTimer()
      return result
    } catch {
      return { success: false, error: 'IPC call failed' }
    }
  },
}))
