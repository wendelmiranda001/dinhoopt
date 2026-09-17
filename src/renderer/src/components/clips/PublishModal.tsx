import { Copy, ExternalLink, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface PublishModalProps {
  link: string
  onClose: () => void
}

export default function PublishModal({ link, onClose }: PublishModalProps) {
  const { t } = useTranslation('clips')
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      toast.success(t('copied'))
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
      }
      timerRef.current = window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('copyFailed'))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85">
      <div aria-hidden="true" className="absolute inset-0" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('publishDone')}
        className="relative w-full max-w-md rounded-xl border shadow-2xl p-6"
        style={{ background: '#111318', borderColor: 'var(--border-medium)' }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {t('publishDone')}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          {t('publishLinkLabel')}
        </p>
        <div
          className="mt-2 flex items-center gap-2 rounded-lg border px-3 py-2"
          style={{ borderColor: 'var(--border-medium)', background: 'rgba(0,0,0,0.2)' }}
        >
          <span className="flex-1 truncate text-xs" style={{ color: 'var(--text-primary)' }}>
            {link}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] transition-colors hover:bg-white/10"
            style={{ color: copied ? '#22c55e' : 'var(--text-dim)' }}
          >
            <Copy className="h-3 w-3" />
            {copied ? t('copied') : t('copy')}
          </button>
        </div>

        <div
          className="mt-2 flex items-center gap-2 rounded-lg border px-3 py-2"
          style={{ borderColor: 'rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.06)' }}
        >
          <span className="text-xs" style={{ color: '#f59e0b' }}>
            {t('expiryWarning')}
          </span>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              window.dinho?.clipsOpenExternal(link)
            }}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs transition-colors hover:bg-white/10"
            style={{ color: 'var(--text-secondary)' }}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('openLink')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90"
            style={{ background: '#06b6d4' }}
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}
