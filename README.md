# DSH Vision Skill（识图技能包）

让没有识图能力的 AI 模型获得识图能力：把图片交给任意 OpenAI 兼容格式的视觉模型 API，用文字描述回来。

适用于 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 的 skill 系统。

## 给 AI 的配置指引（AI 必读）

当用户让你"配置识图 / 装这个 skill / 填 key"时，按以下步骤执行：

1. **先检查现状**：查看本目录下是否存在 `.env`，且其中 `VISION_API_KEY` 已填写（不是 `sk-xxx` 占位符）

2. **已配置**：告诉用户"已配置完成，直接发图片即可"，不要重复配置

3. **未配置**：执行
   
   ```bash
   cp .env.example .env
   ```
   
   然后把真实 key 填入 `.env` 的 `VISION_API_KEY`

4. **不知道就问用户，不要猜**。以下情况必须先问清楚，再动手：
   
   - 用户没给 key → 问用户要 key，并确认用哪家服务
   - 用户不知道选哪家 → 推荐 Gemini（key 以 `AIza` 开头，https://aistudio.google.com/apikey 申请）或阿里云百炼（https://bailian.console.aliyun.com/，新用户有免费额度）
   - 用户要用非默认服务 → 问清 Base URL 和模型名，写入 `.env` 的 `VISION_BASE_URL` / `VISION_MODEL`
   - 用户给的 key 调用失败（401/模型不存在等）→ 报告错误，问用户 key 是否正确、用哪家服务，或建议换一家

5. **安全**：绝不打印、回显或提交 API Key；`.env` 不得提交 git

6. **验证**：配置完成后，用一张用户提供的图片（或请用户给一张）实测一次识别，确认可用再交付

## 安装

将本目录（`dsh-vision-skill` 文件夹）整体复制到以下任一位置：

| 位置                                    | 生效范围                           |
| ------------------------------------- | ------------------------------ |
| `~/.dsh/skills/dsh-vision-skill/`     | 用户级，所有 DSH 项目可用（推荐）            |
| `<项目根>/.dsh/skills/dsh-vision-skill/` | 仅该项目可用（项目根 = 含 `.git` 的最近祖先目录） |

DSH 会自动发现 skill，**无需重启**；复制后新会话即可在 skill 目录中看到 `dsh-vision-skill`。

## 配置（只需一个 Key）

```bash
cd dsh-vision-skill
cp .env.example .env
# 编辑 .env，填入 VISION_API_KEY
```

**Gemini（推荐）**：key 以 `AIza` 开头即可，自动使用 **Gemini 原生 API**（`POST /v1beta/interactions`，图片 base64 inline），默认模型 `gemini-3.1-flash-lite`（便宜快速，支持视觉）。申请：https://aistudio.google.com/apikey

**阿里云千问**：填阿里云百炼 key 即可，走 OpenAI 兼容格式，自动使用 `qwen-vl-max`（新用户有免费额度）。申请：https://bailian.console.aliyun.com/

**其他 OpenAI 兼容视觉 API**：改 `.env` 里两个字段（仅对非 Gemini 服务生效）：

```ini
VISION_BASE_URL=https://你的服务地址/v1
VISION_MODEL=你的视觉模型名
```

也可以不建 `.env`，直接导出环境变量（`VISION_API_KEY` / `VISION_BASE_URL` / `VISION_MODEL`）。兼容旧变量名 `DASHSCOPE_API_KEY` / `DASHSCOPE_BASE_URL`，也支持 `GEMINI_API_KEY`。

## 使用

直接向 AI 发图片即可，三种方式：

- 发送本地图片路径（或直接把图片文件拖进对话）
- 发送图片 URL
- 直接粘贴（复制）图片到剪贴板

AI 会调用 `vision.js` 自动识别并描述图片内容（默认中文回答）。

命令行方式（供 AI 内部使用）：

```bash
node vision.js "<图片绝对路径>" "这张图里有什么？"
node vision.js --url "https://example.com/a.jpg" "识别图中文字"
node vision.js --clipboard "描述这张图片"
```

## 依赖

零依赖（仅需 Node.js，macOS 剪贴板还需系统自带 Swift）。`vision.js` 内置极简 `.env` 解析，无需 `npm install`。

## 安全

- `.env` 包含 API Key，**不要提交到 git**（建议加入 `.gitignore`）
- AI 被明确要求绝不打印 Key

## 文件说明

| 文件                                  | 作用                                        |
| ----------------------------------- | ----------------------------------------- |
| `SKILL.md`                          | skill 定义（名称、描述、使用指令），DSH 自动加载             |
| `vision.js`                         | 核心脚本：图片 → base64/URL → OpenAI 兼容 API → 文字 |
| `clipboard.swift` / `clipboard.ps1` | macOS / Windows 剪贴板图片读取辅助脚本               |
| `.env.example`                      | 配置模板                                      |
