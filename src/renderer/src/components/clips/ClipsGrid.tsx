import { AnimatePresence, motion } from 'framer-motion'
import {
  Clapperboard,
  Combine,
  Film,
  FolderOpen,
  Link,
  Pencil,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { ClipsState } from './useClipsState'

export function ClipsGrid({
  clipsLoaded,
  filteredClips,
  filterTab,
  setFilterTab,
  searchQuery,
  setSearchQuery,
  selectedClips,
  setSelectedClips,
  thumbnails,
  favorites,
  refreshing,
  refreshClips,
  handleDeleteSelected,
  setMergeModePaths,
  handleOpenClip,
  openClipEditor,
  openClipPlayer,
  setRenameTarget,
  handlePublishClip,
  handleCancelPublish,
  publishingPath,
  publishProgress,
  publishedLinks,
  handleDeleteClip,
  toggleFavorite,
  formatSize,
  formatDate,
  formatSeconds,
  filterTabs,
  t,
}: ClipsState) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--border-medium)' }}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          <Film className="mr-2 inline-block h-4 w-4" />
          {t('clips')}
          <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-dim)' }}>
            {t('clipCount', { count: filteredClips.length })}
          </span>
        </h3>
        <button
          type="button"
          onClick={refreshClips}
          disabled={refreshing}
          className="rounded-lg p-1.5 transition-colors hover:bg-white/5 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} style={{ color: 'var(--text-dim)' }} />
        </button>
      </div>

      {/* Filter tabs + search */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {filterTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilterTab(tab.key)}
            className="rounded-lg px-3 py-1 text-xs font-medium transition-all"
            style={{
              background: filterTab === tab.key ? 'var(--accent)' : 'rgba(113,113,122,0.1)',
              color: filterTab === tab.key ? '#fff' : 'var(--text-dim)',
            }}
          >
            {t(tab.label)}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search
            className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            style={{ color: 'var(--text-dim)' }}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search')}
            className="w-36 rounded-lg py-1.5 pl-7 pr-2 text-xs outline-none"
            style={{ background: 'rgba(113,113,122,0.1)', color: 'var(--text-primary)' }}
          />
        </div>
      </div>

      {/* Multi-select toolbar */}
      {filteredClips.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={filteredClips.length > 0 && filteredClips.every((c) => selectedClips.has(c.name))}
              onChange={() => {
                if (filteredClips.every((c) => selectedClips.has(c.name))) {
                  setSelectedClips(new Set())
                } else {
                  setSelectedClips(new Set(filteredClips.map((c) => c.name)))
                }
              }}
              className="h-3.5 w-3.5 rounded"
            />
            <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
              {selectedClips.size > 0 ? t('selectedCount', { count: selectedClips.size }) : t('selectAll')}
            </span>
          </label>
          {selectedClips.size > 0 && (
            <>
              {selectedClips.size >= 2 && (
                <button
                  type="button"
                  onClick={() => {
                    const paths = filteredClips.filter((c) => selectedClips.has(c.name)).map((c) => c.path)
                    setMergeModePaths(paths)
                  }}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-medium transition-all hover:bg-blue-500/15"
                  style={{ color: '#3b82f6' }}
                >
                  <Combine className="h-3 w-3" />
                  {t('merge')}
                </button>
              )}
              <button
                type="button"
                onClick={handleDeleteSelected}
                className="ml-auto flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-medium transition-all hover:bg-red-500/15"
                style={{ color: '#ef4444' }}
              >
                <Trash2 className="h-3 w-3" />
                {t('deleteSelected')}
              </button>
            </>
          )}
        </div>
      )}

      {/* Clip grid */}
      {!clipsLoaded ? (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders have no stable id
              key={`skel-${i}`}
              className="rounded-xl border overflow-hidden"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div className="aspect-video animate-pulse" style={{ background: 'rgba(113,113,122,0.1)' }} />
              <div className="p-2.5 space-y-1.5">
                <div className="h-3 w-3/4 rounded animate-pulse" style={{ background: 'rgba(113,113,122,0.12)' }} />
                <div className="h-2.5 w-1/2 rounded animate-pulse" style={{ background: 'rgba(113,113,122,0.08)' }} />
              </div>
            </div>
          ))}
        </div>
      ) : filteredClips.length === 0 ? (
        <p className="py-8 text-center text-sm" style={{ color: 'var(--text-dim)' }}>
          {searchQuery || filterTab !== 'all' ? t('noClips') : t('noClips')}
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          <AnimatePresence>
            {filteredClips.map((clip, index) => {
              const link = publishedLinks[clip.path]
              return (
                <motion.div
                  key={clip.name}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ delay: index * 0.03 }}
                  className="group relative rounded-xl border transition-colors hover:bg-white/5"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  {/* Selection checkbox */}
                  <div
                    className="absolute left-1.5 top-1.5 z-10 opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ opacity: selectedClips.has(clip.name) ? 1 : undefined }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedClips.has(clip.name)}
                      onChange={() => {
                        setSelectedClips((prev) => {
                          const next = new Set(prev)
                          if (next.has(clip.name)) next.delete(clip.name)
                          else next.add(clip.name)
                          return next
                        })
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="h-3.5 w-3.5 rounded"
                    />
                  </div>

                  {/* Thumbnail — click to play fullscreen */}
                  <button
                    type="button"
                    onClick={() => openClipPlayer(clip)}
                    title={t('playVideo')}
                    aria-label={t('playVideo')}
                    className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-t-xl"
                    style={{ background: 'rgba(113,113,122,0.08)' }}
                  >
                    {thumbnails[clip.name] ? (
                      <img src={thumbnails[clip.name]} alt={clip.name} className="h-full w-full object-cover" />
                    ) : (
                      <Clapperboard className="h-8 w-8" style={{ color: 'var(--text-dim)', opacity: 0.4 }} />
                    )}
                  </button>

                  {/* Info */}
                  <div className="p-2.5">
                    <p className="truncate text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      {clip.name}
                    </p>
                    <p className="mt-0.5 text-[10px]" style={{ color: 'var(--text-dim)' }}>
                      {formatSeconds(clip.duration)} &middot; {formatDate(clip.createdAt)} &middot;{' '}
                      {formatSize(clip.size)}
                    </p>
                  </div>

                  {/* Favorites star */}
                  <div className="absolute right-1.5 top-1.5 z-10 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => toggleFavorite(clip.name)}
                      className="rounded-lg p-1 transition-colors hover:bg-black/20"
                    >
                      <Star
                        className="h-3.5 w-3.5"
                        style={{
                          color: favorites.has(clip.name) ? '#facc15' : 'rgba(255,255,255,0.7)',
                          fill: favorites.has(clip.name) ? '#facc15' : 'none',
                        }}
                      />
                    </button>
                  </div>

                  {/* Bottom actions */}
                  <div
                    className="flex items-center justify-center gap-x-0.5 border-t px-1.5 py-1"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <button
                      type="button"
                      onClick={() => handleOpenClip(clip.path)}
                      title={t('open')}
                      aria-label={t('open')}
                      className="rounded-md p-1.5 transition-colors hover:bg-white/10"
                      style={{ color: 'var(--text-dim)' }}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openClipEditor(clip)}
                      title={t('edit')}
                      aria-label={t('edit')}
                      className="rounded-md p-1.5 transition-colors hover:bg-white/10"
                      style={{ color: 'var(--text-dim)' }}
                    >
                      <Film className="h-3.5 w-3.5" />
                    </button>
                    {publishingPath === clip.path ? (
                      <button
                        type="button"
                        onClick={() => handleCancelPublish(clip.path)}
                        title={t('cancelPublish')}
                        aria-label={t('cancelPublish')}
                        className="rounded-md p-1.5 transition-colors hover:bg-red-500/15"
                        style={{ color: '#ef4444' }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handlePublishClip(clip.name, clip.path)}
                        disabled={publishingPath !== null}
                        title={t('publish')}
                        aria-label={t('publish')}
                        className="rounded-md p-1.5 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ color: 'var(--text-dim)' }}
                      >
                        <Upload className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {link && (
                      <button
                        type="button"
                        onClick={() => window.dinho?.clipsOpenExternal(link)}
                        title={t('openLink')}
                        aria-label={t('openLink')}
                        className="rounded-md p-1.5 transition-colors hover:bg-cyan-500/15"
                        style={{ color: '#06b6d4' }}
                      >
                        <Link className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setRenameTarget(clip.name)}
                      title={t('rename')}
                      aria-label={t('rename')}
                      className="rounded-md p-1.5 transition-colors hover:bg-white/10"
                      style={{ color: 'var(--text-dim)' }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteClip(clip.name)}
                      title={t('delete')}
                      aria-label={t('delete')}
                      className="rounded-md p-1.5 transition-colors hover:bg-red-500/15"
                      style={{ color: '#ef4444' }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {publishingPath === clip.path && (
                    <div className="h-1 w-full" style={{ background: 'rgba(113,113,122,0.15)' }}>
                      <div
                        className="h-full transition-all duration-200"
                        style={{ width: `${Math.max(0, Math.min(100, publishProgress))}%`, background: '#06b6d4' }}
                      />
                    </div>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
