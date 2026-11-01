import { describe, expect, it, vi } from 'vitest'
import { fetchBytes, publicHttpsUrl } from '../src/http.js'

const url = new URL('https://cdn.example.com/photo.jpg')
const options = () => ({ maxBytes: 8, timeoutMs: 1000, signal: new AbortController().signal })

describe('bounded network reads', () => {
  it.each(['file:///tmp/x', 'http://example.com/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://localhost/a', 'https://router.local/a', 'https://u:p@example.com/a', 'https://example.com:8443/a'])('rejects unsuitable URL %s', value => {
    expect(() => publicHttpsUrl(value)).toThrow()
  })
  it('reads a response without content length and disables redirects', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])))
    vi.stubGlobal('fetch', fetch)
    expect(await fetchBytes(url, options())).toEqual(new Uint8Array([1, 2, 3]))
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
  })
  it('rejects redirects without contacting their target', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/' } }))
    vi.stubGlobal('fetch', fetch)
    await expect(fetchBytes(url, options())).rejects.toThrow('HTTP 302')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('enforces actual streamed size despite a misleading header', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(6)); controller.enqueue(new Uint8Array(6)) }, cancel,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { headers: { 'content-length': '2' } })))
    await expect(fetchBytes(url, options())).rejects.toThrow('大小上限')
    expect(cancel).toHaveBeenCalled()
  })
  it('cancels before reading a known oversized response', async () => {
    const cancel = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { 'content-length': '9' } })))
    await expect(fetchBytes(url, options())).rejects.toThrow('大小上限')
    expect(cancel).toHaveBeenCalled()
  })
  it('aborts slow requests and clears its timer', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn((_url: URL, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })))
      const promise = expect(fetchBytes(url, options())).rejects.toThrow('超时')
      await vi.advanceTimersByTimeAsync(1000)
      await promise
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
  it('does not fetch after cancellation', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(fetchBytes(url, { ...options(), signal: AbortSignal.abort() })).rejects.toThrow('超时')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('times out and cancels a body that stalls after headers', async () => {
    vi.useFakeTimers()
    try {
      const cancel = vi.fn()
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))))
      const promise = expect(fetchBytes(url, options())).rejects.toThrow('超时')
      await vi.advanceTimersByTimeAsync(1000)
      await promise
      expect(cancel).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
