"""
ShopeeFood — Passive Human-Supervised OCR Workstation
======================================================
MODE: 100% Passive. User navigates; bot extracts, duplicate-checks, and saves.

STATE FLOW:
  1. SEKITARMU_LIST:
     - 100% Passive. Do absolutely nothing to eliminate UI lag.
  2. RESTAURANT_DETAIL:
     - Run WinRT OCR and UI hybrid scan to extract restaurant name, rating, reviews, discount.
     - Instantly run duplicate-checks against memory cache.
     - Display a warning if the restaurant is a duplicate so the human operator can go back immediately.
  3. INFORMATION_PAGE:
     - Run WinRT OCR and UI hybrid scan to extract address, opening hours, closed status.
  4. GOOGLE_MAPS:
     - Passive Clipboard extractor: when the user shares and copies the Maps link,
       the bot reads the device clipboard, extracts coordinates, and stores them.
  5. SAVE TRIGGER:
     - When the operator returns to the list page (SEKITARMU_LIST) and the current data contains a valid
       restaurant name and address, the data is automatically saved to SQLite and cached in memory.
"""

import uiautomator2 as u2
import sqlite3
import time
import os
import uuid
import json
import requests
import sys
import io
import re
import difflib
from PIL import Image, ImageDraw

# Force UTF-8 encoding for standard streams to avoid terminal encoding issues
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# ── Global Constants ──────────────────────────────────────────────────────────
ADDR_KW   = ["Jl.", "Jalan", "Kel.", "Kec.", "Kab.", "Gang", "Dusun", "Dk.", "Yogyakarta", "Sleman", "Bantul", "DIY", "No.", "Gg."]
HOURS_LBL = ["jam buka", "buka (wib)", "jam operasional", "waktu buka", "setiap hari", "setiap hari:"]
SKIP_PROMO_GENERIC = ["promo untukmu", "shopeevip", "lihat semua", "kamu mungkin suka", "diskon ongkir", "ongkir gratis", "iklan", "ulasan", "penilaian", "tiba dalam"]

# ── Review Filter ─────────────────────────────────────────────────────────────
# Only save restaurants with at least this many reviews (0 = no filter)
MIN_REVIEWS = 0

# ── Session Quota Limit ───────────────────────────────────────────────────────
MAX_SAVED_PER_SESSION = 50

# ── Paths ─────────────────────────────────────────────────────────────────────
DB_PATH        = os.path.join(os.path.dirname(__file__), 'database.sqlite')
STOP_FLAG      = os.path.join(os.path.dirname(__file__), 'stop_scraping.flag')
SCREENSHOT_DIR = os.path.join(os.path.dirname(__file__), 'debug_screenshots')
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

# ── States ────────────────────────────────────────────────────────────────────
class S:
    SEKITARMU_LIST    = "SEKITARMU_LIST"
    RESTAURANT_DETAIL = "RESTAURANT_DETAIL"
    INFORMATION_PAGE  = "INFORMATION_PAGE"
    GOOGLE_MAPS       = "GOOGLE_MAPS"
    ERROR             = "ERROR"

# ── Structured Emitter ────────────────────────────────────────────────────────
def emit(tag: str, payload: dict):
    """Print a structured line that server.js will parse for the live dashboard."""
    line = f"[{tag}] {json.dumps(payload, ensure_ascii=False)}"
    print(line, flush=True)

def should_stop():
    return os.path.exists(STOP_FLAG)

# ── Realtime Screenshot Refresh ───────────────────────────────────────────────
def snap_state(d, state: str):
    """Take a screenshot of the current state and overwrite latest_debug.png."""
    try:
        filename = f"{state.lower()}.png"
        path = os.path.join(SCREENSHOT_DIR, filename)
        d.screenshot(path)
        
        # Overwrite latest_debug.png for the frontend dashboard to render
        latest_path = os.path.join(SCREENSHOT_DIR, "latest_debug.png")
        d.screenshot(latest_path)
        
        # Emit event to notify the dashboard of screenshot refresh
        emit("SCREENSHOT", {"url": f"/screenshots/{filename}?t={int(time.time()*1000)}"})
    except Exception as e:
        print(f"  [📸] Screenshot failed: {e}", flush=True)

# ── Heuristics & Normalization ────────────────────────────────────────────────
RESTAURANT_INDICATORS = [
    "Penilaian", "Tiba dalam", "Promo Untukmu", "Kamu Mungkin Suka",
    "Diskon Ongkir", "ulasan", "Checkout", "Lihat Semua"
]

def normalize_name(s: str) -> str:
    # Remove leading non-alphabetic/non-numeric characters
    s = re.sub(r'^[^a-zA-Z0-9]+', '', s)
    # Lowercase and keep only alphanumeric characters
    return re.sub(r'[^a-z0-9]', '', s.lower())

def are_names_similar(name1: str, name2: str) -> bool:
    if not name1 or not name2:
        return False
    n1 = normalize_name(name1)
    n2 = normalize_name(name2)
    if not n1 or not n2:
        return False
    # Substring check
    if len(n1) >= 8 and (n1 in n2 or n2 in n1):
        return True
    # Length mathematical skip
    L1, L2 = len(n1), len(n2)
    if (2.0 * min(L1, L2)) / (L1 + L2) < 0.82:
        return False
    # Sequence matcher fallback
    ratio = difflib.SequenceMatcher(None, n1, n2).ratio()
    return ratio >= 0.82

def normalize_name_clean(s: str) -> str:
    """Cleans restaurant name from common OCR errors and ShopeeFood badges."""
    if not s:
        return ""
    s = s.strip().strip('.')
    # Strip leading number badges or parentheses e.g. "9 ", ") ", "0 "
    s = re.sub(r'^[)0-9]\s+', '', s)
    s = re.sub(r'\s*\.{3,}$', '', s)
    return s.strip()

def normalize_rating(rating_val) -> float:
    """Converts a rating string/float to a clean float between 1.0 and 5.0."""
    if not rating_val:
        return 0.0
    if isinstance(rating_val, (int, float)):
        return float(rating_val)
    s = str(rating_val).replace(',', '.').strip()
    match = re.search(r'\b([1-5]\.[0-9])\b', s)
    if match:
        return float(match.group(1))
    return 0.0

def normalize_reviews(reviews_str: str) -> int:
    """Parses review counts, converting '12.3RB' to 12300, stripping parentheses, decodes OCR errors."""
    if not reviews_str:
        return 0
    s = reviews_str.replace('(', '').replace(')', '').strip().upper()
    
    # Check if thousands (RB or K) is present
    has_thousands = any(k in s for k in ["RB", "K", "RIBU"])
    
    if has_thousands:
        # Clean up the string to focus on the prefix before RB/K
        prefix_match = re.search(r'([\d\sJjIiL|l!3,.]+)\s*(?:RB|K|RIBU)', s, re.IGNORECASE)
        if prefix_match:
            prefix = prefix_match.group(1).strip()
            
            # Pattern 1: Digit + OCR separator (J, j, I, i, l, |, !, comma, dot) + Digit
            # e.g., '1J1', '1I1', '1.1', '1,1'
            dec_match = re.search(r'^(\d)\s*[JjIiL|l!|.,]\s*(\d)$', prefix)
            if dec_match:
                try:
                    val = float(f"{dec_match.group(1)}.{dec_match.group(2)}")
                    return int(val * 1000)
                except:
                    pass
            
            # Pattern 1b: 3 digits where the middle digit is '3' (common OCR comma-to-3 error)
            # e.g., '131' -> '1.1', '133' -> '1.3'
            three_digit_match = re.search(r'^(\d)3(\d)$', prefix)
            if three_digit_match:
                try:
                    val = float(f"{three_digit_match.group(1)}.{three_digit_match.group(2)}")
                    return int(val * 1000)
                except:
                    pass
            
            # Pattern 2: Pure decimal float with dot/comma
            dec_clean = prefix.replace(',', '.')
            # Remove any spaces
            dec_clean = re.sub(r'\s+', '', dec_clean)
            try:
                val = float(dec_clean)
                return int(val * 1000)
            except ValueError:
                pass
                
            # Pattern 3: Just an integer before RB (e.g. "1 RB" -> 1000)
            int_match = re.search(r'^(\d+)', prefix)
            if int_match:
                try:
                    return int(int_match.group(1)) * 1000
                except:
                    pass
                    
        return 1000 # default fallback for "RB" or unknown count with "RB"
        
    # No thousands: simple integer
    # e.g. "120 Penilaian" -> 120
    digits_clean = re.sub(r'[^\d]', '', s)
    if digits_clean:
        try:
            return int(digits_clean)
        except:
            pass
            
    return 0

