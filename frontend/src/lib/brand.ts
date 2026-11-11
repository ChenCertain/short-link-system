/**
 * 站点署名与版权信息
 *
 * 作者署名、版权行与源码仓库地址集中在此处维护。
 */

/** 作者 / 团队名称，显示在各页面页脚 */
export const AUTHOR_NAME = 'ChenCertain'

/** 源码仓库地址，页脚通过 <SourceLink /> 展示 */
export const SOURCE_URL = 'https://github.com/ChenCertain/short-link-system'

/** 页脚版权行：年份自动取当前时间，并标注实际许可协议 */
export function copyrightText(): string {
  return `Copyright © ${new Date().getFullYear()} ${AUTHOR_NAME} · Licensed under AGPL-3.0-or-later`
}