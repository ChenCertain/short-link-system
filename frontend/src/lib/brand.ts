/**
 * 站点署名与版权信息
 *
 * 本项目以 AGPL-3.0-or-later 发布，`NOTICE` 中的版权声明、作者署名与原仓库地址
 * 属于 `ADDITIONAL_TERMS.md` 要求必须保留的署名：你可以把 AUTHOR_NAME 换成自己的
 * 名字，但分发或对外提供修改版时，仍需随附 NOTICE 并保留原项目署名与仓库地址。
 */

/** 作者 / 团队名称，显示在各页面页脚 */
export const AUTHOR_NAME = 'ChenCertain'

/** 页脚版权行：年份自动取当前时间，并标注实际许可协议 */
export function copyrightText(): string {
  return `Copyright © ${new Date().getFullYear()} ${AUTHOR_NAME} · Licensed under AGPL-3.0-or-later`
}
