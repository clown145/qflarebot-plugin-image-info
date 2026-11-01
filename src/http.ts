/** Messages from this class are safe to show in chat; upstream errors may contain URLs or keys. */
export class InputError extends Error {}

export function publicHttpsUrl(value: string): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new InputError('图片或服务地址无效。') }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || host === 'localhost' || !host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost')
    || host.endsWith('.internal') || host.includes(':') || /^[\d.]+$/.test(host)) {
    throw new InputError('仅支持使用域名的公网 HTTPS 地址。')
  }
  url.hash = ''
  return url
}

/** Bound the actual decoded response, including when Content-Length is absent or inaccurate. */
export async function fetchBytes(url: URL, options: {
  maxBytes: number
  timeoutMs: number
  signal: AbortSignal
  headers?: Record<string, string>
}): Promise<Uint8Array> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (options.signal.aborted) abort()
  else options.signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, options.timeoutMs)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const cancelRead = () => { void reader?.cancel().catch(() => {}) }
  try {
    controller.signal.throwIfAborted()
    // Workers supports follow/manual, not redirect: 'error'. Reject 3xx below without following it.
    const response = await fetch(url, { headers: options.headers, signal: controller.signal, redirect: 'manual' })
    if (!response.ok) {
      await response.body?.cancel()
      throw new InputError(`下载或查询失败（HTTP ${response.status}）。`)
    }
    const length = Number(response.headers.get('content-length'))
    if (length > options.maxBytes) {
      await response.body?.cancel()
      throw new InputError('返回的数据超过大小上限。')
    }
    if (!response.body) throw new InputError('服务返回了空数据。')
    reader = response.body.getReader()
    controller.signal.addEventListener('abort', cancelRead, { once: true })
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      controller.signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > options.maxBytes) throw new InputError('返回的数据超过大小上限。')
      if (value.byteLength) chunks.push(value)
    }
    controller.signal.throwIfAborted()
    const data = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
    return data
  } catch (error) {
    if (controller.signal.aborted) throw new InputError('请求超时，请稍后重试。')
    throw error
  } finally {
    clearTimeout(timer)
    options.signal.removeEventListener('abort', abort)
    controller.signal.removeEventListener('abort', cancelRead)
    await reader?.cancel().catch(() => {})
    reader?.releaseLock()
  }
}
