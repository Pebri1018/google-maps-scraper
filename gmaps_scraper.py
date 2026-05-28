import csv
import re
import time
import os
from playwright.sync_api import sync_playwright

# INPUT: Paste your Google Maps shared list link here
SHARED_LIST_URL = "https://maps.app.goo.gl/LMm6Gsmd12D2XHhK6" 

def extract_coords(url):
    """
    Extracts latitude and longitude from Google Maps URLs.
    """
    if not url:
        return None, None
    
    # Pattern 1: !3dlat!4dlng (Actual place coordinates - highly accurate)
    match = re.search(r'!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)', url)
    if match:
        return float(match.group(1)), float(match.group(2))

    # Pattern 2: @lat,lng
    match = re.search(r'@(-?\d+\.\d+),(-?\d+\.\d+)', url)
    if match:
        return float(match.group(1)), float(match.group(2))
        
    # Pattern 3: q=lat,lng
    match = re.search(r'q=(-?\d+\.\d+),(-?\d+\.\d+)', url)
    if match:
        return float(match.group(1)), float(match.group(2))
        
    return None, None

def parse_weekly_hours(table_element):
    """
    Parses the expanded Google Maps weekly hours table.
    Returns:
      - weekly_hours_str: "Senin: 08:00-17:00; Selasa: 08:00-17:00; ..."
      - closed_days_str: "Sabtu, Minggu"
    """
    rows = table_element.locator("tr").all()
    weekly_hours = []
    closed_days = []
    
    for row in rows:
        try:
            text = row.inner_text().strip()
            # Split day and hours (Google Maps usually separates them by \n inside a tr)
            parts = [p.strip() for p in text.split("\n") if p.strip()]
            if not parts or len(parts) < 2:
                # Fallback for tabs or double spaces
                parts = [p.strip() for p in re.split(r'\t|\s{2,}', text) if p.strip()]
                
            if len(parts) >= 2:
                day, hours = parts[0], parts[1]
                cleaned_hours = hours.replace(".", ":")
                weekly_hours.append(f"{day}: {cleaned_hours}")
                
                # Check if this day is closed
                hours_lower = hours.lower()
                if "tutup" in hours_lower or "closed" in hours_lower:
                    closed_days.append(day)
            elif len(parts) == 1:
                weekly_hours.append(parts[0])
        except Exception:
            pass
            
    weekly_hours_str = "; ".join(weekly_hours)
    closed_days_str = ", ".join(closed_days) if closed_days else "Tidak Ada"
    
    return weekly_hours_str, closed_days_str

