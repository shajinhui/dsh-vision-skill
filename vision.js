#!/usr/bin/env node
/**
 * vision.js — 独立识图脚本（零依赖，无需 npm install）
 *
 * 通过视觉模型 API 识别图片，返回文字描述。
 * - Gemini（key 以 AIza 开头）：使用 Gemini 原生 interactions API（POST /v1beta/interactions）
 * - 其他服务：使用 OpenAI 兼容格式（chat/completions）
 *
 * 用法:
 *   node vision.js <图片路径> [问题]
 *   node vision.js --url <图片链接> [问题]
 *   node vision.js --clipboard [问题]
 *   node vision.js --max-side 1600 --quality 82 <图片路径> [问题]
 *
 * 配置（同目录 .env 或环境变量，环境变量优先）:
 *   VISION_API_KEY     必填。API Key
 *   VISION_BASE_URL    可选。仅对非 Gemini 服务生效（OpenAI 兼容地址），默认阿里云 DashScope
 *   VISION_MODEL       可选。模型名，默认 qwen-vl-max（Gemini key 时默认 gemini-3.1-flash-lite）
 *   VISION_MAX_SIDE    可选。上传前自动缩放的最长边，默认 2048；设为 0 可关闭
 *   VISION_JPEG_QUALITY 可选。JPEG 压缩质量，默认 82
 *   兼容旧变量名: DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL / GEMINI_API_KEY
 *
 * Gemini 说明: 原生 API 的图片 URL 拉取功能在当前地区不可用，
 * 因此 URL 图片一律先下载转 base64 再发送（base64 inline 上限 20MB）。
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const os = require("os");
const { randomBytes } = require("crypto");
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

// Gemini 自动适配：key 以 AIza 开头（或设置 GEMINI_API_KEY）即视为 Gemini。
// Gemini 走原生 API（POST /v1beta/interactions，x-goog-api-key 认证，base64 inline）。
const isGemini = API_KEY.startsWith("AIza");

const BASE_URL =
  EXPLICIT_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
const MODEL = process.env.VISION_MODEL || (isGemini ? "gemini-3.1-flash-lite" : "qwen-vl-max");
const DEFAULT_MAX_SIDE = readIntegerEnv("VISION_MAX_SIDE", 2048, 0, 16384);
const DEFAULT_JPEG_QUALITY = readIntegerEnv("VISION_JPEG_QUALITY", 82, 1, 100);
const MAX_INLINE_BYTES = 18 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

function readIntegerEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

function parseIntegerOption(name, raw, min, max) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min}-${max} 之间的整数。`);
  }
  return value;
}

function parseArgs(argv = process.argv.slice(2)) {
  let imageSource = "", prompt = "", isUrl = false, useClipboard = false, noFallback = false;
  let maxSide = DEFAULT_MAX_SIDE, quality = DEFAULT_JPEG_QUALITY, noOptimize = false;
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    } else if (argv[i] === "--clipboard") {
      useClipboard = true;
    } else if (argv[i] === "--no-fallback") {
      noFallback = true;
    } else if (argv[i] === "--no-optimize") {
      noOptimize = true;
    } else if (argv[i] === "--max-side") {
      if (!argv[i + 1]) throw new Error("--max-side 后必须提供像素值。");
      maxSide = parseIntegerOption("--max-side", argv[++i], 256, 16384);
    } else if (argv[i] === "--quality") {
      if (!argv[i + 1]) throw new Error("--quality 后必须提供质量值。");
      quality = parseIntegerOption("--quality", argv[++i], 1, 100);
    } else if (argv[i] === "--url") {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) {
        throw new Error("--url 后必须提供图片链接。");
      }
      if (imageSource) throw new Error("只能提供一个图片链接。");
      isUrl = true;
      imageSource = argv[++i];
    } else if (argv[i].startsWith("--")) {
      throw new Error(`未知选项: ${argv[i]}`);
    } else {
      positional.push(argv[i]);
    }
  }

  if (useClipboard) {
    if (imageSource || isUrl) {
      throw new Error("--clipboard 不能和图片路径或 --url 同时使用。");
    }
    prompt = positional.join(" ");
  } else {
    if (!imageSource && positional.length > 0) imageSource = positional.shift();
    prompt = positional.join(" ");
  }

  if (/^https?:\/\//i.test(imageSource)) isUrl = true;
  if (!prompt) prompt = "请详细描述这张图片的内容。";
  if (noOptimize) maxSide = 0;
  return { imageSource, prompt, isUrl, useClipboard, noFallback, maxSide, quality };
}

function runClipboardHelper(command, args, options = {}) {
  try {
    execFileSync(command, args, {
      stdio: "pipe",
      timeout: 15000,
      ...options,
    });
  } catch (err) {
    const stderr = err.stderr?.toString().trim();
    throw new Error(stderr || err.message);
  }
}

function getClipboardReader() {
  if (process.platform === "darwin") {
    return (outPath) => {
      runClipboardHelper("/usr/bin/swift", [path.join(__dirname, "clipboard.swift"), outPath]);
      return outPath;
    };
  }
  if (process.platform === "win32") {
    return (outPath) => {
      runClipboardHelper(
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
        { windowsHide: true },
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
  const suffix = randomBytes(8).toString("hex");
  const outPath = path.join(os.tmpdir(), `vision-clipboard-${process.pid}-${suffix}.png`);
  try {
    reader(outPath);
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
      throw new Error("剪贴板辅助程序未生成有效图片。");
    }
    try {
      fs.chmodSync(outPath, 0o600);
    } catch {
      // Windows 等平台可能不支持 POSIX 权限，忽略即可。
    }
    return outPath;
  } catch (err) {
    try {
      fs.unlinkSync(outPath);
    } catch {
      // 辅助程序可能尚未创建文件，无需处理。
    }
    throw err;
  }
}

function cleanupTempImage(filePath) {
  if (!filePath) return;
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(`警告：无法清理临时图片: ${err.message}`);
    }
  }
}

function makeTempImagePath(extension) {
  const suffix = randomBytes(8).toString("hex");
  return path.join(os.tmpdir(), `vision-image-${process.pid}-${suffix}.${extension}`);
}

function mimeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
  };
  return mimeMap[ext] || "image/jpeg";
}

function extensionForMime(mime) {
  const normalized = mime.split(";", 1)[0].trim().toLowerCase();
  const extensionMap = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
  };
  return extensionMap[normalized] || "jpg";
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function inspectWithSips(filePath) {
  const output = execFileSync(
    "/usr/bin/sips",
    ["-g", "pixelWidth", "-g", "pixelHeight", filePath],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15000 },
  );
  const width = Number(/pixelWidth:\s*(\d+)/.exec(output)?.[1]);
  const height = Number(/pixelHeight:\s*(\d+)/.exec(output)?.[1]);
  if (!width || !height) throw new Error("无法读取图片尺寸。");
  return { width, height };
}

function findImageMagick() {
  for (const command of ["magick", "convert"]) {
    try {
      execFileSync(command, ["-version"], {
        stdio: "ignore",
        timeout: 3000,
      });
      return command;
    } catch {
      // 继续尝试下一个命令。
    }
  }
  return "";
}

function inspectWithImageMagick(command, filePath) {
  const args = command === "magick"
    ? ["identify", "-format", "%w %h", filePath]
    : [filePath, "-format", "%w %h", "info:"];
  const output = execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15000,
  }).trim();
  const [width, height] = output.split(/\s+/).map(Number);
  if (!width || !height) throw new Error("无法读取图片尺寸。");
  return { width, height };
}

function optimizeImageFile(source, options = {}) {
  const resolved = path.resolve(source);
  if (!fs.existsSync(resolved)) throw new Error(`文件不存在: ${resolved}`);

  const maxSide = options.maxSide ?? DEFAULT_MAX_SIDE;
  const quality = options.quality ?? DEFAULT_JPEG_QUALITY;
  const beforeBytes = fs.statSync(resolved).size;
  const originalMime = options.mime || mimeForPath(resolved);
  const baseResult = {
    filePath: resolved,
    mime: originalMime,
    cleanup: false,
    optimized: false,
    beforeBytes,
    afterBytes: beforeBytes,
  };
  if (!maxSide) return baseResult;

  const preservePng = originalMime === "image/png";
  const outputExtension = preservePng ? "png" : "jpg";
  const outputMime = preservePng ? "image/png" : "image/jpeg";
  const outputPath = makeTempImagePath(outputExtension);
  let dimensions;
  let keepOutput = false;

  try {
    if (process.platform === "darwin") {
      dimensions = inspectWithSips(resolved);
      if (Math.max(dimensions.width, dimensions.height) <= maxSide && beforeBytes < 1024 * 1024) {
        return { ...baseResult, ...dimensions };
      }
      const args = ["-Z", String(maxSide)];
      if (preservePng) {
        args.push("-s", "format", "png");
      } else {
        args.push("-s", "format", "jpeg", "-s", "formatOptions", String(quality));
      }
      args.push(resolved, "--out", outputPath);
      execFileSync("/usr/bin/sips", args, {
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 30000,
      });
    } else if (process.platform === "win32") {
      execFileSync(
        "powershell",
        [
          "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
          path.join(__dirname, "image-resize.ps1"),
          "-InputFile", resolved,
          "-OutputFile", outputPath,
          "-MaxSide", String(maxSide),
          "-JpegQuality", String(quality),
        ],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 30000 },
      );
    } else {
      const command = findImageMagick();
      if (!command) return baseResult;
      dimensions = inspectWithImageMagick(command, resolved);
      if (Math.max(dimensions.width, dimensions.height) <= maxSide && beforeBytes < 1024 * 1024) {
        return { ...baseResult, ...dimensions };
      }
      const resizeArgs = [resolved, "-auto-orient", "-resize", `${maxSide}x${maxSide}>`, "-strip"];
      if (!preservePng) resizeArgs.push("-quality", String(quality));
      resizeArgs.push(outputPath);
      execFileSync(command, resizeArgs, {
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 30000,
      });
    }

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) return baseResult;
    const afterBytes = fs.statSync(outputPath).size;
    if (afterBytes >= beforeBytes) return baseResult;

    let outputDimensions;
    try {
      if (process.platform === "darwin") outputDimensions = inspectWithSips(outputPath);
      else {
        const command = findImageMagick();
        if (command) outputDimensions = inspectWithImageMagick(command, outputPath);
      }
    } catch {
      // 尺寸只用于提示，不影响优化后的图片。
    }

    keepOutput = true;
    return {
      filePath: outputPath,
      mime: outputMime,
      cleanup: true,
      optimized: true,
      beforeBytes,
      afterBytes,
      ...dimensions,
      outputWidth: outputDimensions?.width,
      outputHeight: outputDimensions?.height,
    };
  } catch (err) {
    if (options.strict) throw err;
    return { ...baseResult, optimizationError: err.message };
  } finally {
    if (!keepOutput) cleanupTempImage(outputPath);
  }
}

function imageFileToDataUri(source, options = {}) {
  const optimized = optimizeImageFile(source, options);
  const data = fs.readFileSync(optimized.filePath);
  if (data.length > MAX_INLINE_BYTES) {
    if (optimized.cleanup) cleanupTempImage(optimized.filePath);
    throw new Error(
      `图片优化后仍有 ${formatBytes(data.length)}，超过安全上传限制；请缩小图片或调低 --max-side。`,
    );
  }
  return {
    dataUri: `data:${optimized.mime};base64,${data.toString("base64")}`,
    cleanupPath: optimized.cleanup ? optimized.filePath : "",
    optimization: optimized,
  };
}

/** 下载远程图片。 */
function downloadImage(urlStr, redirects = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    if (!/^https?:$/.test(u.protocol)) return reject(new Error("只支持 HTTP/HTTPS 图片链接。"));
    const transport = u.protocol === "https:" ? https : http;
    const req = transport.get(u, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 5) return reject(new Error("下载图片失败: 重定向次数过多。"));
        const nextUrl = new URL(res.headers.location, u).toString();
        return downloadImage(nextUrl, redirects + 1).then(resolve, reject);
      }
      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`下载图片失败: HTTP ${res.statusCode}`));
      }
      const declaredLength = Number(res.headers["content-length"] || 0);
      if (declaredLength > MAX_DOWNLOAD_BYTES) {
        res.destroy();
        return reject(new Error(`下载图片失败: 文件超过 ${formatBytes(MAX_DOWNLOAD_BYTES)}。`));
      }
      const chunks = [];
      let received = 0;
      res.on("error", reject);
      res.on("data", (chunk) => {
        received += chunk.length;
        if (received > MAX_DOWNLOAD_BYTES) {
          res.destroy(new Error(`下载图片失败: 文件超过 ${formatBytes(MAX_DOWNLOAD_BYTES)}。`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (buf.length === 0) return reject(new Error("下载图片失败: 响应内容为空。"));
        const mime = (res.headers["content-type"] || "image/jpeg").split(";", 1)[0].trim();
        if (!mime.startsWith("image/")) {
          return reject(new Error(`下载内容不是图片: ${mime || "未知类型"}`));
        }
        resolve({ buffer: buf, mime });
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("下载图片超时。")));
  });
}