def normalize_address(addr_str: str) -> str:
    """Cleans address from non-ASCII emojis, maps icons, and extra spaces."""
    if not addr_str:
        return ""
    s = re.sub(r'[^\x00-\x7F]+', ' ', addr_str)
    s = re.sub(r'\s+', ' ', s)
    return s.strip()

def extract_valid_discount(text: str) -> str:
    """
    Extracts the actual discount value (e.g., 'Diskon 35%', '35%', 'Diskon Rp50RB')
    from raw text, ignoring generic headers.
    
    Also handles bare integer OCR output like '20' (ShopeeFood sometimes renders
    the discount as just a number in a badge) and converts it to 'Diskon 20%'.
    """
    if not text:
        return ""
    t_clean = text.strip()
    tl = t_clean.lower()
    
    # Ignore generic strings completely
    if any(g in tl for g in ["promo untukmu", "lihat semua", "kamu mungkin suka", "diskon ongkir", "ongkir gratis", "iklan", "shopeevip"]):
        return ""

    # Full match: 'Diskon 35%' or '35%' or 'Diskon 35% s/d Rp50RB'
    pct_match = re.search(r'(?:[Dd]iskon\s+)?(\d+%)', t_clean)
    if pct_match:
        coupon_match = re.search(r'(?:[Dd]iskon\s+)?\d+%\s*(?:s/d|hingga)?\s*(?:[Rr]p)?\s*\d+\s*(?:[Rr]b|[Kk])?', t_clean)
        if coupon_match:
            return coupon_match.group(0).strip()
        return pct_match.group(0).strip()

    # Cash discount: 'Diskon Rp50RB'
    cash_match = re.search(r'(?:[Dd]iskon\s+)(?:[Rr]p)?\s*\d+\s*(?:[Rr]b|[Kk])?', t_clean)
    if cash_match:
        return cash_match.group(0).strip()

    # Bare integer fallback: OCR reads just '20' or '35' from a discount badge
    # Only trigger if the text is JUST a number between 5-90 (realistic discount range)
    bare_int_match = re.match(r'^(\d{1,2})$', t_clean)
    if bare_int_match:
        val = int(bare_int_match.group(1))
        if 5 <= val <= 90:
            return f"Diskon {val}%"

    if ("diskon" in tl or "%" in tl) and re.search(r'\d+', tl):
        return t_clean
        
    return ""

# ── Native Windows OCR Engine & ROI Cropper ────────────────────────────────────
def run_ocr_on_device(d, roi=None, screenshot_path=None) -> list[dict]:
    """
    Takes a screenshot (or uses pre-captured screenshot_path), crops to ROI if provided, and runs Windows Native OCR.
    Returns a list of dict: {"text": str, "box": (left, top, right, bottom), "words": [...]}
    """
    scr_path = screenshot_path or os.path.join(SCREENSHOT_DIR, "ocr_temp.png")
    if not screenshot_path:
        try:
            d.screenshot(scr_path)
        except Exception as e:
            print(f"  [OCR] Failed taking screenshot: {e}", flush=True)
            return []

    try:
        img = Image.open(scr_path)
        width, height = img.size
    except Exception as e:
        print(f"  [OCR] Failed loading screenshot in PIL: {e}", flush=True)
        return []
    
    crop_box = (0, 0, width, height)
    if roi:
        left_pct, top_pct, right_pct, bottom_pct = roi
        crop_box = (
            int(left_pct * width),
            int(top_pct * height),
            int(right_pct * width),
            int(bottom_pct * height)
        )
        cropped_img = img.crop(crop_box)
        cropped_path = os.path.join(SCREENSHOT_DIR, "ocr_crop.png")
        cropped_img.save(cropped_path)
        active_path = cropped_path
    else:
        active_path = scr_path

    import asyncio
    from winrt.windows.storage import StorageFile
    from winrt.windows.graphics.imaging import BitmapDecoder
    from winrt.windows.media.ocr import OcrEngine
    from winrt.windows.globalization import Language

    async def _ocr():
        file = await StorageFile.get_file_from_path_async(os.path.abspath(active_path))
        stream = await file.open_async(0) # READ
        try:
            decoder = await BitmapDecoder.create_async(stream)
            bitmap = await decoder.get_software_bitmap_async()
            engine = OcrEngine.try_create_from_user_profile_languages()
            if not engine:
                engine = OcrEngine.try_create_from_language(Language("en-US"))
            if not engine:
                return []
                
            result = await engine.recognize_async(bitmap)
            
            lines_data = []
            for line in result.lines:
                words_list = []
                for w in line.words:
                    rect = w.bounding_rect
                    abs_box = (
                        int(rect.x + crop_box[0]),
                        int(rect.y + crop_box[1]),
                        int(rect.x + rect.width + crop_box[0]),
                        int(rect.y + rect.height + crop_box[1])
                    )
                    words_list.append({
                        "text": w.text,
                        "box": abs_box
                    })
                
                if words_list:
                    line_left = min(w["box"][0] for w in words_list)
                    line_top = min(w["box"][1] for w in words_list)
                    line_right = max(w["box"][2] for w in words_list)
                    line_bottom = max(w["box"][3] for w in words_list)
                    line_box = (line_left, line_top, line_right, line_bottom)
                else:
                    line_box = (0, 0, 0, 0)
                    
                lines_data.append({
                    "text": line.text,
                    "box": line_box,
                    "words": words_list
                })
            
            return lines_data
        finally:
            stream.close()
            if not screenshot_path:
                try: os.remove(scr_path)
                except: pass
            if roi:
                try: os.remove(cropped_path)
                except: pass

    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    def merge_overlapping_lines(lines: list[dict], y_tolerance=12) -> list[dict]:
        if not lines:
            return []
        # Sort by Y center
        sorted_lines = sorted(lines, key=lambda l: (l["box"][1] + l["box"][3]) / 2)
        merged_lines = []
        for line in sorted_lines:
            box = line["box"]
            if box == (0, 0, 0, 0):
                continue
            y_center = (box[1] + box[3]) / 2
            found = False
            for m in merged_lines:
                m_box = m["box"]
                m_y_center = (m_box[1] + m_box[3]) / 2
                if abs(y_center - m_y_center) <= y_tolerance:
                    m["segments"].append(line)
                    found = True
                    break
            if not found:
                merged_lines.append({
                    "segments": [line],
                    "box": list(box)
                })
        final_lines = []
        for m in merged_lines:
            segs = sorted(m["segments"], key=lambda s: s["box"][0])
            joined_text = ""
            prev_right = -1
            for s in segs:
                s_box = s["box"]
                s_text = s["text"].strip()
                if not s_text:
                    continue
                if prev_right != -1:
                    gap = s_box[0] - prev_right
                    if gap > 25:
                        joined_text += "   " + s_text
                    else:
                        joined_text += " " + s_text
                else:
                    joined_text = s_text
                prev_right = s_box[2]
            if not joined_text:
                continue
            left = min(s["box"][0] for s in segs)
            top = min(s["box"][1] for s in segs)
            right = max(s["box"][2] for s in segs)
            bottom = max(s["box"][3] for s in segs)
            words = sum((s.get("words", []) for s in segs), [])
            final_lines.append({
                "text": joined_text,
                "box": (left, top, right, bottom),
                "words": words
            })
        return final_lines

    lines_data = []
    try:
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(asyncio.run, _ocr())
                lines_data = future.result()
        else:
            lines_data = loop.run_until_complete(_ocr())
    except Exception as err:
        print(f"  [OCR] Error in WinRT OCR runner: {err}", flush=True)
        lines_data = []

    lines_data = merge_overlapping_lines(lines_data)
    return lines_data

