#!/usr/bin/env node
/**
 * vision.js — 独立识图脚本（零依赖，无需 npm install）
 *
 * 通过 OpenAI 兼容格式的视觉模型 API 识别图片，返回文字描述。
 *
 * 用法:
 *   node vision.js <图片路径> [问题]
 *   node vision.js --url <图片链接> [问题]
 *   node vision.js --clipboard [问题]
 *
 * 配置（同目录 .env 或环境变量，环境变量优先）:
 *   VISION_API_KEY     必填。API Key
 *   VISION_BASE_URL    可选。OpenAI 兼容 API 地址，默认自动选择
 *   VISION_MODEL       可选。模型名，默认 qwen-vl-max（Gemini key 时默认 gemini-3.1-flash-lite）
 *   兼容旧变量名: DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL
 *
 * Gemini 自动适配: key 以 AIza 开头（或设置 GEMINI_API_KEY）时，
 * 自动使用 https://generativelanguage.googleapis.com/v1beta/openai/，
 * 外部图片 URL 会自动下载转 base64 后发送。
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const os = require("os");
const { execFileSync } = require("child_process");

// ---- 极简 .env 加载：不覆盖已存在的环境变量（shell 导出优先） ----
function loadEnv(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const ENV_FILE = path.join(__dirname, ".env");
loadEnv(ENV_FILE);

const EXPLICIT_BASE_URL =
  process.env.VISION_BASE_URL || process.env.DASHSCOPE_BASE_URL || "";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const API_KEY =
  process.env.VISION_API_KEY || GEMINI_KEY || process.env.DASHSCOPE_API_KEY || "";

// Gemini 自动适配：key 以 AIza 开头（或显式指定了 Gemini 端点）即为 Gemini。
// Gemini 走官方 OpenAI 兼容端点，且不支持直接传外部图片 URL（需先下载转 base64）。
const isGemini = EXPLICIT_BASE_URL
  ? EXPLICIT_BASE_URL.includes("generativelanguage")
  : API_KEY.startsWith("AIza");

const BASE_URL =
  EXPLICIT_BASE_URL ||
  (isGemini
    ? process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/"
    : "https://dashscope.aliyuncs.com/compatible-mode/v1");
const MODEL = process.env.VISION_MODEL || (isGemini ? "gemini-3.1-flash-lite" : "qwen-vl-max");

function parseArgs() {
  const argv = process.argv.slice(2);
  let imageSource = "", prompt = "", isUrl = false, useClipboard = false, noFallback = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--clipboard") {
      useClipboard = true;
    } else if (argv[i] === "--no-fallback") {
      noFallback = true;
    } else if (argv[i] === "--url" && argv[i + 1]) {
      isUrl = true;
      imageSource = argv[++i];
    } else if (!imageSource && !argv[i].startsWith("--")) {
      imageSource = argv[i];
    } else if (imageSource && !argv[i].startsWith("--")) {
      prompt = prompt ? prompt + " " + argv[i] : argv[i];
    }
  }
  if (/^https?:\/\//i.test(imageSource)) isUrl = true;
  if (!prompt) prompt = "请详细描述这张图片的内容。";
  return { imageSource, prompt, isUrl, useClipboard, noFallback };
}

function getClipboardReader() {
  if (process.platform === "darwin") {
    return (outPath) => {
      execFileSync("/usr/bin/swift", [path.join(__dirname, "clipboard.swift"), outPath], {
        stdio: "pipe",
      });
      return outPath;
    };
  }
  if (process.platform === "win32") {
    return (outPath) => {
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Sta",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.join(__dirname, "clipboard.ps1"),
          "-OutFile",
          outPath,
        ],
        { stdio: "pipe", windowsHide: true },
      );
      return outPath;
    };
  }
  return null;
}

function readClipboardImage() {
  const reader = getClipboardReader();
  if (!reader) {
    throw new Error(
      `剪贴板读取暂不支持当前平台: ${process.platform}（目前支持 macOS / Windows）`,
    );
  }
  const outPath = path.join(os.tmpdir(), `vision-clipboard-${Date.now()}.png`);
  return reader(outPath);
}

function resolveImageUrl(source, isUrl) {
  if (isUrl) return source;
  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved)) throw new Error(`文件不存在: ${resolved}`);
  const ext = path.extname(resolved).toLowerCase().replace(".", "");
  const mimeMap = { jpg: "jpeg", jpeg: "jpeg", png: "png", gif: "gif", webp: "webp", bmp: "bmp" };
  const data = fs.readFileSync(resolved);
  return `data:image/${mimeMap[ext] || "jpeg"};base64,${data.toString("base64")}`;
}

/** 下载远程图片并转 base64（Gemini 不接受直接传外部 URL）。 */
function downloadToBase64(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const transport = u.protocol === "https:" ? https : http;
    const req = transport.get(u, (res) => {
      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`下载图片失败: HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        const type = res.headers["content-type"] || "image/jpeg";
        resolve(`data:${type};base64,${buf.toString("base64")}`);
      });
    });
    req.on("error", reject);
  });
}

function request(payload) {
  const url = new URL(BASE_URL.replace(/\/?$/, "/") + "chat/completions");
  const body = JSON.stringify(payload);
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode >= 400) {
            return reject(new Error(`API ${res.statusCode}: ${data.slice(0, 300)}`));
          }
          try {
            resolve(JSON.parse(data)?.choices?.[0]?.message?.content || data);
          } catch {
            resolve(data);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function showUsage() {
  console.error("用法: node vision.js <图片路径> [问题]");
  console.error("      node vision.js --url <图片链接> [问题]");
  console.error("      node vision.js --clipboard [问题]");
}

async function main() {
  if (!API_KEY) {
    console.error("未配置 API Key。");
    console.error(`请在 ${ENV_FILE} 中设置 VISION_API_KEY（参考同目录 .env.example），`);
    console.error("或导出环境变量 VISION_API_KEY / DASHSCOPE_API_KEY。");
    console.error("阿里云百炼申请 Key: https://bailian.console.aliyun.com/");
    process.exit(1);
  }

  const { imageSource, prompt, isUrl, useClipboard, noFallback } = parseArgs();
  let source = imageSource;

  const tryClipboard = () => {
    try {
      source = readClipboardImage();
      console.error("（未提供可用图片路径，已自动回退读取系统剪贴板）");
      return true;
    } catch (err) {
      console.error("剪贴板读取失败:", err.message);
      return false;
    }
  };

  if (useClipboard) {
    if (imageSource || isUrl) {
      console.error("--clipboard 不能和图片路径或 --url 同时使用。");
      process.exit(1);
    }
    if (!tryClipboard()) process.exit(1);
  } else if (source && !isUrl) {
    const resolved = path.resolve(source);
    if (!fs.existsSync(resolved)) {
      if (noFallback) {
        console.error(`文件不存在: ${resolved}`);
        process.exit(1);
      }
      if (!tryClipboard()) process.exit(1);
    }
  } else if (!source) {
    if (noFallback) {
      showUsage();
      process.exit(1);
    }
    if (!tryClipboard()) process.exit(1);
  }

  if (!source) {
    showUsage();
    process.exit(1);
  }

  try {
    const imageUrl = isUrl && isGemini ? await downloadToBase64(source) : resolveImageUrl(source, isUrl);
    const result = await request({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            { type: "text", text: prompt },
          ],
        },
      ],
      stream: false,
      max_tokens: 1024,
    });
    console.log(result);
  } catch (err) {
    console.error("识图失败:", err.message);
    console.error("请检查 .env 中的 VISION_API_KEY / VISION_BASE_URL / VISION_MODEL 是否正确。");
    process.exit(1);
  }
}

main();
