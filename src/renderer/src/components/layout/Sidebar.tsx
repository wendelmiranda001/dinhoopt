import {
  Activity,
  BatteryCharging,
  Bug,
  Clapperboard,
  ClipboardCheck,
  Clock,
  CopyCheck,
  Cpu,
  Database,
  Download,
  Eraser,
  Eye,
  FileUp,
  Flame,
  FolderX,
  Gamepad2,
  Gauge,
  Globe,
  HardDrive,
  History,
  Info,
  LayoutDashboard,
  MemoryStick,
  Menu,
  MousePointerClick,
  Package,
  PackageCheck,
  PackageMinus,
  Rocket,
  Scan,
  Search,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  Sliders,
  Sparkles,
  Trash2,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import logoSrc from '@/assets/logo.png'
import { usePlatform } from '@/hooks/usePlatform'
import { cn } from '@/lib/utils'
import { useDriverStore } from '@/stores/driver-store'
import { useGameModeStore } from '@/stores/game-mode-store'
import { useUpdaterStore } from '@/stores/updater-store'
import { NavItem } from './NavItem'
import type { NavGroup, SectionColor } from './NavTypes'

const navGroups: NavGroup[] = [
  // ── Acesso rápido (pinned) ──
  {
    items: [
      { icon: LayoutDashboard, labelKey: 'dashboard', path: '/' },
      { icon: Gamepad2, labelKey: 'gameMode', path: '/game-mode', highlight: true },
      { icon: Clapperboard, labelKey: 'clips', path: '/clips', badgeLabel: 'Beta', highlight: true },
    ],
  },
  // ── Proteger ──
  {
    headingKey: 'sectionProtect',
    color: 'red',
    items: [
      { icon: ShieldAlert, labelKey: 'malwareScanner', path: '/malware' },
      {
        icon: Shield,
        labelKey: 'systemHardening',
        path: '/hardening',
        children: [
          { icon: Eye, labelKey: 'privacy', path: '/privacy' },
          { icon: Server, labelKey: 'services', path: '/services' },
          { icon: Flame, labelKey: 'firewallAudit', path: '/firewall' },
          { icon: BatteryCharging, labelKey: 'powerPlans', path: '/power-plans' },
          { icon: Globe, labelKey: 'hostsEditor', path: '/hosts-editor' },
          { icon: ClipboardCheck, labelKey: 'compliance', path: '/compliance' },
          { icon: Bug, labelKey: 'vulnerability', path: '/vulnerability' },
        ],
      },
    ],
  },
  // ── Limpar ──
  {
    headingKey: 'sectionClean',
    color: 'blue',
    items: [
      { icon: Sparkles, labelKey: 'cleaner', path: '/cleaner' },
      { icon: Database, labelKey: 'registry', path: '/registry' },
      {
        icon: Package,
        labelKey: 'software',
        path: '/updates',
        children: [
          { icon: Download, labelKey: 'softwareUpdates', path: '/updates' },
          { icon: PackageCheck, labelKey: 'appInstaller', path: '/installer' },
          { icon: Cpu, labelKey: 'driverUpdates', path: '/drivers' },
          { icon: Trash2, labelKey: 'uninstaller', path: '/uninstaller' },
          { icon: PackageMinus, labelKey: 'bloatwareRemover', path: '/debloater' },
          { icon: MousePointerClick, labelKey: 'contextMenu', path: '/context-menu' },
        ],
      },
      {
        icon: HardDrive,
        labelKey: 'diskTools',
        path: '/disk',
        children: [
          { icon: HardDrive, labelKey: 'diskAnalyzer', path: '/disk' },
          { icon: CopyCheck, labelKey: 'duplicateFinder', path: '/duplicates' },
          { icon: FileUp, labelKey: 'largeFileFinder', path: '/large-files' },
          { icon: FolderX, labelKey: 'emptyFolderCleaner', path: '/empty-folders' },
          { icon: ShieldAlert, labelKey: 'fileShredder', path: '/file-shredder' },
          { icon: Wrench, labelKey: 'diskRepair', path: '/disk-repair' },
          { icon: Eraser, labelKey: 'diskMaintenance', path: '/disk-maintenance' },
        ],
      },
    ],
  },
  // ── Otimizar ──
  {
    headingKey: 'sectionOptimize',
    color: 'green',
    items: [
      { icon: Sliders, labelKey: 'windowsTweaks', path: '/windows-tweaks' },
      { icon: MemoryStick, labelKey: 'memoryOptimizer', path: '/memory' },
      { icon: Zap, labelKey: 'startup', path: '/startup' },
      { icon: Activity, labelKey: 'performance', path: '/performance' },
      { icon: Gauge, labelKey: 'benchmark', path: '/benchmark' },
      {
        icon: Settings,
        labelKey: 'settings',
        path: '/settings',
        children: [
          { icon: Settings, labelKey: 'preferences', path: '/settings' },
          { icon: History, labelKey: 'history', path: '/history' },
          { icon: Info, labelKey: 'aboutUpdates', path: '/about' },
        ],
      },
    ],
  },
]

// ── Command Palette: Actions ─────────────────────────────
interface PaletteAction {
  id: string
  labelKey: string
  icon: typeof Shield
  group: 'actions'
  run: () => void
}

const RECENT_KEY = 'dinho-recent-pages'
const MAX_RECENT = 5

function getRecentPages(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function addRecentPage(path: string): void {
  const recent = getRecentPages().filter((p) => p !== path)
  recent.unshift(path)
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)))
}

