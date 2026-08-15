const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  downloadImage,
  imageFileToDataUri,
  parseArgs,
  splitDataUri,
} = require("../vision.js");

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

test("parses a URL and prompt", () => {
  const parsed = parseArgs([
    "--url", "https://example.com/screenshot.png",
    "查找错误",
  ]);
  assert.equal(parsed.isUrl, true);
  assert.equal(parsed.prompt, "查找错误");
});

test("supports prompts beginning with dashes after separator", () => {
  const parsed = parseArgs(["image.png", "--", "--解释这个参数"]);
  assert.equal(parsed.prompt, "--解释这个参数");
});

test("rejects invalid and conflicting options", () => {
  assert.throws(() => parseArgs(["--url"]), /必须提供图片链接/);
  assert.throws(() => parseArgs(["--max-side", "1600"]), /未知选项/);
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

test("base64-encodes the original local image bytes without modification", () => {
  const fixture = path.join(os.tmpdir(), `vision-test-${process.pid}.png`);
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  fs.writeFileSync(fixture, onePixelPng, { mode: 0o600 });
  try {
    const dataUri = imageFileToDataUri(fixture);
    assert.match(dataUri, /^data:image\/png;base64,/);
    const { base64 } = splitDataUri(dataUri);
    assert.deepEqual(Buffer.from(base64, "base64"), onePixelPng);
  } finally {
    fs.rmSync(fixture, { force: true });
  }
});
