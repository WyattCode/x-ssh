import type { Host } from '../../../shared/types'

/** 主机的「环境」标签:来自分组,没有分组就看标签里有没有明显的环境词。
 *  生产类用醒目的暖色,其余用中性色——设计稿里生产环境是唯一需要提醒的那一种。 */
export interface HostEnv {
  label: string
  prod: boolean
}

const PROD_RE = /^(生产|正式|线上|prod|production|live)(环境)?$/i
const ENV_RE = /^(生产|正式|线上|测试|预发|预生产|开发|本地|prod|production|live|staging|stage|test|testing|qa|uat|dev|development|local)(环境)?$/i

export function envLabel(text: string | undefined): HostEnv | null {
  const s = text?.trim()
  if (!s) return null
  return { label: s, prod: PROD_RE.test(s) }
}

export function hostEnv(h: Pick<Host, 'group' | 'tags'> | undefined): HostEnv | null {
  if (!h) return null
  const fromGroup = envLabel(h.group)
  if (fromGroup) return fromGroup
  const tag = (h.tags ?? []).find((t) => ENV_RE.test(t.trim()))
  return envLabel(tag)
}
