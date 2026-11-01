import { describe, expect, it, vi } from 'vitest'
import { runCommand } from '@qqbot/sdk/testing'
import plugin from '../src/index.js'
import { defaultConfig, resolveConfig } from '../src/config.js'
import { inspectImage } from '../src/metadata.js'
import { renderHtml, renderText } from '../src/report.js'
import { fixture } from './fixtures.js'

const attachment = { url: 'https://cdn.example.com/current.jpg', contentType: 'image/jpeg' }

describe('image-info command', () => {
  it('explains how to supply an image', async () => {
    expect((await runCommand(plugin, '解析')).replies[0]).toContain('引用图片')
  })
  it('prefers a quoted image and handles aliases', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(await fixture('gps.jpg')))
    vi.stubGlobal('fetch', fetch)
    const result = await runCommand(plugin, '图片信息', '', {
      session: { attachments: [attachment], quote: { attachments: [{ ...attachment, url: 'https://cdn.example.com/quoted.jpg' }] } },
    })
    expect(fetch.mock.calls[0]?.[0].href).toBe('https://cdn.example.com/quoted.jpg')
    expect(result.replies[0]).toContain('35.500000')
    expect(result.replies[0]).toContain('未配置地址查询服务')
  })
  it('uses the current image if the quote contains no attachments', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(await fixture('plain.jpg')))
    vi.stubGlobal('fetch', fetch)
    await runCommand(plugin, '解析', '', { session: { attachments: [attachment], quote: { content: '文字' } } })
    expect(fetch.mock.calls[0]?.[0].href).toBe(attachment.url)
  })
  it('avoids network requests when the platform reports an oversized file', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const result = await runCommand(plugin, '解析', '', { session: { attachments: [{ ...attachment, size: 20 * 1024 * 1024 }] } })
    expect(result.replies[0]).toContain('超过 4 MiB')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('renders an image through the optional T2I service', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(await fixture('gps.png'))))
    const renderUrl = vi.fn().mockResolvedValue({ url: 'https://render.example.com/card.png' })
    const result = await runCommand(plugin, '解析', '', { session: { attachments: [attachment] }, ctx: { services: { t2i: { renderUrl } } } })
    expect(result.replies).toEqual([{ image: { url: 'https://render.example.com/card.png' } }])
    expect(renderUrl.mock.calls[0]?.[0]).toContain('Test Camera')
    expect(renderUrl.mock.calls[0]?.[1]).toMatchObject({ fullPage: true, timeoutMs: 8000 })
  })
  it.each(['failed', 'invalid-url'])('keeps text when T2I returns %s', async reason => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(await fixture('gps.jpg'))))
    const renderUrl = reason === 'failed' ? vi.fn().mockRejectedValue(new Error('unavailable')) : vi.fn().mockResolvedValue({ url: '' })
    const result = await runCommand(plugin, '解析', '', { session: { attachments: [attachment] }, ctx: { services: { t2i: { renderUrl } } } })
    expect(result.replies[0]).toContain('139.750000')
  })
  it('keeps GPS if all address queries fail', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(await fixture('gps.jpg'))).mockResolvedValueOnce(new Response('', { status: 500 }))
    vi.stubGlobal('fetch', fetch)
    const result = await runCommand(plugin, '解析', '', { session: { attachments: [attachment] }, ctx: { config: { ...defaultConfig, geo_relay_url: 'https://geo.example.com/' } } })
    expect(result.replies[0]).toContain('35.500000')
    expect(result.replies[0]).toContain('地址查询失败')
  })
  it('does not call geocoding without GPS or rendering in text mode', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(await fixture('plain.png')))
    vi.stubGlobal('fetch', fetch)
    const renderUrl = vi.fn()
    const result = await runCommand(plugin, '解析', '', { session: { attachments: [attachment] }, ctx: { config: { ...defaultConfig, output_mode: 'text' as const, geo_relay_url: 'https://geo.example.com/' }, services: { t2i: { renderUrl } } } })
    expect(result.replies[0]).toContain('未读取到有效 GPS')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(renderUrl).not.toHaveBeenCalled()
  })
  it('does not expose download error URLs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private-token')))
    const result = await runCommand(plugin, '解析', '', { session: { attachments: [attachment] } })
    expect(result.replies[0]).toContain('图片解析失败')
    expect(result.replies[0]).not.toContain('private-token')
  })
})

describe('report safety and configuration', () => {
  it('escapes all untrusted content and uses no remote image or script in the card', async () => {
    const info = await inspectImage(await fixture('gps.jpg'))
    info.fields.push(['<svg>', '<script>alert(1)</script>'])
    const html = renderHtml(info, { address: '<img src="https://evil.example/x">', source: 'A&B' })
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('A&amp;B')
    expect(html).not.toMatch(/<script|<img|<svg/)
  })
  it('bounds text while retaining coordinates and location near the top', async () => {
    const info = await inspectImage(await fixture('gps.jpg'))
    info.fields = Array.from({ length: 50 }, () => ['字段', 'x'.repeat(140)])
    const text = renderText(info, { address: '地点' })
    expect(text.length).toBeLessThanOrEqual(1900)
    expect(text).toContain('35.500000')
    expect(text).toContain('地点')
  })
  it('clamps imported limits and restores missing defaults', () => {
    expect(resolveConfig({ max_image_mb: 100, request_timeout_ms: -1 })).toMatchObject({ max_image_mb: 10, request_timeout_ms: 1000 })
    expect(resolveConfig({ max_image_mb: NaN })).toEqual(defaultConfig)
  })
})
