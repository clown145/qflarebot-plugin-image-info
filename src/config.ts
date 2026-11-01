export interface Config {
  output_mode: 'auto' | 'text'
  max_image_mb: number
  request_timeout_ms: number
  geo_relay_url: string
  geo_relay_token: string
  bigdatacloud_key: string
}

export const defaultConfig: Config = {
  output_mode: 'auto',
  max_image_mb: 4,
  request_timeout_ms: 6000,
  geo_relay_url: '',
  geo_relay_token: '',
  bigdatacloud_key: '',
}

export const configSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    output_mode: { type: 'string', title: '结果形式', enum: ['auto', 'text'], default: 'auto', description: 'auto：优先 T2I 图片卡片，不可用时返回文字；text：始终返回文字。' },
    max_image_mb: { type: 'integer', title: '图片大小上限（MiB）', minimum: 1, maximum: 10, default: 4 },
    request_timeout_ms: { type: 'integer', title: '单次网络请求超时（毫秒）', minimum: 1000, maximum: 8000, default: 6000 },
    geo_relay_url: { type: 'string', title: '地址查询接口', default: '', description: '可选 HTTPS 接口，接收 lat/lon，返回 address 或 display_name。支持自建 Nominatim 的 /reverse；留空则尝试 BigDataCloud。坐标会发送到此服务。' },
    geo_relay_token: { type: 'string', title: '地址接口 Bearer Token', writeOnly: true, default: '' },
    bigdatacloud_key: { type: 'string', title: 'BigDataCloud 服务端 API Key', writeOnly: true, default: '', description: '可选。主接口失败时查询城市/行政区；未配置任何地址服务时只显示坐标。' },
  },
}

export function resolveConfig(input: Partial<Config>): Config {
  return {
    ...defaultConfig,
    output_mode: input.output_mode === 'text' ? 'text' : 'auto',
    max_image_mb: Number.isFinite(input.max_image_mb) ? Math.min(10, Math.max(1, Math.trunc(input.max_image_mb!))) : defaultConfig.max_image_mb,
    request_timeout_ms: Number.isFinite(input.request_timeout_ms) ? Math.min(8000, Math.max(1000, Math.trunc(input.request_timeout_ms!))) : defaultConfig.request_timeout_ms,
    geo_relay_url: typeof input.geo_relay_url === 'string' ? input.geo_relay_url.trim() : '',
    geo_relay_token: typeof input.geo_relay_token === 'string' ? input.geo_relay_token.trim() : '',
    bigdatacloud_key: typeof input.bigdatacloud_key === 'string' ? input.bigdatacloud_key.trim() : '',
  }
}
