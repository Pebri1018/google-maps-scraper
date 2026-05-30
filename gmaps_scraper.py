#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════╗
║          Google Maps Universal Scraper  v2.0                     ║
║                                                                  ║
║  Modes  : Shared List  |  Search Results  |  Keyword Search      ║
║  Output : CSV  (nama file bebas, field bebas dipilih)            ║
╚══════════════════════════════════════════════════════════════════╝

Contoh:
  python gmaps_scraper.py --url "https://maps.app.goo.gl/Xxx" --output hasil.csv
  python gmaps_scraper.py --url "https://www.google.com/maps/search/warung+makan+jogja"
  python gmaps_scraper.py --keyword "restoran padang jakarta" --output padang.csv --max-results 50
  python gmaps_scraper.py --url "..." --fields name,latitude,longitude,phone,rating,total_reviews
  python gmaps_scraper.py --list-fields
"""

import csv
import re
import sys
import os
import argparse
from urllib.parse import quote_plus
from playwright.sync_api import sync_playwright

# ─────────────────────────────────────────────────────────────────────
#  Field Registry
#  Daftar semua kolom yang bisa diambil beserta keterangannya.
# ─────────────────────────────────────────────────────────────────────
AVAILABLE_FIELDS = {
    "name":          "Nama tempat",
    "latitude":      "Koordinat GPS – lintang",
    "longitude":     "Koordinat GPS – bujur",
    "address":       "Alamat lengkap",
    "phone":         "Nomor telepon",
    "website":       "Website resmi",
    "rating":        "Rating bintang (contoh: 4.5)",
    "total_reviews": "Total jumlah ulasan (angka)",
    "category":      "Kategori / tipe tempat (contoh: Restoran, Hotel, ...)",
    "price_level":   "Level harga ($ hingga $$$$)",
    "weekly_hours":  "Jam operasional per hari  (Senin: HH:MM–HH:MM; ...)",
    "closed_days":   "Hari tutup  (atau 'Tidak Ada')",
    "plus_code":     "Google Plus Code  (contoh: VQXV+9H Yogyakarta)",
    "maps_url":      "URL Google Maps tempat ini",
}

# Field yang aktif secara default bila --fields tidak ditentukan
DEFAULT_FIELDS = [
    "name", "latitude", "longitude", "address",
    "phone", "website", "rating", "total_reviews",
    "category", "weekly_hours", "closed_days",
]


# ─────────────────────────────────────────────────────────────────────
#  CLI
# ─────────────────────────────────────────────────────────────────────
def parse_args():
    parser = argparse.ArgumentParser(
        prog="gmaps_scraper",
        description="Google Maps Universal Scraper – Shared List, Search Results, atau Keyword.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Contoh penggunaan:
  # Scrape dari Shared List Google Maps
  python gmaps_scraper.py --url "https://maps.app.goo.gl/XxXxXxXx" --output hasil.csv

  # Scrape dari URL search Google Maps
  python gmaps_scraper.py --url "https://www.google.com/maps/search/restoran+di+jogja"

  # Scrape lewat keyword (otomatis buka search Google Maps)
  python gmaps_scraper.py --keyword "warung makan murah jakarta" --output warung.csv

  # Pilih field tertentu saja
  python gmaps_scraper.py --url "..." --fields name,latitude,longitude,phone,rating

  # Batasi jumlah hasil
  python gmaps_scraper.py --keyword "cafe bandung" --max-results 30 --output cafe.csv

  # Lihat semua field yang tersedia
  python gmaps_scraper.py --list-fields
        """,
    )
    src = parser.add_mutually_exclusive_group()
    src.add_argument(
        "--url",
        metavar="URL",
        help="URL Google Maps: bisa shared list (maps.app.goo.gl/...) atau search results",
    )
    src.add_argument(
        "--keyword",
        metavar="KATA_KUNCI",
        help='Kata kunci pencarian, contoh: "restoran padang jakarta"',
    )
    parser.add_argument(
        "--output",
        metavar="FILE.csv",
        default="output.csv",
        help="Nama file CSV output (default: output.csv)",
    )
    parser.add_argument(
        "--fields",
        metavar="FIELD1,FIELD2,...",
        default=",".join(DEFAULT_FIELDS),
        help=(
            "Field yang akan diambil, pisahkan dengan koma. "
            f"Default: {','.join(DEFAULT_FIELDS)}. "
            "Gunakan --list-fields untuk lihat semua pilihan."
        ),
    )
    parser.add_argument(
        "--list-fields",
        action="store_true",
        help="Tampilkan semua field yang tersedia lalu keluar.",
    )
    parser.add_argument(
        "--mode",
        choices=["auto", "list", "search"],
        default="auto",
        help=(
            "Mode scraping. "
            "'auto' = deteksi otomatis dari URL, "
            "'list' = shared list, "
            "'search' = hasil pencarian. "
            "(default: auto)"
        ),
    )
    parser.add_argument(
        "--max-results",
        metavar="N",
        type=int,
        default=0,
        help="Batas maksimum tempat yang diambil. 0 = ambil semua. (default: 0)",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Jalankan browser tanpa tampilan (headless). Bisa kena CAPTCHA lebih mudah.",
    )
    return parser.parse_args()


