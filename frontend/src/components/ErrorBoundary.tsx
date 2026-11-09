import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * 全局错误边界：任何页面渲染异常时展示兜底界面，
 * 避免出现整站白屏且没有任何提示。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('页面渲染异常:', error, info.componentStack)
  }

  private handleReload = () => {
    window.location.reload()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
        <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">页面加载失败</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            页面渲染时发生错误，请刷新重试。若持续出现，请联系管理员。
          </p>
          <p className="mt-3 break-all rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-400 dark:bg-gray-800/60">
            {error.message}
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <button
              onClick={this.handleReload}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              重新加载
            </button>
            <a
              href="/"
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              返回首页
            </a>
          </div>
        </div>
      </div>
    )
  }
}