# ── OCR + UI Hybrid Detail Scanner ─────────────────────────────────────────────
def validate_and_extract_detail_hybrid(d, name_target: str, screenshot_path=None, ocr_lines=None) -> tuple[bool, dict]:
    """
    OCR extraction for restaurant detail page.
    """
    w, h = d.window_size()
    
    lines_data = ocr_lines
    if lines_data is None:
        print("  [hybrid] Running WinRT OCR on detail region (Y=5%-68%)...", flush=True)
        lines_data = run_ocr_on_device(d, roi=(0.0, 0.05, 1.0, 0.68), screenshot_path=screenshot_path)
    else:
        # Filter lines lying in detail region (Y=5%-68%) — extended to capture promo/discount rows
        lines_data = [ld for ld in ocr_lines if ld["box"][1] >= 0.05 * h and ld["box"][3] <= 0.68 * h]
        
    ocr_name = ""
    ocr_rating = 0.0
    ocr_reviews = ""
    ocr_discount = ""
    ocr_eta = ""
    
    overlay_detections = []
    lines = [l["text"].strip() for l in lines_data if l["text"].strip()]
    print(f"  [hybrid] OCR parsed {len(lines)} lines from header region.", flush=True)
    
    review_pattern = re.compile(r'(?:^|\()?([\w,.]*\s*(?:RB|ribu|k)?\+?)\s*(?:Penilaian|ulasan|Penilalan|Penilaan|ulasar|Penilaiar|Penilalian)', re.IGNORECASE)
    rating_line_idx = -1
    for idx, l in enumerate(lines):
        rev_match = review_pattern.search(l)
        if rev_match:
            rating_line_idx = idx
            ocr_reviews = rev_match.group(1).replace('(', '').replace(')', '').strip()
            
            # Check rating on the same line
            rat_match = re.search(r'\b([345])[.,]([0-9])\b', l)
            if rat_match:
                try:
                    ocr_rating = float(f"{rat_match.group(1)}.{rat_match.group(2)}")
                except:
                    pass
            else:
                # Check adjacent lines (offset -1 and +1)
                for offset in [-1, 1]:
                    adj_idx = idx + offset
                    if 0 <= adj_idx < len(lines):
                        adj_line = lines[adj_idx]
                        rat_match = re.search(r'\b([345])[.,]([0-9])\b', adj_line)
                        if rat_match:
                            try:
                                ocr_rating = float(f"{rat_match.group(1)}.{rat_match.group(2)}")
                                break
                            except:
                                pass
            break
            
    name_parts = []
    matched_boxes = []
    SKIP_MAIN = ["group order", "ubah", "lihat semua", "promo untukmu", "tiba dalam", "checkout", "kamu mungkin suka", "favorit", "rice bowl"]
    
    if rating_line_idx != -1:
        # Replicate Zpilot logic: Look 2 to 3 lines above rating line for the name
        # rating_line_idx - 1 is usually the category (e.g. "Nasi Ayam")
        for i in range(2, 4):
            idx = rating_line_idx - i
            if idx >= 0:
                txt = lines[idx].strip()
                tl = txt.lower()
                is_junk = any(s in tl for s in SKIP_MAIN) or len(txt) < 2 or re.match(r'^\d+$', txt)
                if not is_junk:
                    name_parts.insert(0, txt)
                    matched_boxes.append(lines_data[idx]["box"])
                    
        # Fallback if no parts found
        if not name_parts and rating_line_idx >= 1:
            fallback_txt = lines[rating_line_idx - 1]
            name_parts = [fallback_txt]
            matched_boxes.append(lines_data[rating_line_idx - 1]["box"])
            
        ocr_name = " ".join(name_parts)
        ocr_name = normalize_name_clean(ocr_name) if ocr_name else ""
        
        # Overlay for all matched boxes of the name
        for box in matched_boxes:
            overlay_detections.append({"label": "NAME", "box": box, "color": (46, 204, 113)})
            
    # Targeted second-pass if rating is missing, or reviews is empty/incomplete, OR if rating_line_idx was not found at all
    is_incomplete_reviews = not ocr_reviews or ocr_reviews.upper() in ["RB", "K"] or re.match(r'^\s*(?:RB|K|ribu)\s*$', ocr_reviews, re.IGNORECASE)
    if (ocr_rating == 0.0 or is_incomplete_reviews) and screenshot_path and os.path.exists(screenshot_path):
        try:
            img = Image.open(screenshot_path)
            width, height = img.size
            
            # Determine crop box vertically: target box or fallback Y region (Y=33% to 40%)
            if rating_line_idx != -1:
                target_box = lines_data[rating_line_idx]["box"]
                y_top = max(0, target_box[1] - 15)
                y_bottom = min(height, target_box[3] + 15)
                print(f"  [hybrid] Targeted second-pass OCR on rating row box: {target_box}", flush=True)
            else:
                y_top = int(0.33 * height)
                y_bottom = int(0.40 * height)
                print(f"  [hybrid] Targeted second-pass OCR on fallback Y region: {y_top} - {y_bottom}", flush=True)
                
            crop_box = (0, y_top, width, y_bottom)
            cropped_img = img.crop(crop_box)
            
            # Apply dark pixel mask to erase the star and isolate text
            crop_w, crop_h = cropped_img.size
            masked_img = Image.new("L", (crop_w, crop_h), 255)
            for cy in range(crop_h):
                for cx in range(crop_w):
                    r, g, b = cropped_img.getpixel((cx, cy))[:3]
                    if r < 120 and g < 120 and b < 120:
                        masked_img.putpixel((cx, cy), 0)
            
            # Resize by 4x using LANCZOS to make it large enough for WinRT OCR
            resized_img = masked_img.resize((crop_w * 4, crop_h * 4), Image.Resampling.LANCZOS)
            
            temp_crop_path = os.path.join(SCREENSHOT_DIR, "targeted_rating_crop.png")
            resized_img.save(temp_crop_path)
            
            # Run OCR on the processed narrow crop
            crop_lines = run_ocr_on_device(d, roi=None, screenshot_path=temp_crop_path)
            
            try: os.remove(temp_crop_path)
            except: pass
            
            print(f"  [hybrid] Second-pass OCR lines: {[cl['text'] for cl in crop_lines]}", flush=True)
            
            for cl in crop_lines:
                cl_text = cl["text"].strip()
                
                # Extract reviews
                rev_match = review_pattern.search(cl_text)
                if rev_match:
                    ocr_reviews = rev_match.group(1).replace('(', '').replace(')', '').strip()
                
                # Extract rating
                rat_match = re.search(r'\b([345])[.,]([0-9])\b', cl_text)
                if rat_match:
                    try:
                        ocr_rating = float(f"{rat_match.group(1)}.{rat_match.group(2)}")
                    except:
                        pass
        except Exception as e:
            print(f"  [hybrid] Targeted second-pass OCR failed: {e}", flush=True)

    # Search all lines for rating as final fallback (ignoring lines with %, :, -)
    if ocr_rating == 0.0:
        for idx, l in enumerate(lines):
            rat_match = re.search(r'\b([3-5])[.,]([0-9])\b', l)
            if rat_match and "%" not in l and ":" not in l and "-" not in l:
                try:
                    val = float(f"{rat_match.group(1)}.{rat_match.group(2)}")
                    if 3.0 <= val <= 5.0:
                        ocr_rating = val
                        if rating_line_idx == -1:
                            rating_line_idx = idx
                        break
                except:
                    pass

    if ocr_rating > 0.0 and rating_line_idx != -1:
        overlay_detections.append({"label": f"RATING {ocr_rating}", "box": lines_data[rating_line_idx]["box"], "color": (241, 196, 15)})
        
    for idx, l in enumerate(lines):
        tl = l.lower()
        if not ocr_discount:
            valid_disc = extract_valid_discount(l)
            if valid_disc:
                ocr_discount = valid_disc
                overlay_detections.append({"label": "PROMO", "box": lines_data[idx]["box"], "color": (230, 126, 3)})
        if not ocr_eta and ("menit" in tl or "min" in tl or "tiba" in tl):
            ocr_eta = l
            overlay_detections.append({"label": "ETA", "box": lines_data[idx]["box"], "color": (52, 152, 219)})
            
    final_name = ocr_name or normalize_name_clean(name_target)
    real_name = final_name

    final_rating = ocr_rating
    final_reviews = str(normalize_reviews(ocr_reviews)) if ocr_reviews else ""
    final_discount = ocr_discount
    final_eta = ocr_eta
    
    confidence = 100.0
    if not ocr_name: confidence -= 15.0
    if not ocr_rating: confidence -= 20.0
    if not ocr_reviews: confidence -= 10.0
    if not ocr_discount and not ocr_eta: confidence -= 15.0
    confidence = max(0.0, min(100.0, confidence))
    
    detail_data = {
        "name": final_name,
        "rating": final_rating,
        "reviews": final_reviews,
        "discount": final_discount,
        "eta": final_eta,
        "confidence": confidence,
        "mismatched": False,
        "real_name": real_name
    }
    
    try:
        latest_path = os.path.join(SCREENSHOT_DIR, "latest_debug.png")
        if os.path.exists(latest_path):
            img = Image.open(latest_path)
            draw = ImageDraw.Draw(img)
            
            for det in overlay_detections:
                box = det["box"]
                draw.rectangle(box, outline=det["color"], width=6)
                lbl = det["label"]
                draw.rectangle((box[0], box[1] - 30, box[0] + len(lbl)*15 + 20, box[1]), fill=det["color"])
                draw.text((box[0] + 10, box[1] - 25), lbl, fill=(255, 255, 255))
                
            conf_txt = f"OCR CONFIDENCE: {confidence}%"
            draw.rectangle((w - 400, 15, w - 15, 60), fill=(41, 128, 185))
            draw.text((w - 380, 25), conf_txt, fill=(255, 255, 255))
            
            img.save(latest_path)
    except Exception as e:
        print(f"  [hybrid] Overlay draw error: {e}", flush=True)
        
    # 4. Validasi 
    has_name = bool(detail_data["name"])
    has_promo_or_eta = bool(detail_data["discount"] or detail_data["eta"])
    
    # We relax the strict > 0.0 rating requirement because WinRT OCR sometimes drops the numbers completely
    valid = has_name and has_promo_or_eta
    
    return valid, detail_data

