import { SOURCE_URL } from '@/lib/brand'

/**
 * 源码入口
 *
 * AGPL-3.0-or-later 第 13 条：以网络服务方式让远程用户与本程序交互时，
 * 必须向这些用户提供获取对应源码的途径。该链接因此常驻在各页面页脚，
 * 任何修改版都应保留或替换为自己实际运行的源码地址，而不是直接删除。
 */
export function SourceLink() {
  return (
    <a
      href={SOURCE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-gray-300 underline-offset-2 transition-colors hover:text-gray-600 dark:decoration-gray-700 dark:hover:text-gray-300"
    >
      源代码
    </a>
  )
}
