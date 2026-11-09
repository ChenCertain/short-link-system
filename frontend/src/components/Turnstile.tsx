import { useEffect, useRef } from 'react'

interface TurnstileProps {
  siteKey?: string
  onToken: (token: string) => void
  onExpire?: () => void
  resetKey?: number | string
  theme?: 'light' | 'dark' | 'auto'
}

export function Turnstile({ siteKey, onToken, onExpire, resetKey, theme = 'auto' }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!siteKey) return
    let cancelled = false

    const render = () => {
      if (cancelled || !containerRef.current) return
      if (!window.turnstile) return
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

    // 脚本可能尚未加载完成，轮询等待
    let attempts = 0
    const timer = window.setInterval(() => {
      if (window.turnstile) {
        window.clearInterval(timer)
        render()
      } else if (++attempts > 100) {
        window.clearInterval(timer)
      }
    }, 100)

    if (window.turnstile) {
      window.clearInterval(timer)
      render()
    }

    return () => {
      cancelled = true
      window.clearInterval(timer)
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
