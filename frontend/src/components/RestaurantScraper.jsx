import React, { useState, useEffect, useCallback } from 'react';
import HoursInput from './HoursInput';

export default function RestaurantScraper() {
    const [restaurants, setRestaurants] = useState([]);
    const [coverage, setCoverage] = useState([]);
    const [loading, setLoading] = useState(false);
    const [coverageLoading, setCoverageLoading] = useState(false);
    const [statusInfo, setStatusInfo] = useState({
        status: 'idle',
        message: 'Ready to start.',
        logs: [],
        currentArea: '',
        scrapedCount: 0
    });
    const [screenshotToken, setScreenshotToken] = useState(Date.now());
    const [inputName, setInputName] = useState("");
    const [isNameFocused, setIsNameFocused] = useState(false);
    const [inputHours, setInputHours] = useState("");
    const [isHoursFocused, setIsHoursFocused] = useState(false);
    
    // Edit Modal state
    const [editingRestaurant, setEditingRestaurant] = useState(null);
    const [editForm, setEditForm] = useState({});

    const logContainerRef = React.useRef(null);

    useEffect(() => {
        if (!isNameFocused && statusInfo.preview) {
            setInputName(statusInfo.preview.name || "");
        }
    }, [statusInfo.preview?.name, isNameFocused]);

    useEffect(() => {
        if (!isHoursFocused && statusInfo.preview) {
            setInputHours(statusInfo.preview.hours || "");
        }
    }, [statusInfo.preview?.hours, isHoursFocused]);

    const triggerManualScan = async () => {
        try {
            await fetch('http://localhost:3001/api/scrape/trigger_scan', { method: 'POST' });
        } catch (err) {
            console.error("Failed to trigger scan", err);
        }
    };

    const saveActiveRestaurant = async () => {
        try {
            const res = await fetch('http://localhost:3001/api/scrape/save_current', { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                setTimeout(() => {
                    fetchRestaurants();
                    fetchCoverage();
                }, 1000);
            } else {
                alert(data.error || "Gagal menyimpan!");
            }
        } catch (err) {
            console.error("Failed to save current", err);
        }
    };

    const clearActiveRestaurant = async () => {
        try {
            await fetch('http://localhost:3001/api/scrape/clear_current', { method: 'POST' });
        } catch (err) {
            console.error("Failed to clear current", err);
        }
    };

    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [statusInfo.logs]);

    useEffect(() => {
        let intervalId;
        if (statusInfo.status === 'running') {
            intervalId = setInterval(async () => {
                try {
                    const res = await fetch('http://localhost:3001/api/scrape/status');
                    const data = await res.json();
                    setStatusInfo(data);
                    setScreenshotToken(Date.now());
                    if (data.status !== 'running') {
                        fetchRestaurants();
                        fetchCoverage();
                        clearInterval(intervalId);
                    }
                } catch (err) {
                    console.error('Error polling status', err);
                }
            }, 500); // 500ms for snappy realtime updates
        }
        return () => { if (intervalId) clearInterval(intervalId); };
    }, [statusInfo.status]);

    useEffect(() => {
        fetchRestaurants();
        fetchCoverage();
        
        // Global Paste Listener for Google Maps Link
        const handlePaste = async (e) => {
            const pastedText = (e.clipboardData || window.clipboardData).getData('text');
            if (pastedText && (pastedText.includes('goo.gl') || pastedText.includes('google.com/maps'))) {
                try {
                    const res = await fetch('http://localhost:3001/api/scrape/process_maps_link', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: pastedText })
                    });
                    const data = await res.json();
                    if (res.ok && data.latitude && data.longitude) {
                        alert(`Koordinat maps ditemukan: ${data.latitude}, ${data.longitude}`);
                        
                        // If editing in modal, update modal form
                        if (editingRestaurant) {
                            setEditForm(prev => ({
                                ...prev,
                                maps_latitude: data.latitude,
                                maps_longitude: data.longitude,
                                selected_latitude: data.latitude,
                                selected_longitude: data.longitude,
                                validation_status: 'matched'
                            }));
                        } else {
                            // Update active preview restaurant coordinates in backend
                            try {
                                await fetch('http://localhost:3001/api/scrape/update_coords', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ latitude: data.latitude, longitude: data.longitude })
                                });
                            } catch (err) {
                                console.error("Failed to update active coords", err);
                            }
                        }
                    }
                } catch (err) {
                    console.error("Paste maps link error:", err);
                }
            }
        };
        
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [editingRestaurant]);

    const fetchRestaurants = async () => {
        setLoading(true);
        try {
            const res = await fetch('http://localhost:3001/api/restaurants');
            const data = await res.json();
            setRestaurants(data);
        } catch (err) {
            console.error("Failed to fetch restaurants", err);
        } finally {
            setLoading(false);
        }
    };

    const fetchCoverage = async () => {
        setCoverageLoading(true);
        try {
            const res = await fetch('http://localhost:3001/api/coverage');
            const data = await res.json();
            if (Array.isArray(data)) {
                setCoverage(data);
            } else {
                console.error("Coverage API error:", data);
                setCoverage([]);
            }
        } catch (err) {
            console.error("Failed to fetch coverage", err);
            setCoverage([]);
        } finally {
            setCoverageLoading(false);
        }
    };

    const detectClosedDays = (hoursStr) => {
        if (!hoursStr) return "Tidak Ada";
        const clean = hoursStr.toLowerCase();
        const closedList = [];
        const daysMapping = [
            { key: "senin|sen", name: "Senin" },
            { key: "selasa|sel", name: "Selasa" },
            { key: "rabu|rab", name: "Rabu" },
            { key: "kamis|kam", name: "Kamis" },
            { key: "jumat|jum", name: "Jumat" },
            { key: "sabtu|sab", name: "Sabtu" },
            { key: "minggu|min", name: "Minggu" }
        ];
        for (const day of daysMapping) {
            const regex = new RegExp(`\\b(${day.key})\\b\\s*[:\\-–—]?\\s*(tutup|closed)`, 'i');
            if (regex.test(clean)) {
                closedList.push(day.name);
            }
        }
        return closedList.length > 0 ? closedList.join(", ") : "Tidak Ada";
    };

    const normalizeDayNames = (hoursStr) => {
        if (!hoursStr) return "";
        const dayMap = {
            "sen": "Senin",
            "sel": "Selasa",
            "rab": "Rabu",
            "kam": "Kamis",
            "jum": "Jumat",
            "sab": "Sabtu",
            "min": "Minggu",
            "setiap hari": "Setiap Hari"
        };
        let res = hoursStr;
        Object.entries(dayMap).forEach(([short, full]) => {
            const regex = new RegExp(`\\b${short}\\b`, 'gi');
            res = res.replace(regex, full);
        });
        return res;
    };

    const exportToCSV = () => {
        if (restaurants.length === 0) {
            alert("Tidak ada data untuk diekspor!");
            return;
        }

        const headers = [
            "ID", "Name", "Discount Text", "Rating", "Total Reviews", "Source", 
            "Shopee Latitude", "Shopee Longitude", "Maps Latitude", "Maps Longitude", 
            "Validation Status", "Address", "Weekly Hours", "Closed Days"
        ];
        
        const csvRows = [
            headers.join(","),
            ...restaurants.map(r => {
                const mapsLat = r.maps_latitude || r.selected_latitude || '';
                const mapsLng = r.maps_longitude || r.selected_longitude || '';
                const hasCoords = (mapsLat && mapsLng) || (r.shopee_latitude && r.shopee_longitude);
                
                // "kalo udah dapet titik koordinat dibuat matching aja"
                const validationStatus = hasCoords ? "matched" : (r.validation_status || "pending");
                
                const rawHours = r.maps_hours || r.shopee_hours || '';
                const normalizedHours = normalizeDayNames(rawHours);
                const closedDays = detectClosedDays(rawHours);

                return [
                    `"${r.id}"`,
                    `"${(r.name || '').replace(/"/g, '""')}"`,
                    `"${(r.discount_text || '').replace(/"/g, '""')}"`,
                    r.rating || 0.0,
                    `"${(r.total_reviews || '').replace(/"/g, '""')}"`,
                    `"${r.source || ''}"`,
                    r.shopee_latitude || '',
                    r.shopee_longitude || '',
                    mapsLat,
                    mapsLng,
                    `"${validationStatus}"`,
                    `"${(r.address || '').replace(/"/g, '""')}"`,
                    `"${normalizedHours.replace(/"/g, '""')}"`,
                    `"${closedDays.replace(/"/g, '""')}"`
                ].join(",");
            })
        ];

        const csvContent = "\uFEFF" + csvRows.join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `spx_jogja_import_${new Date().toISOString().slice(0, 10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const clearAllData = async () => {
        const confirmClear = window.confirm("Apakah Anda yakin ingin menghapus SEMUA data restoran yang sudah ke-scrap di SQLite lokal? Tindakan tidak dapat dibatalkan.");
        if (!confirmClear) return;

        try {
            const res = await fetch('http://localhost:3001/api/restaurants', { method: 'DELETE' });
            const data = await res.json();
            if (res.ok) {
                alert("Data berhasil dibersihkan! Anda bisa memulai scraping baru.");
                setRestaurants([]);
            } else {
                alert("Gagal menghapus data: " + data.error);
            }
        } catch (err) {
            console.error("Error clearing data", err);
            alert("Error koneksi saat menghapus data.");
        }
    };

    const runShopeeScraper = async () => {
        try {
            setStatusInfo({
                status: 'running',
                message: 'Memulai koneksi ke ponsel Android...',
                logs: ['[*] Memulai koneksi ke ponsel Android via ADB...'],
                currentArea: '',
                scrapedCount: 0
            });
            await fetch('http://localhost:3001/api/scrape/shopeefood', { method: 'POST' });
        } catch (err) {
            console.error("Error triggering Shopee Scraper", err);
            setStatusInfo({
                status: 'failed',
                message: 'Gagal menghubungi server backend.',
                logs: ['[Error] Gagal mengirim perintah ke backend API.'],
                currentArea: '',
                scrapedCount: 0
            });
        }
    };

    const stopShopeeScraper = async () => {
        try {
            const res = await fetch('http://localhost:3001/api/scrape/stop', { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                alert(data.message || "Scraper berhasil dihentikan!");
            } else {
                alert("Gagal menghentikan scraper: " + data.error);
            }
        } catch (err) {
            console.error("Error stopping scraper", err);
            alert("Error koneksi saat menghentikan scraper.");
        }
    };

    const runCrossReference = async () => {
        try {
            await fetch('http://localhost:3001/api/scrape/gmaps_cross_reference', { method: 'POST' });
            alert("Google Maps Cross-Referencing initiated. Check backend console.");
            setTimeout(() => {
                fetchRestaurants();
            }, 3000);
        } catch (err) {
            console.error("Error triggering cross-reference", err);
        }
    };

    const launchScrcpy = async () => {
        try {
            const res = await fetch('http://localhost:3001/api/scrcpy/launch', { method: 'POST' });
            const data = await res.json();
            if (res.ok) {
                alert(data.message || "scrcpy berhasil dibuka!");
            } else {
                alert("Gagal membuka scrcpy: " + data.error);
            }
        } catch (err) {
            console.error("Error launching scrcpy", err);
            alert("Error koneksi saat membuka scrcpy.");
        }
    };

    const handleRefreshAll = () => {
        fetchRestaurants();
        fetchCoverage();
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* LEFT PANEL: SCRAPING COVERAGE SUGGESTIONS */}
            <div className="lg:col-span-4 bg-gray-900 border border-gray-800 rounded-2xl shadow-xl p-6 flex flex-col">
                <div className="mb-4">
                    <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 bg-blue-500 rounded-full animate-pulse" />
                        <h2 className="text-lg font-bold text-gray-100 uppercase tracking-wider">Coverage & Priority Scan</h2>
                    </div>
                    <p className="text-gray-400 text-xs mt-1">Saran area prioritas berdasarkan jumlah spot yang sudah ter-scraping di ztips</p>
                </div>

                <div className="space-y-3 overflow-y-auto max-h-[600px] pr-2 custom-scrollbar">
                    {coverageLoading && coverage.length === 0 ? (
                        <div className="text-center py-8 text-gray-500 text-sm animate-pulse">Memindai database ztips...</div>
                    ) : coverage.length === 0 ? (
                        <div className="text-center py-8 text-gray-500 text-sm">Gagal memuat peta coverage. Pastikan .env.local terhubung.</div>
                    ) : (
                        coverage.map((c) => {
                            let statusLabel = 'Unscraped (0 Spot)';
                            let badgeStyle = 'bg-gray-900/60 text-gray-400 border-gray-800';
                            
                            if (c.status === 'highly_saturated') {
                                statusLabel = `${c.count} Spot (Saturasi Tinggi)`;
                                badgeStyle = 'bg-red-950/40 text-red-400 border-red-900/40';
                            } else if (c.status === 'partially_scraped') {
                                statusLabel = `${c.count} Spot (Cukup)`;
                                badgeStyle = 'bg-yellow-950/40 text-yellow-400 border-yellow-900/40';
                            } else if (c.status === 'low_coverage') {
                                statusLabel = `${c.count} Spot (Rendah)`;
                                badgeStyle = 'bg-green-950/40 text-green-400 border-green-900/40';
                            } else {
                                statusLabel = 'Belum Ada (0 Spot)';
                                badgeStyle = 'bg-indigo-950/40 text-indigo-400 border-indigo-900/40 animate-pulse';
                            }

                            return (
                                <div 
                                    key={c.name} 
                                    className={`p-3.5 rounded-xl border transition-all flex items-center justify-between ${
                                        c.count === 0 
                                            ? 'bg-indigo-900/10 border-indigo-900/30 hover:bg-indigo-900/20' 
                                            : 'bg-gray-800/40 border-gray-800/60 hover:bg-gray-800/70'
                                    }`}
                                >
                                    <div>
                                        <div className="font-bold text-gray-100 text-sm">{c.name}</div>
                                        <div className="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
                                            <span className={`w-1.5 h-1.5 rounded-full ${
                                                c.status === 'highly_saturated' ? 'bg-red-500' :
                                                c.status === 'partially_scraped' ? 'bg-yellow-500' :
                                                c.status === 'low_coverage' ? 'bg-green-500' : 'bg-indigo-500 animate-ping'
                                            }`} />
                                            {statusLabel}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <span className={`text-[0.67rem] font-extrabold uppercase px-2.5 py-1 rounded-lg border tracking-wider ${badgeStyle}`}>
                                            {c.recommendation}
                                        </span>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* RIGHT PANEL: SCRAPING CONTROLS & LOG TABLE */}
            <div className="lg:col-span-8 bg-gray-900 border border-gray-800 rounded-2xl shadow-xl p-6 flex flex-col justify-between">
                <div>
                    <div className="flex justify-between items-center mb-6">
                        <div>
                            <h2 className="text-xl font-bold text-gray-100">Scraping Pipeline Control</h2>
                            <p className="text-gray-400 text-sm">Kendali Android USB Driver & Google Maps Cross-Referencing</p>
                        </div>
                        <div className="flex gap-3">
                            <button 
                                onClick={launchScrcpy}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl text-sm font-black transition active:scale-95 flex items-center gap-2 shadow-lg shadow-indigo-950/20"
                            >
                                📱 Buka Mirror Screen (scrcpy)
                            </button>
                            {statusInfo.status === 'running' ? (
                                <button 
                                    onClick={stopShopeeScraper}
                                    className="bg-red-600 hover:bg-red-500 text-white px-4 py-2.5 rounded-xl text-sm font-black transition active:scale-95 flex items-center gap-2 shadow-lg shadow-red-950/20 animate-pulse"
                                >
                                    🛑 Stop ShopeeFood Scan
                                </button>
                            ) : (
                                <button 
                                    onClick={runShopeeScraper}
                                    className="bg-orange-600 hover:bg-orange-500 text-white px-4 py-2.5 rounded-xl text-sm font-black transition active:scale-95 flex items-center gap-2 shadow-lg shadow-orange-950/20"
                                >
                                    ⚡ 1. Start ShopeeFood Scan (USB)
                                </button>
                            )}
                            <button 
                                onClick={runCrossReference}
                                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl text-sm font-black transition active:scale-95 flex items-center gap-2 shadow-lg shadow-blue-950/20"
                            >
                                🔍 2. Run Google Maps Matcher
                            </button>
                            <button 
                                onClick={handleRefreshAll}
                                className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2.5 rounded-xl text-sm font-black transition active:scale-95"
                            >
                                Refresh All
                            </button>
                            <button 
                                onClick={exportToCSV}
                                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl text-sm font-black transition active:scale-95 flex items-center gap-2 shadow-lg shadow-emerald-950/20"
                            >
                                📥 Export to CSV
                            </button>
                            <button 
                                onClick={clearAllData}
                                className="bg-red-950/40 hover:bg-red-900/60 text-red-400 border border-red-900/40 px-4 py-2.5 rounded-xl text-sm font-black transition active:scale-95 flex items-center gap-2 shadow-lg"
                            >
                                🗑️ Clear Local Data
                            </button>
                        </div>
                    </div>

                    {/* LIVE SCRAPER TERMINAL + REALTIME PREVIEW */}
                    {statusInfo.status !== 'idle' && (
                        <div className="mb-6 grid grid-cols-1 md:grid-cols-12 gap-4">
                            {/* Left Col: Logs + Live Card */}
                            <div className="md:col-span-8 space-y-3">
                                {/* ── Status bar ── */}
                                <div className="bg-black border border-gray-800 rounded-xl p-4 font-mono text-xs text-gray-300">
                                    <div className="flex justify-between items-center mb-3 border-b border-gray-800 pb-2">
                                        <div className="flex items-center gap-2">
                                            <span className={`w-2.5 h-2.5 rounded-full ${
                                                statusInfo.status === 'running'   ? 'bg-orange-500 animate-pulse' :
                                                statusInfo.status === 'completed' ? 'bg-green-500' : 'bg-red-500'
                                            }`} />
                                            <span className="font-bold text-gray-100 uppercase tracking-wider">
                                                {statusInfo.status === 'running'   ? '⚡ Bot Aktif — Human-Supervised Mode' :
                                                 statusInfo.status === 'completed' ? '✅ Sesi Selesai' : '❌ Error'}
                                            </span>
                                        </div>
                                        <div className="text-gray-500 text-[0.7rem]">
                                            Tersimpan: <span className="text-green-400 font-bold">{statusInfo.scrapedCount}</span> resto
                                        </div>
                                    </div>
                                    <div className="text-sm font-bold text-gray-200 mb-2">{statusInfo.message}</div>

                                    {/* Indicator score bar */}
                                    {statusInfo.detect && (
                                        <div className="mb-2 flex flex-wrap gap-1.5 items-center">
                                            <span className="text-[0.6rem] text-gray-500 uppercase tracking-widest font-bold shrink-0">Sensor:</span>
                                            {['Penilaian','Tiba dalam','Promo Untukmu','Kamu Mungkin Suka','Diskon Ongkir','ulasan','Checkout','Lihat Semua'].map(ind => {
                                                const hit = (statusInfo.detect.detected || []).includes(ind);
                                                return (
                                                    <span key={ind} className={`text-[0.58rem] font-bold px-1.5 py-0.5 rounded border ${
                                                        hit ? 'bg-green-900/40 text-green-400 border-green-800/40' : 'bg-gray-900 text-gray-700 border-gray-800'
                                                    }`}>{ind}</span>
                                                );
                                            })}
                                            <span className={`ml-auto text-[0.65rem] font-extrabold px-2 py-0.5 rounded ${
                                                (statusInfo.detect.score || 0) >= 2 ? 'bg-green-900/40 text-green-400' :
                                                (statusInfo.detect.score || 0) === 1 ? 'bg-yellow-900/40 text-yellow-400' :
                                                'bg-gray-900 text-gray-600'
                                            }`}>{statusInfo.detect.score || 0}/2 ✓</span>
                                        </div>
                                    )}

                                    <div ref={logContainerRef} className="max-h-[100px] overflow-y-auto space-y-0.5 text-gray-400 custom-scrollbar pr-2">
                                        {statusInfo.logs.slice(-100).map((log, idx) => (
                                            <div key={idx} className={
                                                log.startsWith('[Error]') || log.startsWith('[!]')   ? 'text-red-400' :
                                                log.startsWith('[+]') || log.includes('Tersimpan')   ? 'text-green-400 font-bold' :
                                                log.startsWith('[-]') || log.includes('duplikasi')   ? 'text-gray-500' :
                                                log.startsWith('[~]')                                 ? 'text-blue-400' :
                                                log.includes('[PREVIEW]') || log.includes('[STATUS]') ? 'text-indigo-400 text-[0.6rem]' :
                                                'text-gray-400'
                                            }>{log}</div>
                                        ))}
                                    </div>
                                </div>

                                {/* ── PERSISTENT MANUAL CONTROL ACTION BAR ── */}
                                <div className="bg-gray-800/40 border border-gray-800 rounded-xl p-4 flex flex-col sm:flex-row gap-3 items-center justify-between shadow-inner">
                                    <div className="flex flex-col text-left w-full sm:w-auto">
                                        <span className="text-[0.62rem] text-indigo-400 uppercase tracking-widest font-extrabold flex items-center gap-1.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
                                            Manual OCR Workstation Controls
                                        </span>
                                        <span className="text-gray-400 font-medium text-[0.68rem] mt-0.5">Buka detail/info/maps di HP lalu scan:</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2.5 w-full sm:w-auto justify-end">
                                        <button
                                            type="button"
                                            onClick={triggerManualScan}
                                            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-lg transition active:scale-95 flex items-center gap-1.5 cursor-pointer"
                                        >
                                            ⚡ SCAN LAYAR PONSEL
                                        </button>
                                        <button
                                            type="button"
                                            onClick={saveActiveRestaurant}
                                            disabled={!statusInfo.preview || !statusInfo.preview.name}
                                            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-lg transition active:scale-95 flex items-center gap-1.5 cursor-pointer"
                                        >
                                            💾 SIMPAN RESTORAN
                                        </button>
                                        <button
                                            type="button"
                                            onClick={clearActiveRestaurant}
                                            disabled={!statusInfo.preview}
                                            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-gray-300 font-bold text-xs px-4 py-2.5 rounded-xl border border-gray-700 transition active:scale-95 flex items-center gap-1.5 cursor-pointer"
                                        >
                                            🧹 RESET DATA
                                        </button>
                                    </div>
                                </div>

                                {/* ── Live Preview Card ── */}
                                {statusInfo.preview && (() => {
                                    const p = statusInfo.preview;
                                    const isDup   = p.status === 'duplicate';
                                    const isSaved = p.status === 'saved';
                                    const isNew   = !isDup && !isSaved && p.name;
                                    return (
                                        <div className={`border rounded-2xl p-5 transition-all duration-300 ${
                                            isDup   ? 'bg-yellow-950/20 border-yellow-900/40' :
                                            isSaved ? 'bg-green-950/20 border-green-900/40' :
                                                      'bg-indigo-950/20 border-indigo-900/40'
                                        }`}>
                                            {/* Header */}
                                            <div className="flex items-start justify-between mb-4">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-1.5">
                                                        <span className={`text-[0.65rem] font-extrabold uppercase tracking-widest px-2 py-0.5 rounded-md ${
                                                            isDup   ? 'bg-yellow-900/40 text-yellow-400 border border-yellow-800/40' :
                                                            isSaved ? 'bg-green-900/40 text-green-400 border border-green-800/40' :
                                                                      'bg-indigo-900/40 text-indigo-400 border border-indigo-800/40 animate-pulse'
                                                        }`}>
                                                            {isDup ? '⚠ DUPLIKASI' : isSaved ? '✅ TERSIMPAN' : '🔍 MEMBACA...'}
                                                        </span>
                                                        {p.confidence !== undefined && (
                                                            <span className={`text-[0.65rem] font-extrabold px-2 py-0.5 rounded-md border ${
                                                                p.confidence >= 90 ? 'bg-green-950/40 text-green-400 border-green-900/40' :
                                                                p.confidence >= 75 ? 'bg-yellow-950/40 text-yellow-400 border-yellow-900/40' :
                                                                                     'bg-red-950/40 text-red-400 border-red-900/40'
                                                            }`}>
                                                                🎯 Confidence: {p.confidence}%
                                                            </span>
                                                        )}
                                                    </div>
                                                    {isDup && (
                                                        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 mb-3 text-xs text-yellow-400 font-semibold flex items-start gap-2.5 mt-2 animate-pulse">
                                                            <span className="text-base shrink-0">⚠️</span>
                                                            <div>
                                                                <p className="font-extrabold text-[0.8rem]">Restoran ini SUDAH ADA di database!</p>
                                                                <p className="text-[0.7rem] text-gray-400 mt-1">
                                                                    Ditemukan di: <span className="text-yellow-400 font-extrabold">{p.dup_source || 'Supabase / SQLite'}</span>
                                                                    {p.dup_name && <> sebagai <span className="text-white font-black">"{p.dup_name}"</span></>}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    )}
                                                    <div className="flex flex-col gap-1.5 mt-1.5 self-stretch">
                                                        <span className="text-[0.6rem] text-gray-500 uppercase tracking-widest font-extrabold flex items-center gap-1.5">
                                                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                                            Nama Restoran (Bisa Diedit Manual):
                                                        </span>
                                                        <input
                                                            type="text"
                                                            value={inputName}
                                                            onChange={(e) => setInputName(e.target.value)}
                                                            onFocus={() => setIsNameFocused(true)}
                                                            onBlur={async () => {
                                                                setIsNameFocused(false);
                                                                if (inputName.trim() && inputName !== p.name) {
                                                                    try {
                                                                        await fetch('http://localhost:3001/api/scrape/update_name', {
                                                                            method: 'POST',
                                                                            headers: { 'Content-Type': 'application/json' },
                                                                            body: JSON.stringify({ name: inputName.trim() })
                                                                        });
                                                                    } catch (err) {
                                                                        console.error("Failed to update name", err);
                                                                    }
                                                                }
                                                            }}
                                                            className={`bg-black/60 border border-gray-800 rounded-xl px-3.5 py-2 text-sm font-black focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all leading-tight w-full ${
                                                                isDup ? 'text-yellow-400 border-yellow-900/30' : isSaved ? 'text-green-400 border-green-900/30' : 'text-white'
                                                            }`}
                                                            placeholder="Ketik atau edit nama restoran di sini..."
                                                        />
                                                    </div>
                                                </div>
                                                {p.rating > 0 && (
                                                    <div className="text-right ml-4 shrink-0">
                                                        <div className="text-2xl font-black text-amber-400">⭐ {p.rating?.toFixed(1)}</div>
                                                        <div className="text-[0.65rem] text-gray-400">{p.reviews || ''}</div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Data grid */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                                {p.discount && (
                                                    <div className="col-span-1 md:col-span-2 bg-orange-950/30 border border-orange-900/30 rounded-xl px-3 py-2">
                                                        <div className="text-orange-400 font-extrabold text-[0.6rem] uppercase tracking-wider mb-0.5">Promo</div>
                                                        <div className="text-orange-200 font-bold">{p.discount}</div>
                                                    </div>
                                                )}
                                                
                                                {/* Alamat Restoran (Static card) */}
                                                {p.address && (
                                                    <div className="col-span-1 md:col-span-2 bg-blue-950/30 border border-blue-900/30 rounded-xl px-3 py-2">
                                                        <div className="text-blue-400 font-extrabold text-[0.6rem] uppercase tracking-wider mb-0.5">Alamat Restoran</div>
                                                        <div className="text-blue-200 font-semibold leading-tight">{p.address}</div>
                                                    </div>
                                                )}

                                                {/* Jam Buka Tutup (Editable component) */}
                                                <div 
                                                    className="col-span-1 md:col-span-2 bg-blue-950/20 border border-blue-900/30 rounded-xl px-3 py-2"
                                                    onMouseEnter={() => setIsHoursFocused(true)}
                                                    onMouseLeave={() => setIsHoursFocused(false)}
                                                    onFocus={() => setIsHoursFocused(true)}
                                                    onBlur={async () => {
                                                        setIsHoursFocused(false);
                                                        if (inputHours && inputHours !== p.hours) {
                                                            try {
                                                                await fetch('http://localhost:3001/api/scrape/update_hours', {
                                                                    method: 'POST',
                                                                    headers: { 'Content-Type': 'application/json' },
                                                                    body: JSON.stringify({ hours: inputHours })
                                                                });
                                                            } catch (err) {
                                                                console.error("Failed to update hours on blur", err);
                                                            }
                                                        }
                                                    }}
                                                >
                                                    <div className="text-teal-400 font-extrabold text-[0.6rem] uppercase tracking-wider mb-2">Jam Buka Tutup (Bisa Diedit Manual):</div>
                                                    <HoursInput 
                                                        initialHours={inputHours} 
                                                        onChange={async (newVal) => {
                                                            setInputHours(newVal);
                                                            if (newVal && newVal !== p.hours) {
                                                                try {
                                                                    await fetch('http://localhost:3001/api/scrape/update_hours', {
                                                                        method: 'POST',
                                                                        headers: { 'Content-Type': 'application/json' },
                                                                        body: JSON.stringify({ hours: newVal })
                                                                    });
                                                                } catch (err) {
                                                                    console.error("Failed to update hours on change", err);
                                                                }
                                                            }
                                                        }}
                                                    />
                                                </div>

                                                {(p.latitude || p.longitude) && (
                                                    <div className="col-span-1 md:col-span-2 bg-indigo-950/30 border border-indigo-900/30 rounded-xl px-3 py-2 flex items-center justify-between">
                                                        <div>
                                                            <div className="text-indigo-400 font-extrabold text-[0.6rem] uppercase tracking-wider mb-0.5">Koordinat Google Maps</div>
                                                            <div className="text-indigo-200 font-semibold font-mono text-[0.7rem]">{p.latitude?.toFixed(6)}, {p.longitude?.toFixed(6)}</div>
                                                        </div>
                                                        <span className="bg-indigo-900/40 text-indigo-400 border border-indigo-800/45 px-2 py-0.5 rounded text-[0.58rem] font-bold">OK ✓</span>
                                                    </div>
                                                )}
                                            </div>

                                            {isDup && (
                                                <div className="mt-3 text-xs text-yellow-400/80 font-bold bg-yellow-950/30 border border-yellow-900/25 px-3 py-2 rounded-xl">
                                                    ⚠ Sudah ada di database lokal — Duplikasi akan dilewati.
                                                </div>
                                            )}
                                            {isSaved && (
                                                <div className="mt-3 text-xs text-green-400/80 font-bold bg-green-950/30 border border-green-900/25 px-3 py-2 rounded-xl">
                                                    ✅ Berhasil disimpan ke database SQLite!
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* Right Col: Live Android Screen Screenshot Debug */}
                            <div className="md:col-span-4 bg-black border border-gray-800 rounded-xl p-4 flex flex-col items-center justify-start font-mono">
                                <div className="text-xs text-gray-400 font-bold uppercase tracking-wider mb-3 self-start flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                                    Live Screen Debug
                                </div>
                                <div className="relative border border-gray-800 rounded-lg overflow-hidden w-full bg-gray-950 aspect-[9/16] flex items-center justify-center">
                                    <img 
                                        src={`http://localhost:3001/screenshots/latest_debug.png?t=${screenshotToken}`} 
                                        alt="Android Screen" 
                                        className="w-full h-full object-contain"
                                        onError={(e) => {
                                            e.target.style.display = 'none';
                                            e.target.nextSibling.style.display = 'flex';
                                        }}
                                        onLoad={(e) => {
                                            e.target.style.display = 'block';
                                            e.target.nextSibling.style.display = 'none';
                                        }}
                                    />
                                    <div className="flex flex-col items-center justify-center text-center text-[0.65rem] text-gray-600 p-4">
                                        <div className="text-2xl mb-1">📱</div>
                                        <div>Menunggu gambar layar ponsel...</div>
                                    </div>
                                </div>
                                <div className="text-[0.65rem] text-gray-400 mt-3 text-center leading-tight self-stretch bg-gray-900/60 border border-gray-800 rounded-lg p-2 flex justify-between items-center">
                                    <span className="text-gray-500 text-[0.58rem] uppercase font-bold">State Machine:</span>
                                    <span className="text-indigo-400 font-extrabold uppercase font-mono bg-indigo-950/40 border border-indigo-900/60 px-2 py-0.5 rounded">
                                        {statusInfo.current_state || 'SEKITARMU_LIST'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="overflow-x-auto max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="text-left text-[0.7rem] uppercase tracking-wider text-gray-500 border-b border-gray-800">
                                    <th className="py-3 px-4 font-bold">Restaurant Name</th>
                                    <th className="py-3 px-4 font-bold">Promo & Rating</th>
                                    <th className="py-3 px-4 font-bold">Source Device</th>
                                    <th className="py-3 px-4 font-bold">Google Maps Status</th>
                                    <th className="py-3 px-4 font-bold">Aksi</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && restaurants.length === 0 ? (
                                    <tr>
                                        <td colSpan="5" className="text-center py-12 text-gray-500 animate-pulse text-sm">Memuat data dari SQLite lokal...</td>
                                    </tr>
                                ) : restaurants.length === 0 ? (
                                    <tr>
                                        <td colSpan="5" className="text-center py-12 text-gray-500 text-sm">Belum ada data restoran ter-scraping lokal. Sambungkan HP dan ketuk scan!</td>
                                    </tr>
                                ) : restaurants.map(r => (
                                    <tr key={r.id} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-all">
                                        <td className="py-3.5 px-4">
                                            <span className="font-semibold text-gray-100 text-sm block">{r.name}</span>
                                            <span className="text-[0.67rem] font-mono text-gray-500 block mt-0.5">{r.id}</span>
                                        </td>
                                        <td className="py-3.5 px-4 text-xs">
                                            <div className="text-green-400 font-bold">{r.discount_text || 'Tanpa Promo'}</div>
                                            <div className="text-amber-400 font-bold mt-0.5">⭐ {r.rating ? r.rating.toFixed(1) : 'N/A'} ({r.total_reviews || '0 ulasan'})</div>
                                        </td>
                                        <td className="py-3.5 px-4 text-xs font-mono text-gray-300">
                                            <span className="bg-gray-800 px-2.5 py-1 rounded-lg text-gray-300 border border-gray-700/60 font-bold uppercase tracking-wider">{r.source}</span>
                                        </td>
                                        <td className="py-3.5 px-4 text-center">
                                            {r.validation_status?.toLowerCase() === 'matched' ? (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-green-950/50 text-green-400 border border-green-900/50 text-[0.65rem] font-bold">
                                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                                    MATCHED
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-red-950/50 text-red-400 border border-red-900/50 text-[0.65rem] font-bold">
                                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                                                    UNMATCHED
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-3.5 px-4">
                                            <button 
                                                onClick={() => {
                                                    setEditingRestaurant(r);
                                                    setEditForm(r);
                                                }}
                                                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-semibold shadow-sm transition-colors"
                                            >
                                                ✏️ Edit
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* EDIT RESTAURANT MODAL */}
            {editingRestaurant && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto custom-scrollbar flex flex-col p-6 text-gray-100">
                        {/* Modal Header */}
                        <div className="flex justify-between items-center border-b border-gray-800 pb-4 mb-4">
                            <div>
                                <h3 className="text-lg font-bold text-gray-100">Edit Data Restoran</h3>
                                <p className="text-gray-400 text-xs mt-0.5">Edit dan validasi manual informasi toko tersimpan</p>
                            </div>
                            <button 
                                onClick={() => setEditingRestaurant(null)}
                                className="text-gray-400 hover:text-white transition-colors p-1"
                            >
                                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        
                        {/* Modal Form */}
                        <div className="space-y-4 text-sm flex-1">
                            {/* Nama Restoran */}
                            <div className="flex flex-col gap-1">
                                <label className="text-[0.7rem] uppercase tracking-wider text-gray-400 font-bold">Nama Restoran</label>
                                <input 
                                    type="text" 
                                    value={editForm.name || ""}
                                    onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                                    className="bg-black/40 border border-gray-800 rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-indigo-500 w-full"
                                />
                            </div>

                            {/* Alamat */}
                            <div className="flex flex-col gap-1">
                                <label className="text-[0.7rem] uppercase tracking-wider text-gray-400 font-bold">Alamat</label>
                                <textarea 
                                    value={editForm.address || ""}
                                    onChange={e => setEditForm(prev => ({ ...prev, address: e.target.value }))}
                                    rows={2}
                                    className="bg-black/40 border border-gray-800 rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-indigo-500 w-full resize-none leading-tight"
                                />
                            </div>

                            {/* Jam ShopeeFood */}
                            <div className="flex flex-col gap-1">
                                <label className="text-[0.7rem] uppercase tracking-wider text-gray-400 font-bold">Jam ShopeeFood (Bisa Diedit Manual)</label>
                                <HoursInput 
                                    initialHours={editForm.shopee_hours || ""} 
                                    onChange={newVal => setEditForm(prev => ({ ...prev, shopee_hours: newVal }))}
                                />
                            </div>

                            {/* Promo Text */}
                            <div className="flex flex-col gap-1">
                                <label className="text-[0.7rem] uppercase tracking-wider text-gray-400 font-bold">Promo Text</label>
                                <input 
                                    type="text" 
                                    value={editForm.discount_text || ""}
                                    onChange={e => setEditForm(prev => ({ ...prev, discount_text: e.target.value }))}
                                    className="bg-black/40 border border-gray-800 rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-indigo-500 w-full"
                                />
                            </div>

                            {/* Rating & Reviews */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="flex flex-col gap-1">
                                    <label className="text-[0.7rem] uppercase tracking-wider text-gray-400 font-bold">Rating (⭐)</label>
                                    <input 
                                        type="number" 
                                        step="0.1" 
                                        min="1" 
                                        max="5"
                                        value={editForm.rating || 0.0}
                                        onChange={e => setEditForm(prev => ({ ...prev, rating: parseFloat(e.target.value) || 0.0 }))}
                                        className="bg-black/40 border border-gray-800 rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-indigo-500 w-full font-bold"
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-[0.7rem] uppercase tracking-wider text-gray-400 font-bold">Total Ulasan</label>
                                    <input 
                                        type="text" 
                                        value={editForm.total_reviews || ""}
                                        onChange={e => setEditForm(prev => ({ ...prev, total_reviews: e.target.value }))}
                                        className="bg-black/40 border border-gray-800 rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-indigo-500 w-full"
                                    />
                                </div>
                            </div>

                            {/* Coordinates Override */}
                            <div className="bg-indigo-950/20 border border-indigo-900/30 rounded-xl p-3.5 space-y-3">
                                <div className="flex justify-between items-center">
                                    <span className="text-[0.7rem] uppercase tracking-wider text-indigo-400 font-bold">Koordinat Google Maps</span>
                                    <span className="text-[0.62rem] text-indigo-300 bg-indigo-900/40 px-2 py-0.5 rounded font-medium">Ctrl+V untuk paste link maps</span>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-[0.65rem] text-gray-400 font-bold uppercase tracking-wider">Latitude</span>
                                        <input 
                                            type="number" 
                                            step="0.000001"
                                            value={editForm.maps_latitude !== undefined ? editForm.maps_latitude : (editForm.selected_latitude || "")}
                                            onChange={e => {
                                                const val = parseFloat(e.target.value) || 0;
                                                setEditForm(prev => ({ ...prev, maps_latitude: val, selected_latitude: val }));
                                            }}
                                            className="bg-black/60 border border-indigo-950 rounded px-3 py-1.5 focus:outline-none text-xs font-mono text-indigo-200"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <span className="text-[0.65rem] text-gray-400 font-bold uppercase tracking-wider">Longitude</span>
                                        <input 
                                            type="number" 
                                            step="0.000001"
                                            value={editForm.maps_longitude !== undefined ? editForm.maps_longitude : (editForm.selected_longitude || "")}
                                            onChange={e => {
                                                const val = parseFloat(e.target.value) || 0;
                                                setEditForm(prev => ({ ...prev, maps_longitude: val, selected_longitude: val }));
                                            }}
                                            className="bg-black/60 border border-indigo-950 rounded px-3 py-1.5 focus:outline-none text-xs font-mono text-indigo-200"
                                        />
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                    <label className="flex items-center gap-2 text-gray-300 cursor-pointer text-xs">
                                        <input 
                                            type="checkbox"
                                            checked={editForm.validation_status?.toLowerCase() === 'matched'}
                                            onChange={e => setEditForm(prev => ({ 
                                                ...prev, 
                                                validation_status: e.target.checked ? 'matched' : 'unmatched' 
                                            }))}
                                            className="w-4 h-4 rounded border-gray-700 bg-black/50 text-indigo-500 focus:ring-indigo-500"
                                        />
                                        <span>Tandai sebagai Valid/Matched</span>
                                    </label>
                                </div>
                            </div>
                        </div>
 
                        {/* Modal Footer Buttons */}
                        <div className="flex justify-end gap-3 border-t border-gray-800 pt-4 mt-6">
                            <button
                                onClick={() => setEditingRestaurant(null)}
                                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold text-xs rounded-xl border border-gray-700 transition"
                            >
                                Batal
                            </button>
                            <button
                                onClick={async () => {
                                    try {
                                        const mapsLat = editForm.maps_latitude;
                                        const mapsLng = editForm.maps_longitude;
                                        const selLat = editForm.selected_latitude;
                                        const selLng = editForm.selected_longitude;
                                        const hasCoords = (mapsLat && mapsLat !== 0) || (selLat && selLat !== 0);
                                        const finalStatus = hasCoords ? 'matched' : (editForm.validation_status || 'pending');

                                        const res = await fetch(`http://localhost:3001/api/restaurants/${editingRestaurant.id}`, {
                                            method: 'PUT',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                name: editForm.name,
                                                address: editForm.address,
                                                shopee_hours: editForm.shopee_hours,
                                                discount_text: editForm.discount_text,
                                                rating: editForm.rating,
                                                total_reviews: editForm.total_reviews,
                                                selected_latitude: editForm.selected_latitude !== undefined ? editForm.selected_latitude : editForm.maps_latitude,
                                                selected_longitude: editForm.selected_longitude !== undefined ? editForm.selected_longitude : editForm.maps_longitude,
                                                maps_latitude: editForm.maps_latitude,
                                                maps_longitude: editForm.maps_longitude,
                                                validation_status: finalStatus
                                            })
                                        });
                                        if (res.ok) {
                                            alert("Perubahan berhasil disimpan!");
                                            setEditingRestaurant(null);
                                            fetchRestaurants();
                                        } else {
                                            const errData = await res.json();
                                            alert("Gagal menyimpan: " + errData.error);
                                        }
                                    } catch (err) {
                                        console.error("Failed to update restaurant", err);
                                        alert("Koneksi gagal.");
                                    }
                                }}
                                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition"
                            >
                                Simpan Perubahan
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
