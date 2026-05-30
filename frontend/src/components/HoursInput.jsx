import React, { useState, useEffect } from 'react';

export default function HoursInput({ initialHours = "", onChange }) {
    const [is24Hours, setIs24Hours] = useState(false);
    const [bukaTime, setBukaTime] = useState("");
    const [tutupTime, setTutupTime] = useState("");
    const [daysPrefix, setDaysPrefix] = useState("");

    // Parse the initial string to set state
    useEffect(() => {
        if (!initialHours) return;
        
        let days = "";
        let timeRange = "";
        
        // Example initialHours: "Sen-Min 08:00-21:00" or just "Sen-Min"
        const parts = initialHours.split(" ");
        if (parts.length >= 1) {
            // First part might be days like "Sen-Min"
            if (parts[0].includes("-") && !parts[0].includes(":")) {
                days = parts[0];
                timeRange = parts.slice(1).join(" ");
            } else {
                timeRange = initialHours;
            }
        }
        
        setDaysPrefix(days);
        
        if (timeRange.includes("00:00-23:59") || timeRange.toLowerCase().includes("24 jam")) {
            setIs24Hours(true);
            setBukaTime("00:00");
            setTutupTime("23:59");
        } else if (timeRange.includes("-")) {
            const [b, t] = timeRange.split("-");
            setBukaTime(b?.trim() || "");
            setTutupTime(t?.trim() || "");
            setIs24Hours(false);
        }
    }, [initialHours]);

    const notifyChange = (new24Hours, newBuka, newTutup) => {
        let finalTime = "";
        if (new24Hours) {
            finalTime = "00:00-23:59";
        } else if (newBuka && newTutup) {
            finalTime = `${newBuka}-${newTutup}`;
        }
        const finalResult = (daysPrefix ? `${daysPrefix} ` : "") + finalTime;
        if (onChange) {
            onChange(finalResult.trim());
        }
    };

    const handle24HoursChange = (checked) => {
        setIs24Hours(checked);
        notifyChange(checked, bukaTime, tutupTime);
    };

    const handleBukaChange = (val) => {
        setBukaTime(val);
        notifyChange(is24Hours, val, tutupTime);
    };

    const handleTutupChange = (val) => {
        setTutupTime(val);
        notifyChange(is24Hours, bukaTime, val);
    };

    return (
        <div className="bg-blue-950/20 border border-blue-900/30 rounded-xl p-3 flex flex-col gap-3">
            <label className="flex items-center gap-2 text-blue-100 cursor-pointer w-fit">
                <input 
                    type="checkbox" 
                    checked={is24Hours}
                    onChange={(e) => handle24HoursChange(e.target.checked)}
                    className="w-4 h-4 rounded border-blue-700 bg-blue-900/50 text-indigo-500 focus:ring-indigo-500"
                />
                <span className="font-medium text-sm">Buka 24 Jam</span>
            </label>
            
            {!is24Hours && (
                <div className="flex gap-4">
                    <div className="flex flex-col flex-1 gap-1">
                        <span className="text-[0.65rem] text-blue-400 font-bold uppercase tracking-wider">Buka</span>
                        <input 
                            type="time" 
                            value={bukaTime}
                            onChange={e => handleBukaChange(e.target.value)}
                            className="w-full bg-blue-900/30 text-blue-100 border border-blue-800 rounded px-3 py-1.5 focus:outline-none focus:border-indigo-500"
                        />
                    </div>
                    <div className="flex flex-col flex-1 gap-1">
                        <span className="text-[0.65rem] text-blue-400 font-bold uppercase tracking-wider">Tutup</span>
                        <input 
                            type="time" 
                            value={tutupTime}
                            onChange={e => handleTutupChange(e.target.value)}
                            className="w-full bg-blue-900/30 text-blue-100 border border-blue-800 rounded px-3 py-1.5 focus:outline-none focus:border-indigo-500"
                        />
                    </div>
                </div>
            )}
            
            {daysPrefix && (
                <div className="text-[0.65rem] text-blue-300/70">
                    Hari dideteksi: <span className="font-semibold">{daysPrefix}</span>
                </div>
            )}
        </div>
    );
}
