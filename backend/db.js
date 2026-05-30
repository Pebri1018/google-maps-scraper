const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err);
    } else {
        console.log('Database connected.');
        
        // Create scraped_restaurants table
        db.run(`
            CREATE TABLE IF NOT EXISTS scraped_restaurants (
                id TEXT PRIMARY KEY, 
                name TEXT NOT NULL,
                shopee_latitude REAL,
                shopee_longitude REAL,
                maps_latitude REAL,
                maps_longitude REAL,
                distance_difference_meters REAL,
                discount_text TEXT,
                rating REAL,
                total_reviews TEXT,
                shopee_hours TEXT,
                maps_hours TEXT,
                address TEXT,
                validation_status TEXT DEFAULT 'pending', 
                selected_latitude REAL,
                selected_longitude REAL,
                source TEXT DEFAULT 'shopeefood_hybrid',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }
});

module.exports = db;
