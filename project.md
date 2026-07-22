# PROJECT CONTEXT — Medical Study Material Extraction & Publishing Pipeline

> This document is the single source of truth for any AI coding agent working on this project.
> Read this fully before writing or editing any code.

---

## 1. WHO IS BUILDING THIS AND WHY

**Builder:** Founder of an educational website that provides medical students (BSc Nursing, MBBS, etc.) with study materials — previous year questions (PYQ), question banks (QB), notes, and textbook content.

**Problem:** Study materials are collected from various sources (BrainKart.com, OpenStax, cLovid-project, etc.) and the raw PDFs contain:
- Source watermarks (e.g. large `www.BrainKart.com` centered headers)
- Google Play Store app install banners and ads
- Website URLs embedded in the page
- Social media icon rows
- Subject navigation index tables (not study content)
- Page numbers and license/copyright footers
- EU/CC funding logos and branding

These cannot be uploaded to the website as-is. The pipeline extracts only the clean study content.

**Critical constraint — verbatim accuracy:**
Medical students are graded in exams on the **exact words from their textbook/notes**. If the extracted content is paraphrased, reworded, or "improved" by an LLM using its own knowledge, students who study from it will write wrong answers in their exams. Therefore, every sentence must be transcribed character-for-character as it appears in the source material.

---

## 2. PIPELINE OVERVIEW

```
PDF Input
   ↓
Split into page images (300 DPI)
   ↓
For each page → send image + prompts to local VLM (LM Studio)
   ↓
VLM returns Markdown chunk (verbatim content, ads stripped, images placeholdered)
   ↓
Chunks merged into single Markdown document
   ↓
[SWITCH TO EDIT MODE UI]
   ↓
User sees rendered Markdown with [IMAGE_PLACEHOLDER_N] markers highlighted
   ↓
User uploads actual image for each placeholder, sets image size
   ↓
Final document exported as PDF
```

---

## 3. APPLICATION STRUCTURE

This is a **single web application** (React frontend) with a **Python backend**.

The UI has two modes, switchable from a top tab/toggle:

### Mode A — OCR Mode
Used to process a new PDF through the VLM pipeline.

**UI Elements:**
- PDF file upload input
- DPI selector (default: 300)
- "Start Extraction" button
- Progress indicator: "Processing page X of Y..."
- Live log / output preview (Markdown rendered per chunk as it completes)
- "Download Raw Markdown" button (saves the merged output)
- Option to switch to Edit Mode once extraction is done (auto-loads the output)

**Backend flow (Python):**
1. Receive PDF upload
2. Use `pdf2image` with `poppler` at selected DPI to convert each page to PNG
3. For each page image:
   a. Encode image as base64
   b. Send to LM Studio local API (`http://localhost:1234/v1/chat/completions`)
   c. Payload: system prompt + user prompt (with page number) + image
   d. Receive markdown chunk
   e. Stream chunk to frontend via SSE (Server-Sent Events)
4. Merge all chunks in order
5. Save merged markdown to a temp file and return download link

**LM Studio API call structure:**
```python
{
  "model": "<loaded_model_name>",  # e.g. "qwen2-vl-7b-instruct"
  "messages": [
    {
      "role": "system",
      "content": "<SYSTEM_PROMPT>"  # verbatim from system_prompt.md
    },
    {
      "role": "user",
      "content": [
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/png;base64,<BASE64_IMAGE>"
          }
        },
        {
          "type": "text",
          "text": "<USER_PROMPT with page number substituted>"
        }
      ]
    }
  ],
  "max_tokens": 2048,
  "temperature": 0.0  # CRITICAL: always 0. Any randomness risks the model rephrasing content.
}
```

**Important:** `temperature` must always be `0.0`. Any randomness risks the model rephrasing content.

---

### Mode B — Edit Markdown / Image Placement Mode
Used to review extracted Markdown, insert images for placeholders, and export as PDF.

**UI Elements:**

**Left Panel — Markdown Editor:**
- Textarea with the raw Markdown content
- User can manually edit/correct any transcription errors
- Changes reflect live in the right panel

**Right Panel — Rendered Preview:**
- Renders the Markdown as formatted HTML
- `[IMAGE_PLACEHOLDER_N: label]` markers are highlighted with a colored badge (e.g. yellow/orange)
- Each placeholder badge has:
  - Placeholder number and label shown
  - "Upload Image" button
  - Image size selector: Small / Medium / Large / Custom (width × height in px or %)
  - Once image uploaded: shows a thumbnail preview in-place

**Bottom Bar:**
- "Export as PDF" button → triggers HTML-to-PDF conversion
- "Download Markdown" button → saves current markdown state

**Regex for placeholder detection:**
```
\[IMAGE_PLACEHOLDER_(\d+):\s*([^\]]+)\]
```
Groups: (1) placeholder number, (2) label text

