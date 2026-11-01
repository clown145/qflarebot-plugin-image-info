import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Use the same workerd/Miniflare version as the adjacent framework's Wrangler.
const framework = createRequire(new URL('../../qqbot-workers/package.json', import.meta.url))
const runtime = createRequire(framework.resolve('wrangler'))
const { Miniflare, convertV4MiniflareOptions, Response: RuntimeResponse } = runtime('miniflare')
const { build } = createRequire(import.meta.resolve('@qqbot/plugin-cli'))('esbuild')
const root = fileURLToPath(new URL('../', import.meta.url))
const fixtures = new URL('../test/fixtures/', import.meta.url)

const script = `import plugin from './dist/plugin.js';
export default { async fetch(request) {
  const filename = new URL(request.url).pathname.slice(1);
  const result = await plugin.commands['解析'].handler({
    session: { attachments: [{ url: 'https://fixtures.example.com/' + filename, contentType: 'image/jpeg' }] },
    ctx: { config: { ...plugin.defaultConfig, output_mode: 'text' }, logger: { warn() {} }, service() { throw new Error('absent'); } }
  });
  return new Response(result);
}};`
const bundle = await build({ stdin: { contents: script, resolveDir: root }, bundle: true, platform: 'browser', format: 'esm', write: false })
const options = {
  compatibilityDate: '2026-09-01',
  script: bundle.outputFiles[0].text,
  modules: true,
  // No real network calls: all outbound fetches read the synthetic image fixtures.
  outboundService: async request => {
    const url = new URL(request.url)
    assert.equal(url.hostname, 'fixtures.example.com')
    const name = url.pathname.slice(1)
    assert.match(name, /^[a-z-]+\.(jpg|png|webp|tiff|gif)$/)
    return new RuntimeResponse(await readFile(new URL(name, fixtures)))
  },
}
const worker = new Miniflare(convertV4MiniflareOptions(options))
try {
  for (const name of ['gps.jpg', 'gps.png', 'gps.webp', 'gps.tiff', 'plain.gif', 'south-west.jpg', 'zero.jpg']) {
    const response = await worker.dispatchFetch('https://worker.test/' + name)
    assert.equal(response.status, 200)
    const text = await response.text()
    assert.ok(text.includes('尺寸：32 × 24'), `${name}: ${text}`)
    if (name.startsWith('gps.')) assert.ok(text.includes('35.500000') && text.includes('139.750000'), `${name}: ${text}`)
    if (name === 'south-west.jpg') assert.ok(text.includes('-35.500000') && text.includes('-139.750000'), text)
    if (name === 'zero.jpg') assert.ok(text.includes('纬度：0.000000') && text.includes('经度：0.000000'), text)
    console.log('Workers runtime PASS:', name)
  }
} finally {
  await worker.dispose()
}
