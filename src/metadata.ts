import { parse } from 'exifr/src/core.mjs'
import 'exifr/src/file-parsers/jpeg.mjs'
import 'exifr/src/file-parsers/tiff.mjs'
import 'exifr/src/segment-parsers/tiff-exif.mjs'
import 'exifr/src/dicts/tiff-ifd0-keys.mjs'
import 'exifr/src/dicts/tiff-exif-keys.mjs'
import 'exifr/src/dicts/tiff-gps-keys.mjs'
import 'exifr/src/dicts/tiff-interop-keys.mjs'
import 'exifr/src/dicts/tiff-ifd0-values.mjs'
import 'exifr/src/dicts/tiff-exif-values.mjs'
import { InputError } from './http.js'

export interface ImageInfo {
  format: string
  byteSize: number
  width?: number
  height?: number
  fields: Array<[string, string]>
  gps?: { latitude: number; longitude: number }
  notes: string[]
}

const LABELS: Record<string, string> = {
  Make: '制造商', Model: '相机型号', LensModel: '镜头', DateTimeOriginal: '拍摄时间',
  OffsetTimeOriginal: '拍摄时区', ExposureTime: '曝光时间（秒）', FNumber: '光圈',
  ISO: 'ISO', FocalLength: '焦距（mm）', FocalLengthIn35mmFormat: '等效焦距（mm）',
  ExposureProgram: '曝光程序', ExposureBiasValue: '曝光补偿', MeteringMode: '测光模式',
  Flash: '闪光灯', WhiteBalance: '白平衡', Orientation: '方向', Software: '处理软件',
  XResolution: '水平分辨率', YResolution: '垂直分辨率', ResolutionUnit: '分辨率单位',
}

// exifr caches options by object identity. Reuse one immutable input across invocations.
const PARSE_OPTIONS = {
  pick: [...Object.keys(LABELS), 'ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight',
    'GPSLatitude', 'GPSLatitudeRef', 'GPSLongitude', 'GPSLongitudeRef', 'GPSAltitude', 'GPSAltitudeRef'],
  reviveValues: false,
  silentErrors: false,
}

export function cleanText(value: unknown, limit = 140): string {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  if (typeof value === 'number' && !Number.isFinite(value)) return ''
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, limit)
}

