// Storage utilities: localStorage for small items, IndexedDB for bulk time series

const Storage = (() => {
    const COMPRESS = true;
    // quick LZ-string wrapper (assumes LZString library included separately)
    function compress(str) {
        return COMPRESS ? LZString.compress(str) : str;
    }
    function decompress(str) {
        return COMPRESS ? LZString.decompress(str) : str;
    }

    function save(key, value) {
        const payload = JSON.stringify(value);
        try {
            localStorage.setItem(key, compress(payload));
        } catch (e) {
            console.error('storage save error', e);
            // show non-blocking user message
            import('./alerts.js').then(m=>m.alertManager.showInAppAlert('error', `Failed to save ${key}`)).catch(()=>{});
        }
    }
    function load(key) {
        const v = localStorage.getItem(key);
        if (!v) return null;
        try {
            return JSON.parse(decompress(v));
        } catch (e) {
            console.error('storage load error', e);
            import('./alerts.js').then(m=>m.alertManager.showInAppAlert('error', `Corrupt data in storage for ${key}, resetting`)).catch(()=>{});
            localStorage.removeItem(key);
            return null;
        }
    }

    // Watchlist operations
    function saveWatchlist(stocks) { save('watchlist', stocks); }
    function loadWatchlist() { return load('watchlist') || []; }
    function addToWatchlist(symbol) {
        const list = loadWatchlist();
        if (!list.includes(symbol)) {
            list.push(symbol);
            saveWatchlist(list);
        }
    }
    function removeFromWatchlist(symbol) {
        let list = loadWatchlist();
        list = list.filter(s => s !== symbol);
        saveWatchlist(list);
    }

    // Signals
    function saveSignals(signals) { save('signals', signals); }
    function loadSignals() { return load('signals') || []; }

    // Settings
    function saveSettings(config) { save('settings', config); }
    function loadSettings() { return load('settings') || {}; }

    // IndexedDB for historical data
    const DB_NAME = 'swingTraderDB';
    const DB_VERSION = 1;
    let db;
    function openDb() {
        return new Promise((resolve, reject) => {
            if (db) return resolve(db);
            if (!window.indexedDB) {
                console.warn('IndexedDB not available, will use localStorage fallback');
                import('./alerts.js').then(m=>m.alertManager.showInAppAlert('info', 'IndexedDB not available; using slower storage')).catch(()=>{});
                return resolve(null);
            }
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = e => {
                const d = e.target.result;
                if (!d.objectStoreNames.contains('history')) {
                    d.createObjectStore('history', { keyPath: 'symbol' });
                }
            };
            req.onsuccess = e => {
                db = e.target.result;
                resolve(db);
            };
            req.onerror = e => {
                console.error('indexeddb open error', e.target.error);
                import('./alerts.js').then(m=>m.alertManager.showInAppAlert('error', 'Failed to open local database')).catch(()=>{});
                reject(e.target.error);
            };
        });
    }
    async function saveHistorical(symbol, data) {
        const database = await openDb();
        if (!database) {
            // fallback: store in localStorage as JSON
            try { localStorage.setItem(`hist_${symbol}`, JSON.stringify({ data, timestamp: Date.now() })); } catch {}
            return;
        }
        return new Promise((res, rej) => {
            const tx = database.transaction('history', 'readwrite');
            const store = tx.objectStore('history');
            store.put({ symbol, data, timestamp: Date.now() });
            tx.oncomplete = () => res();
            tx.onerror = e => rej(e.target.error);
        });
    }
    async function loadHistorical(symbol, maxAgeMs = 24*60*60*1000) {
        const database = await openDb();
        if (!database) {
            // localStorage fallback
            try {
                const item = JSON.parse(localStorage.getItem(`hist_${symbol}`));
                if (item && Date.now() - item.timestamp <= maxAgeMs) return item.data;
            } catch (e) {}
            return null;
        }
        return new Promise((res, rej) => {
            const tx = database.transaction('history', 'readonly');
            const store = tx.objectStore('history');
            const request = store.get(symbol);
            request.onsuccess = () => {
                const rec = request.result;
                if (!rec) return res(null);
                if (Date.now() - rec.timestamp > maxAgeMs) {
                    // stale
                    res(null);
                } else {
                    res(rec.data);
                }
            };
            request.onerror = e => rej(e.target.error);
        });
    }

    function clearOldData() {
        openDb().then(database => {
            const tx = database.transaction('history', 'readwrite');
            const store = tx.objectStore('history');
            const now = Date.now();
            const req = store.openCursor();
            req.onsuccess = e => {
                const cursor = e.target.result;
                if (cursor) {
                    if (now - cursor.value.timestamp > 30 * 24 * 60 * 60 * 1000) {
                        cursor.delete();
                    }
                    cursor.continue();
                }
            };
        });
    }

    return {
        saveWatchlist,
        loadWatchlist,
        addToWatchlist,
        removeFromWatchlist,
        saveSignals,
        loadSignals,
        saveSettings,
        loadSettings,
        saveHistorical,
        loadHistorical,
        clearOldData
    };
})();

// expose for convenience
const {
    saveWatchlist,
    loadWatchlist,
    addToWatchlist,
    removeFromWatchlist,
    saveSignals,
    loadSignals,
    saveSettings,
    loadSettings,
    saveHistorical,
    loadHistorical,
    clearOldData
} = Storage;

// ES module exports
export {
    saveWatchlist,
    loadWatchlist,
    addToWatchlist,
    removeFromWatchlist,
    saveSignals,
    loadSignals,
    saveSettings,
    loadSettings,
    saveHistorical,
    loadHistorical,
    clearOldData
};
