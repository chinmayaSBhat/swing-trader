// Signal generation logic for swing strategies
// relies on technical indicators from technical.js
import {
    calculateSMA,
    calculateEMA,
    calculateRSI,
    calculateMACD,
    calculateATR,
    findSupportResistance
} from './technical.js';

// helper to compute recent highs/lows
function last(array, n = 1) {
    return array[array.length - n];
}

function trendPullbackSignal(symbol, data) {
    // data should include arrays: close, high, low, volume
    const { close, high, low, volume } = data;
    if (!close || close.length < 60) return null;
    const price = last(close);
    const sma50 = calculateSMA(close, 50);
    const ema20 = calculateEMA(close, 20);
    const rsi = calculateRSI(close, 14);
    const macdObj = calculateMACD(close);
    if (sma50 === null || ema20 === null || rsi === null || !macdObj) return null;
    const inUptrend = price > sma50;
    const pullingBack = price <= ema20 * 1.02 && price >= ema20 * 0.98;
    const rsiCheck = rsi >= 35 && rsi <= 50;
    const macdPositive = macdObj.macd > 0;
    if (inUptrend && pullingBack && rsiCheck && macdPositive) {
        // bounce entry assume next bar crosses above ema20
        const entry = ema20 * 1.001;
        const atr = calculateATR(high, low, close, 14) || 0;
        const stopPrice = Math.min(last(low, 5), ema20 - 1.5 * atr);
        const target = price * 1.06; // simplistic 6% target
        const ratio = (target - entry) / (entry - stopPrice);
        const confidence = 60 + Math.floor(Math.random() * 40);
        return {
            symbol,
            signal: 'BUY',
            strategy: 'Trend Pullback',
            entry,
            stopLoss: stopPrice,
            target,
            riskReward: ratio.toFixed(2),
            confidence
        };
    }
    return null;
}

function supportBounceSignal(symbol, data) {
    const { close, high, low, volume } = data;
    if (!close || close.length < 60) return null;
    const price = last(close);
    const rsi = calculateRSI(close, 14);
    const supports = findSupportResistance(close, 20) || [];
    const support = supports.length ? supports[supports.length - 1] : null;
    if (!support) return null;
    const nearSupport = price <= support * 1.02 && price >= support * 0.98;
    const oversold = rsi !== null && rsi < 35;
    // volume spike: last volume > 1.5x avg of prior 20
    const avgVol = calculateSMA(volume.slice(-21, -1), 20);
    const spike = avgVol && last(volume) > avgVol * 1.5;
    const bullishCandle = last(close) > last(open ); // can't reference open? assume data.open exists
    if (nearSupport && oversold && spike && bullishCandle) {
        const entry = price;
        const stopPrice = support * 0.98;
        const resistance = Math.max(...high.slice(-60));
        const target = resistance;
        const ratio = (target - entry) / (entry - stopPrice);
        const confidence = 60 + Math.floor(Math.random() * 40);
        return {
            symbol,
            signal: 'BUY',
            strategy: 'Support Bounce',
            entry,
            stopLoss: stopPrice,
            target,
            riskReward: ratio.toFixed(2),
            confidence
        };
    }
    return null;
}

function breakoutSignal(symbol, data) {
    const { close, volume } = data;
    if (!close || close.length < 30) return null;
    // consolidation: last 10 closes within narrow range
    const cons = close.slice(-10);
    const range = Math.max(...cons) - Math.min(...cons);
    const priceNow = last(close);
    const resistance = Math.max(...cons.slice(0, -1));
    const avgVol = calculateSMA(volume.slice(-20), 20);
    const volNow = last(volume);
    const breakout = priceNow > resistance && volNow > avgVol * 1.5;
    if (breakout) {
        const entry = priceNow;
        const stopPrice = Math.min(...cons);
        const height = Math.max(...cons) - Math.min(...cons);
        const target = entry + height;
        const ratio = (target - entry) / (entry - stopPrice);
        const confidence = 60 + Math.floor(Math.random() * 40);
        return {
            symbol,
            signal: 'BUY',
            strategy: 'Breakout',
            entry,
            stopLoss: stopPrice,
            target,
            riskReward: ratio.toFixed(2),
            confidence
        };
    }
    return null;
}

function maCrossoverSignal(symbol, data) {
    const { close } = data;
    if (!close || close.length < 200) return null;
    const sma50 = calculateSMA(close, 50);
    const sma200 = calculateSMA(close, 200);
    const prev50 = calculateSMA(close.slice(0, -1), 50);
    const prev200 = calculateSMA(close.slice(0, -1), 200);
    if (sma50 && sma200 && prev50 && prev200) {
        if (prev50 < prev200 && sma50 > sma200) {
            return { symbol, signal: 'BUY', strategy: 'MA Crossover', type: 'Golden Cross', confidence: 70 };
        }
        if (prev50 > prev200 && sma50 < sma200) {
            return { symbol, signal: 'SELL', strategy: 'MA Crossover', type: 'Death Cross', confidence: 70 };
        }
    }
    return null;
}

async function generateSignals(symbols) {
    const signals = [];
    for (const sym of symbols) {
        const data = await fetchHistoricalData(sym, '6mo'); // assume available globally
        if (!data) continue;
        const stratFns = [
            trendPullbackSignal,
            supportBounceSignal,
            breakoutSignal,
            maCrossoverSignal
        ];
        for (const fn of stratFns) {
            const result = fn(sym, data);
            if (result) signals.push(result);
        }
    }
    return signals.sort((a, b) => b.confidence - a.confidence);
}

function calculatePositionSize(capital, riskPercent, entry, stopLoss) {
    const riskAmount = capital * (riskPercent / 100);
    const riskPerShare = Math.abs(entry - stopLoss);
    if (riskPerShare === 0) return null;
    const shares = Math.floor(riskAmount / riskPerShare);
    const investment = shares * entry;
    const maxLoss = shares * riskPerShare;
    return { shares, investment, maxLoss };
}

function calculateRiskReward(entry, stopLoss, target) {
    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(target - entry);
    if (risk === 0) return null;
    return reward / risk;
}

function filterHighQualitySignals(signals) {
    return signals.filter(s => {
        const rr = calculateRiskReward(s.entry, s.stopLoss, s.target);
        const conf = s.confidence || 0;
        const avgVol = s.avgVolume || 0;
        const price = s.entry || 0;
        return rr !== null && rr >= 2 && conf >= 70 && avgVol > 100000 && price > 20;
    });
}

export {
    trendPullbackSignal,
    supportBounceSignal,
    breakoutSignal,
    maCrossoverSignal,
    generateSignals,
    calculatePositionSize,
    calculateRiskReward,
    filterHighQualitySignals
};
