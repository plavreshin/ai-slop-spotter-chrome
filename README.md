# Slop Spot

A Chrome extension that shows AI scores beside visible Slack messages. It analyzes text on your device with ONNX Runtime and WebGPU. Messages stay on your device. The extension has no analytics or tracking.

## Install from source

You need Node.js 24 or later, pnpm 12, and Chrome with graphics acceleration and WebGPU FP16 support. Chrome 120 is the minimum declared version. GPU support depends on your hardware and browser settings.

```sh
pnpm install --frozen-lockfile
pnpm build
```

1. Open `chrome://extensions` in the Chrome profile you use for Slack.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose this repository's `dist` directory.
4. Open Slop Spot from Chrome's extensions menu.
5. Select **Download model · 761 MB** and wait for **Ready**. Keep Chrome open. You can close the popup and reopen it to check progress. Each Chrome profile has its own model download.
6. Reload Slack. Scanning starts automatically when the model is ready. Use **Pause scanning** to stop it.

After pulling updates, run `pnpm install --frozen-lockfile` and `pnpm build`. Select **Reload** on Slop Spot in `chrome://extensions`, then reload Slack. Keep the repository at the same path so Chrome retains the extension ID and downloaded model. This project uses manual installation and has no Chrome Web Store package.

## What gets scanned

- Messages and thread replies currently in view on Slack.
- English prose, including short messages. The language check ignores code blocks and URLs. It can misidentify the language, especially for short messages.
- The first 512 tokens, the text units the model reads. The badge explanation states when the model read only part of a message.

Slop Spot analyzes one visible message at a time and checks it again after edits. When a message leaves view, the extension discards its saved text and score. It also ignores results that arrive after the message has left view. Returning to a message can trigger another analysis.

Slop Spot does not scan drafts, attachment contents, linked pages, or channel history. It does not use Slack's API, queue offscreen messages for analysis, or poll the message list. Messages with no prose or a language the check excludes remain unmarked.

Every analyzed message gets a score beside its timestamp or message body. Scores at or above the threshold are red. Lower scores use neutral styling. The default threshold is 75%, the model author's cutoff for generated text. Messages with fewer than 50 prose words include a reliability note.

Open Slop Spot to change **Highlight scores at or above** or use **Pause scanning**. Pausing hides scores and stops new analysis. **Delete model** removes the downloaded files and stops scanning until you download the model again.

## Read the score correctly

`AI score 92%` estimates how much text AI wrote or edited. It is not a 92% probability that a person used AI. The model was trained to estimate the fraction of words an AI model changed or generated. It can flag human writing and miss AI writing. Scores are less reliable for short, paraphrased, mixed-language, and unfamiliar text.

Select a badge for the score, threshold, input length, and explanation. A score is not proof of AI use or human authorship. An unmarked message may have been skipped.

## Model and local storage

The extension uses [VoightKampffLabs/voi-slop-detect-380M](https://huggingface.co/VoightKampffLabs/voi-slop-detect-380M), pinned to revision `a109d591b8b62541f362d873765900380b2bd0ea`.

The FP16 model and tokenizer files total 760,586,474 bytes, about 761 MB. Downloads contact Hugging Face and its CDN without including Slack content. Each file must match its expected size and SHA-256 checksum before the extension saves it in Cache Storage. If a download is interrupted, retry it. Partial downloads restart from the beginning.

After the download, model loading and analysis work offline. Model files stay in the extension's Cache Storage. Settings stay in `chrome.storage.local`. Visible-message text and scores stay in memory. When a message leaves view, the extension discards its saved state. An analysis already in progress can finish, but its result is ignored. The extension does not save a message history.

The extension includes its JavaScript, worker, tokenizer, language detector, and ONNX WebAssembly runtime. Downloaded model weights and tokenizer configuration are data. The extension loads no executable code from a CDN.

The model requires WebGPU FP16 support. If Chrome cannot provide `shader-f16`, Slop Spot reports an error. There is no CPU-only or server fallback. Loading and running the model requires more memory than the 761 MB download size.

## Permissions

| Permission                             | Purpose                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------ |
| Slack host access                      | Read rendered messages and add local badges on `app.slack.com/client/*`. |
| Hugging Face and `*.hf.co` host access | Download pinned model files and follow Hugging Face CDN redirects.       |
| `storage`                              | Save pause, threshold, and model-ready settings.                         |
| `unlimitedStorage`                     | Store the large local model without ordinary origin storage quotas.      |
| `offscreen`                            | Host a dedicated inference worker outside Slack's page context.          |

## Develop and verify

```sh
pnpm dev        # Watch and rebuild; reload the extension and Slack after changes.
pnpm check      # Format, typed lint, typecheck, tests, Fallow, and production build.
```

The Vite build produces a self-contained content script, extension pages, and an inference worker. Development uses file watching. It does not run a dev server or inject remote code.

To check the model, select **Test model** in Slop Spot. Enter English text and select **Analyze locally**. The result shows its score, token count, and analysis time. This manual test does not apply Slack's language filter.

An optional native reference script compares the same sample using the Rust tokenizer and CPU ONNX Runtime:

```sh
uv run --no-project --with onnxruntime --with tokenizers --with numpy \
  scripts/reference.py --model-dir /path/to/downloaded/model-directory
```

That directory must contain `model_fp16.onnx` and `tokenizer.json`. The script is developer tooling; Python is not part of the extension.

Browser verification uses agent-browser over Chrome CDP. Load the extension, use **Test model**, and check a Slack conversation. When testing offline mode, use a disposable browser session so other tabs are not affected. Any synthetic message fixtures must stay in the local DOM; do not post them to Slack.

See the [validation record](docs/validation.md) for the browser and native score comparison, browser checks, and verification limits.

The toolchain uses TypeScript 7.0.2, Vite 8.3.8, Oxlint 1.94.0, Oxfmt 0.79.0, and Fallow 3.43.2. The lockfile pins the installed versions.

## Architecture

```text
Slack DOM → content script → service-worker router
                                  ↓
                           offscreen document
                                  ↓
                         dedicated inference worker
                         tokenizer + ONNX + WebGPU
                                  ↓
                         local score → Slack badge
```

The worker owns one model session and a bounded inference queue. The content script processes visible messages sequentially, discards results when messages change, and keeps badges in Shadow DOM. Only trusted extension pages can download or delete the model. Slack content-script requests are limited to scoring on supported Slack pages while scanning is on.

`src/worker-client.ts` handles worker replies, request deadlines, and cleanup after worker errors. Requests wait up to 2 minutes, or 15 minutes for a model download. A deadline does not cancel GPU work already running. After an inference error, the next analysis loads a fresh session from the cached model. Model-state notifications restore scanning readiness if Chrome stops the original background request during a download.

Slack's DOM is not a stable public API. The selectors are isolated in `src/slack.ts`; a Slack redesign may require an update.

## Attribution

The model is Apache-2.0 licensed. ONNX Runtime and franc are MIT licensed. Hugging Face Tokenizers.js is Apache-2.0 licensed. See [NOTICE.md](NOTICE.md) for sources and license information.
