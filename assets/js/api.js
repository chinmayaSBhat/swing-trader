// API handlers with retry, rate limiting and CORS proxy support

const API = (() => {
    const MAX_REQUESTS_PER_SECOND = 5;
    const stats = { success:0, failure:0, total:0 };
    function logResult(success) {
        stats.total++;
        if (success) stats.success++;
        else stats.failure++;
        console.log('API stats', stats);
    }
    const proxyPrefix = url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;

    // simple rate limiter using token bucket
    let tokens = MAX_REQUESTS_PER_SECOND;
    setInterval(() => { tokens = MAX_REQUESTS_PER_SECOND; }, 1000);

    async function rateLimitedFetch(url, options = {}) {
        while (tokens <= 0) {
            await new Promise(r => setTimeout(r, 100));
        }
        tokens--;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeout);
            return response;
        } catch (err) {
            if (err.name === 'AbortError') {
                const e = new Error('Request timed out');
                e.code = 'TIMEOUT';
                throw e;
            }
            throw err;
        }
    }

    async function fetchWithRetry(url, options = {}, retries = 3, backoff = 500) {
        try {
            const response = await rateLimitedFetch(url, options);
            if (!response.ok) {
                // handle rate limit (e.g. 429)
                if (response.status === 429) {
                    const err = new Error('Rate limited');
                    err.code = 'RATE_LIMIT';
                    throw err;
                }
                throw new Error(`HTTP ${response.status}`);
            }
            logResult(true);
            return response;
        } catch (err) {
            logResult(false);
            const shouldRetry = err.code === 'TIMEOUT' || err.code === 'RATE_LIMIT' || retries > 0;
            if (shouldRetry && retries > 0) {
                // dispatch an event so UI can show a retry notification
                try {
                    window.dispatchEvent(new CustomEvent('apiRetry', { detail: { url, reason: err.code || err.message, retriesLeft: retries } }));
                } catch (_) {}
                await new Promise(r => setTimeout(r, backoff));
                return fetchWithRetry(url, options, retries - 1, backoff * 2);
            }
            throw err;
        }
    }

    // request queue and batching
    const priceQueue = [];
    let queueTimer = null;

    function processPriceQueue() {
        if (priceQueue.length === 0) return;
        const batch = priceQueue.splice(0, 5); // up to 5 at a time
        Promise.all(batch.map(item => rateLimitedFetch(item.url)
            .then(r=>r.json())
            .then(data=>item.resolve(data))
            .catch(err=>{
                // try retry with backoff
                return new Promise((res,rej)=>{
                    setTimeout(()=>rateLimitedFetch(item.url).then(r=>r.json()).then(res).catch(rej), 500);
                });
            })
        )).finally(() => {
            if (priceQueue.length) queueTimer = setTimeout(processPriceQueue, 1000);
        });
    }

    // helper to append .NS or .BO if missing
    function normalizeSymbol(symbol) {
        if (!/\.(NS|BO)$/i.test(symbol)) {
            return `${symbol}.NS`;
        }
        return symbol;
    }

    async function fetchStockPrice(symbol) {
        if (!symbol || typeof symbol !== 'string' || !/^[A-Za-z0-9\.]+$/.test(symbol)) {
            const err = new Error('Invalid symbol'); err.code = 'INVALID_SYMBOL';
            throw err;
        }
        symbol = normalizeSymbol(symbol);
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
        const proxied = proxyPrefix(url);
        let res;
        try {
            res = await fetchWithRetry(proxied);
        } catch (err) {
            console.error('fetchStockPrice error', err);
            if (err.code === 'RATE_LIMIT' || err.code === 'TIMEOUT') throw err;
            if (err.message && err.message.includes('404')) {
                const e = new Error('Stock not found');
                e.code = 'NOT_FOUND';
                throw e;
            }
            throw err;
        }
        const data = await res.json();
        if (!data || !data.chart || !data.chart.result || !data.chart.result[0]) {
            const e = new Error('Invalid response data');
            e.code = 'INVALID_RESPONSE';
            throw e;
        }
        const price = data.chart.result[0].meta?.regularMarketPrice;
        return { symbol, price, raw: data };
    }

    // batch price fetch using internal queue
    function fetchBatchStockPrice(symbols) {
        return Promise.all(symbols.map(sym => new Promise((resolve, reject) => {
            const n = normalizeSymbol(sym);
            const url = proxyPrefix(`https://query1.finance.yahoo.com/v8/finance/chart/${n}`);
            priceQueue.push({ url, resolve, reject });
            if (!queueTimer) queueTimer = setTimeout(processPriceQueue, 0);
        })));
    }

    // caching with storage.js (TTL 24h)
    async function fetchHistoricalData(symbol, period = '1mo') {
        if (!symbol || typeof symbol !== 'string' || !/^[A-Za-z0-9\.]+$/.test(symbol)) {
            const err = new Error('Invalid symbol'); err.code = 'INVALID_SYMBOL';
            throw err;
        }
        symbol = normalizeSymbol(symbol);
        // attempt load from cache first
        try {
            const { loadHistorical, saveHistorical } = await import('./storage.js');
            const cached = await loadHistorical(symbol);
            if (cached && cached.length) {
                // if today's date not present or period changed, refresh
                const today = new Date().toISOString().split('T')[0];
                if (cached[cached.length-1].date === today) {
                    return cached;
                }
            }
        } catch (e) {
            // ignore cache errors
        }
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${period}&interval=1d`;
        const proxied = proxyPrefix(url);
        let res;
        try {
            res = await fetchWithRetry(proxied);
        } catch (err) {
            // invalid symbol? network?
            console.error('fetchHistoricalData error', err);
            if (err.code === 'RATE_LIMIT') throw err;
            if (err.message && err.message.includes('404')) {
                const e = new Error('Stock not found');
                e.code = 'NOT_FOUND';
                throw e;
            }
            throw err;
        }
        const json = await res.json();
        if (!json || json.chart?.error) {
            const err = new Error('Invalid historical data');
            err.code = 'INVALID_RESPONSE';
            throw err;
        }
        const result = json.chart?.result?.[0];
        if (!result) return [];
        const { timestamp, indicators } = result;
        const quotes = indicators.quote?.[0];
        if (!timestamp || !quotes) return [];
        const output = timestamp.map((t, i) => ({
            date: new Date(t * 1000).toISOString().split('T')[0],
            open: quotes.open[i],
            high: quotes.high[i],
            low: quotes.low[i],
            close: quotes.close[i],
            volume: quotes.volume[i]
        }));
        // save
        try {
            const { saveHistorical } = await import('./storage.js');
            saveHistorical(symbol, output);
        } catch (e) {}
        return output;
    }

    async function fetchIndices() {
        const symbols = ['^NSEI', '^NSEBANK', '^BSESN'];
        const promises = symbols.map(s => fetchStockPrice(s));
        const results = await Promise.all(promises);
        return results;
    }

    async function fetchTopMovers() {
        const endpoints = {
            gainers: 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?count=10&scrIds=day_gainers',
            losers: 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?count=10&scrIds=day_losers'
        };
        const [gRes, lRes] = await Promise.all([
            fetchWithRetry(proxyPrefix(endpoints.gainers)),
            fetchWithRetry(proxyPrefix(endpoints.losers))
        ]);
        const gainers = await gRes.json();
        const losers = await lRes.json();
        const parse = obj => obj?.finance?.result?.[0]?.quotes || [];
        return {
            gainers: parse(gainers),
            losers: parse(losers)
        };
    }

    async function fetchStockNews(symbol) {
        symbol = normalizeSymbol(symbol).replace(/\.NS$/i, '');
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(symbol + ' stock')}`;
        const proxied = proxyPrefix(url);
        const res = await fetchWithRetry(proxied);
        const text = await res.text();
        // simple RSS parsing (DOMParser may not be available in node)
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'application/xml');
        const items = Array.from(xml.querySelectorAll('item')).map(i => ({
            title: i.querySelector('title')?.textContent,
            link: i.querySelector('link')?.textContent,
            pubDate: i.querySelector('pubDate')?.textContent
        }));
        return items;
    }

    return {
        fetchStockPrice,
        fetchHistoricalData,
        fetchIndices,
        fetchTopMovers,
        fetchStockNews,
        // make lower-level utilities available for other modules
        fetchWithRetry
    };
})();

// expose API
const {
    fetchStockPrice,
    fetchHistoricalData,
    fetchIndices,
    fetchTopMovers,
    fetchStockNews,
    fetchWithRetry
} = API;

export {
    fetchStockPrice,
    fetchHistoricalData,
    fetchIndices,
    fetchTopMovers,
    fetchStockNews,
    fetchWithRetry
};