# ── OCR + UI Hybrid Information Page Scanner ──────────────────────────────────
DAY_NAMES = ["senin", "selasa", "rabu", "kamis", "jumat", "sabtu", "minggu",
             "sen", "sel", "rab", "kam", "jum", "sab", "min", "setiap hari"]
_HOURS_LABEL_RE = re.compile(
    r"(jam buka|buka \(wib\)|jam operasional|waktu buka|setiap hari)",
    re.IGNORECASE
)
_DAY_LINE_RE = re.compile(
    r"(senin|selasa|rabu|kamis|jumat|sabtu|minggu|sen|sel|rab|kam|jum|sab|min|setiap hari)",
    re.IGNORECASE
)
def normalize_day_names(hours_str: str) -> str:
    if not hours_str:
        return ""
    day_map = {
        r'\bsen\b': 'Senin',
        r'\bsel\b': 'Selasa',
        r'\brab\b': 'Rabu',
        r'\bkam\b': 'Kamis',
        r'\bjum\b': 'Jumat',
        r'\bsab\b': 'Sabtu',
        r'\bmin\b': 'Minggu',
        r'\bsetiap hari\b': 'Setiap Hari',
        r'\bsnin\b': 'Senin',
        r'\bsls\b': 'Selasa',
        r'\brbu\b': 'Rabu',
        r'\bkms\b': 'Kamis',
        r'\bjmt\b': 'Jumat',
        r'\bsbt\b': 'Sabtu',
        r'\bmng\b': 'Minggu'
    }
    res = hours_str
    for pattern, full_name in day_map.items():
        res = re.sub(pattern, full_name, res, flags=re.IGNORECASE)
    return res

_TIME_LINE_RE = re.compile(r"\d{1,2}[:.\-]\d{2}")

def _parse_hours_from_lines(lines: list[str]) -> str:
    """Two-pass hours parser."""
    in_hours = False
    parts: list[str] = []
    STOP_KW = ["Jl.", "Jalan", "Kel.", "Kec.", "Kab.", "Gang", "Kategori:", "Kategori", "Kategori resto"]
    
    for l in lines:
        tl = l.lower()
        if _HOURS_LABEL_RE.search(tl):
            in_hours = True
            parts = []
            cleaned = l.replace("Jam Buka (WIB):", "").replace("Jam Buka:", "").strip()
            if cleaned:
                parts.append(cleaned)
            continue
            
        if in_hours:
            if any(k.lower() in tl for k in STOP_KW) or len(parts) >= 14:
                break
            if not l.strip():
                continue
            parts.append(l.strip())
            
    if parts:
        return " | ".join(parts)

    free_parts: list[str] = []
    for l in lines:
        tl = l.lower()
        if any(k.lower() in tl for k in ["jl.", "jalan", "kategori", "penilaian", "ulasan", "diskon", "checkout"]):
            continue
        has_day  = bool(_DAY_LINE_RE.search(l))
        has_time = bool(_TIME_LINE_RE.search(l))
        has_status = any(w in tl for w in ["tutup", "closed", "buka", "open"])
        if has_day or has_time or has_status:
            free_parts.append(l.strip())
        if len(free_parts) >= 12:
            break
    return " | ".join(free_parts)

def extract_information_page_hybrid(d, screenshot_path=None, ocr_lines=None) -> tuple[dict, float]:
    """Hybrid extraction for Information Page."""
    w, h = d.window_size()
    
    lines_data = ocr_lines
    if lines_data is None:
        print("  [info-hybrid] Running WinRT OCR on info region (Y=10%-90%)...", flush=True)
        lines_data = run_ocr_on_device(d, roi=(0.0, 0.10, 1.0, 0.90), screenshot_path=screenshot_path)
    else:
        # Filter lines lying in info region (Y=10%-90%)
        lines_data = [ld for ld in ocr_lines if ld["box"][1] >= 0.10 * h and ld["box"][3] <= 0.90 * h]
        
    ocr_address = ""
    ocr_hours = ""
    ocr_closed = False
    
    overlay_detections = []
    lines = [l["text"].strip() for l in lines_data if l["text"].strip()]
    print(f"  [info-hybrid] OCR got {len(lines)} lines: {lines[:15]}", flush=True)
    
    # Address extraction
    addr_line_idxs = []
    for idx, l in enumerate(lines):
        if any(k in l for k in ADDR_KW) and len(l) > 8:
            addr_line_idxs.append(idx)
            
    if addr_line_idxs:
        first_idx = addr_line_idxs[0]
        parts = [lines[first_idx]]
        overlay_box = lines_data[first_idx]["box"]
        idx = first_idx + 1
        # Stop words: anything that is NOT part of a street address
        ADDR_STOP = [
            "kategori:", "fasilitas:", "sarangeui", "google", "kategori",
            "gerai", "lihat", "maps", "hubungi", "telepon", "website",
        ]
        while idx < len(lines):
            next_line = lines[idx]
            ntl = next_line.lower()
            if (not _HOURS_LABEL_RE.search(ntl)
                    and "tutup" not in ntl and "closed" not in ntl
                    and "buka" not in ntl
                    and not _DAY_LINE_RE.search(next_line)
                    and not any(k in ntl for k in ADDR_STOP)
                    and len(next_line) > 5):
                parts.append(next_line)
                next_box = lines_data[idx]["box"]
                overlay_box = (
                    min(overlay_box[0], next_box[0]),
                    min(overlay_box[1], next_box[1]),
                    max(overlay_box[2], next_box[2]),
                    max(overlay_box[3], next_box[3])
                )
                idx += 1
            else:
                break
                
        ocr_address = normalize_address(" ".join(parts))
        overlay_detections.append({"label": "ADDRESS", "box": overlay_box, "color": (52, 152, 219)})

    ocr_hours = _parse_hours_from_lines(lines)
    if ocr_hours:
        # Clean up the label from hours, e.g. "Jam Buka (WE): | Sen-Min" -> "Sen-Min"
        ocr_hours = re.sub(r'(?i)Jam Buka[^\|]+\|\s*', '', ocr_hours).strip()
    print(f"  [info-hybrid] OCR hours result: '{ocr_hours}'", flush=True)
    
    if ocr_hours:
        hours_parts_set = set(ocr_hours.split(" | "))
        hours_boxes = [ld["box"] for ld in lines_data if ld["text"].strip() in hours_parts_set]
        if hours_boxes:
            h_box = (
                min(b[0] for b in hours_boxes),
                min(b[1] for b in hours_boxes),
                max(b[2] for b in hours_boxes),
                max(b[3] for b in hours_boxes)
            )
            overlay_detections.append({"label": "HOURS", "box": h_box, "color": (155, 89, 182)})
    
    for l in lines:
        if "tutup" in l.lower() or "closed" in l.lower():
            ocr_closed = True
            break

    # UIAutomator2 fallback check completely removed per user request
    final_address = ocr_address
    final_hours = normalize_day_names(ocr_hours)
    final_closed = ocr_closed
    
    confidence = 100.0
    if not final_address: confidence -= 50.0
    if not final_hours: confidence -= 30.0
    confidence = max(0.0, min(100.0, confidence))
    
    info_data = {
        "address": final_address,
        "hours": final_hours,
        "closed": final_closed
    }
    
    try:
        latest_path = os.path.join(SCREENSHOT_DIR, "latest_debug.png")
        if os.path.exists(latest_path):
            img = Image.open(latest_path)
            draw = ImageDraw.Draw(img)
            
            for det in overlay_detections:
                box = det["box"]
                draw.rectangle(box, outline=det["color"], width=6)
                lbl = det["label"]
                draw.rectangle((box[0], box[1] - 30, box[0] + len(lbl)*15 + 20, box[1]), fill=det["color"])
                draw.text((box[0] + 10, box[1] - 25), lbl, fill=(255, 255, 255))
                
            conf_txt = f"OCR CONFIDENCE: {confidence:.0f}%"
            draw.rectangle((w - 420, 15, w - 15, 60), fill=(41, 128, 185))
            draw.text((w - 410, 25), conf_txt, fill=(255, 255, 255))
            
            img.save(latest_path)
    except Exception as e:
        print(f"  [info-hybrid] Overlay draw error: {e}", flush=True)
        
    return info_data, confidence