/** Simple fuzzy score: earlier match positions and longer contiguous matches score higher */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (t === q) return 1000
  if (t.startsWith(q)) return 800
  if (t.includes(q)) return 600
  // Character-by-character subsequence match
  let qi = 0
  let score = 0
  let consecutive = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++
      consecutive++
      score += consecutive * 10
    } else {
      consecutive = 0
    }
  }
  return qi === q.length ? score : 0
}

function useBadgeCounts(): Record<string, number> {
  const updaterApps = useUpdaterStore((s) => s.apps)
  const driverUpdates = useDriverStore((s) => s.updates)
  const gameModeActive = useGameModeStore((s) => s.active)

  const updatesCount = updaterApps.length + driverUpdates.length

  return {
    '/updates': updatesCount,
    '/drivers': driverUpdates.length,
    '/game-mode': gameModeActive ? 1 : 0,
  }
}

export const Sidebar = memo(function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useTranslation('sidebar')
  const location = useLocation()
  const navigate = useNavigate()
  const badgeCounts = useBadgeCounts()
  const { features } = usePlatform()
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)

  // Auto-open submenu when current route is a child
  useEffect(() => {
    for (const group of navGroups) {
      for (const item of group.items) {
        if (item.children?.some((c) => c.path === location.pathname)) {
          setOpenSubmenu(item.path)
          return
        }
      }
    }
  }, [location.pathname])

  // biome-ignore lint/correctness/useExhaustiveDependencies: navGroups is a module-level const
  const filteredNavGroups = useMemo(
    () =>
      navGroups.map((group) => ({
        ...group,
        items: group.items
          .filter((item) => {
            if (item.path === '/registry' && !features.registry) return false
            if (item.path === '/game-mode' && !features.gameMode) return false
            if (item.path === '/clips' && !features.clips) return false
            if (item.path === '/windows-tweaks' && !features.windowsTweaks) return false
            if (item.path === '/benchmark' && !features.benchmark) return false
            return true
          })
          .map((item) => {
            if (!item.children) return item
            const filtered = item.children.filter((child) => {
              if (child.path === '/debloater' && !features.debloater) return false
              if (child.path === '/drivers' && !features.drivers) return false
              if (child.path === '/context-menu' && !features.contextMenu) return false
              if (child.path === '/firewall' && !features.firewallAudit) return false
              if (child.path === '/vulnerability' && !features.vulnerability) return false
              return true
            })
            return { ...item, children: filtered }
          })
          .filter((item) => {
            if (item.children && item.children.length === 0) return false
            return true
          }),
      })),
    [navGroups, features],
  )

  const effectiveBadgeCounts = useMemo(() => {
    const counts = { ...badgeCounts }
    for (const group of filteredNavGroups) {
      for (const item of group.items) {
        if (item.children && item.children.length > 0) {
          counts[item.path] = item.children.reduce((sum, child) => sum + (badgeCounts[child.path] ?? 0), 0)
        }
      }
    }
    return counts
  }, [badgeCounts, filteredNavGroups])

  const isPathActive = (item: { children?: { path: string }[]; path: string }) => {
    if (location.pathname === item.path) return true
    if (item.children) {
      return item.children.some((c) => c.path === location.pathname)
    }
    return false
  }

  // ── Search: flatten all pages ──
  const allPages = useMemo(() => {
    const pages: { icon: typeof Shield; labelKey: string; path: string; section: string }[] = []
    for (const group of navGroups) {
      const section = group.headingKey ? t(group.headingKey) : t('sectionQuick')
      for (const item of group.items) {
        if (item.path && item.labelKey) {
          pages.push({ icon: item.icon, labelKey: item.labelKey, path: item.path, section })
        }
        if (item.children) {
          for (const child of item.children) {
            if (child.labelKey) {
              pages.push({ icon: child.icon, labelKey: child.labelKey, path: child.path, section })
            }
          }
        }
      }
    }
    const seen = new Set<string>()
    return pages.filter((p) => {
      if (seen.has(p.path)) return false
      seen.add(p.path)
      return true
    })
  }, [t])

  // ── Actions available in the command palette ──
  const paletteActions = useMemo<PaletteAction[]>(
    () => [
      {
        id: 'quick-clean',
        labelKey: 'actionQuickClean',
        icon: Sparkles,
        group: 'actions',
        run: () => navigate('/cleaner'),
      },
      {
        id: 'scan-malware',
        labelKey: 'actionScanMalware',
        icon: ShieldAlert,
        group: 'actions',
        run: () => navigate('/malware'),
      },
      {
        id: 'check-updates',
        labelKey: 'actionCheckUpdates',
        icon: Download,
        group: 'actions',
        run: () => navigate('/updates'),
      },
      {
        id: 'game-mode',
        labelKey: 'actionGameMode',
        icon: Gamepad2,
        group: 'actions',
        run: () => navigate('/game-mode'),
      },
      {
        id: 'export-settings',
        labelKey: 'actionExportSettings',
        icon: Settings,
        group: 'actions',
        run: () => navigate('/settings'),
      },
    ],
    [navigate],
  )

  interface SearchResult {
    kind: 'page' | 'action' | 'recent'
    key: string
    icon: typeof Shield
    label: string
    path: string
    section: string
    score: number
    run?: () => void
  }

  const searchResults = useMemo<SearchResult[]>(() => {
    const q = searchQuery.trim().toLowerCase()

    // Score & filter pages
    const pageResults: SearchResult[] = allPages
      .map((p) => {
        const label = t(p.labelKey)
        const score = q ? fuzzyScore(q, label) : 500
        return {
          kind: 'page' as const,
          key: `page-${p.path}`,
          icon: p.icon,
          label,
          path: p.path,
          section: t('searchGroupPages'),
          score,
        }
      })
      .filter((r) => (q ? r.score > 0 : true))

    // Score & filter actions
    const actionResults: SearchResult[] = paletteActions
      .map((a) => {
        const label = t(a.labelKey)
        const score = q ? fuzzyScore(q, label) : 500
        return {
          kind: 'action' as const,
          key: `action-${a.id}`,
          icon: a.icon,
          label,
          path: '',
          section: t('searchGroupActions'),
          score,
          run: a.run,
        }
      })
      .filter((r) => (q ? r.score > 0 : true))

    // Recent pages (only shown when query is empty)
    const recentResults: SearchResult[] = (!q ? getRecentPages() : []).flatMap((path) => {
      const page = allPages.find((p) => p.path === path)
      if (!page) return []
      return [
        {
          kind: 'recent' as const,
          key: `recent-${path}`,
          icon: Clock,
          label: t(page.labelKey),
          path: page.path,
          section: t('searchGroupRecent'),
          score: 700,
        },
      ]
    })

    return [...recentResults, ...pageResults, ...actionResults].sort((a, b) => b.score - a.score)
  }, [searchQuery, allPages, paletteActions, t])

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    setSearchQuery('')
    setSelectedIndex(0)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchQuery('')
    setSelectedIndex(0)
  }, [])

  const navigateToResult = useCallback(
    (result: SearchResult) => {
      if (result.run) {
        result.run()
      } else {
        addRecentPage(result.path)
        navigate(result.path)
      }
      closeSearch()
    },
    [navigate, closeSearch],
  )

  // Ctrl+K / Cmd+K global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (searchOpen) closeSearch()
        else openSearch()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [searchOpen, openSearch, closeSearch])

  // Focus input when search opens
  useEffect(() => {
    if (searchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus())
    }
  }, [searchOpen])

  // Click outside to close
  useEffect(() => {
    if (!searchOpen) return
    const handler = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        closeSearch()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [searchOpen, closeSearch])

  // Keyboard navigation inside search
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeSearch()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, searchResults.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter' && searchResults[selectedIndex]) {
        navigateToResult(searchResults[selectedIndex])
      }
    },
    [closeSearch, searchResults, selectedIndex, navigateToResult],
  )

  // The first group (Acesso rápido) has no heading, render items directly
  const [quickAccessGroup, ...sectionGroups] = filteredNavGroups

  return (
    <div
      className={cn('flex h-full w-full shrink-0 flex-col')}
      style={{
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--border-medium)',
      }}
    >
      {/* ── Logo ── */}
      <div
        className={cn('drag-region relative flex items-center gap-3 px-4 pb-3 pt-4', collapsed ? 'justify-center' : '')}
      >
        {/* Purple glow behind logo */}
        <div
          className="absolute rounded-full"
          style={{
            width: '48px',
            height: '48px',
            background: 'radial-gradient(circle, rgba(168,85,247,0.45) 0%, rgba(139,92,246,0.2) 40%, transparent 70%)',
            filter: 'blur(10px)',
            animation: 'logo-glow 3s ease-in-out infinite alternate',
            ...(collapsed
              ? { left: '50%', top: '50%', marginLeft: '-24px', marginTop: '-24px' }
              : { left: '8px', top: '12px' }),
          }}
        />
        <img src={logoSrc} alt={t('appName')} className="relative h-8 w-8 shrink-0 rounded-xl" />
        {!collapsed && (
          <div>
            <div className="text-[14px] font-bold tracking-tight text-white">{t('appName')}</div>
            <div className="text-[9px] font-medium tracking-wide" style={{ color: 'var(--text-dim)' }}>
              {t('subtitle')}
            </div>
          </div>
        )}
      </div>

      {/* ── Search ── */}
      <div
        ref={searchContainerRef}
        className="relative mx-2 mb-2 overflow-hidden transition-all duration-300 will-change-transform"
        style={{ maxHeight: collapsed ? 0 : 400, opacity: collapsed ? 0 : 1 }}
      >
        {searchOpen ? (
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2"
            style={{
              background: 'var(--surface-2, rgba(255,255,255,0.06))',
              border: '1px solid var(--accent, #3b82f6)',
            }}
          >
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" strokeWidth={1.7} />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setSelectedIndex(0)
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder={t('searchPlaceholder', 'Search pages & actions...')}
              className="flex-1 bg-transparent text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600"
            />
            <button type="button" onClick={closeSearch} className="shrink-0 text-zinc-500 hover:text-zinc-300">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={openSearch}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-white/5"
            style={{
              background: 'var(--surface-2, rgba(255,255,255,0.03))',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <Scan className="h-3.5 w-3.5 text-zinc-600" strokeWidth={1.7} />
            <span className="flex-1 text-left text-[12px] text-zinc-600">{t('searchHint', 'Pesquisar...')}</span>
            <kbd
              className="rounded border px-1.5 py-0.5 text-[9px] text-zinc-600"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              ⌘K
            </kbd>
          </button>
        )}

        {/* ── Search results ── */}
        {searchOpen && searchResults.length > 0 && (
          <div
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[360px] overflow-y-auto rounded-lg py-1"
            style={{
              background: 'var(--sidebar-bg)',
              border: '1px solid var(--border-medium)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
          >
            {(() => {
              let runningIndex = 0
              let lastSection = ''
              const elements: React.ReactNode[] = []
              for (const result of searchResults) {
                if (result.section !== lastSection) {
                  lastSection = result.section
                  elements.push(
                    <div
                      key={`section-${result.section}`}
                      className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
                      style={{ color: 'var(--text-faint)' }}
                    >
                      {result.section}
                    </div>,
                  )
                }
                const Icon = result.icon
                const idx = runningIndex
                elements.push(
                  <button
                    key={result.key}
                    type="button"
                    onClick={() => navigateToResult(result)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] transition-colors',
                      idx === selectedIndex
                        ? 'bg-white/10 text-white'
                        : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
                    <span className="flex-1 truncate">{result.label}</span>
                    {result.kind === 'action' && (
                      <Rocket className="h-3 w-3 shrink-0 text-amber-500/70" strokeWidth={1.7} />
                    )}
                  </button>,
                )
                runningIndex++
              }
              return elements
            })()}
          </div>
        )}

        {searchOpen && searchQuery && searchResults.length === 0 && (
          <div
            className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg px-3 py-4 text-center text-[12px] text-zinc-600"
            style={{
              background: 'var(--sidebar-bg)',
              border: '1px solid var(--border-medium)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
          >
            {t('searchEmpty', 'Nenhum resultado')}
          </div>
        )}
      </div>

      {/* ── Scrollable nav ── */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2" aria-label={t('mainNavigation', 'Main navigation')}>
        {/* Quick access (no heading) */}
        {quickAccessGroup && (
          <div className="mb-1">
            <div className="space-y-0.5">
              {quickAccessGroup.items.map((item) => (
                <NavItem
                  key={item.path}
                  item={item}
                  badgeCount={effectiveBadgeCounts[item.path] ?? 0}
                  badgeCounts={effectiveBadgeCounts}
                  {...(item.badgeLabel ? { badgeLabel: item.badgeLabel } : {})}
                  isActive={isPathActive(item)}
                  submenuOpen={openSubmenu === item.path}
                  collapsed={collapsed}
                  sectionColor="amber"
                  onToggleSubmenu={(path: string) => setOpenSubmenu((prev) => (prev === path ? null : path))}
                  onCloseSubmenu={() => setOpenSubmenu(null)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Section groups */}
        {sectionGroups.map((group) => (
          <div
            key={group.headingKey || 'section'}
            className="mt-2"
            role="group"
            aria-labelledby={group.headingKey ? `nav-group-${group.headingKey}` : undefined}
          >
            {group.headingKey && (
              <div className={cn('flex items-center', collapsed ? 'justify-center px-0' : 'mb-1 gap-2 px-3')}>
                <div
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{
                    background:
                      group.color === 'red'
                        ? '#ef4444'
                        : group.color === 'blue'
                          ? '#3b82f6'
                          : group.color === 'green'
                            ? '#22c55e'
                            : group.color === 'purple'
                              ? '#a78bfa'
                              : '#f59e0b',
                  }}
                />
                {!collapsed && (
                  <span
                    id={`nav-group-${group.headingKey}`}
                    className="text-[10px] font-semibold uppercase tracking-[0.12em]"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    {t(group.headingKey)}
                  </span>
                )}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItem
                  key={item.path}
                  item={item}
                  badgeCount={effectiveBadgeCounts[item.path] ?? 0}
                  badgeCounts={effectiveBadgeCounts}
                  {...(item.badgeLabel ? { badgeLabel: item.badgeLabel } : {})}
                  isActive={isPathActive(item)}
                  submenuOpen={openSubmenu === item.path}
                  collapsed={collapsed}
                  sectionColor={(group.color ?? 'amber') as SectionColor}
                  onToggleSubmenu={(path: string) => setOpenSubmenu((prev) => (prev === path ? null : path))}
                  onCloseSubmenu={() => setOpenSubmenu(null)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Collapse toggle ── */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-center py-2 text-zinc-500 transition-colors hover:text-zinc-300"
        aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
      >
        <Menu className="h-4 w-4" strokeWidth={1.7} />
      </button>
    </div>
  )
})
