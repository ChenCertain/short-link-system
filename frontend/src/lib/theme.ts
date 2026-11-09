import { useCallback, useEffect, useState } from 'react'

/** 用户的主题选择：未设置过即为 'system'（跟随系统） */
export type ThemeChoice = 'system' | 'light' | 'dark'
/** 实际生效的主题 */
export type ResolvedTheme = 'light' | 'dark'

// 新键：旧版会把「自动应用系统主题」的结果写进 sl_theme，无法区分用户主动选择，
// 换新键后所有人默认回到「跟随系统」。
const STORAGE_KEY = 'sl_theme_pref'
const LEGACY_KEY = 'sl_theme'
const CHANGE_EVENT = 'sl-theme-change'

function readChoice(): ThemeChoice {
  try {
    localStorage.removeItem(LEGACY_KEY)
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    /* 隐私模式下 localStorage 不可用 */
  }
  return 'system'
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

/** 解析出实际生效的主题 */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return choice
}

/** 把主题写到 <html> 上（含浏览器原生控件配色） */
export function applyResolvedTheme(theme: ResolvedTheme) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

function writeChoice(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/** 监听系统浅色/深色变化 */
function subscribeSystem(cb: (dark: boolean) => void): () => void {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
  if (!mq?.addEventListener) return () => undefined
  const handler = (event: MediaQueryListEvent) => cb(event.matches)
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}

/**
 * 主题 hook：默认跟随系统，用户显式切换后固定为该主题。
 * 多个组件同时使用时通过自定义事件保持同步。
 */
export function useTheme() {
  const [choice, setChoiceState] = useState<ThemeChoice>(readChoice)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readChoice()))

  useEffect(() => {
    applyResolvedTheme(resolved)
  }, [resolved])

  // 选择变化（含其他组件触发的变化）时重新解析
  useEffect(() => {
    const sync = () => {
      const next = readChoice()
      setChoiceState(next)
      setResolved(resolveTheme(next))
    }
    window.addEventListener(CHANGE_EVENT, sync)
    return () => window.removeEventListener(CHANGE_EVENT, sync)
  }, [])

  // 跟随系统时监听系统偏好变化
  useEffect(() => {
    if (choice !== 'system') return
    return subscribeSystem((dark) => setResolved(dark ? 'dark' : 'light'))
  }, [choice])

  const setTheme = useCallback((next: ThemeChoice) => {
    writeChoice(next)
  }, [])

  const toggle = useCallback(() => {
    writeChoice(resolveTheme(readChoice()) === 'dark' ? 'light' : 'dark')
  }, [])

  return { choice, resolved, isDark: resolved === 'dark', setTheme, toggle }
}
