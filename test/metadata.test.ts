import { describe, expect, it } from 'vitest'
import { inspectImage } from '../src/metadata.js'
import { fixture } from './fixtures.js'

describe('image metadata from real encoded fixtures', () => {
  it.each(['jpg', 'png', 'webp', 'tiff'])('extracts GPS and camera metadata from %s', async extension => {
    const info = await inspectImage(await fixture(`gps.${extension}`))
    expect(info).toMatchObject({ width: 32, height: 24, gps: { latitude: 35.5, longitude: 139.75 } })
    expect(info.fields).toContainEqual(['相机型号', 'Test Camera'])
    expect(info.fields).toContainEqual(['ISO', '200'])
    expect(info.fields).toContainEqual(['海拔（米）', '-10'])
    expect(info.fields).toContainEqual(['拍摄时间', '2026:01:02 03:04:05'])
  })

  it.each(['jpg', 'png', 'webp', 'gif'])('retains dimensions for %s without EXIF', async extension => {
    const info = await inspectImage(await fixture(`plain.${extension}`))
    expect(info).toMatchObject({ width: 32, height: 24 })
    expect(info.gps).toBeUndefined()
    expect(info.notes.join(' ')).toContain('未读取到有效 GPS')
  })

  it('reads lossless WebP dimensions', async () => {
    expect(await inspectImage(await fixture('lossless.webp'))).toMatchObject({ width: 32, height: 24 })
  })
  it('preserves southern and western hemispheres', async () => {
    expect((await inspectImage(await fixture('south-west.jpg'))).gps).toEqual({ latitude: -35.5, longitude: -139.75 })
  })
  it('accepts zero latitude and longitude', async () => {
    const gps = (await inspectImage(await fixture('zero.jpg'))).gps
    expect(gps?.latitude).toBeCloseTo(0)
    expect(gps?.longitude).toBeCloseTo(0)
  })
  it('does not use invalid GPS coordinates', async () => {
    const info = await inspectImage(await fixture('invalid-gps.jpg'))
    expect(info.gps).toBeUndefined()
    expect(info.notes.join(' ')).toContain('GPS 数据无效')
  })
  it('retains basic information when EXIF is corrupt', async () => {
    const info = await inspectImage(await fixture('damaged-exif.jpg'))
    expect(info).toMatchObject({ format: 'JPEG', width: 32, height: 24 })
    expect(info.gps).toBeUndefined()
    expect(info.notes.join(' ')).toContain('EXIF 数据无法完整读取')
  })
  it('rejects unsupported bytes and truncated containers', async () => {
    await expect(inspectImage(new TextEncoder().encode('<html>not an image</html>'))).rejects.toThrow('暂不支持')
    for (const name of ['gps.jpg', 'gps.png', 'gps.webp']) {
      await expect(inspectImage((await fixture(name)).slice(0, 40))).rejects.toThrow()
    }
  })
})