# ── Overlays and States ───────────────────────────────────────────────────────
def handle_overlays(d) -> bool:
    try:
        if d(text="Grup Order Saat Ini").exists or d(textContains="Group Order yang masih aktif").exists:
            print("  [overlay] Detected 'Grup Order Saat Ini' modal popup! Dismissing...", flush=True)
            for btn_txt in ["Buat Pesanan Satuan", "Pesanan Satuan"]:
                btn = d(textContains=btn_txt)
                if btn.exists:
                    btn.click()
                    print(f"  [overlay] Dismiss click: '{btn_txt}' succeeded", flush=True)
                    time.sleep(2.0)
                    return True
    except Exception as e:
        print(f"  [overlay] Warning: {e}", flush=True)
    return False

def detect_state_from_ocr(ocr_lines: list[dict], pkg: str) -> str:
    """Detects active page state based entirely on OCR lines and app package.
    
    Priority (highest to lowest):
      1. Google Maps app package
      2. INFORMATION_PAGE — 'Informasi' as page title overrides everything.
         The info tab always has 'Informasi' at the top AND 'Jam Buka'/'Kategori' below.
      3. RESTAURANT_DETAIL — strong unique signals that don't appear on info page
         (Tiba dalam, Promo Untukmu, Diskon Ongkir, Kamu Mungkin Suka, Checkout)
         NOTE: 'Penilaian' alone is NOT reliable — the info page also shows it in the header!
      4. Sekitarmu List
    """
    if "maps" in pkg:
        return S.GOOGLE_MAPS

    all_text_lower = " ".join([ld["text"].lower() for ld in ocr_lines])

    # ── PRIORITY 1: Information Page title 'Informasi' ──────────────────────────
    # The info/tab page ALWAYS has 'Informasi' as a heading at the very top.
    # This is the strongest possible disambiguation signal and must win over all else.
    has_informasi_title = "informasi" in all_text_lower
    has_info_content    = any(k in all_text_lower for k in [
        "jam buka", "jam operasional", "kategori:", "kategori resto",
        "lihat gerai", "lihat 5 gerai", "lihat semua gerai"
    ])
    has_addr_content    = any(kw.lower() in all_text_lower for kw in ADDR_KW)

    if has_informasi_title and (has_info_content or has_addr_content):
        # Definitively on the Information tab
        return S.INFORMATION_PAGE

    # ── PRIORITY 2: Restaurant Detail page ──────────────────────────────────────
    # Signals that are UNIQUE to the detail page and do NOT appear on info page:
    # 'Tiba dalam' (ETA), 'Promo Untukmu', 'Diskon Ongkir', 'Kamu Mungkin Suka', 'Checkout'
    # AVOID 'penilaian' alone — info page header also shows it!
    STRONG_DETAIL_ONLY = [
        "tiba dalam",        # ETA — only on detail page
        "promo untukmu",     # promo section header
        "diskon ongkir",     # ongkir discount badge
        "kamu mungkin suka", # recommendation section
        "checkout",          # checkout button
    ]
    detail_score = sum(1 for ind in STRONG_DETAIL_ONLY if ind in all_text_lower)

    if detail_score >= 1:
        return S.RESTAURANT_DETAIL

    # ── PRIORITY 3: Info page without 'Informasi' title ────────────────────────
    # Sometimes OCR misses the title but the content is clearly from info tab
    if has_info_content or (has_addr_content and not has_informasi_title):
        return S.INFORMATION_PAGE

    # ── PRIORITY 4: Sekitarmu list ───────────────────────────────────────────────
    if "sekitarmu" in all_text_lower or "cari resto" in all_text_lower:
        return S.SEKITARMU_LIST

    # ── FALLBACK ────────────────────────────────────────────────────────────────
    if all_text_lower:
        return S.RESTAURANT_DETAIL

    return S.ERROR

# ── SQLite Database & Caching ──────────────────────────────────────────────────
_local_db_cache = []       # List of dict: {"original": str, "normalized": str}
_supabase_db_cache = []    # List of dict: {"original": str, "normalized": str}

def init_db():
    return sqlite3.connect(DB_PATH)

def init_local_db_cache(conn):
    global _local_db_cache
    try:
        cur = conn.cursor()
        cur.execute("SELECT name FROM scraped_restaurants WHERE name IS NOT NULL")
        rows = cur.fetchall()
        _local_db_cache = []
        for row in rows:
            name = row[0].strip()
            if name:
                _local_db_cache.append({
                    "original": name,
                    "normalized": normalize_name(name)
                })
        print(f"[+] Loaded {len(_local_db_cache)} local database restaurant names into cache.", flush=True)
    except Exception as e:
        print(f"[!] Error loading local database cache: {e}", flush=True)

