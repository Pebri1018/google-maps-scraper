# 🗺️ Google Maps Universal Scraper

Scrape data dari Google Maps secara otomatis — dari **Shared List**, **hasil pencarian (Search Results)**, maupun langsung via **kata kunci** — lalu simpan ke file **CSV** dengan nama dan kolom yang bisa dikustomisasi sepenuhnya.

Kini dilengkapi dengan **Web UI Command Generator** untuk mempermudah pengaturan tanpa harus menghafal perintah CLI!

---

## ✨ Fitur Utama

| Fitur | Keterangan |
|---|---|
| 🌐 **Web UI Builder** | Halaman web untuk meracik perintah scraping dengan sekali klik. |
| 🔗 **3 Mode Input** | Shared List · Search Results URL · Kata kunci langsung. |
| 📋 **14 Field Tersedia** | Nama, koordinat, alamat, telepon, website, rating, ulasan, kategori, harga, jam buka, hari tutup, Plus Code, URL Maps. |
| 🎛️ **Field Kustom** | Pilih data apa saja yang ingin diambil melalui Web UI atau CLI. |
| 💾 **Custom CSV** | Tentukan nama file output hasil scraping. |
| 🔢 **Batas Hasil** | Batasi jumlah tempat yang diambil (misal: 50 tempat saja). |
| 🖥️ **Headed Browser** | Browser Chromium terlihat agar tidak diblokir/terdeteksi bot oleh Google. |
| 🔁 **Auto-scroll & Retry**| Scroll otomatis untuk memuat hasil dan auto-retry saat klik gagal. |
| 🍪 **Persistent Session** | Session tersimpan, login/consent Google cukup dilakukan sekali. |

---

## 🚀 Instalasi & Persiapan (Wajib di Komputer Kamu)

Karena Google Maps akan memblokir aktivitas otomatis dari *Cloud Server* (seperti Vercel), **proses scraping yang sebenarnya tetap harus berjalan di komputermu sendiri.**

1. **Clone Repo & Masuk Folder**
   ```bash
   git clone https://github.com/Pebri1018/google-maps-scraper.git
   cd google-maps-scraper
   ```

2. **Buat & Aktifkan Virtual Environment (Sangat Disarankan)**
   ```bash
   python -m venv .venv
   .\.venv\Scripts\activate   # Windows
   # source .venv/bin/activate  # macOS / Linux
   ```

3. **Install Dependensi & Browser**
   ```bash
   pip install -r requirements.txt
   playwright install chromium
   ```

---

## 🌐 Cara Pakai: Web UI Command Generator (Rekomendasi)

Web UI ini dibuat agar kamu dan teman-temanmu tidak perlu pusing menghafal *command prompt*. 

1. Deploy folder `frontend/` di repositori ini ke **Vercel** (pilih framework: **Vite**).
2. Bagikan link Vercel tersebut ke siapa saja.
3. Buka web Vercel tersebut.
4. Masukkan URL / Kata Kunci, centang kolom data yang diinginkan, dan atur batas hasil.
5. Klik **Salin Perintah**.
6. Paste perintah tersebut ke terminal komputermu (pastikan sudah berada di folder project dan `.venv` aktif), lalu tekan **Enter**.
7. Chrome akan terbuka otomatis dan melakukan scraping!

---

## 💻 Cara Pakai: Mode Terminal / CLI Langsung

Jika kamu ingin mengetik langsung di terminal:

### 1. Pakai Link Shared List
```bash
python gmaps_scraper.py --url "https://maps.app.goo.gl/XxXxXxXx" --output hasil.csv
```

### 2. Pakai Link Hasil Pencarian (Search Results)
```bash
python gmaps_scraper.py --url "https://www.google.com/maps/search/restoran+padang+di+jakarta" --output padang.csv
```

### 3. Pakai Kata Kunci Langsung
```bash
python gmaps_scraper.py --keyword "warung makan murah jogja" --output warung.csv
```

**Fitur Tambahan CLI:**
* Pilih Field: `--fields name,latitude,longitude,rating`
* Batasi Hasil: `--max-results 30`
* Lihat semua field: `--list-fields`

---

## 🐛 Troubleshooting

* **Browser langsung tutup setelah dibuka:** Jalankan `playwright install chromium`
* **Google Maps minta login / CAPTCHA:** Selesaikan CAPTCHA secara manual di browser yang muncul. Session-nya akan otomatis tersimpan di `gmaps_chrome_profile/` untuk ke depannya.
* **Hasil scrape hanya sebagian:** Ini wajar karena Google Maps memakai *lazy-load*. Naikkan `--max-results` atau coba perspesifik lagi kata kuncinya.

---

## 📄 Lisensi
MIT License — bebas digunakan, dimodifikasi, dan didistribusikan.
