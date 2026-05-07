#!/usr/bin/env python3
"""Generate seed data images and PDFs for the multi-CDN demo."""

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import lightgrey
import os

BASE = "seed"

# ── Provider headshots ──────────────────────────────────────────────

PROVIDERS = [
    ("Dr. Aisha Rahman", "Cardiology", "#2c5f8d"),
    ("Dr. Marcus Chen", "Pediatrics", "#2c8d5f"),
    ("Dr. Sofia Alvarez", "Emergency Medicine", "#8d2c5f"),
    ("Dr. James Okafor", "Orthopedics", "#5f8d2c"),
    ("Dr. Priya Subramaniam", "Internal Medicine", "#8d5f2c"),
]

# Try to find a usable font
def get_font(size):
    for name in ["Arial", "Helvetica", "DejaVuSans", "/System/Library/Fonts/Helvetica.ttc"]:
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()

for name, specialty, color in PROVIDERS:
    img = Image.new("RGB", (1024, 1024), color)
    draw = ImageDraw.Draw(img)
    font_large = get_font(64)
    font_small = get_font(48)

    # Center text manually since textbbox is available in newer Pillow
    try:
        bbox = draw.textbbox((0, 0), name, font=font_large)
        name_w = bbox[2] - bbox[0]
        name_h = bbox[3] - bbox[1]
    except Exception:
        name_w, name_h = draw.textsize(name, font=font_large) if hasattr(draw, 'textsize') else (400, 64)

    try:
        bbox = draw.textbbox((0, 0), specialty, font=font_small)
        spec_w = bbox[2] - bbox[0]
        spec_h = bbox[3] - bbox[1]
    except Exception:
        spec_w, spec_h = draw.textsize(specialty, font=font_small) if hasattr(draw, 'textsize') else (300, 48)

    cx, cy = 512, 512
    draw.text((cx - name_w / 2, cy - name_h - 20), name, fill="white", font=font_large)
    draw.text((cx - spec_w / 2, cy + 20), specialty, fill="white", font=font_small)

    lastname = name.split()[-1].lower()
    path = f"{BASE}/public/images/providers/{lastname}.jpg"
    img.save(path, quality=90)
    print(f"Created {path}")

# ── Logo ────────────────────────────────────────────────────────────

img = Image.new("RGB", (256, 256), "#1a3a5c")
draw = ImageDraw.Draw(img)
font = get_font(28)
try:
    bbox = draw.textbbox((0, 0), "DEMO\nHOSPITAL", font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
except Exception:
    tw, th = draw.textsize("DEMO\nHOSPITAL", font=font) if hasattr(draw, 'textsize') else (120, 60)

draw.text((128 - tw / 2, 128 - th / 2), "DEMO\nHOSPITAL", fill="white", font=font, align="center")
logo_path = f"{BASE}/public/images/logo.png"
img.save(logo_path)
print(f"Created {logo_path}")

# ── Patient portal PDFs ─────────────────────────────────────────────

PDFS = [
    ("after-visit-summary-sample.pdf", "After-Visit Summary", "Patient: Jane Doe\nDate: May 5, 2026\nProvider: Dr. Aisha Rahman\n"),
    ("pre-procedure-instructions-sample.pdf", "Pre-Procedure Instructions", "Patient: John Smith\nProcedure: Outpatient Surgery\nDate: May 10, 2026\n"),
    ("discharge-care-plan-sample.pdf", "Discharge Care Plan", "Patient: Maria Garcia\nAdmission: May 1, 2026\nDischarge: May 5, 2026\n"),
]

for filename, title, body in PDFS:
    path = f"{BASE}/private/docs/{filename}"
    c = canvas.Canvas(path, pagesize=letter)
    w, h = letter

    # Watermark
    c.saveState()
    c.setFont("Helvetica", 48)
    c.setFillColor(lightgrey)
    c.translate(w / 2, h / 2)
    c.rotate(45)
    c.drawCentredString(0, 0, "DEMO ONLY — NOT REAL PHI")
    c.restoreState()

    # Content
    c.setFont("Helvetica-Bold", 24)
    c.drawString(72, h - 72, title)
    c.setFont("Helvetica", 12)
    y = h - 120
    for line in body.split("\n"):
        c.drawString(72, y, line)
        y -= 20

    # Lorem ipsum medical flavor
    c.drawString(72, y - 20, "Lorem ipsum dolor sit amet, consectetur adipiscing elit.")
    c.drawString(72, y - 40, "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.")
    c.drawString(72, y - 60, "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.")
    c.drawString(72, y - 80, "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.")

    c.showPage()
    c.save()
    print(f"Created {path}")

print("Done.")
