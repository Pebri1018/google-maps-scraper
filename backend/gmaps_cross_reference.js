const { chromium } = require('playwright');
const db = require('./db');

// Haversine formula to calculate distance between two coordinates
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
    const d = R * c; // Distance in km
    return Math.round(d * 1000); // Distance in meters
}

async function crossReferenceGoogleMaps() {
    console.log("[*] Starting Google Maps Cross-Reference Engine...");

    db.all(`SELECT id, name FROM scraped_restaurants WHERE validation_status = 'pending'`, async (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }

        if (rows.length === 0) {
            console.log("[*] No pending restaurants to cross-reference.");
            return;
        }

        console.log(`[*] Found ${rows.length} pending restaurants. Launching Playwright...`);
        
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        for (const row of rows) {
            console.log(`\n[~] Searching Maps for: ${row.name}`);
            const query = encodeURIComponent(`${row.name} Yogyakarta`);
            
            try {
                await page.goto(`https://www.google.com/maps/search/${query}`, { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(3000); // Wait for maps to resolve
                
                // Extract Coordinates from URL
                const url = page.url();
                let lat = null, lng = null;
                const coordMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
                
                if (coordMatch) {
                    lat = parseFloat(coordMatch[1]);
                    lng = parseFloat(coordMatch[2]);
                    console.log(`    [+] Found Coordinates: ${lat}, ${lng}`);
                    
                    // Here we'd compare distance if Shopee coords existed
                    // For demo, we just assign matched
                    db.run(`
                        UPDATE scraped_restaurants 
                        SET maps_latitude = ?, maps_longitude = ?, validation_status = 'matched'
                        WHERE id = ?
                    `, [lat, lng, row.id]);

                } else {
                    console.log(`    [-] Not found on Maps. Flagging as Shopee Only.`);
                    db.run(`
                        UPDATE scraped_restaurants 
                        SET validation_status = 'shopee_only'
                        WHERE id = ?
                    `, [row.id]);
                }
                
            } catch (e) {
                console.error(`    [!] Error searching ${row.name}: ${e.message}`);
            }
        }
        
        await browser.close();
        console.log("\n[*] Cross-Reference Completed!");
    });
}

crossReferenceGoogleMaps();
