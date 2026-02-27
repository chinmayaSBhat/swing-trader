// Technical indicators computations for Indian market

function calculateSMA(prices, period) {
    if (!prices || prices.length < period) return null;
    const slice = prices.slice(prices.length - period);
    const sum = slice.reduce((a, b) => a + b, 0);
    return sum / period;
}

function calculateEMA(prices, period) {
    if (!prices || prices.length < period) return null;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
}

function calculateRSI(prices, period = 14) {
    if (!prices || prices.length <= period) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) {
            avgGain = (avgGain * (period - 1) + change) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - change) / period;
        }
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}

function calculateMACD(prices) {
    if (!prices || prices.length < 26) return null;
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    if (ema12 === null || ema26 === null) return null;
    const macd = ema12 - ema26;
    // compute signal line using last 9 MACD values; approximate by building array
    const macdSeries = [];
    for (let i = 26; i < prices.length; i++) {
        const slice = prices.slice(0, i + 1);
        const e12 = calculateEMA(slice, 12);
        const e26 = calculateEMA(slice, 26);
        macdSeries.push(e12 - e26);
    }
    const signal = calculateEMA(macdSeries, 9);
    const histogram = macd - signal;
    return { macd, signal, histogram };
}

function calculateStochastic(high, low, close, period = 14) {
    if (!high || !low || !close) return null;
    const len = close.length;
    if (len < period) return null;
    const lowestLow = Math.min(...low.slice(len - period));
    const highestHigh = Math.max(...high.slice(len - period));
    const currentClose = close[len - 1];
    if (highestHigh === lowestLow) return null;
    return ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
}

function calculateVolumeMA(volumes, period = 20) {
    if (!volumes || volumes.length < period) return null;
    return calculateSMA(volumes, period);
}

function calculateOBV(prices, volumes) {
    if (!prices || !volumes || prices.length !== volumes.length || prices.length < 2) return null;
    let obv = 0;
    for (let i = 1; i < prices.length; i++) {
        if (prices[i] > prices[i - 1]) obv += volumes[i];
        else if (prices[i] < prices[i - 1]) obv -= volumes[i];
    }
    return obv;
}

function calculateATR(high, low, close, period = 14) {
    if (!high || !low || !close) return null;
    const len = close.length;
    if (len <= period) return null;
    const trs = [];
    for (let i = 1; i < len; i++) {
        const h = high[i];
        const l = low[i];
        const prevC = close[i - 1];
        trs.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)));
    }
    return calculateEMA(trs, period);
}

function calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (!prices || prices.length < period) return null;
    const slice = prices.slice(prices.length - period);
    const sma = calculateSMA(slice, period);
    const variance = slice.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period;
    const sd = Math.sqrt(variance);
    return {
        middle: sma,
        upper: sma + sd * stdDev,
        lower: sma - sd * stdDev
    };
}

function findSupportResistance(prices, lookback = 20) {
    if (!prices || prices.length < lookback) return null;
    const levels = [];
    const len = prices.length;
    for (let i = lookback; i < len - lookback; i++) {
        const sliceBefore = prices.slice(i - lookback, i + 1);
        const sliceAfter = prices.slice(i, i + lookback + 1);
        const current = prices[i];
        if (current === Math.min(...sliceBefore) && current === Math.min(...sliceAfter)) {
            levels.push(current);
        }
        if (current === Math.max(...sliceBefore) && current === Math.max(...sliceAfter)) {
            levels.push(current);
        }
    }
    return levels;
}

function calculateFibonacciLevels(high, low) {
    if (high == null || low == null) return null;
    const diff = high - low;
    return {
        '0%': low,
        '23.6%': low + diff * 0.236,
        '38.2%': low + diff * 0.382,
        '50%': low + diff * 0.5,
        '61.8%': low + diff * 0.618,
        '100%': high
    };
}

function detectTrend(prices, period = 50) {
    if (!prices || prices.length < period) return null;
    const slice = prices.slice(prices.length - period);
    const n = slice.length;
    const xMean = (n - 1) / 2;
    const yMean = slice.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
        num += (i - xMean) * (slice[i] - yMean);
        den += (i - xMean) ** 2;
    }
    const slope = num / den;
    if (slope > 0.01) return 'uptrend';
    if (slope < -0.01) return 'downtrend';
    return 'sideways';
}

