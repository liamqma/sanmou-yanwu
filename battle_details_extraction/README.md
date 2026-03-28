# Battle Details Extraction

Extracts and validates OCR text from battle detail/log screenshots using PaddleOCR.

## Folder Structure

```
battle_details_extraction/
├── README.md               # This file
├── validate_ocr.py         # Main OCR extraction script
├── images/                 # Input screenshots (place .jpg files here)
│   ├── 1.jpg
│   └── 2.jpg
└── ocr_validation/         # Output (auto-created when script runs)
    ├── 1_crop.jpg          # Cropped region from 1.jpg (for visual inspection)
    ├── 1.txt               # Extracted text from 1.jpg (one line per entry)
    ├── 2_crop.jpg
    └── 2.txt
```

## Setup

The project uses the `venv` virtual environment at the project root, which has PaddleOCR pre-installed.

> **Requires Python 3.12.** PaddleOCR does not support Python 3.14+.

If the `venv` is not set up yet:
```bash
/opt/homebrew/bin/python3.12 -m venv venv
./venv/bin/pip install paddlepaddle paddleocr opencv-python --index-url https://pypi.org/simple/
```

## Usage

```bash
cd battle_details_extraction
PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True ../venv/bin/python3 validate_ocr.py
```

This will:
1. Crop the configured region (`x=180, y=268, w=870, h=1815`) from each image in `images/`
2. Run PaddleOCR (Chinese, small-text mode) on the crop
3. Print extracted text with confidence scores to the console
4. Save the cropped image to `ocr_validation/<name>_crop.jpg`
5. Save the extracted text to `ocr_validation/<name>.txt`

## Configuration

Edit the constants at the top of `validate_ocr.py` to adjust:

| Constant | Default | Description |
|----------|---------|-------------|
| `IMAGES` | `images/1.jpg`, `images/2.jpg` | Input image paths |
| `REGION` | `(180, 268, 870, 1815)` | Crop region: `(x, y, width, height)` |
| `OUTPUT_DIR` | `ocr_validation/` | Output directory for crops and text files |

## OCR Accuracy

In testing on battle detail log screenshots (1080×2340 px), most lines are extracted at **94–99% confidence**. Known minor issues:
- Occasional missing `[` bracket at start of hero name (e.g. `孟获]` instead of `[孟获]`)
- Very first line may be truncated if the scroll position cuts off the top of a line