/** Read container dimensions and EXIF bytes without decompressing image pixels. */
export async function inspectImage(bytes: Uint8Array): Promise<ImageInfo> {
  if (bytes.length < 12) throw new InputError('图片数据不完整。')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (offset: number, count: number) => String.fromCharCode(...bytes.subarray(offset, offset + count))
  const info: ImageInfo = { format: '', byteSize: bytes.length, fields: [], notes: [] }
  let exif: Uint8Array | undefined
  if (view.getUint16(0) === 0xffd8) {
    info.format = 'JPEG'
    exif = bytes
    for (let offset = 2, count = 0; offset < bytes.length && count < 4096; count++) {
      if (bytes[offset++] !== 0xff) throw new InputError('JPEG 文件头损坏。')
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === undefined || marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > bytes.length) throw new InputError('JPEG 数据不完整。')
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) throw new InputError('JPEG 数据不完整。')
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (length < 8) throw new InputError('JPEG 尺寸数据损坏。')
        info.height = view.getUint16(offset + 3)
        info.width = view.getUint16(offset + 5)
        break
      }
      offset += length
    }
    if (!info.width || !info.height) throw new InputError('无法读取 JPEG 尺寸，文件可能已损坏。')
  } else if (view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    info.format = 'PNG'
    if (bytes.length < 33 || ascii(12, 4) !== 'IHDR' || view.getUint32(8) !== 13) throw new InputError('PNG 文件头损坏。')
    info.width = view.getUint32(16)
    info.height = view.getUint32(20)
    for (let offset = 8, count = 0; offset < bytes.length; count++) {
      if (count > 4096 || offset + 12 > bytes.length) throw new InputError('PNG 数据不完整或区块过多。')
      const size = view.getUint32(offset)
      if (offset + 12 + size > bytes.length) throw new InputError('PNG 数据不完整。')
      const kind = ascii(offset + 4, 4)
      if (kind === 'eXIf') exif = bytes.subarray(offset + 8, offset + 8 + size)
      offset += 12 + size
      if (kind === 'IEND') break
    }
  } else if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    info.format = 'WebP'
    const end = view.getUint32(4, true) + 8
    if (end > bytes.length || end < 20) throw new InputError('WebP 数据不完整。')
    for (let offset = 12, count = 0; offset < end; count++) {
      if (count > 4096 || offset + 8 > end) throw new InputError('WebP 数据不完整或区块过多。')
      const kind = ascii(offset, 4)
      const size = view.getUint32(offset + 4, true)
      const start = offset + 8
      if (start + size + (size % 2) > end) throw new InputError('WebP 数据不完整。')
      if (kind === 'VP8X' && size >= 10) {
        info.width = 1 + view.getUint32(start + 4, true) % 0x1000000
        info.height = 1 + (view.getUint32(start + 6, true) >>> 8)
      } else if (kind === 'VP8 ' && size >= 10 && ascii(start + 3, 3) === '\x9d\x01\x2a' && !info.width) {
        info.width = view.getUint16(start + 6, true) & 0x3fff
        info.height = view.getUint16(start + 8, true) & 0x3fff
      } else if (kind === 'VP8L' && size >= 5 && bytes[start] === 0x2f && !info.width) {
        const bits = view.getUint32(start + 1, true)
        info.width = 1 + (bits & 0x3fff)
        info.height = 1 + ((bits >>> 14) & 0x3fff)
      } else if (kind === 'EXIF') {
        exif = bytes.subarray(start + (ascii(start, 6) === 'Exif\0\0' ? 6 : 0), start + size)
      }
      offset = start + size + (size % 2)
    }
    if (!info.width || !info.height) throw new InputError('无法读取 WebP 尺寸。')
  } else if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) {
    info.format = 'GIF'
    info.width = view.getUint16(6, true)
    info.height = view.getUint16(8, true)
  } else if (['II*\0', 'MM\0*'].includes(ascii(0, 4))) {
    info.format = 'TIFF'
    exif = bytes
  } else {
    throw new InputError('暂不支持此文件。请发送 JPEG、PNG、WebP、GIF 或 TIFF 图片。')
  }

  let tags: Record<string, unknown> = {}
  if (exif) {
    try { tags = (await parse(exif, PARSE_OPTIONS)) ?? {} }
    catch { info.notes.push('EXIF 数据无法完整读取，已保留基础信息。') }
  }
  for (const [key, label] of Object.entries(LABELS)) {
    const value = cleanText(tags[key])
    if (value) info.fields.push([label, value])
  }
  if (!info.width && typeof tags.ImageWidth === 'number') info.width = tags.ImageWidth
  if (!info.height && typeof tags.ImageHeight === 'number') info.height = tags.ImageHeight
  const { latitude, longitude } = tags
  const validGpsFields = ['N', 'S'].includes(String(tags.GPSLatitudeRef)) && ['E', 'W'].includes(String(tags.GPSLongitudeRef))
    && [tags.GPSLatitude, tags.GPSLongitude].every(dms => Array.isArray(dms) && dms.length === 3
      && dms.every((part: unknown, index: number) => typeof part === 'number' && Number.isFinite(part) && part >= 0 && (index === 0 || part < 60)))
  if (validGpsFields && typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180) {
    info.gps = { latitude, longitude }
    if (typeof tags.GPSAltitude === 'number' && Number.isFinite(tags.GPSAltitude)) {
      const reference = tags.GPSAltitudeRef instanceof Uint8Array ? tags.GPSAltitudeRef[0] : tags.GPSAltitudeRef
      info.fields.push(['海拔（米）', String(tags.GPSAltitude * (reference === 1 ? -1 : 1))])
    }
  } else if (tags.GPSLatitude !== undefined || tags.GPSLongitude !== undefined) {
    info.notes.push('GPS 数据无效或不完整，无法查询地址。')
  }
  if (!info.gps) info.notes.push('未读取到有效 GPS；照片可能未记录位置，或发送时元数据被移除。')
  if (!info.fields.length && !info.gps) info.notes.push('未读取到拍摄参数。')
  return info
}
