"""Local model adapters. Heavy imports occur only on a cache miss."""
from __future__ import annotations

import hashlib
import importlib.metadata
import os
import platform
from pathlib import Path

import numpy as np

MODEL_ID = "mlx-community/GLM-OCR-bf16"
MODEL_REVISION = "24f15402e83baa0a80eeeaecf5480e172abc6f2e"
PROMPT = "Text Recognition:"
MAX_TOKENS = 4096


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def configuration(model_dir: Path | None = None) -> dict:
    versions = {}
    for package in ("rapidocr", "onnxruntime", "mlx-vlm", "mlx", "transformers", "numpy", "opencv-python"):
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = None
    identity = {"id": MODEL_ID, "revision": MODEL_REVISION}
    if model_dir is not None:
        # A local override is never silently identified as the official pinned
        # weights. Include all model/processor bytes in the cache identity.
        required = ("model.safetensors", "config.json", "preprocessor_config.json", "tokenizer.json")
        for name in required:
            if not (model_dir / name).is_file():
                raise ValueError(f"Missing GLM model file: {model_dir / name}")
        identity = {"local_files": {p.name: file_hash(p) for p in sorted(model_dir.iterdir())
                                     if p.is_file() and p.suffix in (".json", ".jinja", ".safetensors")}}
    return {"engine": "glm-rapid-hybrid-v1", "glm": identity, "versions": versions,
            "prompt": PROMPT, "temperature": 0.0, "max_tokens": MAX_TOKENS,
            "localization": "PP-OCRv6-small-onnx-cpu-character-boxes-v1",
            "crop": [195, 275, 1060, 2120]}


class LocalModels:
    def __init__(self, model_dir: Path | None = None):
        self.model_dir = model_dir
        self.rapid = None
        self.glm = None

    def localize(self, image: np.ndarray) -> list[dict]:
        if self.rapid is None:
            from rapidocr import RapidOCR, ModelType, OCRVersion
            self.rapid = RapidOCR(params={
                "Global.use_cls": False,
                "Global.return_word_box": True,
                "Global.return_single_char_box": True,
                "Det.ocr_version": OCRVersion.PPOCRV6,
                "Rec.ocr_version": OCRVersion.PPOCRV6,
                "Det.model_type": ModelType.SMALL,
                "Rec.model_type": ModelType.SMALL,
                "EngineConfig.onnxruntime.use_coreml": False,
            })
        result = self.rapid(image)
        if result.txts is None or result.boxes is None or result.word_results is None:
            raise RuntimeError("RapidOCR returned no character-localized text")
        if not (len(result.txts) == len(result.boxes) == len(result.word_results)):
            raise RuntimeError("RapidOCR returned inconsistent text/geometry lengths")
        lines = []
        for text, box, words in zip(result.txts, result.boxes, result.word_results):
            lines.append({"text": text, "box": np.asarray(box).tolist(),
                          "glyphs": [{"text": t, "score": float(s), "box": np.asarray(b).tolist()}
                                     for t, s, b in words]})
        # Reading order matches the benchmark. Exact-context alignment refuses
        # to guess when a detector's split/ordering cannot be reconciled.
        lines.sort(key=lambda row: (np.mean(np.asarray(row["box"])[:, 1]),
                                    np.mean(np.asarray(row["box"])[:, 0])))
        return lines

    def transcribe(self, image: np.ndarray) -> str:
        if platform.system() != "Darwin" or platform.machine() != "arm64":
            raise RuntimeError("Live GLM OCR requires an Apple Silicon Mac; cached processing and unit tests do not.")
        if self.glm is None:
            os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
            from huggingface_hub import snapshot_download
            from huggingface_hub.errors import LocalEntryNotFoundError
            from mlx_vlm import load
            from mlx_vlm.prompt_utils import apply_chat_template
            if self.model_dir is None:
                try:
                    path = snapshot_download(MODEL_ID, revision=MODEL_REVISION, local_files_only=True)
                except LocalEntryNotFoundError:
                    path = snapshot_download(MODEL_ID, revision=MODEL_REVISION)
            else:
                path = str(self.model_dir)
            model, processor = load(path, trust_remote_code=False)
            prompt = apply_chat_template(processor, model.config, PROMPT, num_images=1)
            self.glm = (model, processor, prompt)
        from mlx_vlm import generate
        from PIL import Image
        model, processor, prompt = self.glm
        # OpenCV images are BGR. GLM's PIL input must be RGB, including its
        # original colours; never feed an unwarped or grayscale surrogate.
        rgb = Image.fromarray(image[:, :, ::-1].copy())
        result = generate(model, processor, prompt, image=[rgb], temperature=0.0,
                          max_tokens=MAX_TOKENS, verbose=False)
        if result.generation_tokens >= MAX_TOKENS or result.finish_reason == "length":
            raise RuntimeError("GLM output reached the token limit; refusing to publish a truncated log")
        if not result.text or not result.text.strip():
            raise RuntimeError("GLM returned an empty transcript")
        return result.text