# ─────────────────────────────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────────────────────────────
def detect_mode(url: str) -> str:
    """Auto-detect mode dari URL."""
    if "maps.app.goo.gl" in url:
        return "list"
    if "/maps/search/" in url or "google.com/maps/search" in url:
        return "search"
    if "/maps/list/" in url:
        return "list"
    # Fallback: kalau ada koordinat /@... kemungkinan search / place
    return "list"


def extract_coords(url: str):
    """Ekstrak lat/lng dari berbagai format URL Google Maps."""
    if not url:
        return None, None
    # Paling akurat: !3dlat!4dlng  (full place URL)
    m = re.search(r'!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)', url)
    if m:
        return float(m.group(1)), float(m.group(2))
    # @lat,lng (viewport/search URL)
    m = re.search(r'@(-?\d+\.\d+),(-?\d+\.\d+)', url)
    if m:
        return float(m.group(1)), float(m.group(2))
    # q=lat,lng
    m = re.search(r'q=(-?\d+\.\d+),(-?\d+\.\d+)', url)
    if m:
        return float(m.group(1)), float(m.group(2))
    return None, None


def parse_weekly_hours(table_el):
    """Parse tabel jam operasional 7 hari dari panel detail Google Maps."""
    rows = table_el.locator("tr").all()
    weekly_hours, closed_days = [], []
    for row in rows:
        try:
            text = row.inner_text().strip()
            parts = [p.strip() for p in text.split("\n") if p.strip()]
            if not parts or len(parts) < 2:
                parts = [p.strip() for p in re.split(r'\t|\s{2,}', text) if p.strip()]
            if len(parts) >= 2:
                day, hours = parts[0], parts[1]
                weekly_hours.append(f"{day}: {hours.replace('.', ':')}")
                if any(k in hours.lower() for k in ["tutup", "closed"]):
                    closed_days.append(day)
            elif len(parts) == 1:
                weekly_hours.append(parts[0])
        except Exception:
            pass
    return (
        "; ".join(weekly_hours),
        ", ".join(closed_days) if closed_days else "Tidak Ada",
    )


def _try_text(page, *selectors) -> str:
    """Coba beberapa selector, kembalikan inner_text pertama yang berhasil."""
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if el.count() > 0:
                t = el.inner_text().strip()
                if t:
                    return t
        except Exception:
            pass
    return ""


def _try_attr(page, attr: str, *selectors) -> str:
    """Coba beberapa selector, kembalikan attribute pertama yang berhasil."""
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if el.count() > 0:
                v = el.get_attribute(attr)
                if v:
                    return v.strip()
        except Exception:
            pass
    return ""