async function downloadToDataUri(urlStr, options = {}) {
  const { buffer, mime } = await downloadImage(urlStr);
  const inputPath = makeTempImagePath(extensionForMime(mime));
  fs.writeFileSync(inputPath, buffer, { mode: 0o600 });
  try {
    const prepared = imageFileToDataUri(inputPath, { ...options, mime });
    return prepared;
  } finally {
    cleanupTempImage(inputPath);
  }
}

/** 拆分 data URI 为 { mime, base64 }。 */
function splitDataUri(dataUri) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUri);
  if (!m) throw new Error("无法解析图片数据（data URI 格式错误）");
  return { mime: m[1], base64: m[2] };
}

/** Gemini 原生 interactions API 请求（图片 base64 inline）。 */
function geminiRequest(model, prompt, base64Data, mimeType) {
  const url = new URL("https://generativelanguage.googleapis.com/v1beta/interactions");
  const body = JSON.stringify({
    model,
    input: [
      { type: "text", text: prompt },
      { type: "image", data: base64Data, mime_type: mimeType },
    ],
  });
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": API_KEY,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode >= 400) {
            return reject(new Error(`Gemini API ${res.statusCode}: ${data.slice(0, 300)}`));
          }
          try {
            const json = JSON.parse(data);
            // 原生 API 响应：steps[] 中 type=model_output 的 step 携带 content[].text
            const texts = [];
            for (const step of json.steps || []) {
              if (step.type === "model_output") {
                for (const part of step.content || []) {
                  if (part.text) texts.push(part.text);
                }
              }
            }
            resolve(texts.join("\n") || data);
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

/** OpenAI 兼容格式请求（非 Gemini 服务）。 */
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
  console.error("选项: --max-side <256-16384>  --quality <1-100>  --no-optimize  --no-fallback");
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs();
  } catch (err) {
    console.error(`参数错误: ${err.message}`);
    showUsage();
    process.exitCode = 2;
    return;
  }

  if (!API_KEY) {
    console.error("未配置 API Key。");
    console.error(`请在 ${ENV_FILE} 中设置 VISION_API_KEY（参考同目录 .env.example），`);
    console.error("或导出环境变量 VISION_API_KEY / GEMINI_API_KEY / DASHSCOPE_API_KEY。");
    console.error("Gemini 申请 Key: https://aistudio.google.com/apikey");
    console.error("阿里云百炼申请 Key: https://bailian.console.aliyun.com/");
    process.exit(1);
  }

  const { imageSource, prompt, isUrl, useClipboard, noFallback, maxSide, quality } = parsed;
  let source = imageSource;
  let clipboardTempPath = "";
  let optimizedTempPath = "";

  const tryClipboard = (isFallback) => {
    try {
      clipboardTempPath = readClipboardImage();
      source = clipboardTempPath;
      console.error(
        isFallback
          ? "（未提供可用图片路径，已自动回退读取系统剪贴板）"
          : "（已读取系统剪贴板图片）",
      );
      return true;
    } catch (err) {
      console.error("剪贴板读取失败:", err.message);
      return false;
    }
  };

  if (useClipboard) {
    if (!tryClipboard(false)) process.exit(1);
  } else if (source && !isUrl) {
    const resolved = path.resolve(source);
    if (!fs.existsSync(resolved)) {
      if (noFallback) {
        console.error(`文件不存在: ${resolved}`);
        process.exit(1);
      }
      if (!tryClipboard(true)) process.exit(1);
    }
  } else if (!source) {
    if (noFallback) {
      showUsage();
      process.exit(1);
    }
    if (!tryClipboard(true)) process.exit(1);
  }

  if (!source) {
    showUsage();
    process.exit(1);
  }

  try {
    let result;
    if (isGemini) {
      // 原生 API：图片一律 base64 inline（URL 先下载）
      const prepared = isUrl
        ? await downloadToDataUri(source, { maxSide, quality })
        : imageFileToDataUri(source, { maxSide, quality });
      optimizedTempPath = prepared.cleanupPath;
      if (prepared.optimization.optimized) {
        const item = prepared.optimization;
        const originalSize = item.width && item.height ? `${item.width}×${item.height}, ` : "";
        const outputSize = item.outputWidth && item.outputHeight
          ? `${item.outputWidth}×${item.outputHeight}, `
          : "";
        console.error(
          `（图片已优化: ${originalSize}${formatBytes(item.beforeBytes)} → ${outputSize}${formatBytes(item.afterBytes)}）`,
        );
      } else if (prepared.optimization.optimizationError) {
        console.error(`（图片优化不可用，已使用原图: ${prepared.optimization.optimizationError}）`);
      }
      const { mime, base64 } = splitDataUri(prepared.dataUri);
      result = await geminiRequest(MODEL, prompt, base64, mime);
    } else {
      let imageUrl = source;
      if (!isUrl) {
        const prepared = imageFileToDataUri(source, { maxSide, quality });
        optimizedTempPath = prepared.cleanupPath;
        if (prepared.optimization.optimized) {
          const item = prepared.optimization;
          const originalSize = item.width && item.height ? `${item.width}×${item.height}, ` : "";
          const outputSize = item.outputWidth && item.outputHeight
            ? `${item.outputWidth}×${item.outputHeight}, `
            : "";
          console.error(
            `（图片已优化: ${originalSize}${formatBytes(item.beforeBytes)} → ${outputSize}${formatBytes(item.afterBytes)}）`,
          );
        } else if (prepared.optimization.optimizationError) {
          console.error(`（图片优化不可用，已使用原图: ${prepared.optimization.optimizationError}）`);
        }
        imageUrl = prepared.dataUri;
      }
      result = await request({
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
    }
    console.log(result);
  } catch (err) {
    console.error("识图失败:", err.message);
    console.error("请检查 .env 中的 VISION_API_KEY / VISION_MODEL 是否正确。");
    process.exitCode = 1;
  } finally {
    cleanupTempImage(optimizedTempPath);
    cleanupTempImage(clipboardTempPath);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  downloadImage,
  imageFileToDataUri,
  optimizeImageFile,
  parseArgs,
  splitDataUri,
};
