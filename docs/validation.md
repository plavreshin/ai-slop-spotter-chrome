# Validation record

Browser and model checks completed on November 18, 2026. These results apply to the tested machine and model revision. They do not measure detection accuracy.

## Automated checks

`pnpm check` passed formatting, typed Oxlint, TypeScript 7, 38 Vitest tests, Fallow dead-code, duplication and architecture checks, and the production build. The recovery and validation tests were added on November 19, 2026.

The tests cover message eligibility, language filtering, code removal, pause settings, and runtime request validation. They also check score styling and explanations, timestamp placement, edited messages, channel changes, pause and resume, and model deletion.

A viewport test verifies that the content script does not extract offscreen message bodies or send them for analysis. It also checks that the script ignores results after a message leaves view. A separate check verifies that scores return after resuming from a background tab.

Recovery tests simulate worker crashes, unanswered requests, malformed replies, GPU session errors, and cache failures. Download tests reject incomplete files and incorrect checksums. Background tests check Slack page authorization, one offscreen document for concurrent requests, and readiness recovery after the original download request is lost. GPU-loss recovery is simulated in tests; the browser's GPU was not reset.

## Browser and native scores

The sample in `scripts/reference.py` produced identical 79-token ID sequences with the native Rust tokenizer and Tokenizers.js. Both used the pinned tokenizer files.

| Runtime                                     | Model score  |
| ------------------------------------------- | ------------ |
| Native ONNX Runtime 1.32.0, CPU, FP16 graph | 0.9997519851 |
| ONNX Runtime Web 1.31.1, WebGPU, FP16 graph | 0.9997284079 |

The absolute score difference was about 0.000024. This compares two implementations using the same exported model. It does not test whether the model correctly identifies AI writing.

In Chrome 157.0.8103.78, a 79-token analysis took 391 ms with the model already loaded. A repeated sample reached the 512-token limit, returned `truncated: true`, and took 926 ms. Timings vary with GPU load, text length, and initial compilation.

A separate disposable Chrome session loaded the cached model and scored the sample after offline mode was enabled and the previous offscreen document was closed. Other browser sessions stayed online.

## Slack browser checks

Browser checks used agent-browser over Chrome CDP in a signed-in Chrome session. The unpacked extension was loaded through Chrome's extension directory picker, and the full model download and loading sequence completed there.

The live Slack page contained the expected `.c-message_kit__message` and `.c-message_kit__blocks` elements. It did not have `.c-message_kit__header` wrappers, so badge placement was adapted to direct timestamp links in the content column.

A temporary test message, labeled as a local DOM test, verified:

- Real inference through the content script, background router, offscreen document, and inference worker.
- A red badge immediately after the timestamp, outside its link.
- The explanation popover and its close control.
- An identical editable draft remaining unmarked.
- Badge removal on pause, return after resuming from another tab, and updates after text edits.

The temporary test message was removed. No Slack message was posted or edited. This repository contains no real channel contents.

The score-display update was also verified on short automated notifications. Scores below the threshold appeared with neutral styling beside timestamps, and their explanations included the short-message reliability note. A local viewport fixture received a score while an identical offscreen fixture did not. Moving the visible fixture outside the viewport removed its badge. Neither test scrolled Slack or requested channel history; both fixtures were removed afterward.

## Accessibility

The local model test page passed axe-core 4.12.1 with zero violations across 33 passing checks. The popup page passed with zero violations across 35 passing checks. The badge fixture had zero violations; axe requested manual review of contrast and the test-only editable draft's ARIA label.

## Limits of this verification

Other operating systems, GPU vendors, and Chrome versions have not been tested. The extension declares Chrome 120 as its minimum and checks for WebGPU FP16 support at runtime. Slack DOM changes can require selector updates. The model is English-only, and these tests do not establish accuracy on a real Slack corpus.
