const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  downloadImage,
  imageFileToDataUri,
  optimizeImageFile,
  parseArgs,
  splitDataUri,
} = require("../vision.js");

function writeBmp(filePath, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const fileSize = 54 + rowSize * height;
  const buffer = Buffer.alloc(fileSize);
  buffer.write("BM");
  buffer.writeUInt32LE(fileSize, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(rowSize * height, 34);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = 54 + y * rowSize + x * 3;
      buffer[offset] = x % 256;
      buffer[offset + 1] = y % 256;
      buffer[offset + 2] = (x + y) % 256;
    }
  }
  fs.writeFileSync(filePath, buffer, { mode: 0o600 });
}

test("parses a custom clipboard prompt", () => {
  const parsed = parseArgs(["--clipboard", "识别", "报错内容"]);
  assert.equal(parsed.useClipboard, true);
  assert.equal(parsed.prompt, "识别 报错内容");
  assert.equal(parsed.imageSource, "");
});

test("parses a local image path and prompt", () => {
  const parsed = parseArgs(["/tmp/example.png", "解释", "界面"]);
  assert.equal(parsed.imageSource, "/tmp/example.png");
  assert.equal(parsed.prompt, "解释 界面");
  assert.equal(parsed.isUrl, false);
});

test("parses URL and optimization options", () => {
  const parsed = parseArgs([
    "--url", "https://example.com/screenshot.png",
    "--max-side", "1600",
    "--quality", "76",
    "查找错误",
  ]);
  assert.equal(parsed.isUrl, true);
  assert.equal(parsed.maxSide, 1600);
  assert.equal(parsed.quality, 76);
  assert.equal(parsed.prompt, "查找错误");
});

test("supports prompts beginning with dashes after separator", () => {
  const parsed = parseArgs(["image.png", "--", "--解释这个参数"]);
  assert.equal(parsed.prompt, "--解释这个参数");
});

test("rejects invalid and conflicting options", () => {
  assert.throws(() => parseArgs(["--url"]), /必须提供图片链接/);
  assert.throws(() => parseArgs(["--max-side", "100"]), /256-16384/);
  assert.throws(() => parseArgs(["--clipboard", "--url", "https://example.com/a.png"]), /不能和/);
});

test("splits a data URI", () => {
  assert.deepEqual(splitDataUri("data:image/png;base64,YWJj"), {
    mime: "image/png",
    base64: "YWJj",
  });
});

test("downloads an image through a redirect", async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/image" });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(Buffer.from("image-bytes"));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const downloaded = await downloadImage(`http://127.0.0.1:${port}/redirect`);
  assert.equal(downloaded.mime, "image/png");
  assert.equal(downloaded.buffer.toString(), "image-bytes");
});

test("rejects downloaded non-image content", async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("not an image");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  await assert.rejects(
    downloadImage(`http://127.0.0.1:${port}/file`),
    /不是图片/,
  );
});

test("encodes a small local image without leaving a temporary file", () => {
  const fixture = path.join(os.tmpdir(), `vision-test-${process.pid}.png`);
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  fs.writeFileSync(fixture, onePixelPng, { mode: 0o600 });
  try {
    const prepared = imageFileToDataUri(fixture, { maxSide: 2048, quality: 82 });
    assert.match(prepared.dataUri, /^data:image\/png;base64,/);
    assert.equal(prepared.cleanupPath, "");
  } finally {
    fs.rmSync(fixture, { force: true });
  }
});

test("optimizer can be disabled", () => {
  const fixture = __filename;
  const optimized = optimizeImageFile(fixture, { maxSide: 0 });
  assert.equal(optimized.filePath, fixture);
  assert.equal(optimized.optimized, false);
});

test("shrinks a large image when a system optimizer is available", (t) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-resize-test-"));
  const fixture = path.join(fixtureDir, "large.bmp");
  writeBmp(fixture, 1200, 800);
  try {
    const optimized = optimizeImageFile(fixture, { maxSide: 600, quality: 82, strict: true });
    if (!optimized.optimized) {
      t.skip("No supported system image optimizer is available");
      return;
    }
    assert.ok(optimized.afterBytes < optimized.beforeBytes);
    if (optimized.outputWidth && optimized.outputHeight) {
      assert.ok(Math.max(optimized.outputWidth, optimized.outputHeight) <= 600);
    }
    fs.rmSync(optimized.filePath, { force: true });
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});
