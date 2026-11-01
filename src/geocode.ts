import type { Config } from './config.js'
import { fetchBytes, publicHttpsUrl } from './http.js'
import { cleanText } from './metadata.js'

export interface LocationResult {
  address?: string
  source?: string
  note?: string
}

/** A failed lookup must never discard the coordinates or other image metadata. */
export async function reverseGeocode(gps: { latitude: number; longitude: number }, config: Config, signal: AbortSignal): Promise<LocationResult> {
  const candidates: Array<{ type: 'relay' | 'bdc'; endpoint: string }> = []
  if (config.geo_relay_url) candidates.push({ type: 'relay', endpoint: config.geo_relay_url })
  if (config.bigdatacloud_key) candidates.push({ type: 'bdc', endpoint: 'https://api-bdc.net/data/reverse-geocode' })
  if (!candidates.length) return { note: '未配置地址查询服务，已显示照片中的 GPS 坐标。' }
  for (const candidate of candidates) {
    if (signal.aborted) break
    try {
      const url = publicHttpsUrl(candidate.endpoint)
      const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'QFlareBot-ImageInfo/0.1.0' }
      if (candidate.type === 'relay') {
        url.searchParams.set('lat', String(gps.latitude))
        url.searchParams.set('lon', String(gps.longitude))
        url.searchParams.set('format', 'jsonv2')
        url.searchParams.set('accept-language', 'zh-CN')
        url.searchParams.set('zoom', '18')
        if (config.geo_relay_token) headers.Authorization = `Bearer ${config.geo_relay_token}`
      } else {
        url.searchParams.set('latitude', String(gps.latitude))
        url.searchParams.set('longitude', String(gps.longitude))
        url.searchParams.set('localityLanguage', 'zh')
        url.searchParams.set('key', config.bigdatacloud_key)
      }
      const bytes = await fetchBytes(url, { maxBytes: 64 * 1024, timeoutMs: config.request_timeout_ms, signal, headers })
      const result: unknown = JSON.parse(new TextDecoder().decode(bytes))
      if (!result || typeof result !== 'object' || Array.isArray(result)) continue
      const data = result as Record<string, unknown>
      if (data.error || data.errorMessage) continue
      if (candidate.type === 'relay') {
        const address = cleanText(data.address, 400) || cleanText(data.display_name, 400)
        if (address) return { address, source: cleanText(data.attribution, 180) || cleanText(data.licence, 180) || '自定义地址接口' }
      } else {
        const address = [...new Set(['countryName', 'principalSubdivision', 'city', 'locality', 'postcode']
          .map(key => cleanText(data[key], 100)).filter(Boolean))].join(' · ')
        if (address) return { address, source: 'BigDataCloud（城市 / 行政区）' }
      }
    } catch {
      // Do not log upstream errors: URLs may contain API keys or precise coordinates.
    }
  }
  return { note: '地址查询失败或超时，已保留 GPS 坐标。' }
}