# ─────────────────────────────────────────────────────────────────────
#  Detail Extractor  – baca semua field dari panel detail yang terbuka
# ─────────────────────────────────────────────────────────────────────
def extract_place_details(page, fields: list, current_url: str) -> dict:
    """
    Ekstrak semua field yang diminta dari panel detail Google Maps yang
    sedang terbuka. Mengembalikan dict {field: value}.
    """
    data = {f: "" for f in fields}

    # ── name ─────────────────────────────────────────────────────────
    if "name" in fields:
        data["name"] = _try_text(
            page,
            "h1.DUwDvf",
            "h1[class*='fontHeadline']",
            "h1",
        )

    # ── coordinates (dari URL setelah klik / navigasi) ───────────────
    if "latitude" in fields or "longitude" in fields:
        lat, lng = extract_coords(current_url)
        data["latitude"]  = lat if lat else ""
        data["longitude"] = lng if lng else ""

    # ── maps_url ──────────────────────────────────────────────────────
    if "maps_url" in fields:
        data["maps_url"] = current_url

    # ── address ──────────────────────────────────────────────────────
    if "address" in fields:
        data["address"] = _try_text(
            page,
            "button[data-item-id='address']",
            "[data-item-id='address']",
        )

    # ── phone ─────────────────────────────────────────────────────────
    if "phone" in fields:
        # aria-label sering berisi nomor lebih bersih
        for sel in ["button[data-item-id*='phone']", "a[href^='tel:']"]:
            try:
                el = page.locator(sel).first
                if el.count() > 0:
                    label = el.get_attribute("aria-label") or ""
                    text  = el.inner_text().strip()
                    # Ambil yang lebih panjang/bermakna
                    val = label if label else text
                    # Bersihkan prefix seperti "Telepon: "
                    val = re.sub(r'^(Telepon|Phone)\s*[:\-]?\s*', '', val, flags=re.I).strip()
                    if val:
                        data["phone"] = val
                        break
            except Exception:
                pass

    # ── website ───────────────────────────────────────────────────────
    if "website" in fields:
        data["website"] = (
            _try_attr(page, "href",
                      "a[data-item-id='authority']",
                      "a[aria-label*='ebsite']")
            or _try_text(page,
                         "a[data-item-id='authority']",
                         "a[aria-label*='ebsite']")
        )

    # ── rating ────────────────────────────────────────────────────────
    if "rating" in fields:
        for sel in [
            "div.F7nice span[aria-hidden='true']",
            "span.ceNzKf[aria-hidden='true']",
            "div[jsaction*='pane.rating'] span[aria-hidden='true']",
        ]:
            try:
                el = page.locator(sel).first
                if el.count() > 0:
                    t = el.inner_text().strip()
                    if re.match(r'^\d[\.,]\d$', t):
                        data["rating"] = t.replace(",", ".")
                        break
            except Exception:
                pass

    # ── total_reviews ─────────────────────────────────────────────────
    if "total_reviews" in fields:
        for sel in [
            "button[jsaction*='pane.rating']",
            "span[aria-label*='ulasan']",
            "span[aria-label*='review']",
            "div.F7nice span[aria-label]",
        ]:
            try:
                el = page.locator(sel).first
                if el.count() > 0:
                    label = el.get_attribute("aria-label") or el.inner_text()
                    # Ambil semua angka (termasuk titik/koma pemisah ribuan)
                    nums = re.findall(r'[\d\.]+', label.replace(",", "."))
                    if nums:
                        # Hilangkan titik pemisah ribuan lalu ambil angka terbesar
                        clean = max(nums, key=lambda x: len(x))
                        data["total_reviews"] = clean.replace(".", "")
                        break
            except Exception:
                pass

    # ── category + price_level ────────────────────────────────────────
    if "category" in fields or "price_level" in fields:
        for sel in ["button.DkEaL", "span.DkEaL", "[jsaction*='category']"]:
            try:
                els = page.locator(sel).all()
                for el in els:
                    t = el.inner_text().strip()
                    if not t:
                        continue
                    if re.match(r'^[\$\€\£·]+$', t):
                        if "price_level" in fields and not data["price_level"]:
                            data["price_level"] = t
                    else:
                        if "category" in fields and not data["category"]:
                            data["category"] = t
                if els:
                    break
            except Exception:
                pass

    # ── plus_code ─────────────────────────────────────────────────────
    if "plus_code" in fields:
        data["plus_code"] = _try_text(
            page,
            "button[data-item-id='oloc']",
            "[data-item-id='oloc']",
        )

    # ── weekly_hours + closed_days ────────────────────────────────────
    if "weekly_hours" in fields or "closed_days" in fields:
        oh_btn = page.locator("button[data-item-id='oh']").first
        if oh_btn.count() > 0:
            try:
                oh_btn.click(force=True, delay=200)
                for _ in range(80):
                    tbl = page.locator("table").first
                    if tbl.count() > 0 and tbl.locator("tr").count() == 7:
                        wh, cd = parse_weekly_hours(tbl)
                        data["weekly_hours"] = wh
                        data["closed_days"]  = cd
                        break
                    page.wait_for_timeout(100)
            except Exception:
                pass
        if not data.get("closed_days"):
            data["closed_days"] = "Tidak Ada"

    return data


