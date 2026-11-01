import { definePlugin } from '@qqbot/sdk'
import { configSchema, defaultConfig, resolveConfig } from './config.js'
import type { Config } from './config.js'
import { fetchBytes, InputError, publicHttpsUrl } from './http.js'
import { inspectImage } from './metadata.js'
import { reverseGeocode } from './geocode.js'
import { renderHtml, renderText } from './report.js'

export type { Config } from './config.js'

interface T2IService {
  renderUrl(html: string, options: { width: number; height: number; fullPage: boolean; type: 'png'; timeoutMs: number; signal: AbortSignal }): Promise<{ url: string }>
}

export default definePlugin<Config>({
  name: 'image-info',
  apiVersion: 5,
  displayName: '图片信息',
  description: '提取图片 EXIF、拍摄参数和 GPS，查询地址并生成信息卡片',
  permissions: ['net'],
  depends: { t2i: 'optional' },
  configSchema,
  defaultConfig,
  commands: {
    解析: {
      description: '查看图片信息和拍摄位置',
      usage: '/解析（附带或引用图片）',
      aliases: ['图片信息', 'image-info'],
      async handler({ session, ctx }) {
        const config = resolveConfig(ctx.config)
        const isImage = (attachment: { contentType?: string; filename?: string; url: string }) =>
          attachment.contentType?.toLowerCase().startsWith('image/')
          || /\.(jpe?g|png|webp|gif|tiff?)(?:[?#]|$)/i.test(attachment.filename || attachment.url)
          || !attachment.contentType || attachment.contentType === 'application/octet-stream'
        const attachment = session.quote?.attachments.find(isImage) ?? session.attachments.find(isImage)
        if (!attachment) return '请在 /解析 同一条消息中附带图片，或引用图片发送 /解析。支持 JPEG、PNG、WebP、GIF 和 TIFF。'
        const maxBytes = config.max_image_mb * 1024 * 1024
        if (attachment.size && attachment.size > maxBytes) return `图片超过 ${config.max_image_mb} MiB 上限，请发送较小的图片。`
        // Leave time for the framework to send the final reply within its background-event budget.
        const controller = new AbortController()
        const deadline = Date.now() + 25_000
        const timer = setTimeout(() => controller.abort(), 25_000)
        try {
          const bytes = await fetchBytes(publicHttpsUrl(attachment.url), {
            maxBytes, timeoutMs: config.request_timeout_ms, signal: controller.signal,
          })
          const info = await inspectImage(bytes)
          const location = info.gps ? await reverseGeocode(info.gps, config, controller.signal) : {}
          const text = renderText(info, location)
          if (config.output_mode === 'auto' && !controller.signal.aborted) {
            try {
              const t2i = ctx.service<T2IService>('t2i')
              const image = await t2i.renderUrl(renderHtml(info, location), {
                width: 1280, height: 720, fullPage: true, type: 'png',
                timeoutMs: Math.max(1, Math.min(8000, deadline - Date.now())), signal: controller.signal,
              })
              return { image: { url: publicHttpsUrl(image.url).href } }
            } catch {
              // The optional service can be absent, disabled, or temporarily unavailable.
            }
          }
          return text
        } catch (error) {
          if (error instanceof InputError) return error.message
          ctx.logger.warn('Image inspection failed; upstream details omitted.')
          return '图片解析失败，请重新发送原图后重试。'
        } finally {
          clearTimeout(timer)
        }
      },
    },
  },
})
