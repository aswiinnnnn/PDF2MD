import base64
import os
import re
import httpx
import fitz  # PyMuPDF

SYSTEM_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "prompts", "system_prompt.txt")
USER_PROMPT_PATH = os.path.join(os.path.dirname(__file__), "prompts", "user_prompt.txt")

def load_env():
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    os.environ[key.strip()] = val.strip().strip('"').strip("'")

load_env()

def get_selected_model():
    provider = os.getenv("MODEL_PROVIDER", "qwen").lower()
    if provider == "google":
        return os.getenv("MODEL_GOOGLE", "gemma-3-4b-it-q4_k_m")
    else:
        return os.getenv("MODEL_QWEN", "qwen2-vl-7b-instruct")

def get_prompts():
    with open(SYSTEM_PROMPT_PATH, "r", encoding="utf-8") as f:
        system_prompt = f.read()
    with open(USER_PROMPT_PATH, "r", encoding="utf-8") as f:
        user_prompt_template = f.read()
    return system_prompt, user_prompt_template

from datetime import datetime

def log_debug(msg: str):
    log_path = os.path.join(os.path.dirname(__file__), "ocr_debug.log")
    try:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    except:
        pass

async def run_ocr_pipeline(pdf_path: str, dpi: int = 300):
    """
    Renders pages of a PDF to PNG base64, sends them to LM Studio,
    and yields processed markdown chunks page-by-page.
    """
    log_debug(f"--- Pipeline Start: {pdf_path} (DPI: {dpi}) ---")
    try:
        system_prompt, user_prompt_template = get_prompts()
        doc = fitz.open(pdf_path)
        total_pages = len(doc)
        log_debug(f"Initialization success. Pages count: {total_pages}")
    except Exception as e:
        log_debug(f"Initialization error: {str(e)}")
        yield {"status": "error", "page": 1, "error": f"OCR initialization failed: {str(e)}"}
        return
        
    start_placeholder_idx = 1
    placeholder_pattern = re.compile(r"\[IMAGE_PLACEHOLDER_(\d+):\s*([^\]]+)\]")
    
    for page_idx in range(total_pages):
        log_debug(f"Processing page {page_idx + 1}/{total_pages}")
        page = doc.load_page(page_idx)
        # Render page to image at specified DPI
        zoom = dpi / 72  # default resolution is 72 dpi
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        
        # Get PNG bytes
        png_bytes = pix.tobytes("png")
        base64_image = base64.b64encode(png_bytes).decode("utf-8")
        
        # Prepare prompts
        user_prompt = user_prompt_template.format(
            page_num=page_idx + 1,
            start_placeholder_idx=start_placeholder_idx
        )
        
        # Call LM Studio API (local)
        payload = {
            "model": get_selected_model(),
            "messages": [
                {
                    "role": "system",
                    "content": system_prompt
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{base64_image}"
                            }
                        },
                        {
                            "type": "text",
                            "text": user_prompt
                        }
                    ]
                }
            ],
            "max_tokens": 2048,
            "temperature": 0.0
        }
        
        yield {"status": "processing", "page": page_idx + 1, "total": total_pages}
        
        log_debug(f"Sending page {page_idx + 1} VLM request (image base64 len: {len(base64_image)})")
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                response = await client.post(
                    "http://127.0.0.1:1234/v1/chat/completions",
                    json=payload
                )
                log_debug(f"Page {page_idx + 1} response status: {response.status_code}")
                response.raise_for_status()
                res_data = response.json()
                markdown_chunk = res_data["choices"][0]["message"]["content"]
                log_debug(f"Page {page_idx + 1} transcribed text length: {len(markdown_chunk)}")
                
                # Scan for placeholders to adjust start index for next page
                placeholders = placeholder_pattern.findall(markdown_chunk)
                if placeholders:
                    max_num = max(int(match[0]) for match in placeholders)
                    start_placeholder_idx = max_num + 1
                
                yield {
                    "status": "success",
                    "page": page_idx + 1,
                    "total": total_pages,
                    "content": markdown_chunk
                }
        except Exception as e:
            log_debug(f"Page {page_idx + 1} VLM error: {str(e)}")
            yield {
                "status": "error",
                "page": page_idx + 1,
                "total": total_pages,
                "error": str(e)
            }
