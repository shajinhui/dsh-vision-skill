---
name: dsh-vision-skill
description: Use when the user shares, pastes, or references an image (local path or URL) and you need to describe, analyze, OCR, or recognize its content. The current model may not read images directly; run the bundled vision.js helper to convert the image into text via a configurable OpenAI-compatible vision API.
whenToUse: 用户提供图片（路径/链接/剪贴板粘贴）并要求描述、识别、分析图片内容，而当前模型无法直接看图时。
---

# 识图助手（Vision Helper）

当前模型可能不支持直接读取图片。当用户提供图片路径、URL 或粘贴图片时，**不要尝试直接看图**，而是运行本 skill 自带的 `vision.js`，把图片转成文字描述。

## 找到 vision.js

本 skill 的基础目录在 `<skill_resources>` 中给出（"Base directory for this skill"）。`vision.js` 位于该目录下，用其绝对路径执行：

```bash
node "<基础目录>/vision.js" "<图片绝对路径>" "<问题>"
```

## 三种输入方式

| 场景       | 命令                                                               |
| -------- | ---------------------------------------------------------------- |
| 本地图片文件   | `node "<基础目录>/vision.js" "/绝对/路径/图片.png" "问题"`                   |
| 网络图片     | `node "<基础目录>/vision.js" --url "https://example.com/a.jpg" "问题"` |
| 剪贴板粘贴的图片 | `node "<基础目录>/vision.js" --clipboard "问题"`                       |

`--clipboard` 会读取系统剪贴板中的图片（macOS 用内置 Swift 脚本，Windows 用内置 PowerShell 脚本）。若失败，请用户把图片保存为文件并提供绝对路径。

自动回退规则（无需显式指定）：

- 给定本地路径但文件不存在 → 自动回退读取剪贴板
- 完全没给路径/URL → 自动尝试剪贴板
- 传 `--no-fallback` 可关闭回退，改为直接报错

不传"问题"时默认提示词为：`请详细描述这张图片的内容。`

## 规则

- 始终使用绝对路径调用 `vision.js`，路径从 `<skill_resources>` 的基础目录解析，**不要硬编码或猜测路径**
- 本地图片用绝对路径，网络图片用 `--url`
- 用户粘贴图片且无可见路径时，优先 `--clipboard`
- 默认用中文描述，除非用户另有要求
- 配置在 `vision.js` 同目录的 `.env` 中（`VISION_API_KEY` / `VISION_BASE_URL` / `VISION_MODEL`，兼容旧变量名 `DASHSCOPE_API_KEY` / `DASHSCOPE_BASE_URL`）。支持任意 OpenAI 兼容格式的视觉模型 API；key 以 `AIza` 开头（或设置 `GEMINI_API_KEY`）时自动使用 Gemini 官方兼容端点（默认模型 `gemini-3.1-flash-lite`），否则默认阿里云 DashScope（`qwen-vl-max`）
- **绝不打印或提交 API Key**
- 若 API 调用失败：向用户报告错误，并提示检查 Key、模型名或 Base URL（参考同目录 `.env.example`）

## 配置指引（当用户尚未配置时）

告诉用户：

1. 将本 skill 目录下的 `.env.example` 复制为 `.env`
2. 填入 `VISION_API_KEY`（必填）。Gemini key（`AIza` 开头）在 https://aistudio.google.com/apikey 申请；阿里云百炼在 https://bailian.console.aliyun.com/ 申请（新用户有免费额度）
3. 模型与端点会自动按 key 匹配；如需其他服务，改 `VISION_BASE_URL` 和 `VISION_MODEL` 指向任意 OpenAI 兼容的视觉 API
