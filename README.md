# qflarebot-plugin-image-info

QFlareBot 的图片信息插件：读取文件格式、尺寸、拍摄设备、曝光参数与 EXIF GPS，将经纬度交给配置的地址服务查询位置。可选使用 T2I 生成信息卡片。

版本 **0.1.0**，要求框架插件契约 **API 5**（已在 QFlareBot 0.7.1 的 SDK / 构建工具上验证）。

## 使用

- 在同一条消息中发送 `/解析` 和图片。
- 或引用图片消息，发送 `/解析`。
- 别名：`/图片信息`、`/image-info`。
- 每次处理一张图片，优先使用引用消息中的图片。QQ 没有下发引用附件时，使用当前消息的附件。

支持 JPEG、PNG、WebP、GIF、TIFF。JPEG/TIFF 和 PNG/WebP 的 EXIF 区块可提供拍摄参数与 GPS；GIF 仅显示基础信息。不解码图片像素，不依赖 Python、Pillow、Canvas、文件系统或常驻后端。

位置来自照片内嵌的 GPS，精度取决于照片记录及地址服务。没有 GPS 时仍显示基础信息与可读取的拍摄参数；不会通过画面内容推测位置。QQ 上传或转发可能改变元数据，具体以机器人实际收到的文件为准。HEIC/AVIF、PNG 文本/XMP、厂商 MakerNote 暂不解析。

## 配置

| 字段 | 默认 | 用途 |
| --- | --- | --- |
| `output_mode` | `auto` | 优先通过 `t2i` 服务返回图片；缺失或失败时返回文字。`text` 始终返回文字 |
| `max_image_mb` | `4` | 下载上限，单位 MiB，允许 1–10；以实际响应字节数再次检查 |
| `request_timeout_ms` | `6000` | 每次下载/地址查询的超时，允许 1000–8000 毫秒，包含读取响应体 |
| `geo_relay_url` | 空 | 自定义 HTTPS 地址接口，兼容原 AstrBot 插件的 relay 和 Nominatim 格式 |
| `geo_relay_token` | 空 | 可选 Bearer Token，配置面板按密钥处理 |
| `bigdatacloud_key` | 空 | 可选 BigDataCloud **服务端** API Key，主接口失败后使用 |

不配置地址接口也能读取 GPS。配置顺序为：自定义接口 → 配置了 Key 的 BigDataCloud → 仅坐标。BigDataCloud 返回城市/行政区信息，不保证街道或门牌精度。

### 自定义接口

向 `geo_relay_url` 发起 GET，请求参数包含 `lat`、`lon`、`format=jsonv2`、`accept-language=zh-CN`、`zoom=18`。原 URL 已有的其他参数保留；Token 通过 `Authorization: Bearer …` 发送。

支持以下 JSON 响应：

```json
{ "address": "具体地址", "attribution": "地址数据来源" }
```

或 Nominatim 格式：

```json
{ "display_name": "具体地址", "licence": "© OpenStreetMap contributors" }
```

可以配置自建 Nominatim 的 `/reverse` 端点。服务来源署名会保留在结果中；查询失败不影响 GPS 展示。接口需直接返回 JSON，不要返回登录页或重定向。

BigDataCloud 使用其[服务端接口](https://www.bigdatacloud.com/docs/reverse-geocoding/reverse-geocode-to-city-api)。原插件使用的 `reverse-geocode-client` 仅供客户端当前设备定位，本插件没有将其作为服务端免密接口使用。

### T2I

安装并启用框架的 `t2i` 服务提供者后，`auto` 模式会调用 `renderUrl()`，QQ 直接从渲染服务拉取图片。没有 T2I 时，命令仍可使用。渲染超时最多 8 秒，整个处理过程最多为网络阶段预留 25 秒。

## 数据与运行限制

- 仅处理用户触发的命令，不扫描其他消息；不写入 KV、D1、R2，不保存原图或位置历史。
- 地址查询只发送经纬度；T2I 接收解析后的文字/位置卡片 HTML，不接收原图。
- T2I 模式的卡片由渲染服务托管，保存时长由该服务决定。
- 网络接口只接受 HTTPS 域名，拒绝显式 IP、常见本地域名、URL 用户名密码、自定义端口和自动重定向。
- 下载默认最多 4 MiB，地址接口响应最多 64 KiB。超时、超限及损坏数据会返回提示。
- 未标注时区的 EXIF 拍摄时间保留原始值，不转换为服务器时区。
- Workers 免费版 CPU 预算由整个机器人共享。此插件只解析元数据，卡片在外部渲染；真实 QQ 图片的 CPU 开销仍需结合部署日志观察。

## 开发与构建

当前目录布局：

```text
Projects/
  qqbot-workers/
  qflarebot-plugin-image-info/
```

SDK 和插件构建工具引用相邻的 `qqbot-workers/packages/*`。若目录名不同，修改 `package.json` 的两个 `file:` 开发依赖并重新生成锁文件。

```bash
# 首次准备框架构建工具（在 qqbot-workers 目录执行）
pnpm install --frozen-lockfile
pnpm --filter '@qqbot/plugin-cli...' build

# 在本插件目录执行
npm ci
npm test
npm run typecheck
npm run test:workers
npm run sync
```

`npm run sync` 生成 `dist/plugin.js`、`dist/manifest.json`，并更新根目录声明清单 `manifest.json`。第三方运行时依赖只有固定版本的 `exifr`，锁文件需要随源码提交。其模块化入口用于避开 Node 文件读取和 PNG zlib 依赖。

`test:workers` 使用相邻框架 Wrangler 自带的 workerd/Miniflare，按框架的兼容日期运行真实打包产物；下载被替换为本地合成图片，不访问外部地址服务。脚本与当前框架的 Miniflare 5 配套。

测试使用 Pillow/piexif 生成的小型合成图片，不包含私人照片；正常运行测试无需安装 Python。仅重新生成测试样本时执行：

```bash
uv run --with pillow --with piexif test/fixtures/generate.py
```

## 安装到机器人

在框架面板的「插件 → 安装插件」中粘贴仓库地址并安装：

```text
https://github.com/clown145/qflarebot-plugin-image-info
```

仓库包含源码、`package-lock.json` 和根目录 `manifest.json`，框架会下载源码并构建。运行时不需要 npm 发布，也无需将此目录复制进框架源码。

## 协议

MIT。EXIF 解析依赖 exifr（MIT），归属说明见 `THIRD_PARTY_NOTICES.md`。
