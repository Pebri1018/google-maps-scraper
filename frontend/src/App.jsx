import { useState, useEffect } from 'react'
import RestaurantScraper from './components/RestaurantScraper'

function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8 font-sans">
      <header className="mb-8 border-b border-gray-800 pb-4">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-500 to-amber-300 bg-clip-text text-transparent">
          ZPILOT Admin
        </h1>
        <p className="text-gray-400 text-sm mt-2">Data Harmonization: ShopeeFood x Google Maps</p>
      </header>

      <main>
        <RestaurantScraper />
      </main>
    </div>
  )
}

export default App
