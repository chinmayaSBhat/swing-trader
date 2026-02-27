// Web Worker for computing signals using generateSignals and technical indicators
importScripts('./signals.js');

// postMessage({ action: 'scan', symbols: [...] });
// responds with { action:'scanResult', results: [...] }

self.onmessage = async function(e) {
    const msg = e.data;
    if (msg.action === 'scan') {
        try {
            // generateSignals defined in imported script
            const results = await generateSignals(msg.symbols);
            self.postMessage({ action: 'scanResult', results });
        } catch (err) {
            self.postMessage({ action: 'error', error: err.message || err });
        }
    }
};