# ─────────────────────────────────────────────────────────────────────
#  URL polling  – tunggu sampai koordinat muncul di URL
# ─────────────────────────────────────────────────────────────────────
def wait_for_coords(page, prev_url: str, timeout_ms: int = 25000):
    """Poll URL sampai koordinat GPS muncul. Return (lat, lng, url)."""
    elapsed = 0
    while elapsed < timeout_ms:
        url_now = page.url
        if url_now != prev_url:
            lat, lng = extract_coords(url_now)
            if lat and lng:
                return lat, lng, url_now
        page.wait_for_timeout(100)
        elapsed += 100
    return None, None, page.url


# ─────────────────────────────────────────────────────────────────────
#  Mode: Shared List
# ─────────────────────────────────────────────────────────────────────
def collect_list_cards(page, max_results: int) -> list:
    """Scroll shared list sampai habis, kembalikan semua card element."""
    print("[*] Mode: Shared List – auto-scrolling...")
    seen, stall = 0, 0

    while stall < 20:
        cards = page.locator("button.SMP2wb")
        now   = cards.count()
        print(f"    Terdeteksi {now} tempat...", end="\r", flush=True)

        if max_results > 0 and now >= max_results:
            break

        if now > 0:
            try:
                cards.nth(now - 1).scroll_into_view_if_needed(timeout=1000)
                page.keyboard.press("PageDown")
            except Exception:
                pass
            page.evaluate("""() => {
                const cs = document.querySelectorAll('button.SMP2wb');
                if (!cs.length) return;
                let p = cs[cs.length-1].parentElement;
                while (p && p !== document.body) {
                    if (p.scrollHeight > p.clientHeight) {
                        p.scrollTop = p.scrollHeight - 500;
                        setTimeout(() => { p.scrollTop = p.scrollHeight + 1000; }, 300);
                        break;
                    }
                    p = p.parentElement;
                }
            }""")
        else:
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")

        page.wait_for_timeout(3500)
        stall = 0 if now > seen else stall + 1
        seen  = max(seen, now)

    all_cards = page.locator("button.SMP2wb").all()
    print(f"\n[*] Total terdeteksi: {len(all_cards)} tempat.")
    return all_cards[:max_results] if max_results > 0 else all_cards


