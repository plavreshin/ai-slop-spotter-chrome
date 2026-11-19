export const MODEL_REVISION = "a109d591b8b62541f362d873765900380b2bd0ea";
export const MODEL_URL = `https://huggingface.co/VoightKampffLabs/voi-slop-detect-380M/resolve/${MODEL_REVISION}`;
export const MODEL_CACHE = `slop-spot-${MODEL_REVISION}-fp16`;
export const MODEL_ASSETS = [
  {
    path: "tokenizer.json",
    bytes: 3523470,
    sha256: "38734bb17ef19f84c67b5eb5692bea19801ffd02cb5c5ffc11429e76b0242e08",
  },
  {
    path: "tokenizer_config.json",
    bytes: 822,
    sha256: "28d01faba677a0a906362e4feab32de4ca40466a43798204d2e296ba4bb4c658",
  },
  {
    path: "onnx/model_fp16.onnx",
    bytes: 757062182,
    sha256: "f4768ae821434a421bc76563a39c8bf73770f644ba98ab597a574468dbbdc525",
  },
] as const;
export const TOTAL_BYTES = MODEL_ASSETS.reduce((total, asset) => total + asset.bytes, 0);
export function cacheKey(path: string): string {
  return `${MODEL_URL}/${path}`;
}
