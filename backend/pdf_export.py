import os
import re
import subprocess
from markdown_it import MarkdownIt

def markdown_to_html(markdown_text: str, image_mappings: dict) -> str:
    """
    Converts markdown text to HTML, replacing [IMAGE_PLACEHOLDER_N: label] markers
    with HTML <img> tags based on user uploaded images and size preferences.
    
    image_mappings format:
    {
       "1": {"url": "http://localhost:8000/static/img.png", "size": "medium", "customWidth": "", "customHeight": ""},
       ...
    }
    """
    md = MarkdownIt()
    # Convert markdown to basic HTML
    html_content = md.render(markdown_text)
    
    # Regex to find [IMAGE_PLACEHOLDER_N: label]
    placeholder_pattern = re.compile(r"\[IMAGE_PLACEHOLDER_(\d+):\s*([^\]]+)\]")
    
    def replace_placeholder(match):
        placeholder_num = match.group(1)
        label = match.group(2)
        
        # Check if we have an image mapping for this placeholder
        mapping = image_mappings.get(placeholder_num)
        if mapping and mapping.get("url"):
            url = mapping["url"]
            size = mapping.get("size", "medium")
            custom_width = mapping.get("customWidth", "")
            custom_height = mapping.get("customHeight", "")
            
            # Determine width/height style
            width_style = "max-width: 100%; height: auto;"
            if size == "small":
                width_style = "width: 30%; max-width: 250px; height: auto;"
            elif size == "medium":
                width_style = "width: 60%; max-width: 500px; height: auto;"
            elif size == "large":
                width_style = "width: 100%; height: auto;"
            elif size == "custom" and (custom_width or custom_height):
                w = f"width: {custom_width};" if custom_width else ""
                h = f"height: {custom_height};" if custom_height else ""
                width_style = f"{w} {h}"
                
            return f"""
            <div class="image-container" style="text-align: center; margin: 20px 0; page-break-inside: avoid;">
                <img src="{url}" style="{width_style} display: block; margin: 0 auto; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);" alt="{label}" />
                <div class="image-caption" style="font-style: italic; font-size: 0.9em; color: #555; margin-top: 8px; text-align: center;">{label}</div>
            </div>
            """
        else:
            # If no image uploaded, show a nice highlighted missing-image badge in print
            return f"""
            <div class="missing-image-placeholder" style="border: 2px dashed #f59e0b; padding: 15px; text-align: center; color: #d97706; background-color: #fef3c7; margin: 15px 0; border-radius: 6px; page-break-inside: avoid;">
                <strong>[MISSING IMAGE PLACEHOLDER {placeholder_num}]</strong><br/>
                <span style="font-size: 0.9em;">Label: {label}</span>
            </div>
            """
            
    html_content = placeholder_pattern.sub(replace_placeholder, html_content)
    
    # Wrap in standard page styling
    styled_html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Extracted Study Material</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        body {{
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.45;
            color: #334155;
            margin: 0;
            padding: 0;
            font-size: 10pt;
            background-color: #fff;
        }}
        
        h1, h2, h3, h4, h5, h6 {{
            color: #0f172a;
            font-weight: 700;
            margin-top: 18pt;
            margin-bottom: 6pt;
            page-break-after: avoid;
            break-after: avoid;
            letter-spacing: -0.01em;
        }}
        
        h1 {{
            font-size: 16pt;
            border-bottom: 2pt solid #0f172a;
            padding-bottom: 6pt;
            margin-top: 0;
            color: #0f172a;
        }}
        
        h2 {{
            font-size: 13pt;
            border-bottom: 1pt solid #e2e8f0;
            padding-bottom: 4pt;
            color: #0f172a;
        }}
        
        h3 {{
            font-size: 11pt;
            color: #16a34a;
        }}
        
        p {{
            margin-top: 0;
            margin-bottom: 8pt;
            color: #334155;
        }}
        
        ul, ol {{
            margin-top: 0;
            margin-bottom: 10pt;
            padding-left: 20pt;
        }}
        
        li {{
            margin-bottom: 4pt;
            color: #334155;
        }}
        
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 15pt 0;
            font-size: 9pt;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            overflow: hidden;
            page-break-inside: avoid;
            break-inside: avoid;
        }}
        
        th, td {{
            padding: 6pt 10pt;
            text-align: left;
        }}
        
        th {{
            background-color: #f8fafc;
            color: #1e293b;
            font-weight: 600;
            border-bottom: 2px solid #e2e8f0;
            text-transform: uppercase;
            font-size: 8pt;
            letter-spacing: 0.05em;
        }}
        
        td {{
            border-bottom: 1px solid #f1f5f9;
            color: #475569;
        }}
        
        tr:nth-child(even) {{
            background-color: #f8fafc;
        }}
        
        hr {{
            border: none;
            page-break-before: always;
            break-before: always;
            margin: 0;
            height: 0;
        }}
        
        blockquote {{
            margin: 15pt 0;
            padding: 10pt 12pt;
            background-color: #f8fafc;
            border-left: 3.5pt solid #94a3b8;
            color: #475569;
            border-radius: 0 4pt 4pt 0;
            font-style: italic;
            page-break-inside: avoid;
            break-inside: avoid;
        }}
        
        /* Print optimizations */
        @media print {{
            body {{
                padding: 0;
            }}
            @page {{
                margin: 15mm 20mm;
                size: A4;
            }}
            .page-break {{
                page-break-before: always;
                break-before: always;
            }}
        }}
    </style>
</head>
<body>
    {html_content}
</body>
</html>
"""
    return styled_html

def export_to_pdf(markdown_text: str, image_mappings: dict, output_pdf_path: str) -> bool:
    """
    Generates a PDF from markdown text and image mappings.
    Uses headless Microsoft Edge to convert HTML to PDF.
    """
    html_content = markdown_to_html(markdown_text, image_mappings)
    
    # Save temporary HTML file next to output PDF path
    base_dir = os.path.dirname(output_pdf_path)
    temp_html_path = os.path.join(base_dir, "temp_render.html")
    
    with open(temp_html_path, "w", encoding="utf-8") as f:
        f.write(html_content)
        
    try:
        edge_path = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
        if not os.path.exists(edge_path):
            raise FileNotFoundError("Microsoft Edge was not found at standard path.")
            
        cmd = [
            edge_path,
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            "--print-to-pdf-no-header",
            f"--print-to-pdf={output_pdf_path}",
            temp_html_path
        ]
        
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return True
    except Exception as e:
        print(f"Error printing to PDF: {e}")
        return False
    finally:
        if os.path.exists(temp_html_path):
            try:
                os.remove(temp_html_path)
            except:
                pass