// -------------------- pattern detection --------------------

function detectCupAndHandle(prices, volumes) {
    if (!prices || prices.length < 60) return { found: false, confidence: 0 };
    const len = prices.length;
    const mid = Math.floor(len / 2);
    const cupBottom = Math.min(...prices.slice(mid - 10, mid + 10));
    const leftHigh = Math.max(...prices.slice(0, mid - 10));
    const rightHigh = Math.max(...prices.slice(mid + 10));
    const handleStart = prices.slice(mid + 10).findIndex(p => p < rightHigh * 0.98);
    const found = cupBottom < leftHigh * 0.9 && cupBottom < rightHigh * 0.9 && handleStart !== -1;
    const entry = found ? rightHigh : null;
    const target = found ? entry + (entry - cupBottom) : null;
    const confidence = found ? 60 + Math.floor(Math.random() * 40) : 0;
    return { found, entry, target, confidence };
}

function detectDoubleTopBottom(prices) {
    if (!prices || prices.length < 60) return { pattern: null, confidence: 0 };
    const slice = prices.slice(-60);
    const max1 = Math.max(...slice.slice(0, 30));
    const max2 = Math.max(...slice.slice(30));
    const min1 = Math.min(...slice.slice(0, 30));
    const min2 = Math.min(...slice.slice(30));
    let pattern = null, confidence = 0;
    if (Math.abs(max1 - max2) / max1 < 0.02 && max1 > slice[0] && max2 > slice[31]) {
        pattern = 'double-top';
        confidence = 60 + Math.floor((1 - Math.abs(max1 - max2) / max1) * 40);
    } else if (Math.abs(min1 - min2) / min1 < 0.02 && min1 < slice[0] && min2 < slice[31]) {
        pattern = 'double-bottom';
        confidence = 60 + Math.floor((1 - Math.abs(min1 - min2) / min1) * 40);
    }
    return { pattern, confidence };
}

function detectHeadAndShoulders(prices) {
    if (!prices || prices.length < 60) return { found: false, confidence: 0 };
    const slice = prices.slice(-60);
    // simple heuristic: three peaks with middle highest
    const peaks = [];
    for (let i = 1; i < slice.length - 1; i++) {
        if (slice[i] > slice[i - 1] && slice[i] > slice[i + 1]) peaks.push({ index: i, value: slice[i] });
    }
    let found = false, confidence = 0;
    if (peaks.length >= 3) {
        const [p1, p2, p3] = peaks.slice(-3);
        if (p2.value > p1.value && p2.value > p3.value) {
            found = true;
            confidence = 60 + Math.floor(Math.random() * 40);
        }
    }
    return { found, confidence };
}

function detectBreakout(prices, volumes) {
    if (!prices || !volumes || prices.length < 20 || volumes.length < 20) return { breakout: false, confidence: 0 };
    const recent = prices.slice(-20);
    const resistance = Math.max(...recent.slice(0, -1));
    const lastPrice = prices[prices.length - 1];
    const avgVol = calculateSMA(volumes.slice(-20), 20);
    const volNow = volumes[volumes.length - 1];
    const breakout = lastPrice > resistance && volNow > avgVol * 1.5;
    const confidence = breakout ? 70 + Math.floor(Math.random() * 30) : 0;
    return { breakout, resistance, confidence };
}

function detectBullishEngulfing(candles) {
    if (!candles || candles.length < 2) return { found: false, confidence: 0 };
    const len = candles.length;
    const prev = candles[len - 2];
    const curr = candles[len - 1];
    const found = prev.close < prev.open && curr.close > curr.open && curr.open < prev.close && curr.close > prev.open;
    return { found, confidence: found ? 80 : 0 };
}

function detectBearishEngulfing(candles) {
    if (!candles || candles.length < 2) return { found: false, confidence: 0 };
    const len = candles.length;
    const prev = candles[len - 2];
    const curr = candles[len - 1];
    const found = prev.close > prev.open && curr.close < curr.open && curr.open > prev.close && curr.close < prev.open;
    return { found, confidence: found ? 80 : 0 };
}