**PDF Export approach:**
Render the final HTML (with images embedded) and use one of:
- Python backend: `WeasyPrint` (`pip install weasyprint`)
- Or: trigger browser `window.print()` with print-specific CSS for a clean output
- Preferred: WeasyPrint for consistent server-side output

---

## 4. TECH STACK

| Layer | Technology |
|---|---|
| Frontend | React (single-page, two-mode UI) |
| Styling | Tailwind CSS |
| Backend | Python (FastAPI) |
| PDF → Images | `pdf2image` + `poppler` at 300 DPI |
| VLM / OCR | LM Studio local API (OpenAI-compatible, port 1234) |
| Recommended VLM | `Qwen2-VL-7B-Instruct` or `MiniCPM-V-2.6` |
| Markdown rendering | `react-markdown` with `remark-gfm` for tables |
| PDF export | `WeasyPrint` (Python) |
| Streaming | FastAPI SSE → React EventSource |

---

## 5. FOLDER STRUCTURE (RECOMMENDED)

```
project-root/
├── backend/
│   ├── main.py                  # FastAPI app
│   ├── ocr_pipeline.py          # PDF→image→LMStudio→markdown logic
│   ├── pdf_export.py            # Markdown→HTML→PDF via WeasyPrint
│   ├── prompts/
│   │   ├── system_prompt.txt    # The VLM system prompt (verbatim from system_prompt.md)
│   │   └── user_prompt.txt      # The per-page user prompt template
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # Main app with mode switcher
│   │   ├── modes/
│   │   │   ├── OCRMode.jsx      # Mode A component
│   │   │   └── EditMode.jsx     # Mode B component
│   │   ├── components/
│   │   │   ├── MarkdownEditor.jsx
│   │   │   ├── MarkdownPreview.jsx
│   │   │   ├── PlaceholderBadge.jsx
│   │   │   └── ImageUploader.jsx
│   │   └── utils/
│   │       └── placeholderParser.js  # Regex to detect [IMAGE_PLACEHOLDER_N: label]
│   └── package.json
├── PROJECT_CONTEXT.md           # This file
├── system_prompt.md             # VLM system prompt documentation
└── user_prompt.md               # VLM user prompt documentation
```

---

## 6. KEY RULES FOR ALL CODE AGENTS

1. **Never change the system prompt logic** — it is carefully engineered for verbatim medical transcription.
2. **temperature must always be 0.0** in LM Studio API calls. Never make it configurable in the UI.
3. **Do not add any AI-generated content** to the markdown output at any stage of the pipeline.
4. **Image placeholder format is fixed:** `[IMAGE_PLACEHOLDER_N: label]` — do not change this format without updating the regex in the frontend and the system prompt.
5. **The edit mode must not auto-correct or reformat markdown** — the user's manual edits are intentional corrections to verbatim content.
6. **LM Studio runs locally** at `http://localhost:1234`. Do not add any external API calls for OCR or text generation.
7. **Context window awareness:** Each page is processed independently. Do not accumulate conversation history across pages — start a fresh message per page to avoid context overflow.
8. **DPI default is 300.** Do not lower it as a performance optimization without user consent — lower DPI degrades OCR accuracy on medical text.

---

## 7. IRRELEVANT CONTENT CATEGORIES TO STRIP (for prompt tuning reference)

The system prompt uses intent-based rules rather than hard-coded names, because irrelevant content varies across hundreds of PDF sources. The general categories are:

| Category | Description |
|---|---|
| Website/app branding | Any domain name, site logo, or app name overlaid on the page |
| URLs | Any http/https link anywhere on the page |
| App store promotion | Ratings, install buttons, download counts, Play Store / App Store banners |
| Social media | Any social platform icon, handle, or link row |
| Page wrapper numbers | Page X of Y, running headers/footers from the PDF distributor |
| License/copyright | CC licenses, "download for free at", attribution lines, funding acknowledgements |
| Navigation UI | Subject index tables, semester menus, chapter link grids — anything that was a clickable nav element in a website/app |
| Institutional branding | Project logos, EU funding badges, university/org marks |

The prompt rule is: **if it exists to promote or navigate a digital platform, exclude it. If it exists to teach a medical concept, include it verbatim.** This covers any new pattern without needing to update the prompt for each new source.

---

## 8. FUTURE IMPROVEMENTS (OUT OF SCOPE FOR NOW)

- Batch processing queue for multiple PDFs
- Human review side-by-side UI (original page image vs extracted markdown)
- Confidence scoring per page
- Auto-detection of page type (content page vs ad/index page) to skip non-content pages entirely
- Support for LaTeX math rendering (`$$...$$`) in the preview

---

*Last updated: project initialization*
*Maintain this file as the codebase evolves.*