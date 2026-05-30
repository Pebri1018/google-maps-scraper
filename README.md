# 🗺️ Google Maps Universal Scraper

Scrape data dari Google Maps secara otomatis — dari **Shared List**, **hasil pencarian (Search Results)**, maupun langsung via **kata kunci** — lalu simpan ke file **CSV** dengan nama dan kolom yang bisa dikustomisasi sepenuhnya.

---

## ✨ Fitur Utama

| Fitur | Keterangan |
|---|---|
| 🔗 **3 mode input** | Shared List · Search Results URL · Kata kunci langsung |
| 📋 **14 field tersedia** | Nama, koordinat, alamat, telepon, website, rating, ulasan, kategori, harga, jam buka, hari tutup, Plus Code, URL Maps |
| 🎛️ **Field bebas dipilih** | Ambil hanya field yang kamu butuhkan via `--fields` |
| 💾 **Nama CSV bebas** | Tentukan nama file output via `--output` |
| 🔢 **Batas hasil** | Batasi jumlah tempat yang diambil via `--max-results` |
| 🖥️ **Headed browser** | Browser Chromium visible agar tidak terdeteksi bot |
| 🔁 **Auto-scroll** | Scroll otomatis untuk memuat semua hasil |
| 🔄 **Retry click** | Deteksi klik macet dan retry otomatis |
| 🍪 **Persistent session** | Profile Chrome tersimpan, login/consent cukup sekali |

---

## 📋 Prasyarat

- **Python 3.10+**
- Koneksi internet aktif
- Chromium **tidak perlu** diinstall manual (Playwright download otomatis)

---

## 🚀 Instalasi

```bash
# 1. Clone repo
git clone https://github.com/Pebri1018/google-maps-scraper.git
cd google-maps-scraper

# 2. Buat virtual environment (disarankan)
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

# 3. Install dependensi
pip install -r requirements.txt

# 4. Download browser Chromium
playwright install chromium
```

---

## 🎮 Cara Pakai

### Mode 1 – Shared List (link daftar Google Maps)

```bash
python gmaps_scraper.py --url "https://maps.app.goo.gl/XxXxXxXx" --output hasil.csv
```

### Mode 2 – Search Results (URL hasil pencarian)

```bash
python gmaps_scraper.py \
  --url "https://www.google.com/maps/search/restoran+padang+di+jakarta" \
  --output padang_jakarta.csv
```

### Mode 3 – Keyword (langsung cari tanpa URL)

```bash
python gmaps_scraper.py --keyword "warung makan murah jogja" --output warung.csv
```

### Pilih field tertentu saja

```bash
python gmaps_scraper.py \
  --url "https://maps.app.goo.gl/Xxx" \
  --fields name,latitude,longitude,phone,rating,total_reviews \
  --output ringkas.csv
```

### Batasi jumlah hasil

```bash
python gmaps_scraper.py --keyword "cafe bandung instagramable" --max-results 30 --output cafe.csv
```

### Lihat semua field yang tersedia

```bash
python gmaps_scraper.py --list-fields
```

---

## 📊 Field yang Tersedia

Gunakan `--list-fields` untuk melihat daftar ini kapan saja, atau lihat di sini:

| Field | Keterangan | Default? |
|---|---|:---:|
| `name` | Nama tempat | ✅ |
| `latitude` | Koordinat GPS – lintang | ✅ |
| `longitude` | Koordinat GPS – bujur | ✅ |
| `address` | Alamat lengkap | ✅ |
| `phone` | Nomor telepon | ✅ |
| `website` | Website resmi | ✅ |
| `rating` | Rating bintang (contoh: `4.5`) | ✅ |
| `total_reviews` | Total jumlah ulasan (angka) | ✅ |
| `category` | Kategori / tipe tempat | ✅ |
| `weekly_hours` | Jam operasional per hari | ✅ |
| `closed_days` | Hari tutup | ✅ |
| `price_level` | Level harga (`$` hingga `$$$$`) | ❌ |
| `plus_code` | Google Plus Code | ❌ |
| `maps_url` | URL Google Maps tempat ini | ❌ |

---

## 📂 Contoh Output CSV

```csv
name,latitude,longitude,address,phone,website,rating,total_reviews,category,weekly_hours,closed_days
Warung Pak Budi,-7.7654,110.3891,"Jl. Magelang No.5, Yogyakarta",+62274123456,,-,4.6,1250,Warung makan,"Senin: 08:00-21:00; ...",Minggu
Toko Maju Jaya,-7.8012,110.4123,"Jl. Kaliurang KM.5",,https://majujaya.com,4.2,340,Toko,"Senin: 09:00-22:00; ...",Tidak Ada
```

---

## ⚙️ Semua Argumen CLI

```
usage: gmaps_scraper.py [-h] [--url URL | --keyword KATA_KUNCI]
                        [--output FILE.csv] [--fields FIELD1,FIELD2,...]
                        [--list-fields] [--mode {auto,list,search}]
                        [--max-results N] [--headless]

Argumen:
  --url URL             URL Google Maps (shared list atau search results)
  --keyword KATA_KUNCI  Kata kunci pencarian, contoh: "restoran padang jakarta"
  --output FILE.csv     Nama file CSV output (default: output.csv)
  --fields F1,F2,...    Field yang akan diambil, pisahkan koma (default: 11 field utama)
  --list-fields         Tampilkan semua field yang tersedia lalu keluar
  --mode {auto,list,search}
                        Mode scraping (default: auto – deteksi dari URL)
  --max-results N       Maks jumlah tempat yang diambil. 0 = semua (default: 0)
  --headless            Jalankan browser tanpa tampilan GUI
```

---

## 🐛 Troubleshooting

### Browser langsung tutup setelah dibuka
→ Jalankan `playwright install chromium`

### Koordinat tidak ditemukan untuk beberapa tempat
→ Script retry klik otomatis hingga 3x dengan total timeout 40 detik per tempat.

### Jam buka tidak terdeteksi (`""`)
→ Tempat tersebut tidak memiliki informasi jam di Google Maps.

### Google Maps minta login / CAPTCHA
→ Profile Chrome tersimpan di folder `gmaps_chrome_profile/`. Cukup selesaikan CAPTCHA/login **sekali** di browser yang muncul, lalu jalankan ulang — session tersimpan permanen.

### Hasil search hanya sebagian
→ Naikkan waktu tunggu scroll di source code (`page.wait_for_timeout(2500)` → `4000`) atau batasi dengan `--max-results`.

### Mode terdeteksi salah (list vs search)
→ Tambahkan `--mode list` atau `--mode search` secara eksplisit.

---

## 📌 Catatan Penting

- Script ini menggunakan **browser automation (Playwright)** — bukan API resmi Google. Google sewaktu-waktu dapat mengubah struktur HTML-nya.
- Script sengaja dibuat **lambat** (3–3.5 detik antar scroll) agar tidak terdeteksi bot.
- **Gunakan secara bertanggung jawab** — jangan scrape dalam jumlah masif yang membebani server Google.

---

## 🛠️ Tech Stack

| Teknologi | Kegunaan |
|---|---|
| Python 3.10+ | Bahasa utama |
| [Playwright](https://playwright.dev/python/) | Browser automation (Chromium) |
| `csv` | Standard library – output file |
| `argparse` | CLI interface |
| `re` | Parsing URL dan teks |

---

## 📄 Lisensi

MIT License — bebas digunakan, dimodifikasi, dan didistribusikan.
