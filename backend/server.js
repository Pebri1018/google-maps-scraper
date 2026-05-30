const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const db = require('./db');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/screenshots', express.static(path.join(__dirname, 'debug_screenshots')));


// Global Scraper Status tracker
let currentStatus = {
    status: 'idle',
    message: 'Ready to start.',
    logs: [],
    currentArea: '',
    scrapedCount: 0,
    preview: null,
    lastSaved: null,
    detect: null,   // realtime indicator score from DETECT tag
};

let currentScraperProcess = null;

// Get current scraper status
app.get('/api/scrape/status', (req, res) => {
    res.json(currentStatus);
});

// Get all scraped restaurants
app.get('/api/restaurants', (req, res) => {
    db.all(`SELECT * FROM scraped_restaurants ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Helper to load Supabase config from zpilot Next.js project
function loadSupabaseConfig() {
    const envPath = 'C:\\Project\\zpilot\\.env.local';
    let url = null;
    let key = null;
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        const lines = content.split('\n');
        for (let line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('NEXT_PUBLIC_SUPABASE_URL=')) {
                url = trimmed.split('=', 2)[1].trim();
            } else if (trimmed.startsWith('NEXT_PUBLIC_SUPABASE_ANON_KEY=')) {
                key = trimmed.split('=', 2)[1].trim();
            }
        }
    }
    return { url, key };
}

// Get Yogyakarta Scraping Coverage
app.get('/api/coverage', async (req, res) => {
    const { url, key } = loadSupabaseConfig();
    if (!url || !key) {
        return res.status(500).json({ error: 'Supabase credentials not found in ztips config.' });
    }
    
    try {
        // Query merchant_signals count grouped by area or just query all areas
        const response = await fetch(`${url}/rest/v1/merchant_signals?select=area`, {
            headers: {
                'apikey': key,
                'Authorization': `Bearer ${key}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`Supabase REST error: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Define our target zones in Jogja
        const defaultZones = {
            "Seturan": 0,
            "Babarsari": 0,
            "Gejayan": 0,
            "Pogung": 0,
            "Jakal Bawah": 0,
            "UGM Area": 0,
            "Kota Jogja": 0,
            "Bantul Kota": 0,
            "Gamping": 0,
            "Tamansiswa": 0,
            "Alun-alun & Prawirotaman": 0,
            "Godean & Banguntapan": 0
        };
        
        // Count existing spots in each zone from Supabase
        data.forEach(item => {
            if (item.area) {
                // Perform loose matching to map area string to predefined key
                let matched = false;
                for (let zone of Object.keys(defaultZones)) {
                    if (item.area.toLowerCase().includes(zone.toLowerCase()) || zone.toLowerCase().includes(item.area.toLowerCase())) {
                        defaultZones[zone]++;
                        matched = true;
                        break;
                    }
                }
                if (!matched) {
                    // Create dynamic zone
                    if (!defaultZones[item.area]) {
                        defaultZones[item.area] = 0;
                    }
                    defaultZones[item.area]++;
                }
            }
        });
        
        // Convert to array format with recommendations
        const coverage = Object.entries(defaultZones).map(([name, count]) => {
            let status = 'unscraped';
            let statusColor = 'text-gray-400 bg-gray-900 border-gray-800';
            
            if (count > 100) {
                status = 'highly_saturated';
                statusColor = 'text-red-400 bg-red-950/40 border-red-900/60';
            } else if (count > 20) {
                status = 'partially_scraped';
                statusColor = 'text-yellow-400 bg-yellow-950/40 border-yellow-900/60';
            } else if (count > 0) {
                status = 'low_coverage';
                statusColor = 'text-green-400 bg-green-950/40 border-green-900/60';
            }
            
            return {
                name,
                count,
                status,
                statusColor,
                recommendation: count === 0 ? '🔥 PRIORITAS (0 Spot)' : (count < 10 ? '⭐ Perlu Tambahan' : '✅ Aman (Cukup)')
            };
        });
        
        // Sort coverage so that priority/unscraped areas come first!
        coverage.sort((a, b) => a.count - b.count);
        
        res.json(coverage);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const STOP_FLAG_PATH = path.resolve(__dirname, 'stop_scraping.flag');

// Trigger ShopeeFood Python Scraper
app.post('/api/scrape/shopeefood', (req, res) => {
    if (currentStatus.status === 'running') {
        return res.status(400).json({ error: 'Scraper is already running!' });
    }

    // Remove any stale stop flag before starting
    if (fs.existsSync(STOP_FLAG_PATH)) {
        fs.unlinkSync(STOP_FLAG_PATH);
    }

    currentStatus = {
        status: 'running',
        message: 'Initializing scraper pipeline...',
        logs: ['[*] Initializing scraper pipeline...'],
        currentArea: '',
        scrapedCount: 0
    };

    const pythonScriptPath = path.resolve(__dirname, 'shopeefood_android_scraper.py');
    const venvPython = path.resolve(__dirname, '../.venv/Scripts/python.exe');
    
    const pythonProcess = spawn(venvPython, [pythonScriptPath]);
    currentScraperProcess = pythonProcess;
    
    pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log(`Python: ${output.trim()}`);

        const lines = output.split('\n');
        lines.forEach(line => {
            const cleanLine = line.trim();
            if (!cleanLine) return;

            // ── Parse structured [TAG] JSON lines ──────────────────────────
            const tagMatch = cleanLine.match(/^\[([A-Z_]+)\]\s+(.+)$/);
            if (tagMatch) {
                const tag     = tagMatch[1];
                let   payload = {};
                try { payload = JSON.parse(tagMatch[2]); } catch(e) {}

                switch (tag) {
                    case 'PREVIEW':
                        // Live card: name, rating, reviews, discount, status
                        currentStatus.preview = {
                            ...currentStatus.preview,
                            ...payload,
                            updatedAt: Date.now(),
                        };
                        if (payload.status === 'duplicate') {
                            currentStatus.message = `⚠ Duplikasi: ${payload.name}`;
                            currentStatus.logs.push(`[-] Duplikasi: ${payload.name}`);
                        } else if (payload.name) {
                            currentStatus.message = `🔍 Membaca: ${payload.name}`;
                        }
                        break;

                    case 'DUP_RESULT':
                        if (payload.is_dup) {
                            currentStatus.logs.push(`[-] Skip (duplikasi): ${payload.name}`);
                        } else {
                            currentStatus.logs.push(`[~] Baru! Lanjut ambil detail: ${payload.name}`);
                        }
                        break;

                    case 'DETAIL_RESULT':
                        if (currentStatus.preview) {
                            currentStatus.preview.address = payload.address;
                            currentStatus.preview.hours   = payload.hours;
                            currentStatus.preview.updatedAt = Date.now();
                        }
                        currentStatus.message = `📍 Dapat alamat: ${payload.address || '-'}`;
                        break;

                    case 'SAVED':
                        currentStatus.scrapedCount++;
                        currentStatus.lastSaved = { ...payload, savedAt: Date.now() };
                        currentStatus.preview   = { ...payload, status: 'saved', updatedAt: Date.now() };
                        currentStatus.message   = `✅ Tersimpan: ${payload.name}`;
                        currentStatus.logs.push(`[+] Tersimpan: ${payload.name}`);
                        break;

                    case 'SKIP':
                        currentStatus.message = `⏩ Skip: ${payload.name || payload.reason}`;
                        currentStatus.logs.push(`[-] Skip: ${payload.name || payload.reason}`);
                        break;

                    case 'STATUS':
                        if (payload.message) {
                            currentStatus.message = payload.message;
                        }
                        if (payload.current_state) {
                            currentStatus.current_state = payload.current_state;
                        }
                        if (payload.step === 'waiting' || payload.step === 'waiting_on_list') {
                            // clear preview card when idle/waiting
                            currentStatus.preview = null;
                        }
                        if (payload.step === 'done') {
                            currentStatus.status  = 'completed';
                            currentStatus.message = payload.message || 'Selesai.';
                        }
                        if (payload.step === 'error') {
                            currentStatus.status  = 'failed';
                            currentStatus.message = payload.message || 'Error.';
                        }
                        break;

                    case 'DETECT':
                        // Realtime indicator score — update detect but DON'T spam logs
                        currentStatus.detect = {
                            state:    payload.state,
                            score:    payload.score,
                            detected: payload.detected || [],
                            updatedAt: Date.now(),
                        };
                        // Only add to logs when state changes to MAIN
                        if (payload.state === 'RESTAURANT_MAIN') {
                            currentStatus.logs.push(`[🎯] Halaman resto terdeteksi! Skor: ${payload.score} — ${(payload.detected||[]).join(', ')}`);
                            if (currentStatus.logs.length > 40) currentStatus.logs.shift();
                        }
                        return;  // skip normal log push for DETECT tag

                    default:
                        break;
                }

                // Add raw line to logs (keep last 40)
                currentStatus.logs.push(cleanLine);
                if (currentStatus.logs.length > 40) currentStatus.logs.shift();
                return;
            }

            // ── Plain text log lines (fallback) ───────────────────────────
            currentStatus.logs.push(cleanLine);
            if (currentStatus.logs.length > 40) currentStatus.logs.shift();

            // Parse plain-text status cues
            if (cleanLine.includes('[*] Connected:')) {
                const model = cleanLine.split('[*] Connected:')[1].trim();
                currentStatus.message = `Terhubung ke HP: ${model}`;
            } else if (cleanLine.includes('[*] ShopeeFood Human-Supervised')) {
                currentStatus.message = 'Human-Supervised Extraction dimulai...';
            } else if (cleanLine.includes('Session ended')) {
                currentStatus.status  = 'completed';
                currentStatus.message = `Sesi selesai. ${currentStatus.scrapedCount} restoran disimpan.`;
            }
        });
    });
    
    pythonProcess.stderr.on('data', (data) => {
        const output = data.toString();
        console.error(`Python Error: ${output}`);
        currentStatus.logs.push(`[Error] ${output.trim()}`);
        if (output.includes('Error connecting') || output.includes('RemoteDisconnected')) {
            currentStatus.status = 'failed';
            currentStatus.message = 'Koneksi ke ponsel gagal/terputus! Pastikan HP aktif.';
        }
    });
    
    pythonProcess.on('close', (code) => {
        console.log(`Python scraper process exited with code ${code}`);
        if (code !== 0 && currentStatus.status === 'running') {
            currentStatus.status = 'failed';
            currentStatus.message = `Proses terhenti dengan kode exit ${code}`;
        } else if (currentStatus.status === 'running') {
            currentStatus.status = 'completed';
            currentStatus.message = 'Scraping selesai!';
        }
    });
    
    res.json({ message: 'ShopeeFood Android scan started.' });
});

// Stop ShopeeFood Scraper
app.post('/api/scrape/stop', (req, res) => {
    console.log('[*] Stop requested by user.');
    
    // Write stop flag file - Python will check this and stop gracefully
    try {
        fs.writeFileSync(STOP_FLAG_PATH, 'stop', 'utf-8');
        console.log('[*] Stop flag written to:', STOP_FLAG_PATH);
    } catch (e) {
        console.error('[!] Could not write stop flag:', e);
    }
    
    currentStatus.logs.push('[!] Sinyal berhenti dikirim ke scraper...');
    currentStatus.message = 'Menghentikan scraper... (menunggu operasi saat ini selesai)';
    
    // Also kill the process as backup after 8 seconds (enough time for graceful stop)
    if (currentScraperProcess) {
        setTimeout(() => {
            try {
                if (currentScraperProcess) {
                    currentScraperProcess.kill('SIGTERM');
                    console.log('[*] Python process terminated.');
                }
            } catch(e) { console.error('Kill error:', e); }
        }, 8000);
    }
    
    currentStatus.status = 'completed';
    currentStatus.message = `Scraping dihentikan. Berhasil mengambil ${currentStatus.scrapedCount} spot baru.`;
    currentStatus.logs.push(`[STOP] Scraping dihentikan oleh pengguna. Total: ${currentStatus.scrapedCount} spot.`);
    
    res.json({ message: 'Stop signal sent. Scraper will stop after current restaurant is done.' });
});

// Launch scrcpy mirror screen
app.post('/api/scrcpy/launch', (req, res) => {
    const scrcpyPath = 'C:\\Project\\google maps scrapper\\scrcpy\\scrcpy-win64-v2.4\\scrcpy.exe';
    if (!fs.existsSync(scrcpyPath)) {
        return res.status(404).json({ error: 'scrcpy.exe tidak ditemukan di folder scrcpy.' });
    }
    
    console.log(`[*] Launching scrcpy desktop mirroring from: ${scrcpyPath}`);
    try {
        const scrcpyProcess = spawn(scrcpyPath, [], {
            detached: true,
            stdio: 'ignore'
        });
        scrcpyProcess.unref();
        res.json({ message: 'Layar ponsel berhasil di-mirror ke Windows!' });
    } catch (err) {
        console.error('Gagal menjalankan scrcpy:', err);
        res.status(500).json({ error: 'Gagal menjalankan scrcpy: ' + err.message });
    }
});

// Trigger Google Maps Cross-Referencer
app.post('/api/scrape/gmaps_cross_reference', (req, res) => {
    const nodeScriptPath = path.resolve(__dirname, 'gmaps_cross_reference.js');
    
    const nodeProcess = spawn('node', [nodeScriptPath]);
    
    nodeProcess.stdout.on('data', (data) => {
        console.log(`GMaps: ${data}`);
    });
    
    nodeProcess.stderr.on('data', (data) => {
        console.error(`GMaps Error: ${data}`);
    });
    
    res.json({ message: 'Google Maps cross-referencing started in the background.' });
});

// Clear all scraped restaurants (Start Fresh)
app.delete('/api/restaurants', (req, res) => {
    db.run(`DELETE FROM scraped_restaurants`, [], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'All scraped restaurants cleared.', changes: this.changes });
    });
});

// Endpoint to edit active restaurant name manually
app.post('/api/scrape/update_name', (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Name is required' });
    }
    
    console.log(`[*] Received manual name edit: "${name}"`);
    
    // 1. Update the preview status in node server
    if (currentStatus.preview) {
        currentStatus.preview.name = name;
        currentStatus.preview.updatedAt = Date.now();
    }
    currentStatus.message = `🔍 Diedit manual: ${name}`;
    currentStatus.logs.push(`[~] Diedit manual: ${name}`);
    
    // 2. Write to a temporary file active_name.json for Python to consume
    const activeNamePath = path.resolve(__dirname, 'active_name.json');
    try {
        fs.writeFileSync(activeNamePath, JSON.stringify({ name }), 'utf-8');
    } catch (e) {
        console.error('[!] Failed writing active_name.json:', e);
    }
    
    res.json({ message: 'Name updated successfully.' });
});

// Endpoint to edit active restaurant hours manually
app.post('/api/scrape/update_hours', (req, res) => {
    const { hours } = req.body;
    if (hours === undefined) {
        return res.status(400).json({ error: 'Hours is required' });
    }
    
    console.log(`[*] Received manual hours edit: "${hours}"`);
    
    if (currentStatus.preview) {
        currentStatus.preview.hours = hours;
        currentStatus.preview.updatedAt = Date.now();
    }
    currentStatus.message = `🕒 Jam buka diedit manual: ${hours}`;
    currentStatus.logs.push(`[~] Jam buka diedit manual: ${hours}`);
    
    const activeHoursPath = path.resolve(__dirname, 'active_hours.json');
    try {
        fs.writeFileSync(activeHoursPath, JSON.stringify({ hours }), 'utf-8');
    } catch (e) {
        console.error('[!] Failed writing active_hours.json:', e);
    }
    
    res.json({ message: 'Hours updated successfully.' });
});

// Endpoint to edit active restaurant coords manually
app.post('/api/scrape/update_coords', (req, res) => {
    const { latitude, longitude } = req.body;
    if (latitude === undefined || longitude === undefined) {
        return res.status(400).json({ error: 'Latitude and longitude are required' });
    }
    
    console.log(`[*] Received manual coords edit: ${latitude}, ${longitude}`);
    
    if (currentStatus.preview) {
        currentStatus.preview.latitude = parseFloat(latitude);
        currentStatus.preview.longitude = parseFloat(longitude);
        currentStatus.preview.updatedAt = Date.now();
    }
    currentStatus.message = `📍 Koordinat diedit manual: ${latitude}, ${longitude}`;
    currentStatus.logs.push(`[~] Koordinat diedit manual: ${latitude}, ${longitude}`);
    
    const activeCoordsPath = path.resolve(__dirname, 'active_coords.json');
    try {
        fs.writeFileSync(activeCoordsPath, JSON.stringify({ latitude: parseFloat(latitude), longitude: parseFloat(longitude) }), 'utf-8');
    } catch (e) {
        console.error('[!] Failed writing active_coords.json:', e);
    }
    
    res.json({ message: 'Coordinates updated successfully.' });
});

// Trigger a manual screenshot & OCR scan
app.post('/api/scrape/trigger_scan', (req, res) => {
    console.log('[*] Triggering manual scan...');
    const scanTriggerPath = path.resolve(__dirname, 'scan_trigger.json');
    try {
        fs.writeFileSync(scanTriggerPath, JSON.stringify({ action: 'scan', timestamp: Date.now() }), 'utf-8');
        currentStatus.logs.push('[⚡] Mengirim perintah scan layar...');
        currentStatus.message = 'Memindai layar ponsel...';
        res.json({ message: 'Scan triggered successfully.' });
    } catch (e) {
        console.error('[!] Failed writing scan_trigger.json:', e);
        res.status(500).json({ error: 'Failed to write scan trigger: ' + e.message });
    }
});

// Trigger a manual SQLite save of current preview data
app.post('/api/scrape/save_current', (req, res) => {
    console.log('[*] Saving current restaurant to SQLite database...');
    const saveTriggerPath = path.resolve(__dirname, 'save_trigger.json');
    try {
        fs.writeFileSync(saveTriggerPath, JSON.stringify({ action: 'save', timestamp: Date.now() }), 'utf-8');
        currentStatus.logs.push('[💾] Mengirim perintah simpan restoran ke database...');
        currentStatus.message = 'Menyimpan restoran...';
        res.json({ message: 'Save triggered successfully.' });
    } catch (e) {
        console.error('[!] Failed writing save_trigger.json:', e);
        res.status(500).json({ error: 'Failed to write save trigger: ' + e.message });
    }
});

// Trigger a manual reset of the active preview data
app.post('/api/scrape/clear_current', (req, res) => {
    console.log('[*] Clearing active restaurant preview...');
    const clearTriggerPath = path.resolve(__dirname, 'clear_trigger.json');
    try {
        fs.writeFileSync(clearTriggerPath, JSON.stringify({ action: 'clear', timestamp: Date.now() }), 'utf-8');
        currentStatus.preview = null;
        currentStatus.message = 'Preview dibersihkan.';
        currentStatus.logs.push('[🧹] Preview dibersihkan oleh pengguna.');
        res.json({ message: 'Clear triggered successfully.' });
    } catch (e) {
        console.error('[!] Failed writing clear_trigger.json:', e);
        res.status(500).json({ error: 'Failed to write clear trigger: ' + e.message });
    }
});

app.put('/api/restaurants/:id', (req, res) => {
    const { id } = req.params;
    const { validation_status, selected_latitude, selected_longitude, maps_latitude, maps_longitude, name, address, shopee_hours, maps_hours, discount_text, rating, total_reviews } = req.body;
    
    let final_status = validation_status;
    const hasMaps = (maps_latitude !== undefined && maps_latitude !== null && maps_latitude !== '' && maps_latitude !== 0 && maps_latitude !== '0');
    const hasSel = (selected_latitude !== undefined && selected_latitude !== null && selected_latitude !== '' && selected_latitude !== 0 && selected_latitude !== '0');
    if (hasMaps || hasSel) {
        final_status = 'matched';
    }

    // Build dynamic UPDATE query
    const fields = [];
    const values = [];
    
    if (final_status !== undefined) { fields.push('validation_status = ?'); values.push(final_status); }
    if (selected_latitude !== undefined) { fields.push('selected_latitude = ?'); values.push(selected_latitude); }
    if (selected_longitude !== undefined) { fields.push('selected_longitude = ?'); values.push(selected_longitude); }
    if (maps_latitude !== undefined) { fields.push('maps_latitude = ?'); values.push(maps_latitude); }
    if (maps_longitude !== undefined) { fields.push('maps_longitude = ?'); values.push(maps_longitude); }
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (address !== undefined) { fields.push('address = ?'); values.push(address); }
    if (shopee_hours !== undefined) { fields.push('shopee_hours = ?'); values.push(shopee_hours); }
    if (maps_hours !== undefined) { fields.push('maps_hours = ?'); values.push(maps_hours); }
    if (discount_text !== undefined) { fields.push('discount_text = ?'); values.push(discount_text); }
    if (rating !== undefined) { fields.push('rating = ?'); values.push(rating); }
    if (total_reviews !== undefined) { fields.push('total_reviews = ?'); values.push(total_reviews); }
    
    if (fields.length === 0) {
        return res.json({ message: 'No fields to update' });
    }
    
    values.push(id);
    const query = `UPDATE scraped_restaurants SET ${fields.join(', ')} WHERE id = ?`;
    
    db.run(query, values, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Updated successfully', changes: this.changes });
    });
});

app.post('/api/scrape/process_maps_link', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Missing url' });
    
    try {
        let finalUrl = url;
        if (url.includes('goo.gl') || url.includes('maps.app.goo.gl')) {
            const resp = await fetch(url, { redirect: 'follow' });
            finalUrl = resp.url;
        }
        
        let lat = null;
        let lng = null;
        
        // Match !3d... !4d... format
        const match3d = finalUrl.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
        if (match3d) {
            lat = parseFloat(match3d[1]);
            lng = parseFloat(match3d[2]);
        } else {
            // Match @lat,lng format
            const matchAt = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
            if (matchAt) {
                lat = parseFloat(matchAt[1]);
                lng = parseFloat(matchAt[2]);
            }
        }
        
        if (lat && lng) {
            res.json({ latitude: lat, longitude: lng, finalUrl });
        } else {
            res.status(400).json({ error: 'Could not extract coordinates from link', finalUrl });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Backend API running on http://localhost:${PORT}`);
});
