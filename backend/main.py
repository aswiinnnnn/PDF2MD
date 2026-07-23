import json
import os
import uuid
import shutil
from datetime import datetime
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
TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "temp")
UPLOADS_DIR = os.path.join(TEMP_DIR, "uploads")
MARKDOWNS_DIR = os.path.join(TEMP_DIR, "markdowns")
MAPPINGS_DIR = os.path.join(TEMP_DIR, "mappings")
LOGS_FILE = os.path.join(TEMP_DIR, "logs.json")

os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(MARKDOWNS_DIR, exist_ok=True)
os.makedirs(MAPPINGS_DIR, exist_ok=True)

# Serve uploaded images statically
app.mount("/temp", StaticFiles(directory=TEMP_DIR), name="temp")

class SaveLogRequest(BaseModel):
    message: str
    type: str = "info"
    timestamp: str = None

class SaveDocumentRequest(BaseModel):
    filename: str
    markdown: str
    image_mappings: dict

@app.get("/api/workspace-status")
async def get_workspace_status():
    """
    Returns the list of PDF files in the upload directory along with their statuses,
    and the saved console log history.
    """
    queue = []
    if os.path.exists(UPLOADS_DIR):
        for f in os.listdir(UPLOADS_DIR):
            if f.lower().endswith(".pdf"):
                md_exists = os.path.exists(os.path.join(MARKDOWNS_DIR, f"{f}.md"))
                queue.append({
                    "name": f,
                    "status": "success" if md_exists else "pending"
                })
    
    logs = []
    if os.path.exists(LOGS_FILE):
        try:
            with open(LOGS_FILE, "r", encoding="utf-8") as file:
                logs = json.load(file)
        except Exception:
            pass
            
    return {"queue": queue, "logs": logs}

@app.post("/api/save-log")
async def save_log(request: SaveLogRequest):
    """
    Appends a new console log entry to logs.json.
    """
    logs = []
    if os.path.exists(LOGS_FILE):
        try:
            with open(LOGS_FILE, "r", encoding="utf-8") as file:
                logs = json.load(file)
        except Exception:
            pass
            
    logs.append({
        "timestamp": request.timestamp or datetime.now().strftime("%I:%M:%S %p"),
        "message": request.message,
        "type": request.type
    })
    
    with open(LOGS_FILE, "w", encoding="utf-8") as file:
        json.dump(logs, file, indent=2)
        
    return {"status": "success"}

class ExportPDFRequest(BaseModel):
    markdown: str
    image_mappings: dict
    filename: str = "published_material.pdf"

@app.get("/api/documents")
async def get_documents():
    """
    Returns a dictionary of all documents currently saved in the backend workspace.
    """
    docs = {}
    if os.path.exists(MARKDOWNS_DIR):
        for f in os.listdir(MARKDOWNS_DIR):
            if f.endswith(".md"):
                filename = f[:-3] # removing .md gives original PDF filename
                md_path = os.path.join(MARKDOWNS_DIR, f)
                mapping_path = os.path.join(MAPPINGS_DIR, f"{filename}.json")
                
                with open(md_path, "r", encoding="utf-8") as file:
                    markdown_content = file.read()
                    
                image_mappings = {}
                if os.path.exists(mapping_path):
                    with open(mapping_path, "r", encoding="utf-8") as file:
                        try:
                            image_mappings = json.load(file)
                        except Exception:
                            pass
                
                docs[filename] = {
                    "markdown": markdown_content,
                    "imageMappings": image_mappings
                }
    return docs

@app.post("/api/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)):
    """
    Receives a PDF file and saves it in the backend temp uploads folder.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
        
    dest_path = os.path.join(UPLOADS_DIR, file.filename)
    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    return {"filename": file.filename, "status": "success"}

@app.post("/api/ocr")
async def ocr_pdf(
    filename: str = Form(...),
    dpi: int = Form(300)
):
    """
    Triggers OCR process on a PDF file already stored in the uploads directory,
    writing intermediate markdown page-by-page.
    """
    pdf_path = os.path.join(UPLOADS_DIR, filename)
    if not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail=f"PDF file '{filename}' not found. Please upload it first.")
        
    async def sse_event_generator():
        try:
            accumulated_markdown = []
            async for chunk in run_ocr_pipeline(pdf_path, dpi):
                if chunk.get("status") == "success":
                    accumulated_markdown.append(chunk.get("content", ""))
                    # Write to markdowns directory
                    md_path = os.path.join(MARKDOWNS_DIR, f"{filename}.md")
                    with open(md_path, "w", encoding="utf-8") as f:
                        f.write("\n\n---\n\n".join(accumulated_markdown))
                yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as e:
            err_chunk = {"status": "error", "page": 1, "error": f"Server stream error: {str(e)}"}
            yield f"data: {json.dumps(err_chunk)}\n\n"

    return StreamingResponse(sse_event_generator(), media_type="text/event-stream")

@app.post("/api/save-document")
async def save_document(request: SaveDocumentRequest):
    """
    Saves the edited markdown and image mappings to the backend storage.
    """
    md_path = os.path.join(MARKDOWNS_DIR, f"{request.filename}.md")
    mapping_path = os.path.join(MAPPINGS_DIR, f"{request.filename}.json")
    
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(request.markdown)
        
    with open(mapping_path, "w", encoding="utf-8") as f:
        json.dump(request.image_mappings, f, indent=2)
        
    return {"status": "success"}

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

@app.post("/api/clear-data")
async def clear_data():
    """
    Cleans up all files from the backend workspace directories.
    """
    for directory in [UPLOADS_DIR, MARKDOWNS_DIR, MAPPINGS_DIR, TEMP_DIR]:
        if os.path.exists(directory):
            for f in os.listdir(directory):
                # Don't delete the folders themselves, just their files
                file_path = os.path.join(directory, f)
                try:
                    if os.path.isfile(file_path) or os.path.islink(file_path):
                        os.unlink(file_path)
                    elif os.path.isdir(file_path) and f not in ["uploads", "markdowns", "mappings"]:
                        shutil.rmtree(file_path)
                except Exception as e:
                    print(f"Failed to delete {file_path}. Reason: {e}")
                    
    # Ensure folders exist
    os.makedirs(UPLOADS_DIR, exist_ok=True)
    os.makedirs(MARKDOWNS_DIR, exist_ok=True)
    os.makedirs(MAPPINGS_DIR, exist_ok=True)
    return {"status": "success"}

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
        
    clean_filename = os.path.basename(request.filename)
    if not clean_filename.lower().endswith(".pdf"):
        clean_filename += ".pdf"
        
    return FileResponse(
        path=output_pdf_path,
        media_type="application/pdf",
        filename=clean_filename
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