def scrape_gmaps_list(url, output_csv="spx_jogja_import.csv"):
    print(f"[*] Memulai scraper untuk: {url}")
    
    # ── Profil Chrome Persisten ──
    # Menyimpan cookies, status persetujuan Google Maps, dan data captcha agar tidak hilang saat dijalankan ulang.
    # Menggunakan direktori terisolasi di dalam proyek agar tidak bertabrakan jika pengguna sedang membuka Chrome.
    workspace_dir = os.path.dirname(os.path.abspath(__file__))
    profile_dir = os.path.join(workspace_dir, "backend", "gmaps_chrome_profile")
    os.makedirs(profile_dir, exist_ok=True)
    print(f"[*] Menggunakan profil Chrome persisten: {profile_dir}")
    
    with sync_playwright() as p:
        # Menggunakan launch_persistent_context untuk mewarisi session aktif
        context = p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=False,
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        page = context.pages[0] if context.pages else context.new_page()
        
        # Navigate to the list
        page.goto(url, wait_until="domcontentloaded")
        print("[*] Halaman dimuat. Menunggu daftar tempat ter-render...")
        page.wait_for_timeout(6000)
        
        # Scroll loop to load all dynamic places in the shared list
        items_count = 0
        scroll_attempts = 0
        max_attempts = 300 # Increased to support longer/slower scroll processes
        
        print("[*] Memulai auto-scrolling untuk memuat seluruh spot (sabar, proses ini sengaja diperlambat agar akurat)...")
        while scroll_attempts < max_attempts:
            cards = page.locator("button.SMP2wb")
            current_count = cards.count()
            print(f"[~] Men-scroll daftar tempat... Terdeteksi {current_count} tempat saat ini.")
            
            if current_count > 0:
                try:
                    last_card = cards.nth(current_count - 1)
                    last_card.scroll_into_view_if_needed(timeout=1000)
                    last_card.focus()
                    page.keyboard.press("PageDown")
                    page.keyboard.press("PageDown")
                except Exception:
                    pass
                
                # Jitter scroll on the scrollable container
                page.evaluate("""() => {
                    const allCards = document.querySelectorAll('button.SMP2wb');
                    if (allCards.length > 0) {
                        const lastCard = allCards[allCards.length - 1];
                        let parent = lastCard.parentElement;
                        while (parent && parent !== document.body) {
                            if (parent.scrollHeight > parent.clientHeight) {
                                // Jitter: up 500px, then down to bottom
                                parent.scrollTop = parent.scrollHeight - 500;
                                setTimeout(() => {
                                    parent.scrollTop = parent.scrollHeight + 1000;
                                }, 300);
                            }
                            parent = parent.parentElement;
                        }
                    }
                }""")
            else:
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                
            page.wait_for_timeout(3500) # Increased wait to 3.5 seconds to let heavy lists load
            
            if current_count == items_count:
                scroll_attempts += 1
                if scroll_attempts >= 20: # Tolerate up to 20 stagnations (70 seconds)
                    print("[*] Tidak ada tempat baru yang dimuat setelah 20 kali percobaan. Menghentikan scrolling.")
                    break
            else:
                scroll_attempts = 0
                items_count = current_count
                
        print(f"[*] Selesai memuat tempat. Total terdeteksi: {items_count} tempat.")
        
        # Extract details from loaded cards
        places_data = []
        cards_list = page.locator("button.SMP2wb").all()
        total_to_extract = len(cards_list)
        
        print("\n[*] Memulai proses ekstraksi detail (klik dan parse)...")
        for idx, card in enumerate(cards_list):
            try:
                # 1. Get Name from child class fontHeadlineSmall
                name_el = card.locator(".fontHeadlineSmall")
                name = name_el.inner_text().strip() if name_el.count() else f"Spot SPX {idx+1}"
                
                # Record URL before click to prevent race condition coordinates duplicates
                previous_url = page.url
                
                # 2. Click the card to open details pane and update URL
                try:
                    card.scroll_into_view_if_needed(timeout=2000)
                except Exception:
                    pass
                card.click(force=True, delay=200) # Force click bypasses visibility/overlay issues
                
                # 3. Dynamic check for coordinates in URL (Tunggu sampai dapat!)
                lat, lng = None, None
                attempts = 0
                
                while attempts < 300: # Max tunggu 30 detik per seller
                    url_now = page.url
                    if url_now != previous_url:
                        lat, lng = extract_coords(url_now)
                        if lat and lng:
                            break
                    
                    # Jika sudah 5 detik tapi URL masih belum berubah, paksa klik lagi!
                    if attempts == 50 and url_now == previous_url:
                        print(f"    [!] Klik macet untuk {name[:20]}, mencoba klik ulang...")
                        try:
                            card.scroll_into_view_if_needed(timeout=1000)
                            card.click(force=True, delay=500)
                        except Exception:
                            pass
                            
                    # Jika sudah 15 detik URL belum berubah juga, klik lagi dengan cara beda
                    if attempts == 150 and url_now == previous_url:
                        print(f"    [!] Mencoba klik lagi untuk yang ketiga kali {name[:20]}...")
                        try:
                            card.evaluate("node => node.click()")
                        except Exception:
                            pass

                    page.wait_for_timeout(100)
                    attempts += 1
                
                # 4. Extract address with dynamic loading wait (max 10 seconds)
                address = ""
                for _ in range(100): # 100 * 100ms = 10s wait
                    addr_el = page.locator("button[data-item-id='address']")
                    if addr_el.count() > 0:
                        address_text = addr_el.first.inner_text().strip()
                        if address_text:
                            address = address_text
                            break
                    page.wait_for_timeout(100)
                
                # 5. Extract full weekly hours and detect closed days (max 8 seconds)
                weekly_hours = "Tidak Ada Informasi"
                closed_days = "Tidak Ada"
                
                oh_btn = page.locator("button[data-item-id='oh']")
                if oh_btn.count() > 0:
                    try:
                        # Click to expand the weekly hours table
                        oh_btn.first.click(force=True, delay=200)
                        
                        # Wait dynamicly until the table has exactly 7 rows (representing the 7 days)
                        for _ in range(80):
                            weekly_table = page.locator("table").first
                            if weekly_table.count() > 0 and weekly_table.locator("tr").count() == 7:
                                weekly_hours, closed_days = parse_weekly_hours(weekly_table)
                                break
                            page.wait_for_timeout(100)
                    except Exception:
                        pass
                
                if name and lat and lng:
                    places_data.append({
                        "name": name,
                        "latitude": lat,
                        "longitude": lng,
                        "address": address,
                        "weekly_hours": weekly_hours,
                        "closed_days": closed_days
                    })
                    # Safe print to console
                    print(f"[+] [{idx+1}/{total_to_extract}] Extracted: {name[:25]} -> ({lat}, {lng}) | Tutup: {closed_days}")
                else:
                    print(f"[-] [{idx+1}/{total_to_extract}] Skipped {name[:25]}: Missing coords or details")
            except Exception as e:
                print(f"[!] [{idx+1}/{total_to_extract}] Gagal mengekstrak item: {str(e)[:50]}")
                
        # Write to CSV
        if places_data:
            fieldnames = ["name", "latitude", "longitude", "address", "weekly_hours", "closed_days"]
            with open(output_csv, mode="w", encoding="utf-8", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(places_data)
            print(f"\n[OK] SUKSES! {len(places_data)} spot berhasil disimpan ke: {output_csv}")
        else:
            print("\n[!] Gagal mengekstrak data tempat yang valid dari list.")
            
        context.close()

if __name__ == "__main__":
    scrape_gmaps_list(SHARED_LIST_URL)
