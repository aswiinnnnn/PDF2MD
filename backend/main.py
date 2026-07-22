import json
import os
import uuid
import shutil
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ocr_pipeline import run_ocr_pipeline
from pdf_export import export_to_pdf

app = FastAPI(title="PDF to Markdown Transcription Service")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust for production if necessary
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import tempfile

# Base directories
TEMP_DIR = os.path.join(tempfile.gettempdir(), "pdf2md_pipeline")
os.makedirs(TEMP_DIR, exist_ok=True)

# Serve uploaded images statically
app.mount("/temp", StaticFiles(directory=TEMP_DIR), name="temp")

class ExportPDFRequest(BaseModel):
    markdown: str
    image_mappings: dict

@app.post("/api/ocr")
async def ocr_pdf(
    file: UploadFile = File(...),
    dpi: int = Form(300)
):
    """
    Accepts a PDF file, processes it, and streams page-by-page OCR transcription
    results via Server-Sent Events (SSE).
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
        
    # Reset read cursor to start of file to avoid reading empty stream
    await file.seek(0)
    
    # Save uploaded PDF to a unique temp file
    file_id = str(uuid.uuid4())
    temp_pdf_path = os.path.join(TEMP_DIR, f"{file_id}.pdf")
    
    with open(temp_pdf_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    print(f"[Upload] PDF saved: {temp_pdf_path} (size: {os.path.getsize(temp_pdf_path)} bytes)")
        
    async def sse_event_generator():
        try:
            async for chunk in run_ocr_pipeline(temp_pdf_path, dpi):
                yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as e:
            err_chunk = {"status": "error", "page": 1, "error": f"Server stream error: {str(e)}"}
            yield f"data: {json.dumps(err_chunk)}\n\n"
        finally:
            # Clean up raw PDF when stream terminates
            if os.path.exists(temp_pdf_path):
                try:
                    os.remove(temp_pdf_path)
                except:
                    pass

    return StreamingResponse(sse_event_generator(), media_type="text/event-stream")

@app.post("/api/upload-image")
async def upload_image(file: UploadFile = File(...)):
    """
    Uploads an image to place into markdown placeholders, returning the static access URL.
    """
    allowed_exts = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in allowed_exts:
        raise HTTPException(status_code=400, detail=f"Unsupported image type. Allowed: {allowed_exts}")
        
    file_id = str(uuid.uuid4())
    filename = f"{file_id}{ext}"
    dest_path = os.path.join(TEMP_DIR, filename)
    
    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    # Return URL of static file
    url = f"http://localhost:8000/temp/{filename}"
    return {"url": url, "filename": filename}

@app.post("/api/export-pdf")
async def export_pdf(request: ExportPDFRequest):
    """
    Generates a PDF from markdown content and image placement choices.
    """
    file_id = str(uuid.uuid4())
    output_pdf_path = os.path.join(TEMP_DIR, f"{file_id}.pdf")
    
    success = export_to_pdf(request.markdown, request.image_mappings, output_pdf_path)
    if not success or not os.path.exists(output_pdf_path):
        raise HTTPException(status_code=500, detail="Failed to generate PDF.")
        
    return FileResponse(
        path=output_pdf_path,
        media_type="application/pdf",
        filename="transcribed_material.pdf"
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
