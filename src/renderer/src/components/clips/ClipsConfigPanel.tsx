import { AnimatePresence, motion } from 'framer-motion'
import { FolderOpen, Gamepad2, HardDrive, Mic, Video } from 'lucide-react'
import { AudioSection } from './ClipsConfigAudio'
import { GameSection, ProcessPicker } from './ClipsConfigGame'
import { QualitySection, TipBadge } from './ClipsConfigQuality'
import { ConfigSection } from './clips-utils'
import type { ClipsState } from './useClipsState'

export function ClipsConfigPanel({
  showConfig,
  config,
  status,
  activeTip,
  setActiveTip,
  rebindingId,
  setRebindingId,
  gpuList,
  micDevices,
  loadingMicDevices,
  estimatedRamMB,
  processes,
  procSearch,
  setProcSearch,
  showProcPicker,
  setShowProcPicker,
  handleConfigUpdate,
  handleSelectOutputDir,
  addHotkey,
  removeHotkey,
  updateHotkey,
  handleOpenClip,
  setProcesses,
  t,
}: ClipsState) {
  return (
    <AnimatePresence>
      {showConfig && config && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 380, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="overflow-x-hidden overflow-y-visible shrink-0 will-change-transform"
        >
          <div className="w-[380px] space-y-3">
            {/* Output Directory */}
            <div
              className="relative overflow-hidden rounded-2xl border px-4 py-3"
              style={{
                background: `linear-gradient(180deg, rgba(139,92,246,0.06), transparent 60%), var(--card-bg)`,
                borderColor: 'var(--border-medium)',
              }}
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />
              <div className="flex items-center gap-2 text-xs">
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
                  style={{ background: 'rgba(139,92,246,0.14)', color: '#a78bfa' }}
                >
                  <HardDrive className="h-3.5 w-3.5" />
                </span>
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[11px]"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {config.outputDirectory}
                </span>
                <button
                  type="button"
                  onClick={handleSelectOutputDir}
                  className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/10"
                  style={{ color: 'var(--text-dim)' }}
                >
                  {t('chooseOutputDir')}
                </button>
                <button
                  type="button"
                  onClick={() => handleOpenClip(config.outputDirectory)}
                  className="shrink-0 rounded-md p-1 transition-colors hover:bg-white/10"
                  title={t('openFolder')}
                >
                  <FolderOpen className="h-3.5 w-3.5" style={{ color: 'var(--text-dim)' }} />
                </button>
              </div>
            </div>

            {/* Quality Section */}
            <ConfigSection
              icon={Video}
              label={
                <span className="flex items-center gap-1">
                  {t('recordingQuality')}
                  <TipBadge id="quality" activeTip={activeTip} setActiveTip={setActiveTip} />
                </span>
              }
              defaultOpen={true}
              content={
                <QualitySection
                  config={config}
                  status={status}
                  activeTip={activeTip}
                  setActiveTip={setActiveTip}
                  gpuList={gpuList}
                  estimatedRamMB={estimatedRamMB}
                  handleConfigUpdate={handleConfigUpdate}
                  t={t}
                />
              }
            />

            {/* Audio Section */}
            <ConfigSection
              icon={Mic}
              label={t('audio')}
              defaultOpen={true}
              content={
                <AudioSection
                  config={config}
                  status={status}
                  activeTip={activeTip}
                  setActiveTip={setActiveTip}
                  rebindingId={rebindingId}
                  setRebindingId={setRebindingId}
                  micDevices={micDevices}
                  loadingMicDevices={loadingMicDevices}
                  handleConfigUpdate={handleConfigUpdate}
                  t={t}
                />
              }
            />

            {/* Game Detection Section */}
            <ConfigSection
              icon={Gamepad2}
              label={t('gameDetection')}
              defaultOpen={true}
              content={
                <GameSection
                  config={config}
                  status={status}
                  rebindingId={rebindingId}
                  setRebindingId={setRebindingId}
                  handleConfigUpdate={handleConfigUpdate}
                  addHotkey={addHotkey}
                  removeHotkey={removeHotkey}
                  updateHotkey={updateHotkey}
                  setProcesses={setProcesses}
                  setShowProcPicker={setShowProcPicker}
                  t={t}
                />
              }
            />

            {/* Process Picker Modal */}
            {showProcPicker && (
              <ProcessPicker
                procSearch={procSearch}
                setProcSearch={setProcSearch}
                processes={processes}
                onSelect={(name) => {
                  handleConfigUpdate({ customGameProcess: name })
                  setShowProcPicker(false)
                  setProcSearch('')
                }}
                onClose={() => setShowProcPicker(false)}
                t={t}
              />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
