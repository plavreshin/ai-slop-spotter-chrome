"""Optional native ONNX/tokenizer reference for comparison with the Chrome lab."""
import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

ort.disable_telemetry_events()

parser = argparse.ArgumentParser()
parser.add_argument("--model-dir", type=Path, required=True)
args = parser.parse_args()
text = "The release is delayed until Thursday. I found a bug in the account import this morning: rows with an empty country field get dropped without an error. I have a fix ready, but I want to run it against last week's export before we ship. Please hold off on sending the announcement. I will post the test results here after lunch and update the release notes if anything else changes."
tokenizer = Tokenizer.from_file(str(args.model_dir / "tokenizer.json"))
ids = tokenizer.encode(text).ids[:512]
session = ort.InferenceSession(str(args.model_dir / "model_fp16.onnx"), providers=["CPUExecutionProvider"])
logits = session.run(["logits"], {"input_ids": np.array([ids], dtype=np.int64), "attention_mask": np.ones((1, len(ids)), dtype=np.int64)})[0]
print(json.dumps({"runtime": ort.__version__, "tokens": len(ids), "ids": ids, "score": float(1 / (1 + np.exp(-logits[0, 0])))}))
