import type { ImageInfo } from './metadata.js'
import type { LocationResult } from './geocode.js'

export function reportRows(info: ImageInfo, location: LocationResult): Array<[string, string]> {
  const rows: Array<[string, string]> = [['格式', info.format], ['文件大小', `${(info.byteSize / 1024).toFixed(1)} KiB`]]
  if (info.width && info.height) rows.push(['尺寸', `${info.width} × ${info.height} px`])
  if (info.gps) {
    rows.push(['纬度', info.gps.latitude.toFixed(6)], ['经度', info.gps.longitude.toFixed(6)])
    if (location.address) rows.push(['位置', location.address])
    if (location.source) rows.push(['地址来源', location.source])
  }
  rows.push(...info.fields)
  return rows
}

export function renderText(info: ImageInfo, location: LocationResult): string {
  const text = ['图片信息', ...reportRows(info, location).map(([label, value]) => `${label}：${value}`),
    '', ...info.notes, ...(location.note ? [location.note] : [])].join('\n')
  return text.length > 1900 ? `${text.slice(0, 1897)}…` : text
}

export function renderHtml(info: ImageInfo, location: LocationResult): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
  const rows = reportRows(info, location).map(([label, value]) => `<tr><th>${escape(label)}</th><td>${escape(value)}</td></tr>`).join('')
  const notes = [...info.notes, ...(location.note ? [location.note] : [])].map(note => `<p>${escape(note)}</p>`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;padding:48px;background:#edf2f7;color:#172334;font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif}
    main{width:1120px;padding:44px 48px;background:#fff;border-radius:24px;border-top:8px solid #2563eb}
    header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:28px}h1{font-size:36px;margin:0}header span{font-size:17px;color:#52647a}
    table{width:100%;border-collapse:collapse;font-size:23px;line-height:1.5;table-layout:fixed}th,td{padding:14px 0;border-bottom:1px solid #e7edf4;vertical-align:top;text-align:left;overflow-wrap:anywhere}
    th{width:250px;font-weight:500;color:#52647a;padding-right:24px}footer{font-size:19px;line-height:1.6;color:#52647a;margin-top:26px}footer p{margin:8px 0}
  </style></head><body><main><header><h1>图片信息</h1><span>EXIF · GPS</span></header><table>${rows}</table><footer>${notes}</footer></main></body></html>`
}