def check_duplicate(name: str) -> tuple[bool, str, str]:
    """
    Checks if a restaurant name is a duplicate in SQLite local cache or Supabase cache.
    Returns: (is_duplicate, matched_original_name, source_db)
    If not duplicate, returns (False, "", "")
    """
    if not name or len(name.strip()) < 4:
        return True, name, "Nama terlalu pendek"
        
    n_input = normalize_name(name)
    if not n_input:
        return True, name, "Nama tidak valid"

    L1 = len(n_input)
    
    # 1. Check Local SQLite Cache
    for item in _local_db_cache:
        n_cached = item["normalized"]
        if not n_cached:
            continue
        
        # A. Perfect match check
        if n_input == n_cached:
            return True, item["original"], "SQLite Lokal"
            
        # B. Substring match for reasonably long names
        if L1 >= 8 and len(n_cached) >= 8:
            if n_input in n_cached or n_cached in n_input:
                return True, item["original"], "SQLite Lokal"
                
        # C. Fuzzy Match with mathematical skip optimization
        L2 = len(n_cached)
        max_possible_ratio = (2.0 * min(L1, L2)) / (L1 + L2)
        if max_possible_ratio < 0.82:
            continue
            
        ratio = difflib.SequenceMatcher(None, n_input, n_cached).ratio()
        if ratio >= 0.82:
            return True, item["original"], "SQLite Lokal"

    # 2. Check Supabase merchant Cache
    for item in _supabase_db_cache:
        n_cached = item["normalized"]
        if not n_cached:
            continue
            
        # A. Perfect match check
        if n_input == n_cached:
            return True, item["original"], "Supabase ztips"
            
        # B. Substring match
        if L1 >= 8 and len(n_cached) >= 8:
            if n_input in n_cached or n_cached in n_input:
                return True, item["original"], "Supabase ztips"
                
        # C. Fuzzy Match with mathematical skip optimization
        L2 = len(n_cached)
        max_possible_ratio = (2.0 * min(L1, L2)) / (L1 + L2)
        if max_possible_ratio < 0.82:
            continue
            
        ratio = difflib.SequenceMatcher(None, n_input, n_cached).ratio()
        if ratio >= 0.82:
            return True, item["original"], "Supabase ztips"
            
    return False, "", ""

def extract_gmaps_coords_on_phone(d) -> tuple[float, float, str]:
    """
    Reads coordinates from the phone's clipboard or directly via OCR on the Maps screen.
    """
    # ── 1. Clipboard Check ──
    try:
        clip = d.clipboard
        if clip:
            print(f"  [maps] Phone clipboard: '{clip[:100]}...'", flush=True)
            urls = re.findall(r'(https?://\S+)', clip)
            if urls:
                url = urls[0]
                url = url.split('?')[0] if '?' in url and 'maps.app.goo.gl' in url else url
                resolved_url = url
                if "maps.app.goo.gl" in url:
                    try:
                        r = requests.head(url, allow_redirects=True, timeout=5)
                        resolved_url = r.url
                        print(f"  [maps] Resolved short URL to: '{resolved_url}'", flush=True)
                    except Exception as e:
                        print(f"  [maps] Failed resolving short URL: {e}", flush=True)
                        
                # Now extract coordinates using regex
                match = re.search(r'!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)', resolved_url)
                if match:
                    return float(match.group(1)), float(match.group(2)), url
                    
                match = re.search(r'@(-?\d+\.\d+),(-?\d+\.\d+)', resolved_url)
                if match:
                    return float(match.group(1)), float(match.group(2)), url
                    
                match = re.search(r'[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)', resolved_url)
                if match:
                    return float(match.group(1)), float(match.group(2)), url
    except Exception as e:
        print(f"  [maps] Clipboard error: {e}", flush=True)

    # ── 2. Direct Screen OCR Fallback (Matches the user's highlighted blue box!) ──
    try:
        print("  [maps] Clipboard empty/invalid. Running WinRT OCR on screen to find coordinates...", flush=True)
        # Search the entire screen for coordinate pattern
        lines_data = run_ocr_on_device(d)
        for ld in lines_data:
            text = ld["text"].strip()
            # Look for coordinate pattern like: -7.747656, 110.408322 or -7.7476560, 110.4083220
            match = re.search(r'(-?[1-9]\d{0,1}\.\d{4,9})\s*,\s*(\d{2,3}\.\d{4,9})', text)
            if match:
                lat = float(match.group(1))
                lng = float(match.group(2))
                print(f"  [maps] Direct coordinates found via OCR: ({lat}, {lng})!", flush=True)
                return lat, lng, "Direct Screen OCR"
    except Exception as e:
        print(f"  [maps] Direct OCR error: {e}", flush=True)
        
    return None, None, ""

def save_to_db(conn, data: dict) -> bool:
    """Save to DB. Returns False and prints reason if skipped (e.g. below review threshold)."""
    reviews_raw = data.get('reviews', '')
    review_count = normalize_reviews(reviews_raw)
    if MIN_REVIEWS > 0 and review_count < MIN_REVIEWS:
        print(f"  [filter] SKIP '{data.get('name','')}': reviews={review_count} < MIN_REVIEWS={MIN_REVIEWS}", flush=True)
        emit("SKIPPED", {
            "name":   data.get('name', ''),
            "reason": f"Reviews {review_count} < {MIN_REVIEWS} (filter)",
            "reviews": reviews_raw
        })
        return False

    cur = conn.cursor()
    lat = data.get('latitude')
    lng = data.get('longitude')
    status = 'matched' if (lat and lng) else 'pending'
    
    cur.execute("""
        INSERT INTO scraped_restaurants
          (id, name, discount_text, rating, total_reviews, address, shopee_hours, source, maps_latitude, maps_longitude, validation_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'shopeefood_android', ?, ?, ?)
    """, (
        str(uuid.uuid4()),
        data['name'].strip(),
        data.get('discount', ''),
        data.get('rating', 0.0),
        str(review_count),
        data.get('address', ''),
        data.get('hours', ''),
        lat,
        lng,
        status
    ))
    conn.commit()
    return True

# ── Supabase Config & Caching ─────────────────────────────────────────────────
def load_ztips_config():
    env = r"C:\Project\zpilot\.env.local"
    url = key = None
    if os.path.exists(env):
        for line in open(env, encoding='utf-8'):
            l = line.strip()
            if l.startswith("NEXT_PUBLIC_SUPABASE_URL="):
                url = l.split("=", 1)[1].strip()
            elif l.startswith("NEXT_PUBLIC_SUPABASE_ANON_KEY="):
                key = l.split("=", 1)[1].strip()
    return url, key

_ztips_url, _ztips_key = None, None

def init_ztips():
    global _ztips_url, _ztips_key, _supabase_db_cache
    _ztips_url, _ztips_key = load_ztips_config()
    if _ztips_url and _ztips_key:
        try:
            url = f"{_ztips_url}/rest/v1/merchant_signals?select=name&name=not.is.null&limit=5000"
            r = requests.get(
                url,
                headers={"apikey": _ztips_key, "Authorization": f"Bearer {_ztips_key}"},
                timeout=10
            )
            if r.status_code == 200:
                raw = r.json()
                _supabase_db_cache = []
                for i in raw:
                    name = i.get('name')
                    if name:
                        name_stripped = name.strip()
                        if len(name_stripped) >= 5 and any(c.isalpha() for c in name_stripped):
                            _supabase_db_cache.append({
                                "original": name_stripped,
                                "normalized": normalize_name(name_stripped)
                            })
                print(f"[+] Loaded {len(_supabase_db_cache)} merchant names from Supabase.", flush=True)
            else:
                print(f"[!] Supabase HTTP {r.status_code}", flush=True)
        except Exception as e:
            print(f"[!] Supabase load error: {e}", flush=True)

