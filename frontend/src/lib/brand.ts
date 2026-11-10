/**
 * 站点署名与版权信息
 *
 * 如果你想把这个系统部署成自己的产品，改这里即可（页脚、首页、登录页会一起生效），
 * 无需逐个文件搜索替换。署名不是硬性要求，按自己的使用场景决定。
 */

/** 作者 / 团队名称，显示在各页面页脚 */
export const AUTHOR_NAME = 'ChenCertain'

/** 页脚版权行，年份自动取当前时间 */
export function copyrightText(): string {
  return `Copyright © ${new Date().getFullYear()} ${AUTHOR_NAME}. All Rights Reserved.`
}
