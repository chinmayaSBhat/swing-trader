// News aggregation and event detection for Indian market

// basic sentiment analysis using keywords
const positiveWords = ['profit','growth','bullish','upgrade','beat','surge','strong','record'];
const negativeWords = ['loss','decline','bearish','downgrade','miss','plunge','weak','fall'];

function analyzeSentiment(text) {
    if (!text) return 0;
    text = text.toLowerCase();
    let score = 0;
    positiveWords.forEach(w => { if (text.includes(w)) score += 1; });
    negativeWords.forEach(w => { if (text.includes(w)) score -= 1; });
    // normalize to -1..1
    if (score > 0) return Math.min(1, score / positiveWords.length);
    if (score < 0) return Math.max(-1, score / negativeWords.length);
    return 0;
}

async function fetchRSS(url) {
    try {
        const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
        // use retry helper from api module to handle timeouts
        const { fetchWithRetry } = await import('./api.js');
        const resp = await fetchWithRetry(proxy, {}, 2, 500);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'application/xml');
        const items = Array.from(xml.querySelectorAll('item')).map(i => ({
            headline: i.querySelector('title')?.textContent,
            link: i.querySelector('link')?.textContent,
            summary: i.querySelector('description')?.textContent,
            timestamp: new Date(i.querySelector('pubDate')?.textContent),
            source: url
        }));
        return items;
    } catch (e) {
        console.warn('fetchRSS failed for', url, e);
        return [];
    }
}

async function fetchMarketNews() {
    const feeds = [
        'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
        'https://www.moneycontrol.com/rss/feeder/MCtopnews.xml',
        'https://news.google.com/rss/search?q=Indian+stock+market',
        'https://www.nseindia.com/rss/announcements' // hypothetical
    ];
    let all = [];
    for (const f of feeds) {
        try {
            const items = await fetchRSS(f);
            all = all.concat(items);
        } catch (e) {
            console.warn('failed feed', f, e);
        }
    }
    // notify if nothing was retrieved
    if (!all.length) {
        try { window.dispatchEvent(new Event('newsFetchEmpty')); } catch {};
    }
    // post-process add sentiment, impact dummy, relatedStocks empty
    return all.map(item => ({
        ...item,
        relatedStocks: [],
        sentiment: analyzeSentiment(item.headline + ' ' + item.summary),
        impact: 'medium'
    }));
}

async function detectKeyEvents(symbol) {
    // placeholder: real scraping would be needed
    // returning empty list for now
    return [];
}

export { fetchMarketNews, detectKeyEvents, analyzeSentiment };