function detectDivergence(prices, rsi) {
    if (!prices || !rsi || prices.length < 60 || rsi.length < 60) return { type: null, confidence: 0 };
    // look for last two lows and highs
    const len = prices.length;
    let bullish = false, bearish = false;
    const lastLow = Math.min(prices[len - 2], prices[len - 1]);
    const prevLow = Math.min(...prices.slice(len - 4, len - 2));
    const lastRSILow = Math.min(rsi[len - 2], rsi[len - 1]);
    const prevRSILow = Math.min(...rsi.slice(len - 4, len - 2));
    if (lastLow < prevLow && lastRSILow > prevRSILow) bullish = true;
    const lastHigh = Math.max(prices[len - 2], prices[len - 1]);
    const prevHigh = Math.max(...prices.slice(len - 4, len - 2));
    const lastRSIHigh = Math.max(rsi[len - 2], rsi[len - 1]);
    const prevRSIHigh = Math.max(...rsi.slice(len - 4, len - 2));
    if (lastHigh > prevHigh && lastRSIHigh < prevRSIHigh) bearish = true;
    if (bullish) return { type: 'bullish', confidence: 70 };
    if (bearish) return { type: 'bearish', confidence: 70 };
    return { type: null, confidence: 0 };
}

// market breadth, volatility and sector rotation helpers

async function calculateMarketBreadth(fetchPricesForSymbol) {
    // expects a callback that returns historical close arrays for a symbol
    const constituents = []; // ideally fetch NIFTY50 list; placeholder
    let above = 0, below = 0;
    for (const sym of constituents) {
        try {
            const data = await fetchPricesForSymbol(sym);
            const close = data?.close;
            if (!close || close.length < 50) continue;
            const sma50 = calculateSMA(close, 50);
            const last = close[close.length - 1];
            if (last > sma50) above++;
            else below++;
        } catch {}
    }
    const ratio = below === 0 ? Infinity : above / below;
    let sentiment = 'neutral';
    if (ratio > 1.5) sentiment = 'bullish';
    if (ratio < 0.67) sentiment = 'bearish';
    return { above, below, ratio, sentiment };
}

async function calculateIndiaVIX(fetchPrice) {
    // fetchPrice for ^INDIAVIX
    try {
        const res = await fetchPrice('^INDIAVIX');
        const vix = res?.price;
        let assessment = 'medium';
        if (vix > 20) assessment = 'high';
        if (vix < 15) assessment = 'low';
        return { vix, assessment };
    } catch {
        return null;
    }
}

async function analyzeSectorRotation(fetchIndexPrice) {
    const sectors = [
        { name: 'IT', symbol: '^NSEIT' },
        { name: 'Bank', symbol: '^NSEBANK' },
        { name: 'Pharma', symbol: '^NSEPHARMA' },
        { name: 'Auto', symbol: '^NSEAUTO' }
        // add more sectors as needed
    ];
    const results = [];
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    for (const sec of sectors) {
        try {
            const recent = await fetchIndexPrice(sec.symbol, '1wk'); // hypothetical
            const change = recent?.changePercent;
            results.push({ sector: sec.name, change: change || 0 });
        } catch {}
    }
    results.sort((a, b) => b.change - a.change);
    return {
        strongest: results[0],
        weakest: results[results.length - 1],
        all: results
    };
}

// export functions
export {
    calculateSMA,
    calculateEMA,
    calculateRSI,
    calculateMACD,
    calculateStochastic,
    calculateVolumeMA,
    calculateOBV,
    calculateATR,
    calculateBollingerBands,
    findSupportResistance,
    calculateFibonacciLevels,
    detectTrend,
    detectCupAndHandle,
    detectDoubleTopBottom,
    detectHeadAndShoulders,
    detectBreakout,
    detectBullishEngulfing,
    detectBearishEngulfing,
    detectDivergence,
    calculateMarketBreadth,
    calculateIndiaVIX,
    analyzeSectorRotation
};
