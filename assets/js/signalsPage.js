// Logic for signals discovery page
import { fetchHistoricalData } from './api.js';
import { generateSignals } from './signals.js';
import { formatIndianCurrency } from './utils.js';

// map symbol to sector for filtering
let sectorMap = {};

async function loadSectorMap() {
    try {
        const res = await fetch('../assets/data/nifty500.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        (json.stocks || []).forEach(s => { sectorMap[s.symbol] = s.sector; });
    } catch (e) {
        console.warn('failed to load sector map', e);
        import('./alerts.js').then(m=>m.alertManager.showInAppAlert('error', 'Could not load sector information'));        
    }
}

function setupFilters() {
    const rrSlider = document.getElementById('filterRR');
    const rrVal = document.getElementById('filterRRValue');
    rrSlider.addEventListener('input', () => rrVal.textContent = `${rrSlider.value}:1`);
    const confSlider = document.getElementById('filterConf');
    const confVal = document.getElementById('filterConfValue');
    confSlider.addEventListener('input', () => confVal.textContent = `${confSlider.value}%`);
}

function applyFilters(signals) {
    // filter logic based on form values
    const strat = document.getElementById('filterStrategy').value;
    const sector = document.getElementById('filterSector').value;
    const risk = document.getElementById('filterRisk').value;
    const minRR = parseFloat(document.getElementById('filterRR').value);
    const minConf = parseInt(document.getElementById('filterConf').value, 10);
    return signals.filter(s => {
        if (strat !== 'All' && s.strategy !== strat) return false;
        if (sector !== 'All' && sectorMap[s.symbol] !== sector) return false;
        // risk and other checks would require tagging signals with risk level
        if (s.riskReward && s.riskReward < minRR) return false;
        if (s.confidence < minConf) return false;
        return true;
    });
}

async function runScan() {
    const universe = document.getElementById('scanUniverse').value;
    // populate stock list based on universe
    let symbols = [];
    if (universe === 'Watchlist Only') {
        const { loadWatchlist } = await import('./storage.js');
        symbols = loadWatchlist();
    } else {
        const res = await fetch('../assets/data/nifty500.json');
        const json = await res.json();
        symbols = json.stocks.map(s => s.symbol);
        if (universe === 'NIFTY 50') symbols = symbols.slice(0,50);
        else if (universe === 'NIFTY 100') symbols = symbols.slice(0,100);
    }
    const progress = document.getElementById('scanProgress');
    const eta = document.getElementById('scanETA');
    const results = [];
    let failures = 0;
    const total = symbols.length;
    for (let i = 0; i < symbols.length; i++) {
        const sym = symbols[i];
        try {
            const hist = await fetchHistoricalData(sym, '6mo');
            const sigs = await generateSignals([sym]);
            results.push(...sigs);
        } catch (e) {
            failures++;
            console.warn('scan error', sym, e);
        }
        const pct = Math.floor(((i+1)/total)*100);
        if (progress) {
            progress.style.width = pct + '%';
            progress.textContent = pct + '%';
        }
        const remaining = ((total - i - 1) * 1); // assume 1s per symbol
        if (eta) eta.textContent = `ETA: ${remaining}s`;
    }
    // display results
    displayResults(results);
    if (failures) {
        import('./alerts.js').then(m => m.alertManager.showInAppAlert('error', `${failures} symbols failed during scan`));
    }
}

function displayResults(signals) {
    const tbody = document.querySelector('#signalsResultsTable tbody');
    tbody.innerHTML = '';
    if (signals.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-3">No signals found</td></tr>';
        return;
    }
    signals.sort((a,b)=>b.confidence - a.confidence);
    signals.slice(0,100).forEach(s => {
        const row = document.createElement('tr');
        row.classList.add('row-swipe-action');
        row.innerHTML = `<td>${s.symbol}</td><td>${s.strategy}</td><td class="col-hidden-xs">${formatIndianCurrency(s.entry)}</td><td class="col-hidden-xs">${formatIndianCurrency(s.stopLoss)}</td><td class="col-hidden-xs">${formatIndianCurrency(s.target)}</td><td class="col-hidden-xs">${s.riskReward}</td><td class="col-hidden-xs">${s.confidence}%</td><td><button class="btn btn-sm btn-success" data-symbol="${s.symbol}">Add</button></td>`;
        tbody.appendChild(row);

        // swipe gesture for add
        let startX = 0;
        row.addEventListener('touchstart', e => {
            if (e.touches.length === 1) startX = e.touches[0].clientX;
        });
        row.addEventListener('touchend', e => {
            const dx = e.changedTouches[0].clientX - startX;
            if (dx > 60) {
                const btn = row.querySelector('button');
                if (btn) btn.click();
            }
        });
    });
    // attach click listener for rows to show detail section
    tbody.querySelectorAll('tr').forEach(r => {
        r.addEventListener('click', async e => {
            // avoid clicks on Add button
            if (e.target.tagName.toLowerCase() === 'button') return;
            const sym = r.cells[0].textContent;
            // remove any existing detail row
            const next = r.nextElementSibling;
            if (next && next.classList.contains('signal-detail-row')) {
                next.remove();
                return;
            }
            const template = document.getElementById('signalDetailTemplate');
            const clone = template.content.cloneNode(true);
            const detailRow = clone.querySelector('tr');
            detailRow.querySelector('.detail-why').textContent = 'Strategy rules triggered';
            // fetch history for chart
            try {
                const hist = await fetchHistoricalData(sym, '3mo');
                if (hist && hist.length) {
                    // convert candles for price chart
                    const chartData = hist.map(d=>({ time: d.date, open:d.open, high:d.high, low:d.low, close:d.close, volume:d.volume }));
                    // render price chart inside the new detail row
                    // assign id dynamically
                    const chartContainer = detailRow.querySelector('.detail-chart');
                    const cid = `signalChart_${sym}_${Date.now()}`;
                    chartContainer.id = cid;
                    try {
                        const { renderPriceChart } = await import('./charts.js');
                        renderPriceChart(cid, sym, chartData, s);
                    } catch (chartErr) {
                        console.warn('chart render failed', chartErr);
                        chartContainer.innerHTML = '<pre>' + JSON.stringify(chartData.slice(-10), null, 2) + '</pre>';
                    }
                }
            } catch (err) {
                console.warn('failed fetch history for detail', sym, err);
                import('./alerts.js').then(m=>m.alertManager.showInAppAlert('error', `Could not load historical data for ${sym}`));
            }
            r.after(detailRow);
        });
    });
}

function setupScanButton() {
    document.getElementById('runScanBtn').addEventListener('click', () => {
        runScan().catch(err=>console.error(err));
    });
}

function init() {
    setupFilters();
    setupScanButton();
    loadSectorMap();
}

document.addEventListener('DOMContentLoaded', init);
