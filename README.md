# DSH Vision Skill

Give text-only AI agents eyes. Paste a screenshot, provide a local image, or share an image URL; the skill sends it to Gemini or an OpenAI-compatible vision API and returns useful text.

让纯文本 AI Agent 一键看图：支持剪贴板、本地图片和图片 URL，零 npm 依赖，并自动优化大图。

[中文](#中文) · [English](#english)

![DSH Vision Skill demo](media/demo.gif)

## 中文

### 为什么使用

- **直接粘贴截图**：不必先保存文件或寻找路径
- **零 npm 依赖**：只需要 Node.js；macOS 和 Windows 使用系统自带工具读取剪贴板
- **自动优化大图**：默认将最长边缩至 2048px，减少 base64 体积和等待时间
- **多种视觉模型**：支持 Gemini 原生 API、阿里云百炼及其他 OpenAI 兼容服务
- **保护本地配置**：API Key 保存在被 Git 忽略的 `.env`；临时图片使用后自动清理

### 一行安装

```bash
git clone --depth 1 https://github.com/shajinhui/dsh-vision-skill ~/.dsh/skills/dsh-vision-skill
```

也可以把仓库复制到项目级目录：`<项目根>/.dsh/skills/dsh-vision-skill/`。DSH 会自动发现 Skill，新会话即可使用。

### 配置

```bash
cd ~/.dsh/skills/dsh-vision-skill
cp .env.example .env
# 编辑 .env，填入 VISION_API_KEY
```

| 服务 | 默认模型 | 配置方式 |
| --- | --- | --- |
| Gemini（推荐） | `gemini-3.1-flash-lite` | 填写 `AIza...` Key，自动使用 Gemini 原生 API |
| 阿里云百炼 | `qwen-vl-max` | 填写百炼 Key，自动使用 OpenAI 兼容接口 |
| 其他兼容服务 | 自定义 | 设置 `VISION_BASE_URL` 和 `VISION_MODEL` |

Gemini Key 可在 [Google AI Studio](https://aistudio.google.com/apikey) 申请；阿里云百炼 Key 可在[百炼控制台](https://bailian.console.aliyun.com/)申请。

### 使用

在 DSH 中直接发送或粘贴图片，然后提问即可。命令行也可以独立使用：

```bash
node vision.js "/绝对路径/screenshot.png" "分析这个报错并给出修复建议"
node vision.js --url "https://example.com/image.jpg" "识别图片中的文字"
node vision.js --clipboard "这个界面有什么问题？"
```

### 大图优化

默认在上传前把图片最长边限制为 2048px。macOS 使用系统 `sips`，Windows 使用系统 PowerShell/.NET；Linux 检测到 ImageMagick 时启用。优化结果不比原图小时会自动保留原图。

```bash
# 更快：最长边 1600px，JPEG 质量 76
node vision.js --max-side 1600 --quality 76 --clipboard "分析截图"

# 需要保留原图时关闭优化
node vision.js --no-optimize "/path/to/image.png" "读取细小文字"
```

也可以在 `.env` 中设置：

```ini
VISION_MAX_SIDE=2048
VISION_JPEG_QUALITY=82
```

### 平台支持

| 能力 | macOS | Windows | Linux |
| --- | --- | --- | --- |
| 本地图片 / URL | ✅ | ✅ | ✅ |
| 剪贴板图片 | ✅ | ✅ | 暂不支持 |
| 零额外依赖优化 | ✅ | ✅ | 需系统安装 ImageMagick |

### 安全与隐私

- 图片只会发送给你在 `.env` 中配置的视觉模型服务；项目不包含遥测
- `.env` 已加入 `.gitignore`，请勿在 Issue、日志或提交中粘贴 Key
- 剪贴板和优化产生的临时图片权限受限，并会在成功或失败后清理
- Gemini 本地下载远程图片时，仅允许 HTTP/HTTPS，并限制为最多 5 次重定向和 25 MB

## English

### Install

```bash
git clone --depth 1 https://github.com/shajinhui/dsh-vision-skill ~/.dsh/skills/dsh-vision-skill
cd ~/.dsh/skills/dsh-vision-skill
cp .env.example .env
```

Set `VISION_API_KEY` in `.env`. Keys beginning with `AIza` use the native Gemini API; other keys use the configured OpenAI-compatible endpoint, defaulting to DashScope with `qwen-vl-max`.

### Use

```bash
node vision.js "/absolute/path/screenshot.png" "Find the bug and suggest a fix"
node vision.js --url "https://example.com/image.jpg" "Extract the text"
node vision.js --clipboard "Review this interface"
```

Large images are automatically resized to a maximum side of 2048px. Override this with `--max-side`, `--quality`, `--no-optimize`, `VISION_MAX_SIDE`, or `VISION_JPEG_QUALITY`.

### Development

```bash
node --check vision.js
node --test tests/*.test.js
swiftc -typecheck clipboard.swift  # macOS
```

## License

[MIT](LICENSE)
