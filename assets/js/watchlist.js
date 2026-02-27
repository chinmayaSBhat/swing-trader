// Watchlist page logic
import { loadWatchlist, saveWatchlist, addToWatchlist, removeFromWatchlist } from './storage.js';
import { fetchStockPrice, fetchHistoricalData } from './api.js';
import { generateSignals } from './signals.js';
// charts will be imported lazily when needed
import { formatIndianCurrency } from './utils.js';
import { calculateRSI } from './technical.js';

let niftySymbols = [];

async function loadSymbols() {
    try {
        const res = await fetch('../assets/data/nifty500.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        niftySymbols = json.stocks || [];
        const datalist = document.getElementById('stockList');
        niftySymbols.forEach(s => {
            const opt = document.createElement('option');
            opt.value = `${s.symbol} - ${s.name}`;
            datalist.appendChild(opt);
        });
    } catch (e) {
        console.error('failed load symbols', e);
        import('./alerts.js').then(m=>m.alertManager.showInAppAlert('error', 'Unable to load stock list for autocomplete.'));
    }
}

function updateCount() {
    const count = loadWatchlist().length;
    document.getElementById('watchlistCount').textContent = `${count} stocks`;
}

async function refreshTable() {
    const tbody = document.querySelector('#watchlistTable tbody');
    const list = loadWatchlist();
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-3">No stocks added</td></tr>';
        return;
    }
    tbody.innerHTML = '';
    for (const sym of list) {
        const row = document.createElement('tr');
        // add placeholders so we can update later
        row.innerHTML = `<td><a href="#" class="stock-link" data-symbol="${sym}">${sym}</a></td>
                         <td>${sym}</td>
                         <td class="price-cell">--</td>
                         <td class="change-cell">--</td>
                         <td class="rsi-cell">--</td>
                         <td class="signal-cell">--</td>
                         <td><button class="btn btn-sm btn-outline-secondary chart-btn" data-symbol="${sym}">View</button></td>
                         <td><button class="btn btn-sm btn-danger remove-btn" data-symbol="${sym}">Remove</button></td>`;
        tbody.appendChild(row);
        // asynchronously fetch price/hist and update cells
        (async () => {
            try {
                const priceData = await fetchStockPrice(sym);
                const price = priceData.price || 0;
                const change = priceData.changePercent || '--';
                const priceCell = row.querySelector('.price-cell');
                const changeCell = row.querySelector('.change-cell');
                if (priceCell) priceCell.textContent = formatIndianCurrency(price);
                if (changeCell) changeCell.textContent = typeof change === 'number' ? change.toFixed(2) + '%' : change;
                // compute RSI and simple signal
                const hist = await fetchHistoricalData(sym, '3mo');
                if (hist && hist.length) {
                    const closes = hist.map(d=>d.close);
                    const rsi = calculateRSI(closes, 14);
                    const rsiCell = row.querySelector('.rsi-cell');
                    if (rsiCell && rsi != null) rsiCell.textContent = rsi.toFixed(0);
                    // compute signal via generateSignals (on last 1 only)
                    const sigs = await generateSignals([sym]);
                    const sigCell = row.querySelector('.signal-cell');
                    if (sigCell) sigCell.textContent = sigs.length ? sigs[0].strategy : '--';
                }
            } catch (e) {
                console.warn('error updating row for', sym, e);
                import('./alerts.js').then(m=>m.alertManager.showInAppAlert('error', `Failed to load data for ${sym}: ${e.message || ''}`));
            }
        })();
    }
}

function attachRowHandlers() {
    document.querySelector('#watchlistTable').addEventListener('click', e => {
        if (e.target.matches('.remove-btn')) {
            const sym = e.target.dataset.symbol;
            removeFromWatchlist(sym);
            updateCount();
            refreshTable();
        } else if (e.target.matches('.stock-link') || e.target.matches('.chart-btn')) {
            e.preventDefault();
            const sym = e.target.dataset.symbol;
            showDetailModal(sym);
        }
    });
}

async function showDetailModal(symbol) {
    const modalEl = document.getElementById('stockDetailModal');
    const modal = new bootstrap.Modal(modalEl);
    const content = document.getElementById('stockDetailContent');
    content.innerHTML = '<p>Loading...</p>';
    modal.show();
    try {
        // fetch some data
        const priceData = await fetchStockPrice(symbol);
        const hist = await fetchHistoricalData(symbol, '1mo');
        // find stock info from niche list
        const info = niftySymbols.find(s => s.symbol === symbol) || {};
        content.innerHTML = `<h5>${info.name || symbol} (${symbol})</h5>
            <p>Sector: ${info.sector || 'N/A'}</p>
            <p>Price: ${priceData.price || '--'}</p>`;

        // render mini price chart in modal if historical data available
        if (hist && hist.length) {
            const series = hist.map(d => ({ time: d.date, close: d.close }));
            try {
                const { renderMiniChart } = await import('./charts.js');
                renderMiniChart('detailChart', symbol, series);
            } catch (e) {
                console.warn('chart failed', e);
                const chartContainer = document.getElementById('detailChart');
                if (chartContainer) {
                    chartContainer.innerHTML = '<pre>' + JSON.stringify(series.slice(-10), null, 2) + '</pre>';
                }
            }
        }
    } catch (err) {
        console.error('showDetailModal fetch error', err);
        import('./alerts.js').then(m => m.alertManager.showInAppAlert('error', `Unable to load details for ${symbol}`));
        content.innerHTML = '<p class="text-danger">Failed to load data.</p>';
    }
}

function setupAddForm() {
    const form = document.getElementById('addStockForm');
    form.addEventListener('submit', e => {
        e.preventDefault();
        const val = document.getElementById('stockInput').value.split(' ')[0];
        if (val) {
            if (!/^[A-Za-z0-9\.]+$/.test(val)) {
                import('./alerts.js').then(m=>m.alertManager.showInAppAlert('error', 'Invalid stock symbol'));            
            } else {
                addToWatchlist(val);
                updateCount();
                refreshTable();
                form.reset();
            }
        }
    });
}

function setupExportImport() {
    document.getElementById('exportBtn').addEventListener('click', () => {
        const data = loadWatchlist();
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'watchlist.json';
        a.click();
    });
    const importInput = document.getElementById('importInput');
    document.getElementById('importBtn').addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const arr = JSON.parse(reader.result);
                saveWatchlist(arr);
                updateCount();
                refreshTable();
            } catch (err) {
                alert('Invalid file');
            }
        };
        reader.readAsText(file);
    });
}

// generate signals from watchlist
function setupGenerate() {
    document.getElementById('generateSignalsBtn').addEventListener('click', async () => {
        const list = loadWatchlist();
        if (list.length === 0) return alert('Watchlist empty');
        const signals = await generateSignals(list);
        console.log('Generated signals', signals);
        alert(`Found ${signals.length} signals (check console)`);
    });
}

async function init() {
    await loadSymbols();
    updateCount();
    refreshTable();
    attachRowHandlers();
    setupAddForm();
    setupExportImport();
    setupGenerate();
}

document.addEventListener('DOMContentLoaded', init);
