import { useEffect, useRef } from 'react'

interface TurnstileProps {
  siteKey?: string
  onToken: (token: string) => void
  onExpire?: () => void
  resetKey?: number | string
  theme?: 'light' | 'dark' | 'auto'
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise: Promise<void> | null = null

// 仅在真正需要人机验证时按需加载脚本，避免每次访问都请求第三方资源
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile]')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Turnstile script load failed')))
      return
    }
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.dataset.turnstile = '1'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Turnstile script load failed'))
    document.head.appendChild(script)
  })

  return scriptPromise
}

export function Turnstile({ siteKey, onToken, onExpire, resetKey, theme = 'auto' }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!siteKey) return
    let cancelled = false

    const render = () => {
      if (cancelled || !containerRef.current || !window.turnstile) return
      // 清理旧 widget
      if (widgetIdRef.current) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // ignore
        }
        widgetIdRef.current = null
      }
      containerRef.current.innerHTML = ''
      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme,
          language: 'zh-cn',
          callback: (token: string) => onToken(token),
          'expired-callback': () => {
            onToken('')
            onExpire?.()
          },
          'error-callback': () => onToken(''),
        })
      } catch (err) {
        console.error('Turnstile render failed', err)
      }
    }

    loadTurnstileScript()
      .then(render)
      .catch((err) => console.error('Turnstile unavailable', err))

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // ignore
        }
        widgetIdRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, resetKey, theme])

  if (!siteKey) return null

  return <div ref={containerRef} className="cf-turnstile flex justify-center" />
}