# ─────────────────────────────────────────────────────────────────────
#  Mode: Search Results
# ─────────────────────────────────────────────────────────────────────
def collect_search_urls(page, max_results: int) -> list:
    """
    Scroll panel kiri hasil pencarian Google Maps.
    Kumpulkan semua href tempat yang muncul.
    """
    print("[*] Mode: Search Results – auto-scrolling panel hasil...")

    # Tunggu panel kiri muncul
    for _ in range(50):
        if page.locator("div[role='feed']").count() > 0:
            break
        page.wait_for_timeout(300)

    seen_urls: set = set()
    stall = 0

    while stall < 15:
        prev = len(seen_urls)

        # Selector utama dan fallback untuk kartu hasil pencarian
        for sel in [
            "div[role='feed'] a[href*='/maps/place/']",
            "a.hfpxzc[href*='/maps/place/']",
            "a[href*='/maps/place/']",
        ]:
            try:
                els = page.locator(sel).all()
                for el in els:
                    href = el.get_attribute("href") or ""
                    if "/maps/place/" in href:
                        # Bersihkan parameter tracking, simpan URL bersih
                        clean = re.sub(r'&ved=.*', '', href)
                        seen_urls.add(clean)
            except Exception:
                pass

        print(f"    Terkumpul {len(seen_urls)} URL tempat...", end="\r", flush=True)

        if max_results > 0 and len(seen_urls) >= max_results:
            break

        # Scroll panel feed
        page.evaluate("""() => {
            const feed = document.querySelector("div[role='feed']");
            if (feed) feed.scrollTop = feed.scrollHeight + 2000;
            else window.scrollTo(0, document.body.scrollHeight);
        }""")
        page.wait_for_timeout(2500)

        stall = 0 if len(seen_urls) > prev else stall + 1

    urls = list(seen_urls)
    print(f"\n[*] Total URL terkumpul: {len(urls)}")
    return urls[:max_results] if max_results > 0 else urls


