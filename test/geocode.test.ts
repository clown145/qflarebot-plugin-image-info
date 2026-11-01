import { describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '../src/config.js'
import { reverseGeocode } from '../src/geocode.js'

const gps = { latitude: 0, longitude: 0 }
const signal = () => new AbortController().signal

describe('reverse geocoding', () => {
  it('does not contact a public service without configuration', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await reverseGeocode(gps, defaultConfig, signal())).toMatchObject({ note: expect.stringContaining('未配置') })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('passes exact coordinates and the relay token separately', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ address: '测试地址', attribution: '测试数据' }))
    vi.stubGlobal('fetch', fetch)
    const result = await reverseGeocode(gps, { ...defaultConfig, geo_relay_url: 'https://geo.example.com/reverse?existing=yes', geo_relay_token: 'secret' }, signal())
    expect(result).toEqual({ address: '测试地址', source: '测试数据' })
    const [url, init] = fetch.mock.calls[0]!
    expect(url.searchParams.get('lat')).toBe('0')
    expect(url.searchParams.get('lon')).toBe('0')
    expect(url.searchParams.get('existing')).toBe('yes')
    expect(url.href).not.toContain('secret')
    expect(init.headers.Authorization).toBe('Bearer secret')
  })
  it('reads Nominatim-compatible names and attribution', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ display_name: '某街道', licence: '© OpenStreetMap contributors', address: { road: '某街道' } })))
    expect(await reverseGeocode(gps, { ...defaultConfig, geo_relay_url: 'https://geo.example.com/reverse' }, signal()))
      .toEqual({ address: '某街道', source: '© OpenStreetMap contributors' })
  })
  it.each(['http', 'json', 'empty'])('falls back after relay %s failure to the server-side BigDataCloud API', async failure => {
    const first = failure === 'http' ? new Response('', { status: 503 }) : failure === 'json' ? new Response('not json') : Response.json({})
    const fetch = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(Response.json({ countryName: '国家', city: '城市', locality: '城市' }))
    vi.stubGlobal('fetch', fetch)
    const result = await reverseGeocode(gps, { ...defaultConfig, geo_relay_url: 'https://geo.example.com/', geo_relay_token: 'relay-only', bigdatacloud_key: 'bdc-only' }, signal())
    expect(result.address).toBe('国家 · 城市')
    const [url, init] = fetch.mock.calls[1]!
    expect(url.origin + url.pathname).toBe('https://api-bdc.net/data/reverse-geocode')
    expect(url.searchParams.get('key')).toBe('bdc-only')
    expect(init.headers.Authorization).toBeUndefined()
  })
  it('does not expose upstream credentials in errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed at https://api.example.com?key=PRIVATE')))
    const result = await reverseGeocode(gps, { ...defaultConfig, bigdatacloud_key: 'PRIVATE' }, signal())
    expect(result.note).toContain('查询失败')
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })
  it('does not start a lookup after cancellation', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await reverseGeocode(gps, { ...defaultConfig, bigdatacloud_key: 'key' }, AbortSignal.abort())
    expect(fetch).not.toHaveBeenCalled()
  })
})
