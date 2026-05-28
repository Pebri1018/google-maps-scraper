# 🗺️ Google Maps Shared List Scraper

Scrape **nama, koordinat GPS, alamat, dan jam operasional** dari sebuah Google Maps Shared List secara otomatis — lalu simpan hasilnya ke file **CSV** siap pakai.

> Cocok untuk keperluan riset lapangan, import data ke platform internal, atau analisis lokasi bisnis.

---

## ✨ Fitur

| Fitur | Keterangan |
|---|---|
| 🔗 Input URL Shared List | Cukup tempel link Google Maps list kamu |
| 📍 Ekstrak Koordinat GPS | Presisi tinggi via URL pattern `!3d!4d` |
| 🏠 Ekstrak Alamat | Dari panel detail Google Maps |
| 🕐 Jam Operasional Lengkap | Klik otomatis untuk buka tabel 7 hari |
| 📅 Deteksi Hari Tutup | Parsing otomatis hari dengan label "Tutup" |
| 💾 Output CSV | Langsung siap diimport ke Zpilot / spreadsheet |
| 🖥️ Headed Browser | Pakai Chromium visible jadi Google Maps tidak deteksi bot |
| 🔁 Auto-Scroll | Scroll otomatis untuk memuat semua tempat di list |
| 🔄 Retry Click | Deteksi klik macet dan retry otomatis |

---

## 📋 Prasyarat

- **Python 3.10+**
- **pip** (sudah terinstall bersama Python)
- Koneksi internet aktif
- Google Chrome / Chromium **tidak perlu** diinstall secara terpisah (Playwright download sendiri)

---

## 🚀 Cara Pakai

### 1. Clone repo ini

```bash
git clone https://github.com/YOUR_USERNAME/gmaps-shared-list-scraper.git
cd gmaps-shared-list-scraper
```

### 2. Buat virtual environment (opsional tapi disarankan)

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate
```

### 3. Install dependensi

```bash
pip install -r requirements.txt
playwright install chromium
```

### 4. Set URL Google Maps List kamu

Buka file `gmaps_scraper.py`, ganti variabel `SHARED_LIST_URL` di bagian atas:

```python
# INPUT: Paste your Google Maps shared list link here
SHARED_LIST_URL = "https://maps.app.goo.gl/XXXXXXXXXXXXXXX"
```

> **Cara dapat link list Google Maps:**
> 1. Buka Google Maps → klik ikon Saved (bookmark) kamu
> 2. Pilih salah satu List → klik ⋮ (titik tiga) → **Share or embed map**
> 3. Copy link yang muncul

### 5. Jalankan scraper

```bash
python gmaps_scraper.py
```

Browser Chromium akan terbuka secara otomatis. Biarkan berjalan — jangan tutup browser!

---

## 📁 Output

Setelah selesai, hasil scraping disimpan di:

```
spx_jogja_import.csv
```

Contoh isi CSV:

| name | latitude | longitude | address | weekly_hours | closed_days |
|---|---|---|---|---|---|
| Warung Pak Budi | -7.7654 | 110.3891 | Jl. Magelang No.5 | Senin: 08:00-17:00; Selasa: 08:00-17:00; ... | Minggu |
| Toko Maju Jaya | -7.8012 | 110.4123 | Jl. Kaliurang KM.5 | Senin: 09:00-21:00; ... | Tidak Ada |

### Keterangan kolom

| Kolom | Keterangan |
|---|---|
| `name` | Nama tempat dari Google Maps |
| `latitude` | Koordinat GPS lintang |
| `longitude` | Koordinat GPS bujur |
| `address` | Alamat lengkap |
| `weekly_hours` | Jam buka per hari, format: `Hari: HH:MM-HH:MM; ...` |
| `closed_days` | Hari tutup (jika ada), atau `Tidak Ada` |

---

## ⚙️ Konfigurasi

Kamu bisa mengubah beberapa parameter di dalam `gmaps_scraper.py`:

```python
# URL list Google Maps yang mau di-scrape
SHARED_LIST_URL = "https://maps.app.goo.gl/..."

# Nama file output CSV
output_csv = "spx_jogja_import.csv"   # parameter di fungsi scrape_gmaps_list()

# Maksimal percobaan scroll (makin besar = makin sabar menunggu list panjang)
max_attempts = 300

# Maks. tunggu per tempat sampai koordinat ketemu (satuan: 100ms per unit)
while attempts < 300:   # = 30 detik
```

---

## 🐛 Troubleshooting

### Browser terbuka lalu langsung tutup
→ Pastikan kamu sudah jalankan `playwright install chromium`

### Koordinat tidak ditemukan untuk beberapa tempat
→ Google Maps butuh waktu untuk redirect ke URL penuh. Script sudah retry otomatis hingga 30 detik per tempat.

### Jam buka tidak terdeteksi (`Tidak Ada Informasi`)
→ Beberapa tempat memang tidak punya info jam di Google Maps, atau tombol jam tidak muncul.

### Google Maps minta login / CAPTCHA
→ Script menggunakan **persistent Chrome profile** (folder `backend/gmaps_chrome_profile/`). Cukup login sekali di browser yang muncul, lalu jalankan ulang script — session tersimpan otomatis.

### List hanya load sebagian
→ Tambah nilai `max_attempts` atau kurangi kecepatan scroll dengan menaikkan nilai `wait_for_timeout`.

---

## 📌 Catatan Penting

- **Bukan API resmi** — Script ini menggunakan browser automation (Playwright). Google Maps sewaktu-waktu bisa mengubah struktur HTML-nya dan menyebabkan script perlu diupdate.
- **Rate Limiting** — Script sengaja dibuat lambat (3.5 detik antar scroll, 100ms polling) agar tidak terdeteksi sebagai bot.
- **Gunakan secara bertanggung jawab** — Jangan gunakan untuk scraping masif yang membebani server Google.

---

## 🛠️ Tech Stack

- **Python 3.10+**
- **Playwright** — Browser automation (headless/headed Chromium)
- **csv** — Standard library Python untuk output file

---

## 📄 Lisensi

MIT License — bebas digunakan, dimodifikasi, dan didistribusikan.
