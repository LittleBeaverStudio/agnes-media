# agnes-media

A [DeepSeek Harness](https://github.com/deepseek-ai) (dsh) plugin that registers
two host tools for the Agnes AI media models, so the agent can generate images
and videos during a conversation.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![DeepSeek Harness](https://img.shields.io/badge/dsh-plugin-v1.5.0-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![Agnes AI](https://img.shields.io/badge/agnes-api-free-green)](https://agnes-ai.cn)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![npm](https://img.shields.io/badge/npm-v10%2B-red)](https://npmjs.com)

---

## 🌟 功能特性

- **文生图**：使用 `agnes-image-2.1-flash` 模型生成高质量图片
- **文生视频**：使用 `agnes-video-v2.0` 模型生成短视频
- **免费无限**：Agnes AI 提供永久免费的 API 调用
- **双端点支持**：自动适配中国大陆和国际节点
- **凭证集成**：支持 DSH credentials 系统

---

## ⚠️ 获取 API Key（重要！）

### 平台地址

| 地区 | URL |
|------|-----|
| 中国大陆 | [platform.agnes-ai.cn](https://platform.agnes-ai.cn) |
| 国际 | [platform.agnes-ai.com](https://platform.agnes-ai.com) |

**两个平台使用同一个 API Key** — 只需要切换端点 URL。

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

如果返回模型数据，说明 Key 有效；如果返回 `{"error":{"message":"无效的令牌"...}}`，请重新生成 Key。

---

## ⚠️ API Key 与端点选择

### 获取你的 API Key

1. 在 **[Agnes AI 平台](https://platform.agnes-ai.cn)**（国内节点）或 **[国际节点](https://platform.agnes-ai.com)** 注册
   - **中国大陆用户**：使用 `.cn` 平台 — 速度更快，无需代理
   - **海外用户**：使用 `.com` 平台
2. 在控制台设置 → API 密钥中创建 API Key
3. 同一个 Key 在 `.cn` 和 `.com` 节点都可用

### 选择合适的端点

默认情况下，插件连接**国际节点**（`apihub.agnes-ai.com`）。

| 如果你… | 这样做 |
|---------|--------|
| 在中国大陆 | 启动 DSH 前设置 `AGNES_MEDIA_DOMAIN=cn` 使用国内节点（`apihub.agnes-ai.cn`）— 速度更快，无需代理 |
| 需要自定义端点 | 设置 `AGNES_MEDIA_BASE_URL=https://your-custom-endpoint/v1` |
| 想保持国际默认 | 无需额外配置；只需设置你的 API Key |
| 使用 DSH credentials | 在 DSH 凭证管理中添加 `AGNES_MEDIA_API_KEY` |

#### Windows PowerShell
```powershell
$env:AGNES_API_KEY = "sk-xxxxxxxx..."
$env:AGNES_MEDIA_DOMAIN = "cn"   # 中国大陆用户添加这一行
dsh web
```

#### macOS / Linux
```bash
export AGNES_API_KEY="sk-xxxxxxxx..."
export AGNES_MEDIA_DOMAIN=cn     # 中国大陆用户取消注释这一行
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

使用 `agnes-video-v2.0` 模型从文本提示生成短视频。

异步操作：提交任务后，每 3 秒轮询状态端点，直到视频生成完成（最多约 3 分钟）。

**参数：**
- `prompt`（必需）：视频的详细文本描述。包括主体、动作、场景、镜头运动、光线和风格。
- `duration`（可选）：目标时长（秒）。自动转换为有效的帧数，24 fps。默认：`5`。
- `num_frames`（可选）：显式帧数覆盖。必须满足 `8n + 1` 且 ≤ 441。有效值：81, 121, 161, 201, 241, 281, 321, 361, 401, 441。如果提供，将忽略 `duration`。
- `size`（可选）：分辨率，格式为 `"WxH"`（如 `"1280x720"`）或 `"{width,W},{height,H}"`。默认：`1280x720`。
- `frame_rate`（可选）：帧率。范围：1–60。默认：`24`。
- `negative_prompt`（可选）：要避免的内容（如 `"模糊、抖动镜头"`）。
- `seed`（可选）：随机种子，用于可重复生成。

**返回值：** 直接视频 URL。

## 帧数验证

Agnes Video V2.0 要求 `num_frames` 必须满足集合 `{8n + 1 | n ≥ 1, 8n+1 ≤ 441}`：

```
81, 121, 161, 201, 241, 281, 321, 361, 401, 441
```

如果你传递 `duration`，插件会自动计算最近的帧数。如果直接传递 `num_frames`，会在提交前验证 — 无效值会立即被拒绝并显示清晰的错误信息。

## 环境变量参考

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AGNES_MEDIA_API_KEY` | Agnes API Key（推荐） | _(必须设置)_ |
| `AGNES_API_KEY` | 备用 API Key | — |
| `AGNES_MEDIA_DOMAIN` | 节点选择：`cn` 为国内，其他为国际 | `com` |
| `AGNES_MEDIA_BASE_URL` | 完整自定义 Base URL（覆盖域名）。必须以 `/v1` 结尾。 | _(自动从域名生成)_ |

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

## 许可证

[MIT](LICENSE)

---

## 版本历史

| 版本 | 日期 | 更新内容 |
|------|------|---------|
| v1.5.0 | 2026-08-31 | 修正端点 URL 到 apihub，支持 DSH credentials 系统 |
| v1.4.0 | 2026-08-28 | 升级视频模型至 agnes-video-2.5-flash（已回退） |
| v1.2.0 | 2026-08-21 | 修正端点 URL：`apihub.agnes-ai.cn` → `api.agnes-ai.cn` |
| v1.1.1 | 2026-08-21 | 添加 API Key 获取指南和 401 错误排查表 |
| v1.1.0 | 2026-08-21 | 支持国内外双端点，通过 `AGNES_MEDIA_DOMAIN` 切换 |
| v1.0.1 | 2026-08-20 | 初始版本，修复 Agnes Video API 参数对齐问题 |