# ── Passive State Machine Processing Loop ─────────────────────────────────────
def run_state_machine():
    if os.path.exists(STOP_FLAG):
        os.remove(STOP_FLAG)

    emit("STATUS", {"step": "init", "message": "Memulai Manual OCR Workstation..."})
    
    # ── Initialize SQLite & Supabase Caches ──
    conn = init_db()
    init_local_db_cache(conn)
    init_ztips()

    try:
        d = u2.connect()
        model = d.device_info.get('model', 'Unknown')
        print(f"[*] Connected: {model}", flush=True)
        emit("STATUS", {"step": "connected", "message": f"Ponsel Terhubung: {model}"})
    except Exception as e:
        print(f"[!] ADB Connection failed: {e}", flush=True)
        emit("STATUS", {"step": "error", "message": f"ADB gagal terhubung: {e}"})
        conn.close()
        return

    saved_count = 0
    current_data = {}
    last_state = S.SEKITARMU_LIST

    last_processed_scan_ts = None
    last_processed_save_ts = None
    last_processed_clear_ts = None

    # Remove any stale triggers on startup
    for fn in ['scan_trigger.json', 'save_trigger.json', 'clear_trigger.json', 'active_name.json', 'active_hours.json', 'active_coords.json']:
        fp = os.path.join(os.path.dirname(__file__), fn)
        if os.path.exists(fp):
            try: os.remove(fp)
            except: pass
    
    while not should_stop():
        try:
            # ── 1. Check for manual name edits from frontend ──
            active_name_file = os.path.join(os.path.dirname(__file__), 'active_name.json')
            if os.path.exists(active_name_file):
                try:
                    with open(active_name_file, 'r', encoding='utf-8') as f:
                        manual_data = json.load(f)
                        manual_name = manual_data.get('name')
                        if manual_name:
                            current_data['name'] = manual_name
                            print(f"\n  [manual-edit] Restaurant name updated manually to: '{manual_name}'\n", flush=True)
                            
                            # Emit preview update immediately
                            emit("PREVIEW", {
                                "name":   current_data["name"],
                                "status": "extracting",
                                "rating": current_data.get("rating", 0.0),
                                "reviews": current_data.get("reviews", ""),
                                "discount": current_data.get("discount", ""),
                                "eta": current_data.get("eta", ""),
                                "address": current_data.get("address", ""),
                                "hours": current_data.get("hours", ""),
                                "latitude": current_data.get("latitude"),
                                "longitude": current_data.get("longitude"),
                                "confidence": 100.0,
                                "card":   current_data
                            })
                    os.remove(active_name_file)
                except Exception as e:
                    print(f"  [manual-edit] Error reading manual name edit file: {e}", flush=True)

            # ── 2. Check for manual hours edits from frontend ──
            active_hours_file = os.path.join(os.path.dirname(__file__), 'active_hours.json')
            if os.path.exists(active_hours_file):
                try:
                    with open(active_hours_file, 'r', encoding='utf-8') as f:
                        manual_data = json.load(f)
                        manual_hours = manual_data.get('hours')
                        if manual_hours is not None:
                            current_data['hours'] = manual_hours
                            print(f"\n  [manual-edit] Restaurant hours updated manually to: '{manual_hours}'\n", flush=True)
                            
                            # Emit preview update immediately
                            emit("PREVIEW", {
                                "name":   current_data.get("name", ""),
                                "status": "extracting",
                                "rating": current_data.get("rating", 0.0),
                                "reviews": current_data.get("reviews", ""),
                                "discount": current_data.get("discount", ""),
                                "eta": current_data.get("eta", ""),
                                "address": current_data.get("address", ""),
                                "hours": current_data.get("hours", ""),
                                "latitude": current_data.get("latitude"),
                                "longitude": current_data.get("longitude"),
                                "confidence": 100.0,
                                "card":   current_data
                            })
                    os.remove(active_hours_file)
                except Exception as e:
                    print(f"  [manual-edit] Error reading manual hours edit file: {e}", flush=True)

            # ── 2b. Check for manual coords edits (e.g. from pasted maps link) ──
            active_coords_file = os.path.join(os.path.dirname(__file__), 'active_coords.json')
            if os.path.exists(active_coords_file):
                try:
                    with open(active_coords_file, 'r', encoding='utf-8') as f:
                        manual_data = json.load(f)
                        manual_lat = manual_data.get('latitude')
                        manual_lng = manual_data.get('longitude')
                        if manual_lat is not None and manual_lng is not None:
                            current_data['latitude'] = manual_lat
                            current_data['longitude'] = manual_lng
                            print(f"\n  [manual-edit] Coordinates updated manually to: ({manual_lat}, {manual_lng})\n", flush=True)
                            
                            # Emit preview update immediately
                            emit("PREVIEW", {
                                "name":   current_data.get("name", ""),
                                "status": "extracting",
                                "rating": current_data.get("rating", 0.0),
                                "reviews": current_data.get("reviews", ""),
                                "discount": current_data.get("discount", ""),
                                "eta": current_data.get("eta", ""),
                                "address": current_data.get("address", ""),
                                "hours": current_data.get("hours", ""),
                                "latitude": manual_lat,
                                "longitude": manual_lng,
                                "confidence": 100.0,
                                "card":   current_data
                            })
                    os.remove(active_coords_file)
                except Exception as e:
                    print(f"  [manual-edit] Error reading manual coords edit file: {e}", flush=True)

            # ── 3. Check for clear trigger ──
            clear_trigger_file = os.path.join(os.path.dirname(__file__), 'clear_trigger.json')
            if os.path.exists(clear_trigger_file):
                try:
                    ts = None
                    with open(clear_trigger_file, 'r', encoding='utf-8') as f:
                        ts = json.load(f).get('timestamp')
                    if ts != last_processed_clear_ts:
                        last_processed_clear_ts = ts
                        current_data = {}
                        print("  [trigger] Clear/reset active data.", flush=True)
                        emit("STATUS", {"step": "waiting", "message": "Preview dibersihkan."})
                    os.remove(clear_trigger_file)
                except Exception as e:
                    pass

            # ── 4. Check for save trigger ──
            save_trigger_file = os.path.join(os.path.dirname(__file__), 'save_trigger.json')
            if os.path.exists(save_trigger_file):
                try:
                    ts = None
                    with open(save_trigger_file, 'r', encoding='utf-8') as f:
                        ts = json.load(f).get('timestamp')
                    if ts != last_processed_save_ts:
                        last_processed_save_ts = ts
                        if current_data.get('name'):
                            # Cek lagi sebelum menyimpan apakah benar-benar duplikat
                            is_dup, _, _ = check_duplicate(current_data['name'])
                            if is_dup:
                                print(f"  [save] SKIP '{current_data['name']}': Sudah ada di database.", flush=True)
                                emit("STATUS", {"step": "state_tick", "message": f"Gagal simpan: '{current_data['name']}' sudah ada di database!"})
                            else:
                                print(f"  [save] Menyimpan data restoran {current_data['name']}...", flush=True)
                                saved = save_to_db(conn, current_data)
                                if saved:
                                    saved_count += 1
                                    emit("SAVED", current_data)
                                    
                                    # Update local cache dynamically
                                    _local_db_cache.append({
                                        "original": current_data['name'].strip(),
                                        "normalized": normalize_name(current_data['name'])
                                    })
                                    current_data = {}
                                    print(f"  [quota] Berhasil menyimpan {saved_count}/{MAX_SAVED_PER_SESSION} restoran baru.", flush=True)
                                    
                                    if saved_count >= MAX_SAVED_PER_SESSION:
                                        print(f"\n[!] KUOTA TERCAPAI: {MAX_SAVED_PER_SESSION} data! Menghentikan scraper...", flush=True)
                                        emit("STATUS", {
                                            "step": "quota_reached",
                                            "message": f"🎉 Kuota {MAX_SAVED_PER_SESSION} data tercapai! Sesi selesai."
                                        })
                                        with open(STOP_FLAG, 'w') as sf:
                                            sf.write('STOP')
                        else:
                            print("  [save] Gagal menyimpan: Nama restoran kosong!", flush=True)
                            emit("STATUS", {"step": "state_tick", "message": "Gagal menyimpan: Nama restoran belum terisi!"})
                    os.remove(save_trigger_file)
                except Exception as e:
                    pass

            # ── 5. Check for scan trigger ──
            scan_trigger_file = os.path.join(os.path.dirname(__file__), 'scan_trigger.json')
            if not os.path.exists(scan_trigger_file):
                # No scan trigger, just sleep briefly and continue loop
                time.sleep(0.1)
                continue

            try:
                ts = None
                with open(scan_trigger_file, 'r', encoding='utf-8') as f:
                    ts = json.load(f).get('timestamp')
            except Exception as e:
                time.sleep(0.05)
                continue

            if ts == last_processed_scan_ts:
                time.sleep(0.1)
                continue

            last_processed_scan_ts = ts

            # Consume the scan trigger
            try:
                os.remove(scan_trigger_file)
            except Exception as e:
                print(f"  [trigger] Error removing scan trigger: {e}", flush=True)

            print("\n[⚡] Trigger scan diterima! Mengambil tangkapan layar ponsel...", flush=True)
            emit("STATUS", {"step": "state_tick", "message": "Mengambil tangkapan layar & menjalankan OCR..."})

            # Capture a single master screenshot for this scan trigger
            master_screenshot = os.path.join(SCREENSHOT_DIR, "master_tick.png")
            try:
                d.screenshot(master_screenshot)
                # Copy to latest_debug.png for the frontend to render immediately
                latest_path = os.path.join(SCREENSHOT_DIR, "latest_debug.png")
                import shutil
                shutil.copy(master_screenshot, latest_path)
                emit("SCREENSHOT", {"url": f"/screenshots/latest_debug.png?t={int(time.time()*1000)}"})
            except Exception as e:
                print(f"  [screenshot] Master screenshot capture failed: {e}", flush=True)

            # ── Pure OCR state and data pipeline ──
            print("  [OCR] Running WinRT OCR on master screenshot...", flush=True)
            ocr_lines = run_ocr_on_device(d, screenshot_path=master_screenshot)
            
            try:
                curr_app = d.app_current()
                pkg = curr_app.get('package', '').lower()
            except Exception as e:
                print(f"  [detect_state] Failed to get app package: {e}", flush=True)
                pkg = ""

            state = detect_state_from_ocr(ocr_lines, pkg)
            print(f"  [trigger] Terdeteksi halaman: {state}", flush=True)
            
            # Emit live state logs
            emit("STATUS", {
                "step":          "state_tick",
                "current_state":  state,
                "prev_state":     last_state,
                "next_expected":  None,
                "restaurant":     current_data.get('name')
            })

            # --- PROCESS STATE ---
            if state == S.SEKITARMU_LIST:
                print("  [trigger] Sedang di halaman List Sekitarmu. Silakan masuk ke detail restoran dulu!", flush=True)
                emit("STATUS", {"step": "state_tick", "message": "Harap buka detail restoran di ponsel Anda terlebih dahulu!"})
                
            elif state == S.RESTAURANT_DETAIL:
                print("  [trigger] Memindai Halaman Detail Restoran...", flush=True)
                valid, detail_data = validate_and_extract_detail_hybrid(d, "", screenshot_path=master_screenshot, ocr_lines=ocr_lines)
                
                if valid and detail_data['name']:
                    # Update memory for current session
                    current_data['name'] = detail_data['name']
                    
                    if detail_data.get('rating') and detail_data['rating'] > 0.0:
                        current_data['rating'] = detail_data['rating']
                    elif 'rating' not in current_data:
                        current_data['rating'] = 0.0
                        
                    if detail_data.get('reviews'):
                        current_data['reviews'] = detail_data['reviews']
                    elif 'reviews' not in current_data:
                        current_data['reviews'] = ""
                        
                    current_data['discount'] = detail_data['discount']
                    current_data['eta'] = detail_data.get('eta', '')
                    
                    # Instantly check duplicate on detail page
                    is_dup, dup_name, dup_src = check_duplicate(current_data['name'])
                    
                    if is_dup:
                        emit("PREVIEW", {
                            "name":   current_data["name"],
                            "status": "duplicate",
                            "dup_source": dup_src,
                            "dup_name": dup_name,
                            "rating": current_data["rating"],
                            "reviews": current_data["reviews"],
                            "discount": current_data["discount"],
                            "eta": current_data["eta"],
                            "address": current_data.get("address", ""),
                            "hours": current_data.get("hours", ""),
                            "latitude": current_data.get("latitude"),
                            "longitude": current_data.get("longitude"),
                            "confidence": detail_data.get("confidence", 100.0),
                            "card":   current_data
                        })
                        print(f"\n  [!] WARNING: '{current_data['name']}' sudah ada di database ({dup_src} sebagai '{dup_name}')!", flush=True)
                        emit("STATUS", {"step": "state_tick", "message": f"⚠ Duplikasi terdeteksi di {dup_src}: '{current_data['name']}'!"})
                    else:
                        emit("PREVIEW", {
                            "name":   current_data["name"],
                            "status": "extracting",
                            "rating": current_data["rating"],
                            "reviews": current_data["reviews"],
                            "discount": current_data["discount"],
                            "eta": current_data["eta"],
                            "address": current_data.get("address", ""),
                            "hours": current_data.get("hours", ""),
                            "latitude": current_data.get("latitude"),
                            "longitude": current_data.get("longitude"),
                            "confidence": detail_data.get("confidence", 100.0),
                            "card":   current_data
                        })
                        print(f"  [trigger] Sukses membaca detail untuk {current_data['name']}.", flush=True)
                        emit("STATUS", {"step": "state_tick", "message": f"Detail resto didapat: '{current_data['name']}'"})
                else:
                    print("  [trigger] Gagal mendeteksi detail restoran yang valid.", flush=True)
                    emit("STATUS", {"step": "state_tick", "message": "Gagal mendeteksi nama & rating. Coba buka kembali halaman detail resto."})
 
            elif state == S.INFORMATION_PAGE:
                print("  [trigger] Memindai Halaman Informasi Restoran...", flush=True)
                info_data, confidence = extract_information_page_hybrid(d, screenshot_path=master_screenshot, ocr_lines=ocr_lines)
                
                if info_data['address']:
                    current_data["address"] = info_data["address"]
                if info_data['hours']:
                    current_data["hours"] = info_data["hours"]
                current_data["closed"] = info_data.get("closed", False)
                
                emit("DETAIL_RESULT", {
                    "name":    current_data.get('name', 'Unknown'),
                    "address": current_data.get('address', ''),
                    "hours":   current_data.get('hours', ''),
                    "closed":  current_data.get('closed', False),
                    "confidence": confidence
                })
                
                emit("PREVIEW", {
                    "name":   current_data.get("name", ""),
                    "status": "extracting",
                    "rating": current_data.get("rating", 0.0),
                    "reviews": current_data.get("reviews", ""),
                    "discount": current_data.get("discount", ""),
                    "eta": current_data.get("eta", ""),
                    "address": current_data.get("address", ""),
                    "hours": current_data.get("hours", ""),
                    "latitude": current_data.get("latitude"),
                    "longitude": current_data.get("longitude"),
                    "confidence": confidence,
                    "card":   current_data
                })
                print(f"  [trigger] Sukses membaca alamat & jam operasional.", flush=True)
                emit("STATUS", {"step": "state_tick", "message": "Sukses mengambil alamat & jam operasional!"})

            elif state == S.GOOGLE_MAPS:
                print("  [trigger] Memindai Halaman Google Maps...", flush=True)
                lat, lng, url = extract_gmaps_coords_on_phone(d)
                
                if lat:
                    current_data["latitude"] = lat
                    current_data["longitude"] = lng
                    current_data["maps_url"]  = url
                    
                    emit("PREVIEW", {
                        "name":   current_data.get("name", ""),
                        "status": "extracting",
                        "rating": current_data.get("rating", 0.0),
                        "reviews": current_data.get("reviews", ""),
                        "discount": current_data.get("discount", ""),
                        "eta": current_data.get("eta", ""),
                        "address": current_data.get("address", ""),
                        "hours": current_data.get("hours", ""),
                        "latitude": lat,
                        "longitude": lng,
                        "confidence": 100.0,
                        "card":   current_data
                    })
                    print(f"  [trigger] Sukses membaca koordinat: ({lat}, {lng})", flush=True)
                    emit("STATUS", {"step": "state_tick", "message": f"Koordinat didapat: ({lat}, {lng})!"})
                else:
                    print("  [trigger] Gagal mengekstrak koordinat.", flush=True)
                    emit("STATUS", {"step": "state_tick", "message": "Gagal mendapatkan koordinat. Pastikan koordinat tertera di layar / salin Maps link."})

            else:
                print(f"  [trigger] Halaman tidak dikenal: {state}", flush=True)
                emit("STATUS", {"step": "state_tick", "message": "Halaman tidak dikenal. Silakan buka Detail Resto, Info Resto, atau Google Maps."})

            last_state = state
        except Exception as err:
            print(f"[!] Trigger Scan Error: {err}", flush=True)

        time.sleep(0.1)

    conn.close()
    if os.path.exists(STOP_FLAG):
        os.remove(STOP_FLAG)

    print("\n[*] Scraper Session Completed successfully.", flush=True)
    emit("STATUS", {"step": "done", "message": "Sesi Scraper selesai."})

if __name__ == "__main__":
    run_state_machine()
