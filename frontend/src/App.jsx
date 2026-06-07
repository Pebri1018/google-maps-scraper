import { useState, useEffect, useRef } from 'react'
import { MapPin, Search, Link2, Settings2, Terminal, Play, CheckSquare, Square, Download } from 'lucide-react'

const AVAILABLE_FIELDS = [
  { id: "name", label: "Nama Tempat", default: true },
  { id: "latitude", label: "Latitude", default: true },
  { id: "longitude", label: "Longitude", default: true },
  { id: "address", label: "Alamat", default: true },
  { id: "phone", label: "Telepon", default: true },
  { id: "website", label: "Website", default: true },
  { id: "rating", label: "Rating", default: true },
  { id: "total_reviews", label: "Total Ulasan", default: true },
  { id: "category", label: "Kategori", default: true },
  { id: "weekly_hours", label: "Jam Operasional", default: true },
  { id: "closed_days", label: "Hari Tutup", default: true },
  { id: "price_level", label: "Level Harga", default: false },
  { id: "plus_code", label: "Plus Code", default: false },
  { id: "maps_url", label: "Maps URL", default: false },
];

function App() {
  const [mode, setMode] = useState('auto')
  const [inputText, setInputText] = useState('')
  const [fields, setFields] = useState(AVAILABLE_FIELDS.filter(f => f.default).map(f => f.id))
  const [maxResults, setMaxResults] = useState(0)
  const [outputCsv, setOutputCsv] = useState('hasil_scrape.csv')
  
  const [isScraping, setIsScraping] = useState(false)
  const [logs, setLogs] = useState([])
  const terminalRef = useRef(null)
  
  // API URL - Selalu arahkan ke localhost karena scraper butuh browser lokal
  const API_URL = 'http://127.0.0.1:5000'

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [logs])

  const toggleField = (fieldId) => {
    setFields(prev => 
      prev.includes(fieldId) 
        ? prev.filter(id => id !== fieldId)
        : [...prev, fieldId]
    )
  }

  const startScrape = async () => {
    if (!inputText) {
      alert("Masukkan URL atau Kata Kunci pencarian!")
      return
    }

    setIsScraping(true)
    setLogs(["[SYSTEM] Menyambungkan ke Engine Lokal..."])

    try {
      const response = await fetch(`${API_URL}/api/scrape`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode,
          input_text: inputText,
          fields,
          max_results: maxResults,
          output_csv: outputCsv
        })
      });

      if (!response.ok) {
        throw new Error("Gagal menyambung ke Local Engine. Pastikan server.py sudah berjalan.");
      }

      // Start listening to SSE logs
      const eventSource = new EventSource(`${API_URL}/api/logs`);
      
      eventSource.onmessage = (event) => {
        if (event.data === ": keep-alive") return;
        
        setLogs(prev => [...prev, event.data]);
        
        if (event.data.includes("[DONE]") || event.data.includes("[ERROR]")) {
          eventSource.close();
          setIsScraping(false);
        }
      };

      eventSource.onerror = () => {
        setLogs(prev => [...prev, "[SYSTEM] Koneksi log terputus."]);
        eventSource.close();
        setIsScraping(false);
      };

    } catch (error) {
      setLogs(prev => [...prev, `[ERROR] ${error.message}`, "[SYSTEM] Pastikan kamu sudah menjalankan 'python server.py' di terminal komputer kamu."]);
      setIsScraping(false);
    }
  }

  return (
    <div className="min-h-screen p-4 md:p-8 flex justify-center">
      <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Form Settings */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          
          <header className="mb-2">
            <h1 className="text-3xl font-bold tracking-tight text-brand-dark flex items-center gap-3">
              <MapPin className="text-brand-blue" size={32} />
              Gmaps Scraper
            </h1>
            <p className="text-brand-dark/70 mt-2 text-sm">
              Ekstrak data dari Google Maps ke CSV secara otomatis.
            </p>
          </header>

          {/* Card: Input */}
          <div className="bg-white/60 backdrop-blur-md border border-white p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <div className="flex gap-4 mb-4 bg-brand-light/50 p-1.5 rounded-2xl">
              <button 
                onClick={() => setMode('auto')}
                className={`flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-all ${mode === 'auto' ? 'bg-white text-brand-dark shadow-sm' : 'text-brand-dark/60 hover:text-brand-dark'}`}
              >
                Auto Detect
              </button>
              <button 
                onClick={() => setMode('list')}
                className={`flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-all ${mode === 'list' ? 'bg-white text-brand-dark shadow-sm' : 'text-brand-dark/60 hover:text-brand-dark'}`}
              >
                Shared List
              </button>
              <button 
                onClick={() => setMode('search')}
                className={`flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-all ${mode === 'search' ? 'bg-white text-brand-dark shadow-sm' : 'text-brand-dark/60 hover:text-brand-dark'}`}
              >
                Keyword
              </button>
            </div>

            <label className="block text-sm font-semibold mb-2 text-brand-dark">
              {mode === 'search' ? 'Kata Kunci Pencarian' : 'URL Google Maps'}
            </label>
            <div className="relative">
              {mode === 'search' ? (
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-blue/50" size={18} />
              ) : (
                <Link2 className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-blue/50" size={18} />
              )}
              <input 
                type="text" 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={mode === 'search' ? "Contoh: warung makan enak di jogja" : "https://maps.app.goo.gl/..."}
                className="w-full bg-white border-0 py-3.5 pl-11 pr-4 rounded-2xl text-sm shadow-inner focus:ring-2 focus:ring-brand-cyan focus:outline-none transition-all placeholder-brand-dark/30"
              />
            </div>
          </div>

          {/* Card: Fields */}
          <div className="bg-white/60 backdrop-blur-md border border-white p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <h3 className="text-sm font-semibold mb-4 text-brand-dark flex items-center gap-2">
              <Settings2 size={16} className="text-brand-blue" />
              Kolom Data
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {AVAILABLE_FIELDS.map(field => {
                const isActive = fields.includes(field.id);
                return (
                  <div 
                    key={field.id}
                    onClick={() => toggleField(field.id)}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl cursor-pointer transition-all border ${isActive ? 'bg-brand-cyan/20 border-brand-cyan text-brand-dark font-medium' : 'bg-white/50 border-transparent text-brand-dark/60 hover:bg-white'}`}
                  >
                    {isActive ? (
                      <CheckSquare size={16} className="text-brand-blue" />
                    ) : (
                      <Square size={16} className="text-brand-dark/30" />
                    )}
                    <span className="text-xs">{field.label}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Card: Output Config */}
          <div className="bg-white/60 backdrop-blur-md border border-white p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-2 text-brand-dark">Max Hasil (0 = Semua)</label>
              <input 
                type="number" 
                min="0"
                value={maxResults}
                onChange={(e) => setMaxResults(e.target.value)}
                className="w-full bg-white border-0 py-2.5 px-3 rounded-xl text-sm shadow-inner focus:ring-2 focus:ring-brand-cyan focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-2 text-brand-dark">Nama CSV</label>
              <input 
                type="text" 
                value={outputCsv}
                onChange={(e) => setOutputCsv(e.target.value)}
                className="w-full bg-white border-0 py-2.5 px-3 rounded-xl text-sm shadow-inner focus:ring-2 focus:ring-brand-cyan focus:outline-none"
              />
            </div>
          </div>

          <button 
            onClick={startScrape}
            disabled={isScraping}
            className={`w-full py-4 rounded-2xl font-bold text-white shadow-lg flex items-center justify-center gap-2 transition-all ${isScraping ? 'bg-brand-blue/50 cursor-not-allowed' : 'bg-brand-blue hover:bg-brand-dark hover:-translate-y-0.5'}`}
          >
            {isScraping ? (
              <span className="animate-pulse">Sedang Berjalan...</span>
            ) : (
              <>
                <Play fill="currentColor" size={18} />
                Gas Scrape
              </>
            )}
          </button>

        </div>

        {/* Right Column: Terminal View */}
        <div className="lg:col-span-7 flex flex-col h-[600px] lg:h-auto">
          <div className="bg-[#1C2C3A] rounded-3xl flex flex-col h-full overflow-hidden shadow-2xl border border-white/10 relative">
            
            {/* Terminal Header */}
            <div className="bg-black/20 py-3 px-5 flex items-center gap-3 backdrop-blur-sm border-b border-white/5">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-400/80"></div>
                <div className="w-3 h-3 rounded-full bg-amber-400/80"></div>
                <div className="w-3 h-3 rounded-full bg-green-400/80"></div>
              </div>
              <span className="text-white/40 text-xs font-mono ml-2 flex items-center gap-2">
                <Terminal size={12} />
                Live Engine Output
              </span>
            </div>

            {/* Terminal Body */}
            <div 
              ref={terminalRef}
              className="flex-1 p-5 overflow-y-auto terminal-scroll font-mono text-xs leading-relaxed"
            >
              {logs.length === 0 ? (
                <div className="text-white/30 h-full flex flex-col items-center justify-center text-center">
                  <Terminal size={32} className="mb-3 opacity-50" />
                  <p>Menunggu instruksi...</p>
                  <p className="mt-2 text-[10px] bg-white/5 py-1 px-3 rounded-lg border border-white/10">Pastikan Local Engine python berjalan.</p>
                </div>
              ) : (
                logs.map((log, i) => {
                  let colorClass = "text-white/80";
                  if (log.includes("[+]")) colorClass = "text-[#A2E0F8]";
                  if (log.includes("[-]")) colorClass = "text-amber-300";
                  if (log.includes("[!]")) colorClass = "text-red-400";
                  if (log.includes("[OK]")) colorClass = "text-green-400 font-bold";
                  if (log.includes("[SYSTEM]")) colorClass = "text-brand-blue font-bold";
                  
                  return (
                    <div key={i} className={`whitespace-pre-wrap ${colorClass} mb-1`}>
                      {log}
                    </div>
                  )
                })
              )}
            </div>
            
          </div>
        </div>

      </div>
    </div>
  )
}

export default App
