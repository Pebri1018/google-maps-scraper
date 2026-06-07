# 🗺️ Google Maps Universal Scraper

Scrape data dari Google Maps secara otomatis — dari **Shared List**, **hasil pencarian (Search Results)**, maupun langsung via **kata kunci** — lalu simpan ke file **CSV** dengan nama dan kolom yang bisa dikustomisasi sepenuhnya.

Kini tersedia **Web UI Minimalis** untuk memudahkan penggunaan tanpa harus berurusan dengan CLI!

---

## ✨ Fitur Utama

| Fitur | Keterangan |
|---|---|
| 🌐 **Web UI** | Tersedia halaman antarmuka web (React) yang mudah digunakan. |
| 🔗 **3 Mode Input** | Shared List · Search Results URL · Kata kunci langsung. |
| 📋 **14 Field Tersedia** | Nama, koordinat, alamat, telepon, website, rating, ulasan, kategori, harga, jam buka, hari tutup, Plus Code, URL Maps. |
| 🎛️ **Field Kustom** | Pilih data apa saja yang ingin diambil melalui Web UI atau CLI. |
| 💾 **Custom CSV** | Tentukan nama file output hasil scraping. |
| 🔢 **Batas Hasil** | Batasi jumlah tempat yang diambil (misal: 50 tempat saja). |
| 🖥️ **Headed Browser** | Browser Chromium terlihat agar tidak diblokir/terdeteksi bot oleh Google. |
| 🔁 **Auto-scroll & Retry**| Scroll otomatis untuk memuat hasil dan auto-retry saat klik gagal. |
| 🍪 **Persistent Session** | Session tersimpan, login/consent Google cukup dilakukan sekali. |

---

## 🚀 Instalasi & Persiapan

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

## 🌐 Cara Pakai (Mode Web UI) - Rekomendasi

Agar Web UI yang di-deploy ke Vercel bisa membuka Chrome di laptopmu, kamu harus menyalakan **Local Engine** (Server Lokal) terlebih dahulu.

1. Buka terminal, pastikan kamu berada di folder `google-maps-scraper` dan `.venv` sudah aktif.
2. Jalankan server lokal:
   ```bash
   python server.py
   ```
   *(Akan muncul tulisan: 🚀 Local Engine is running on http://localhost:5000)*
3. Sekarang, **buka link Web Vercel kamu** (atau jalankan `npm run dev` di folder `frontend/` jika ingin tes web-nya secara lokal).
4. Di Web UI, masukkan settingan (Kata kunci, jumlah, nama file) lalu klik **Gas Scrape**.
5. Chrome akan otomatis terbuka di komputermu, dan log/terminal akan muncul secara *live* di website!

---

## 💻 Cara Pakai (Mode Terminal / CLI)

Jika kamu lebih suka menggunakan terminal:

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
* **Gagal Konek dari Web (Vercel) ke Local Engine:** Pastikan terminal yang menjalankan `python server.py` tidak tertutup.
* **Hasil scrape hanya sebagian:** Ini wajar karena Google Maps memakai *lazy-load*. Naikkan `--max-results` atau coba perspesifik lagi kata kuncinya.

---

## 📄 Lisensi
MIT License — bebas digunakan, dimodifikasi, dan didistribusikan.
