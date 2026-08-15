---
name: dsh-vision-skill
description: Give text-only AI agents image understanding through the bundled vision.js helper. Use when a user shares, pastes, or references a local image, screenshot, clipboard image, or image URL and asks to describe, analyze, OCR, debug, inspect, or recognize its content. Use especially when the current model cannot read images directly. Supports Gemini's native API and OpenAI-compatible vision services. Do not use when the host model can already inspect the supplied image directly without a helper.
---

# Analyze images

Use the bundled `vision.js` to convert an image into text that the current agent can reason about.

## Resolve the script

Resolve the Skill root from the directory containing this `SKILL.md`. DSH may expose it as the base directory in `<skill_resources>`; other compatible hosts may expose the Skill file path directly. Run `vision.js` by absolute path. Never guess or hard-code the installation directory.

## Choose the input mode

```bash
# Local file
node "<skill-root>/vision.js" "/absolute/path/image.png" "<question>"

# Remote image
node "<skill-root>/vision.js" --url "https://example.com/image.jpg" "<question>"

# Clipboard image
node "<skill-root>/vision.js" --clipboard "<question>"
```

Use the clipboard mode when the user pasted an image but the host provides no visible path. Clipboard capture supports macOS and Windows. If it fails, ask the user to save the image and provide its absolute path.

If a supplied local path does not exist, the helper falls back to the clipboard. Add `--no-fallback` when failure should be explicit.

## Handle large images

Allow the default optimization first: it limits the longest side to 2048px when the platform has a supported system image tool. For faster OCR or screenshots, use `--max-side 1600 --quality 76`. Use `--no-optimize` only when tiny visual details require the original image.

## Configure the provider

Read configuration from `<skill-root>/.env` or the process environment:

- `VISION_API_KEY` — required
- `VISION_MODEL` — optional model override
- `VISION_BASE_URL` — optional OpenAI-compatible endpoint; ignored for Gemini
- `VISION_MAX_SIDE` — optional maximum side in pixels; default `2048`
- `VISION_JPEG_QUALITY` — optional quality from 1 to 100; default `82`

Also accept the legacy variables `GEMINI_API_KEY`, `DASHSCOPE_API_KEY`, and `DASHSCOPE_BASE_URL`.

A Key beginning with `AIza` uses the Gemini native API and defaults to `gemini-3.1-flash-lite`. Other Keys use the OpenAI-compatible endpoint and default to DashScope with `qwen-vl-max`.

If no Key is configured, instruct the user to copy `.env.example` to `.env` and set `VISION_API_KEY`. Never print, echo, log, or commit a Key.

## Return the result

Use the helper output as image context, then answer the user's actual question. Match the user's language. Do not merely repeat a generic image description when the user asked for OCR, debugging, UI review, or another specific outcome.

If the API call fails, report the concise error and ask the user to check the Key, model, or endpoint. Do not expose request headers or secrets.
