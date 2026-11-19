# Third-party components

Slop Spot uses these components. Their licenses remain separate from the project's MIT license.

| Component                                     | License    | Source                                                       |
| --------------------------------------------- | ---------- | ------------------------------------------------------------ |
| voi-slop-detect-380M model and tokenizer data | Apache-2.0 | https://huggingface.co/VoightKampffLabs/voi-slop-detect-380M |
| ONNX Runtime Web                              | MIT        | https://www.npmjs.com/package/onnxruntime-web                |
| Hugging Face Tokenizers.js                    | Apache-2.0 | https://github.com/huggingface/tokenizers.js                 |
| franc-min and language data                   | MIT        | https://github.com/wooorm/franc                              |

Model weights are downloaded from their pinned upstream revision, not committed to this repository. They are based on dmis-lab/UltraBERT-380M, also Apache-2.0 licensed. The model card documents the training data, evaluation, preprocessing, and limitations.

Production dependency metadata is available through `pnpm licenses list --prod`. The build copies installed dependency license files into `dist/licenses` when the package includes them.