# ─────────────────────────────────────────────────────────────────────
#  CSV Writer
# ─────────────────────────────────────────────────────────────────────
def save_csv(rows: list, output_file: str, fields: list):
    with open(output_file, mode="w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"\n[OK] {len(rows)} data tersimpan → {output_file}")


# ─────────────────────────────────────────────────────────────────────
#  Main Scraper
# ─────────────────────────────────────────────────────────────────────
def scrape(url: str, output: str, fields: list, mode: str, max_results: int, headless: bool):
    # Persistent Chrome profile – simpan session/cookies agar tidak kena CAPTCHA berulang
    profile_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gmaps_chrome_profile")
    os.makedirs(profile_dir, exist_ok=True)

    if mode == "auto":
        mode = detect_mode(url)

    print("=" * 62)
    print(f"  Google Maps Universal Scraper v2.0")
    print("=" * 62)
    print(f"  URL        : {url[:70]}{'...' if len(url) > 70 else ''}")
    print(f"  Mode       : {mode}")
    print(f"  Output     : {output}")
    print(f"  Fields     : {', '.join(fields)}")
    print(f"  Max results: {'Semua' if max_results == 0 else max_results}")
    print(f"  Headless   : {headless}")
    print("=" * 62)
    print()

    places_data = []

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=headless,
            viewport={"width": 1280, "height": 800},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = context.pages[0] if context.pages else context.new_page()

        # ── Buka URL ──────────────────────────────────────────────────
        print("[*] Membuka halaman...")
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_timeout(5000)

        # ── Kumpulkan daftar tempat ───────────────────────────────────
        if mode == "list":
            cards = collect_list_cards(page, max_results)
            total = len(cards)
            print(f"\n[*] Mengekstrak detail dari {total} tempat...\n")

            for idx, card in enumerate(cards):
                try:
                    name_el   = card.locator(".fontHeadlineSmall")
                    card_name = name_el.inner_text().strip() if name_el.count() else f"Tempat {idx+1}"
                    prev_url  = page.url

                    try:
                        card.scroll_into_view_if_needed(timeout=2000)
                    except Exception:
                        pass
                    card.click(force=True, delay=200)

                    # Tunggu koordinat muncul, retry jika macet
                    lat, lng, cur_url = wait_for_coords(page, prev_url, timeout_ms=15000)
                    if not lat:
                        print(f"    [!] Retry klik: {card_name[:30]}")
                        try:
                            card.click(force=True, delay=500)
                        except Exception:
                            pass
                        lat, lng, cur_url = wait_for_coords(page, prev_url, timeout_ms=15000)
                    if not lat:
                        try:
                            card.evaluate("n => n.click()")
                        except Exception:
                            pass
                        lat, lng, cur_url = wait_for_coords(page, prev_url, timeout_ms=10000)

                    # Tunggu panel detail
                    page.wait_for_timeout(1500)

                    details = extract_place_details(page, fields, cur_url)
                    if not details.get("name"):
                        details["name"] = card_name

                    places_data.append(details)
                    print(
                        f"[+] [{idx+1}/{total}] "
                        f"{details.get('name','')[:35]:<35} "
                        f"({lat}, {lng})"
                    )

                except Exception as e:
                    print(f"[!] [{idx+1}/{total}] Gagal: {str(e)[:70]}")

        elif mode == "search":
            place_urls = collect_search_urls(page, max_results)
            total      = len(place_urls)
            print(f"\n[*] Mengekstrak detail dari {total} tempat...\n")

            for idx, place_url in enumerate(place_urls):
                try:
                    page.goto(place_url, wait_until="domcontentloaded")
                    page.wait_for_timeout(2500)

                    # Tunggu nama muncul sebagai tanda panel siap
                    for _ in range(30):
                        if page.locator("h1.DUwDvf").count() > 0:
                            break
                        page.wait_for_timeout(200)

                    cur_url = page.url
                    details = extract_place_details(page, fields, cur_url)

                    places_data.append(details)
                    lat  = details.get("latitude", "")
                    lng  = details.get("longitude", "")
                    name = details.get("name", f"Tempat {idx+1}")
                    print(
                        f"[+] [{idx+1}/{total}] "
                        f"{name[:35]:<35} "
                        f"({lat}, {lng})"
                    )

                except Exception as e:
                    print(f"[!] [{idx+1}/{total}] Gagal: {str(e)[:70]}")

        context.close()

    if places_data:
        save_csv(places_data, output, fields)
    else:
        print("\n[!] Tidak ada data yang berhasil diambil.")


# ─────────────────────────────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────────────────────────────
def main():
    args = parse_args()

    # ── --list-fields ─────────────────────────────────────────────────
    if args.list_fields:
        print("\nField yang tersedia:\n")
        print(f"  {'FIELD':<18}  {'KETERANGAN'}")
        print("  " + "─" * 65)
        for field, desc in AVAILABLE_FIELDS.items():
            mark = " ← (default)" if field in DEFAULT_FIELDS else ""
            print(f"  {field:<18}  {desc}{mark}")
        print(f"\nDefault: {', '.join(DEFAULT_FIELDS)}\n")
        sys.exit(0)

    # ── Validasi sumber input ─────────────────────────────────────────
    if not args.url and not args.keyword:
        print("[!] Harus menyertakan --url atau --keyword. Gunakan --help untuk bantuan.")
        sys.exit(1)

    # ── Resolusi URL ──────────────────────────────────────────────────
    if args.keyword:
        encoded = quote_plus(args.keyword)
        url  = f"https://www.google.com/maps/search/{encoded}"
        mode = "search"
        print(f"[*] Keyword → URL: {url}")
    else:
        url  = args.url
        mode = args.mode

    # ── Validasi fields ───────────────────────────────────────────────
    requested = [f.strip() for f in args.fields.split(",") if f.strip()]
    invalid   = [f for f in requested if f not in AVAILABLE_FIELDS]
    if invalid:
        print(f"[!] Field tidak dikenal: {', '.join(invalid)}")
        print("    Jalankan --list-fields untuk melihat pilihan yang valid.")
        sys.exit(1)

    scrape(
        url=url,
        output=args.output,
        fields=requested,
        mode=mode,
        max_results=args.max_results,
        headless=args.headless,
    )


if __name__ == "__main__":
    main()
