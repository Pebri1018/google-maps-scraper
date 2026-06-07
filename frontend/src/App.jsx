import { useState } from 'react'
import { MapPin, Search, Link2, Settings2, CheckSquare, Square, TerminalSquare, Copy, Check } from 'lucide-react'

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
  const [copied, setCopied] = useState(false)
  
  const toggleField = (fieldId) => {
    setFields(prev => 
      prev.includes(fieldId) 
        ? prev.filter(id => id !== fieldId)
        : [...prev, fieldId]
    )
  }

  const generateCommand = () => {
    let cmd = 'python gmaps_scraper.py'
    
    if (inputText) {
      if (mode === 'search' || !inputText.includes('http')) {
        cmd += ` --keyword "${inputText}"`
      } else {
        cmd += ` --url "${inputText}"`
      }
    } else {
      cmd += ` --keyword "..."`
    }

    if (fields.length > 0 && fields.length < AVAILABLE_FIELDS.length) {
      cmd += ` --fields ${fields.join(',')}`
    }

    if (maxResults > 0) {
      cmd += ` --max-results ${maxResults}`
    }

    if (outputCsv && outputCsv !== 'output.csv') {
      let safeOutput = outputCsv.endsWith('.csv') ? outputCsv : `${outputCsv}.csv`
      cmd += ` --output "${safeOutput}"`
    }

    if (mode !== 'auto' && inputText) {
       // Only append mode if it's explicitly needed, usually auto detection is fine.
       // Tapi karena user milih mode, kita tambahin aja biar eksplisit
       cmd += ` --mode ${mode}`
    }

    return cmd
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(generateCommand())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen p-4 md:p-8 flex justify-center pb-24">
      <div className="max-w-4xl w-full flex flex-col gap-6">
        
        <header className="mb-2 text-center md:text-left">
          <h1 className="text-3xl font-bold tracking-tight text-brand-dark flex items-center justify-center md:justify-start gap-3">
            <MapPin className="text-brand-blue" size={32} />
            Gmaps Scraper Builder
          </h1>
          <p className="text-brand-dark/70 mt-2 text-sm">
            Gunakan alat ini untuk menghasilkan perintah *scraping* secara otomatis.
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
            {mode === 'search' ? 'Kata Kunci Pencarian' : 'URL Google Maps / Kata Kunci'}
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
              placeholder={mode === 'search' ? "Contoh: warung makan enak di jogja" : "https://maps.app.goo.gl/... atau kata kunci"}
              className="w-full bg-white border-0 py-3.5 pl-11 pr-4 rounded-2xl text-sm shadow-inner focus:ring-2 focus:ring-brand-cyan focus:outline-none transition-all placeholder-brand-dark/30"
            />
          </div>
        </div>

        {/* Card: Fields */}
        <div className="bg-white/60 backdrop-blur-md border border-white p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <h3 className="text-sm font-semibold mb-4 text-brand-dark flex items-center gap-2">
            <Settings2 size={16} className="text-brand-blue" />
            Pilih Kolom Data yang Ingin Diambil
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
        <div className="bg-white/60 backdrop-blur-md border border-white p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold mb-2 text-brand-dark">Maksimal Hasil (0 = Ambil Semua)</label>
            <input 
              type="number" 
              min="0"
              value={maxResults}
              onChange={(e) => setMaxResults(e.target.value)}
              className="w-full bg-white border-0 py-2.5 px-3 rounded-xl text-sm shadow-inner focus:ring-2 focus:ring-brand-cyan focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-2 text-brand-dark">Nama File Output</label>
            <input 
              type="text" 
              value={outputCsv}
              onChange={(e) => setOutputCsv(e.target.value)}
              className="w-full bg-white border-0 py-2.5 px-3 rounded-xl text-sm shadow-inner focus:ring-2 focus:ring-brand-cyan focus:outline-none"
            />
          </div>
        </div>

        {/* Card: Result Command */}
        <div className="bg-[#1C2C3A] p-6 rounded-3xl shadow-2xl border border-white/10 mt-4 relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand-cyan to-brand-blue"></div>
          
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-white/80 text-sm font-semibold flex items-center gap-2">
              <TerminalSquare size={18} className="text-brand-cyan" />
              Terminal Command
            </h3>
            
            <button 
              onClick={handleCopy}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${copied ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'}`}
            >
              {copied ? <><Check size={14} /> Tersalin!</> : <><Copy size={14} /> Salin Perintah</>}
            </button>
          </div>
          
          <div className="bg-black/40 p-4 rounded-xl font-mono text-sm text-brand-cyan leading-relaxed break-all">
            {generateCommand()}
          </div>
          
          <p className="text-white/40 text-xs mt-4">
            * Buka terminal di komputermu (di dalam folder project ini), *paste* perintah di atas, lalu tekan Enter.
          </p>
        </div>

      </div>
    </div>
  )
}

export default App
