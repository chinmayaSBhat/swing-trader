import { fetchIndices, fetchTopMovers, fetchStockPrice, fetchHistoricalData, fetchBatchStockPrice } from './api.js';
import { alertManager } from './alerts.js';
import { loadWatchlist, saveSignals, loadSignals, saveSettings, loadSettings } from './storage.js';
import { formatIndianCurrency } from './utils.js';
import { generateSignals, filterHighQualitySignals } from './signals.js';
import { fetchMarketNews } from './news.js';
import { renderMarketBreadthGauge, renderSectorPerformance, renderSignalDistribution } from './charts.js';
import { isMarketOpen, getNextMarketOpen } from './market-timings.js';

// register service worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(reg => console.log('SW registered', reg)).catch(err => console.warn('SW registration failed', err));
}

class SwingTraderApp {
    constructor() {
        this.watchlist = [];
        this.signals = [];
        this.marketData = {};
        this.settings = {};
        this.refreshTimer = null;
        this.autoRefreshInterval = null;
        this.lastSignalIds = new Set();
    }

    async init() {
        try {
            // load settings and watchlist
            this.settings = loadSettings() || {};
            this.watchlist = loadWatchlist();

            // UI initial state
            this.setLoading(true);

            // register service worker for offline support
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('/sw.js').catch(e => console.warn('sw register failed', e));
            }

            // connectivity handlers for user feedback
            window.addEventListener('offline', () => {
                import('./alerts.js').then(m=>m.alertManager.showInAppAlert('error', 'You are offline. Data may be stale.'));
            });
            window.addEventListener('online', async () => {
                import('./alerts.js').then(m=>m.alertManager.showInAppAlert('info', 'Back online. Refreshing data...'));
                await this.refreshMarketData();
                await this.updateWatchlist();
            });
            // catch any unhandled promise rejections
            window.addEventListener('unhandledrejection', event => {
                console.error('Unhandled rejection', event.reason);
                import('./alerts.js').then(m=>m.alertManager.showInAppAlert('error', 'An unexpected error occurred.'));
            });
            // show retry notifications from API
            window.addEventListener('apiRetry', ev => {
                const reason = ev.detail?.reason || 'network issue';
                import('./alerts.js').then(m=>m.alertManager.showInAppAlert('info', `Retrying request due to ${reason}`));
            });
            // no news items fetched
            window.addEventListener('newsFetchEmpty', () => {
                import('./alerts.js').then(m=>m.alertManager.showInAppAlert('error', 'Could not retrieve any news.'));
            });

            // warn if starting offline
            if (navigator && navigator.onLine === false) {
                import('./alerts.js').then(m=>m.alertManager.showInAppAlert('error', 'You are currently offline. Some data may not load.'));
            }
            // market status and initial data
            const marketOpen = isMarketOpen();
            await this.refreshMarketData();

            // load saved signals
            this.signals = loadSignals() || [];

            // if market open, scan immediately
            if (marketOpen && this.watchlist.length) {
                await this.scanForSignals(this.watchlist);
            }

            // setup periodic refresh
            this.setupAutoRefresh();

            // event listeners
            this.initEventListeners();

            // render dashboard elements
            this.renderDashboard();
            // update countdown every minute
            setInterval(() => {
                const statusEl = document.getElementById('marketStatus');
                const countdownEl = document.getElementById('marketCountdown');
                if (statusEl) statusEl.textContent = isMarketOpen() ? 'Open' : 'Closed';
                if (countdownEl) countdownEl.textContent = getNextMarketOpen();
            }, 60000);
        } catch (err) {
            console.error('Init error', err);
            import('./alerts.js').then(m=>m.alertManager.showInAppAlert('error', 'Initialization failed. Please reload.'));
        } finally {
            this.setLoading(false);
        }
    }

    attachMobileHelpers() {
        // collapsible card headers
        document.querySelectorAll('.card.mobile-collapsible .card-header').forEach(h => {
            h.addEventListener('click', () => {
                const card = h.closest('.card');
                if (card) card.classList.toggle('collapsed');
            });
        });

        // bottom nav active state
        const path = window.location.pathname;
        document.querySelectorAll('.mobile-bottom-nav .nav-link').forEach(a => {
            if (a.getAttribute('href') === path || path.endsWith(a.getAttribute('href'))) {
                a.classList.add('active');
            }
        });

        // swipe between main pages
        let startX = 0;
        document.body.addEventListener('touchstart', e => {
            if (e.touches.length === 1) startX = e.touches[0].clientX;
        });
        document.body.addEventListener('touchend', e => {
            const dx = e.changedTouches[0].clientX - startX;
            if (Math.abs(dx) < 50) return;
            const order = ['/index.html', '/pages/watchlist.html', '/pages/signals.html', '/pages/settings.html'];
            const curr = order.findIndex(o => path.endsWith(o));
            if (curr === -1) return;
            if (dx < 0 && curr < order.length - 1) {
                window.location.href = order[curr + 1];
            } else if (dx > 0 && curr > 0) {
                window.location.href = order[curr - 1];
            }
        });

        // pull-to-refresh on dashboard
        if (path.endsWith('index.html') || path === '/' || path === '') {
            let touchStartY = 0;
            let refreshing = false;
            window.addEventListener('touchstart', e => {
                if (window.scrollY === 0 && e.touches.length === 1) touchStartY = e.touches[0].clientY;
            });
            window.addEventListener('touchmove', e => {
                if (window.scrollY === 0 && !refreshing) {
                    const dy = e.touches[0].clientY - touchStartY;
                    if (dy > 80) {
                        refreshing = true;
                        this.refreshMarketData().finally(() => { refreshing = false; });
                    }
                }
            });
        }
    }

    async initEventListeners() {
        // existing handlers...
        // call mobile helpers
        this.attachMobileHelpers();
    }

    setLoading(isLoading) {
        const btn = document.getElementById('refreshBtn');
        if (btn) btn.disabled = !!isLoading;
        const last = document.getElementById('lastUpdated');
        if (last && !isLoading) last.textContent = 'Last update: ' + new Date().toLocaleString();
        if (last && isLoading) last.textContent = 'Updating...';
    }

    async refreshMarketData() {
        try {
            this.setLoading(true);
            const indices = await fetchIndices();
            this.marketData.indices = indices;
            // update UI badges if present
            const nifty = indices.find(i => /NSEI|\^NSEI/i.test(i.symbol));
            const bank = indices.find(i => /NSEBANK|\^NSEBANK/i.test(i.symbol));
            const sensex = indices.find(i => /BSESN|\^BSESN/i.test(i.symbol));
            if (nifty && document.getElementById('nifty50')) document.getElementById('nifty50').textContent = formatIndianCurrency(nifty.price);
            if (bank && document.getElementById('bankNifty')) document.getElementById('bankNifty').textContent = formatIndianCurrency(bank.price);
            if (sensex && document.getElementById('sensex')) document.getElementById('sensex').textContent = formatIndianCurrency(sensex.price);

            // top movers
            const movers = await fetchTopMovers();
            this.marketData.movers = movers;

            // simple breadth ratio: using gainers/losers length
            const adv = (movers.gainers || []).length;
            const dec = (movers.losers || []).length;
            const ratio = dec === 0 ? adv : adv / Math.max(1, dec);
            this.marketData.breadthRatio = ratio;
            if (document.getElementById('breadthSentiment')) {
                const el = document.getElementById('breadthSentiment');
                const text = ratio >= 1.3 ? 'Bullish' : ratio >= 0.67 ? 'Neutral' : 'Bearish';
                el.textContent = text;
            }

            // render gauge if available
            try { renderMarketBreadthGauge('breadthGauge', ratio); } catch (e) { /* ignore */ }

            // render top sectors if data provided (placeholder)
            if (this.settings.sectorPerformance && document.getElementById('sectorPerf')) {
                renderSectorPerformance('sectorPerf', this.settings.sectorPerformance);
            }

            // update market status and countdown
            try {
                const statusEl = document.getElementById('marketStatus');
                const countdownEl = document.getElementById('marketCountdown');
                const open = isMarketOpen();
                if (statusEl) statusEl.textContent = open ? 'Open' : 'Closed';
                if (countdownEl) countdownEl.textContent = getNextMarketOpen();
            } catch (e) { /* ignore */ }

            // update last updated
            const last = document.getElementById('lastUpdated');
            if (last) last.textContent = 'Last update: ' + new Date().toLocaleString();
        } catch (err) {
            console.error('refreshMarketData error', err);
            // user feedback
            alertManager.showInAppAlert('error', 'Failed to refresh market data. Check internet connection.');
            // hide news section if indices fetch failed
            const newsCard = document.querySelector('.card-header.d-flex');
            if (newsCard) newsCard.parentElement.style.display = 'none';
        } finally {
            this.setLoading(false);
        }
    }

    async scanForSignals(symbols) {
        const results = [];
        if (!symbols || symbols.length === 0) return results;
        const progressEl = document.getElementById('scanProgress');
        try {
            const tbody = document.querySelector('#signalsTable tbody');
            if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="text-center py-3"><div class="spinner-border" role="status"></div></td></tr>`;
            // fetch historical data first in batch and cache
            const allHist = {};
            for (const sym of symbols) {
                allHist[sym] = await fetchHistoricalData(sym, '3mo');
            }
            // delegate signal calc to worker
            await new Promise((resolve, reject) => {
                const worker = new Worker('./assets/js/signalWorker.js');
                worker.postMessage({ action: 'scan', symbols });
                worker.onmessage = evt => {
                    const data = evt.data;
                    if (data.action === 'scanResult') {
                        results.push(...data.results);
                        worker.terminate();
                        resolve();
                    }
                    if (data.action === 'error') {
                        worker.terminate();
                        reject(data.error);
                    }
                };
            });
            // progress complete
            if (progressEl) { progressEl.style.width = '100%'; progressEl.textContent = '100%'; }

            // filter high confidence
            const filtered = filterHighQualitySignals(results).filter(s => (s.confidence || 0) >= 70);
            filtered.sort((a,b) => b.confidence - a.confidence);
            this.signals = filtered;
            saveSignals(this.signals);

            // update UI table
            this.renderSignalsTable();

            // notify if new high-confidence signals
            const newIds = new Set(this.signals.map(s => `${s.symbol}|${s.strategy}|${s.entry}`));
            const newOnes = Array.from(newIds).filter(id => !this.lastSignalIds.has(id));
            if (newOnes.length) {
                this.lastSignalIds = newIds;
                try {
                    if (window.Notification && Notification.permission === 'granted') {
                        newOnes.slice(0,3).forEach(n => new Notification('New high-confidence signal', { body: n }));
                    }
                } catch (e) { /* ignore */ }
            }

            return this.signals;
        } catch (err) {
            console.error('scanForSignals error', err);
            return [];
        } finally {
            if (progressEl) { progressEl.style.width = '0%'; progressEl.textContent = ''; }
        }
    }

    async updateWatchlist() {
        try {
            const list = loadWatchlist();
            this.watchlist = list;
            const tbody = document.querySelector('#watchlistTable tbody');
            if (!tbody) return;
            tbody.innerHTML = '';
            for (const sym of list) {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${sym}</td><td>--</td><td>--</td><td>--</td>`;
                tbody.appendChild(tr);
                // fetch price async and update row
                // fill row asynchronously later
                tbody.appendChild(tr);
            }
            // batch fetch prices for all symbols currently appended
            try {
                const prices = await fetchBatchStockPrice(list);
                prices.forEach((p,i) => {
                    const price = p.chart?.result?.[0]?.meta?.regularMarketPrice || 0;
                    const change = p.chart?.result?.[0]?.meta?.regularMarketChangePercent || '--';
                    const row = tbody.rows[i];
                    if (row) {
                        row.cells[1].textContent = price ? formatIndianCurrency(price) : '--';
                        row.cells[2].textContent = typeof change === 'number' ? change.toFixed(2) + '%' : '--';
                    }
                });
            } catch (e) {
                console.warn('batch price fetch failed', e);
                alertManager.showInAppAlert('error', 'Unable to fetch latest prices for watchlist.');
            }

            }
        } catch (err) {
            console.error('updateWatchlist error', err);
            alertManager.showInAppAlert('error', 'Failed to update watchlist data. Try again later.');
        }
    }

    checkMarketHours() {
        try {
            // IST offset +5:30
            const now = new Date();
            const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds());
            const ist = new Date(utc + (5.5 * 60 * 60 * 1000));
            const day = ist.getDay(); // 0 = Sun, 6 = Sat
            if (day === 0 || day === 6) return false;
            const hours = ist.getHours();
            const minutes = ist.getMinutes();
            const t = hours * 60 + minutes;
            const start = 9 * 60 + 15; // 9:15
            const end = 15 * 60 + 30; // 15:30
            // check holidays configured in settings
            const holidays = (this.settings.marketHolidays || []).map(d => new Date(d).toDateString());
            if (holidays.includes(ist.toDateString())) return false;
            return t >= start && t <= end;
        } catch (err) {
            console.error('checkMarketHours error', err);
            return false;
        }
    }

    setupAutoRefresh() {
        if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);
        const marketOpen = isMarketOpen();
        const interval = marketOpen ? (5 * 60 * 1000) : (30 * 60 * 1000);
        this.autoRefreshInterval = setInterval(async () => {
            if (!isMarketOpen()) {
                // still refresh for news
                await this.refreshMarketData();
                await this.updateWatchlist();
            } else {
                await this.refreshMarketData();
                await this.updateWatchlist();
                if (this.watchlist.length) await this.scanForSignals(this.watchlist);
            }
        }, interval);
    }

    initEventListeners() {
        const btn = document.getElementById('refreshBtn');
        if (btn) btn.addEventListener('click', async () => {
            await this.refreshMarketData();
            await this.updateWatchlist();
        });
        // news filter buttons
        document.querySelectorAll('.btn-group [data-filter]').forEach(b => b.addEventListener('click', async e => {
            document.querySelectorAll('.btn-group [data-filter]').forEach(x => x.classList.remove('active'));
            e.target.classList.add('active');
            const filter = e.target.dataset.filter;
            try {
                const news = await fetchMarketNews();
                this.renderNews(news, filter);
            } catch (err) {
                console.warn('news fetch failed', err);
                import('./alerts.js').then(m=>m.alertManager.showInAppAlert('error', 'Could not load market news'));
            }
        }));
    }

    renderDashboard() {
        // signals table
        this.renderSignalsTable();
        // watchlist
        this.updateWatchlist();
        // news
        fetchMarketNews().then(news => this.renderNews(news, 'all')).catch(e=>{
            console.warn('news fetch failed', e);
            import('./alerts.js').then(m=>m.alertManager.showInAppAlert('error', 'Could not load market news'));            
        });
        // signal distribution pie
        try { renderSignalDistribution('signalDist', this.signals); } catch (e) { /* ignore */ }
    }

    renderSignalsTable() {
        const tbody = document.querySelector('#signalsTable tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (!this.signals || this.signals.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center py-3">No signals</td></tr>';
            return;
        }
        this.signals.slice(0, 100).forEach(s => {
            const row = document.createElement('tr');
            row.innerHTML = `<td>${s.symbol}</td><td>${s.strategy}</td><td>${formatIndianCurrency(s.entry)}</td><td>${formatIndianCurrency(s.stopLoss)}</td><td>${formatIndianCurrency(s.target)}</td><td>${s.riskReward || '--'}</td><td>${s.confidence || 0}%</td><td><button class="btn btn-sm btn-primary">Add</button></td>`;
            tbody.appendChild(row);
        });
    }

    renderNews(news, filter) {
        const list = document.getElementById('newsList');
        if (!list) return;
        const ul = list.querySelector('ul');
        if (!ul) return;
        ul.innerHTML = '';
        const items = (news || []).slice(0, 50).filter(n => {
            if (filter === 'watchlist') return (n.relatedStocks || []).some(s => this.watchlist.includes(s));
            if (filter === 'market') return true;
            return true;
        });
        if (items.length === 0) ul.innerHTML = '<li class="list-group-item text-center py-3">No news</li>';
        items.slice(0,20).forEach(n => {
            const li = document.createElement('li');
            li.className = 'list-group-item';
            li.innerHTML = `<a href="${n.link}" target="_blank">${n.headline || n.title || 'News'}</a><br/><small class="text-muted">${n.timestamp ? new Date(n.timestamp).toLocaleString() : ''}</small>`;
            ul.appendChild(li);
        });
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    const app = new SwingTraderApp();
    app.init().catch(err => console.error('App init failed', err));
});

export default SwingTraderApp;
// Main application logic for Swing Trader India

function updateTimestamp() {
    const elem = document.getElementById('lastUpdated');
    if (elem) elem.textContent = 'Last update: ' + new Date().toLocaleString();
}

async function loadDashboard() {
    // placeholder: actual data population to be implemented
    updateTimestamp();
    // remove spinners if any by clearing tables
    const signalsBody = document.querySelector('#signalsTable tbody');
    if (signalsBody) signalsBody.innerHTML = '<tr><td colspan="8" class="text-center py-3">No signals</td></tr>';
    const watchBody = document.querySelector('#watchlistTable tbody');
    if (watchBody) watchBody.innerHTML = '<tr><td colspan="4" class="text-center py-3">No items</td></tr>';
    const newsList = document.querySelector('#newsList ul');
    if (newsList) newsList.innerHTML = '<li class="list-group-item text-center py-3">No news</li>';
}

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('refreshBtn');
    if (btn) btn.addEventListener('click', loadDashboard);
    loadDashboard();
});

console.log('App initialized');
