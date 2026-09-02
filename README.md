# agnes-media

A [DeepSeek Harness](https://github.com/deepseek-ai) (dsh) plugin that registers
two host tools for the Agnes AI media models, so the agent can generate images
and videos during a conversation.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![DeepSeek Harness](https://img.shields.io/badge/dsh-plugin-v1.8.1-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![Agnes AI](https://img.shields.io/badge/agnes-api-free-green)](https://agnes-ai.cn)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![npm](https://img.shields.io/badge/npm-v10%2B-red)](https://npmjs.com)

---

## 🌟 功能特性

- **文生图**：使用 `agnes-image-2.1-flash` 模型生成高质量图片
- **文生视频**：使用 `agnes-video-2.5-flash` 模型生成 4-12 秒短视频（默认 5 秒）
- **图生视频**：传入 `reference_image_url`（单图）或 `reference_image_urls`（多图数组，最多 5 张）即可使用参考图，支持 429 限流退避重试
- **免费无限**：Agnes AI 提供免费 API 调用
- **国内直连**：实测 `api.agnes-ai.com`/`.cn` 旧节点均 404/401，默认统一走 `apihub.agnes-ai.cn`
- **凭证集成**：支持环境变量或 DSH credentials 系统
- **零依赖**：仅使用 Node.js 内置模块，无需额外安装

---

## ⚠️ 获取 API Key（重要！）

### 平台地址

| 地区 | URL |
|------|-----|
| 中国大陆 | [platform.agnes-ai.cn](https://platform.agnes-ai.cn) |
| 国际 | [platform.agnes-ai.com](https://platform.agnes-ai.com) |

**两个平台各自签发 Key** — 注意 Key 与节点存在代际绑定，并非处处通用（见下文「API Key 与端点选择」的实测表格）。

### 获取步骤

1. 登录与你所在地区匹配的平台
2. 进入 **设置 → API 密钥**（Settings → API Keys）
3. 点击 **"创建新密钥"**（Create New Key）
4. **重要**：密钥只显示一次！立即复制保存！
5. 密钥格式为 `sk-xxxxxxxx...`（以 `sk-` 开头，约 50+ 字符）

### 常见问题：401 错误（"无效的令牌"）

如果你遇到 `401` 错误：

| 检查项 | 解决方案 |
|--------|---------|
| **复制完整？** | 确保完整复制 `sk-...` 字符串，不要截断 |
| **多余空格/换行？** | 去除首尾空格 — 确保没有多余空格 |
| **Key 已删除？** | 去设置 → API 密钥检查 Key 是否还存在 |
| **用错 Key？** | 创建新 Key 并重新测试 |
| **区域不匹配？** | `.cn` Key 用于 `.cn` 端点，`.com` Key 用于 `.com` 端点 |

### 手动测试你的 Key

```bash
# 使用 curl 直接测试，排除插件配置问题
curl -s https://apihub.agnes-ai.cn/v1/models \
  -H "Authorization: Bearer YOUR_KEY_HERE" | head -c 500
```

如果返回模型数据，说明 Key 在该节点有效；如果返回 `{"error":{"message":"无效的令牌"...}}`，
**先换一个端点重试**（见下文实测表格——Key 与节点有代际绑定），换节点仍 401 再重新生成 Key。

---

## ⚠️ API Key 与端点选择

### 获取你的 API Key

1. 在 **[Agnes AI 平台](https://platform.agnes-ai.cn)**（国内节点）或 **[国际节点](https://platform.agnes-ai.com)** 注册
   - **中国大陆用户**：使用 `.cn` 平台 — 速度更快，无需代理
   - **海外用户**：使用 `.com` 平台
2. 在控制台设置 → API 密钥中创建 API Key
3. 创建 API Key（Key 与签发它的节点存在代际绑定，见下方实测表格）

### 选择合适的端点

**端点现状（2026-09-02 实测，中国大陆网络，`platform.agnes-ai.cn` 签发的 key）**：
节点与 key 存在代际绑定，同一把 key 并非在所有节点都有效：

| 端点 | 实测结果 |
|------|---------|
| `api.agnes-ai.cn` | ✅ 200（旧平台体系 key 的正确节点） |
| `apihub.agnes-ai.cn` — **本插件默认** | ❌ 401 无效的令牌（对上述 key） |
| `apihub.agnes-ai.com` | ✅ 200 |
| `api.agnes-ai.com` | ❌ 404 |

本插件默认指向 `apihub.agnes-ai.cn`（对 dsh 生态新签发的 key 有效）。
**遇到 `401 无效的令牌` 时先换端点、再换 key**：设置
`AGNES_MEDIA_BASE_URL=https://api.agnes-ai.cn` 通常即可恢复。
`AGNES_MEDIA_DOMAIN` 保留仅为向后兼容，不再影响端点选择。

| 如果你… | 这样做 |
|---------|--------|
| 在中国大陆 | 无需任何配置，默认即 `apihub.agnes-ai.cn` |
| 在海外 / 需要自定义端点 | 设置 `AGNES_MEDIA_BASE_URL=https://apihub.agnes-ai.com`（插件会自动追加 `/v1`） |
| 使用 DSH credentials | 在 DSH 凭证管理中添加 `AGNES_MEDIA_API_KEY` |

#### Windows PowerShell
```powershell
$env:AGNES_API_KEY = "sk-xxxxxxxx..."
# 国内无需额外配置；海外用户取消下一行注释
# $env:AGNES_MEDIA_BASE_URL = "https://apihub.agnes-ai.com"
dsh web
```

#### macOS / Linux
```bash
export AGNES_API_KEY="sk-xxxxxxxx..."
# 国内无需额外配置；海外用户取消下一行注释
# export AGNES_MEDIA_BASE_URL=https://apihub.agnes-ai.com
dsh web
```

---

## 环境要求

- DeepSeek Harness `0.1.0-rc.7` 或更高版本（使用 `cordis.patch.yml` bundle 格式）
- Agnes AI API Key（免费），通过 `AGNES_MEDIA_API_KEY` 或 `AGNES_API_KEY` 暴露
- 可选：DSH credentials 系统（支持图形界面配置 API Key）

## 安装

从本地目录：

```bash
dsh plugin --profile web add github:LittleBeaverStudio/agnes-media
```

然后重启 DSH web 服务器。`generate_image` 和 `generate_video` 工具会出现在 agent 的工具目录中。

## 工具

### `generate_image`

使用 `agnes-image-2.1-flash` 模型从文本提示生成图片。

**参数：**
- `prompt`（必需）：图片的详细文本描述。
- `size`（可选）：输出尺寸，格式为 `"WxH"`（如 `"1920x1080"`）或 `"{width,1920},{height,1080}"`。默认：`1024x1024`。
- `n`（可选）：生成的图片数量。默认：`1`，最大：`4`。

**返回值：** 公共 HTTPS URL 数组。工具将结果渲染为 markdown 图片，DSH Web UI 会内联显示。

### `generate_video`

使用 `agnes-video-2.5-flash` 模型从文本提示或参考图生成短视频。

异步操作：提交任务后，每 3 秒轮询一次 `/agnesapi` 状态端点，直到视频生成完成（最多约 6 分钟；12 秒任务实测推理约 2 分钟）。

**参数：**
- `prompt`（必需）：视频的详细文本描述。包括主体、动作、场景、镜头运动、光线和风格。
- `duration`（可选）：目标时长（秒）。范围：4-12，默认：`5`。
- `aspect_ratio`（可选）：宽高比，`"16:9"`（默认）、`"9:16"`、`"1:1"`、`"4:3"`、`"3:4"`、`"21:9"`。
- `size`（可选）：分辨率档位。Flash 模型固定 720P，插件会自动传 `"720P"`。
- `reference_image_url`（可选）：公网可访问的 HTTPS 图片 URL。传入即走 `mode=reference` 图生视频，并放入 `images[]`；不传走 `mode=text`。注意：Agnes 不接受本地文件路径。
- `seed`（可选）：随机种子，用于可重复生成。
- `negative_prompt`（可选，保留）：参数定义保留以避免调用报错，但 Agnes 2.5 Flash 接口会 400 拒收该字段，插件不会实际发送。

**返回值：** 直接视频 URL（按 `metadata.url → url → video_url → data.url` 依次回退提取）。

## 宽高比说明

Agnes Video 2.5 Flash 固定 720P，支持以下宽高比：

| 宽高比 | 分辨率 | 适用场景 |
|--------|--------|----------|
| 16:9 | 1280×720 | 横向视频（默认） |
| 9:16 | 720×1280 | 竖屏短视频 |
| 1:1 | 720×720 | 正方形 |
| 4:3 | 960×720 | 传统比例 |
| 3:4 | 720×960 | 竖版海报 |
| 21:9 | 1680×720 | 超宽 cinematic |

## 环境变量参考

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AGNES_MEDIA_API_KEY` | Agnes API Key（推荐，也可存到 DSH credentials） | _(必须设置)_ |
| `AGNES_API_KEY` | 备用 API Key | — |
| `AGNES_MEDIA_BASE_URL` | 完整自定义 Base URL（海外/自定义端点用）。插件自动追加 `/v1` | `https://apihub.agnes-ai.cn` |
| `AGNES_MEDIA_DOMAIN` | 已保留但不再影响端点（实测旧节点 404/401，统一走 apihub） | — |

## DSH Credentials 支持

插件支持从 DSH 凭证系统读取 API Key，无需设置环境变量：

1. 在 DSH Web UI 中打开设置
2. 进入 **凭证管理**（Credentials）
3. 添加新凭证：`AGNES_MEDIA_API_KEY` = `sk-xxxxxxxx...`
4. 保存后重启 DSH

凭证优先级：环境变量 > DSH credentials > 错误提示

## 结果如何在对话中显示

- **图片**：工具返回公共 HTTPS URL，其结果指示模型使用 markdown 图片语法（`![description](url)`）回复。DSH Web UI 会内联渲染绝对 HTTPS 图片，生成的图片会直接出现在对话中 — 无需客户端插件。
- **视频**：工具返回直接视频 URL。markdown 渲染器没有视频块，因此 agent 会向用户展示链接；浏览器打开时会内联播放。

## 安全说明

- 永远不要提交 API Key。此仓库故意不包含任何密钥；`.gitignore` 排除了本地配置和环境文件。
- Key 仅以 `Bearer` header 形式离开你的机器，发送到 Agnes AI API。
- 插件在调用时从进程环境读取 Key；永远不会持久化或记录。
- 如果使用 DSH credentials，Key 会加密存储在本地凭证数据库中。

## 版本历史

| 版本 | 日期 | 更新内容 |
|------|------|---------|
| v1.8.2 | 2026-09-02 | 修复 `AGNES_MEDIA_BASE_URL` 双 `/v1`（传 `/v1` 结尾值会打出 `/v1/v1` 得到误导性 404，现幂等兼容两种写法）；实测修正端点文档：key 与节点存在代际绑定（platform 签发的 key 在 `apihub.agnes-ai.cn` 401、在 `api.agnes-ai.cn` 200），401 时先换端点再换 key；`negative_prompt` 参数描述标注为 DEPRECATED（API 400 拒收该字段，插件从不发送） |
| v1.8.1 | 2026-09-01 | 修复多图参考支持：index.js 代码已包含 `reference_image_urls` 数组参数，兼容旧 `reference_image_url`，最多 5 张参考图 |
| v1.8.0 | 2026-09-01 | 新增多图参考支持（README + package.json，index.js 遗漏未提交） |
| v1.7.0 | 2026-09-01 | 新增 429 限流退避重试：瞬态错误（429/5xx/网络抖动）退避 10 秒继续轮询，不再直接报错；轮询间隔 3s→5s，上限约 10 分钟 |
| v1.6.0 | 2026-09-01 | 实测修复：默认端点统一 `apihub.agnes-ai.cn`；视频切换到 `agnes-video-2.5-flash`（`seconds/mode/size='720P'/aspect_ratio` 参数）；新增图生视频 `reference_image_url`；轮询改为 `/agnesapi?video_id=&model_name=`；轮询上限 3→6 分钟；停止发送 `negative_prompt` |
| v1.5.0 | 2026-08-31 | 修正端点 URL 到 apihub，支持 DSH credentials 系统 |
| v1.4.0 | 2026-08-28 | 升级视频模型至 agnes-video-2.5-flash（已回退） |
| v1.2.0 | 2026-08-21 | 修正端点 URL：`apihub.agnes-ai.cn` → `api.agnes-ai.cn` |
| v1.1.1 | 2026-08-21 | 添加 API Key 获取指南和 401 错误排查表 |
| v1.1.0 | 2026-08-21 | 支持国内外双端点，通过 `AGNES_MEDIA_DOMAIN` 切换 |
| v1.0.1 | 2026-08-20 | 初始版本，修复 Agnes Video API 参数对齐问题 |

## 许可证

[MIT](LICENSE)