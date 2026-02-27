// TradingView Lightweight Charts wrappers
// expects Lightweight Charts lib loaded via CDN

import { calculateEMA, calculateSMA } from './technical.js';

function createChart(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    const chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight,
        layout: { backgroundColor: '#ffffff', textColor: '#000' },
        rightPriceScale: { visible: true },
        timeScale: { timeVisible: true, secondsVisible: false },
        handleScroll: {
            mouseWheel: true,
            pressedMouseMove: true,
            horzTouchDrag: true
        },
        handleScale: {
            axisPressedMouseMove: true,
            axisDoubleClickReset: true,
            pinch: true
        }
    });
    window.addEventListener('resize', () => {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });
    // adapt orientation
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
        }, 200);
    });
    return chart;
}

function renderPriceChart(containerId, symbol, data, signal) {
    // data: array of {time, open, high, low, close, volume}
    const chart = createChart(containerId);
    if (!chart) return;
    const candleSeries = chart.addCandlestickSeries();
    candleSeries.setData(data.map(d => ({
        time: d.time,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close
    })));

    // EMA and SMA
    const ema20 = calculateEMA(data.map(d=>d.close), 20);
    const sma50 = calculateSMA(data.map(d=>d.close), 50);
    // we will compute full series for overlays
    const emaData = [];
    const smaData = [];
    for (let i = 0; i < data.length; i++) {
        const slice = data.slice(0, i+1).map(d=>d.close);
        const vema = calculateEMA(slice, 20);
        const vsma = calculateSMA(slice, 50);
        if (vema != null) emaData.push({ time: data[i].time, value: vema });
        if (vsma != null) smaData.push({ time: data[i].time, value: vsma });
    }
    const emaSeries = chart.addLineSeries({ color: 'blue' });
    const smaSeries = chart.addLineSeries({ color: 'orange' });
    emaSeries.setData(emaData);
    smaSeries.setData(smaData);

    // volume
    const volumeChart = chart.addHistogramSeries({
        color: 'rgba(0, 0, 255, 0.3)',
        priceFormat: { type: 'volume' },
        scaleMargins: { top: 0.8, bottom: 0 }
    });
    volumeChart.setData(data.map(d=>({ time: d.time, value: d.volume, color: d.close >= d.open ? 'rgba(0,150,0,0.5)' : 'rgba(150,0,0,0.5)' })));    

    // support/resistance lines if provided in signal
    if (signal?.supportLevels) {
        signal.supportLevels.forEach(level => {
            chart.addLineSeries({ color: 'green' }).setData([{ time: data[0].time, value: level }, { time: data[data.length-1].time, value: level }]);
        });
    }
    if (signal?.resistanceLevels) {
        signal.resistanceLevels.forEach(level => {
            chart.addLineSeries({ color: 'red' }).setData([{ time: data[0].time, value: level }, { time: data[data.length-1].time, value: level }]);
        });
    }

    // entry/stop/target markers
    if (signal) {
        const markers = [];
        if (signal.entry) markers.push({ time: data[data.length-1].time, position: 'aboveBar', color: 'green', shape: 'arrowUp', text: 'Entry' });
        if (signal.stopLoss) markers.push({ time: data[data.length-1].time, position: 'belowBar', color: 'red', shape: 'arrowDown', text: 'Stop' });
        if (signal.target) markers.push({ time: data[data.length-1].time, position: 'aboveBar', color: 'blue', shape: 'arrowUp', text: 'Target' });
        candleSeries.setMarkers(markers);
    }

    // legend (simple overlay div)
    const legend = document.createElement('div');
    legend.className = 'chart-legend';
    legend.style.position = 'absolute';
    legend.style.top = '5px';
    legend.style.left = '5px';
    legend.style.background = 'rgba(255,255,255,0.8)';
    legend.style.padding = '2px 5px';
    legend.textContent = `${symbol} ${data[data.length-1].close}`;
    const container = document.getElementById(containerId);
    if (window.innerWidth < 576) {
        // hide legend until tapped on mobile
        legend.style.display = 'none';
        container.addEventListener('click', () => {
            legend.style.display = legend.style.display === 'none' ? 'block' : 'none';
        });
    }
    container.appendChild(legend);
}

function renderIndicatorChart(containerId, symbol, indicator, data) {
    const chart = createChart(containerId);
    if (!chart) return;
    if (indicator === 'RSI') {
        const line = chart.addLineSeries({ color: 'purple' });
        line.setData(data.map(d=>({ time:d.time, value:d.value })));
        chart.addLineSeries({ color:'red', lineWidth:1 }).setData(data.map(d=>({ time:d.time, value:70 })));        
        chart.addLineSeries({ color:'green', lineWidth:1 }).setData(data.map(d=>({ time:d.time, value:30 })));        
    }
    if (indicator === 'MACD') {
        const hist = chart.addHistogramSeries({ color: 'grey', priceFormat:{type:'volume'} });
        hist.setData(data.map(d=>({ time:d.time, value:d.hist }))); // fixed parentheses
        const macdLine = chart.addLineSeries({ color: 'blue' });
        macdLine.setData(data.map(d=>({ time:d.time, value:d.macd }))); // fixed
        const sigLine = chart.addLineSeries({ color: 'red' });
        sigLine.setData(data.map(d=>({ time:d.time, value:d.signal }))); // fixed
    }
}

function renderMiniChart(containerId, symbol, data) {
    const chart = createChart(containerId);
    if (!chart) return;
    const line = chart.addLineSeries({ color: '#2196f3', lineWidth: 2 });
    line.setData(data.map(d=>({ time:d.time, value:d.close })));
}


export { renderPriceChart, renderIndicatorChart, renderMiniChart };

// Helper to dynamically load Chart.js if not present
async function ensureChartJS() {
    if (window.Chart) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
        s.async = true;
        s.onload = () => resolve();
        s.onerror = (e) => reject(new Error('Failed to load Chart.js'));
        document.head.appendChild(s);
    });
}

function clearContainer(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return null;
    el.innerHTML = '';
    el.style.position = 'relative';
    return el;
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function renderMarketBreadthGauge(containerId, advanceDeclineRatio) {
    const el = clearContainer(containerId);
    if (!el) return;
    const width = el.clientWidth || 400;
    const height = Math.max(120, Math.floor(width / 3));
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.style.display = 'block';

    // semicircle parameters
    const cx = width / 2;
    const cy = height * 0.9;
    const r = Math.min(width * 0.4, height * 0.8);
    const startAngle = Math.PI; // 180deg
    const endAngle = 0; // 0deg

    // mapping ratio to 0..1 across domain 0..2.0
    const maxRatio = 2.0;
    const ratio = clamp(advanceDeclineRatio || 0, 0, maxRatio) / maxRatio;

    // helper to draw arc for a normalized segment [t0,t1]
    function arcPath(t0, t1) {
        const a0 = startAngle + (endAngle - startAngle) * t0;
        const a1 = startAngle + (endAngle - startAngle) * t1;
        const x0 = cx + r * Math.cos(a0);
        const y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1);
        const y1 = cy + r * Math.sin(a1);
        const large = 0; // semicircle pieces < 180deg
        return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    }

    // zones: [0,0.67],[0.67,1.3],[1.3,2.0]
    const z0 = 0 / maxRatio;
    const z1 = 0.67 / maxRatio;
    const z2 = 1.3 / maxRatio;
    const z3 = 1.0; // normalized end

    const zones = [ { t0:z0, t1:z1, color:'rgba(220,53,69,0.9)' }, // red
                    { t0:z1, t1:z2, color:'rgba(255,193,7,0.95)' }, // yellow
                    { t0:z2, t1:z3, color:'rgba(40,167,69,0.95)' } ]; // green

    zones.forEach(z => {
        const p = document.createElementNS(svgNS, 'path');
        p.setAttribute('d', arcPath(z.t0, z.t1));
        p.setAttribute('stroke', z.color);
        p.setAttribute('stroke-width', Math.max(12, r * 0.12));
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke-linecap', 'butt');
        svg.appendChild(p);
    });

    // ticks and labels
    for (let i = 0; i <= 4; i++) {
        const t = i / 4; // normalized
        const a = startAngle + (endAngle - startAngle) * t;
        const x = cx + (r + 10) * Math.cos(a);
        const y = cy + (r + 10) * Math.sin(a);
        const tick = document.createElementNS(svgNS, 'line');
        const x0 = cx + (r - 6) * Math.cos(a);
        const y0 = cy + (r - 6) * Math.sin(a);
        tick.setAttribute('x1', x0);
        tick.setAttribute('y1', y0);
        tick.setAttribute('x2', x);
        tick.setAttribute('y2', y);
        tick.setAttribute('stroke', '#666');
        tick.setAttribute('stroke-width', 1);
        svg.appendChild(tick);
    }

    // needle
    const angle = startAngle + (endAngle - startAngle) * ratio;
    const nx = cx + (r - 18) * Math.cos(angle);
    const ny = cy + (r - 18) * Math.sin(angle);
    const needle = document.createElementNS(svgNS, 'line');
    needle.setAttribute('x1', cx);
    needle.setAttribute('y1', cy);
    needle.setAttribute('x2', nx);
    needle.setAttribute('y2', ny);
    needle.setAttribute('stroke', '#222');
    needle.setAttribute('stroke-width', 3);
    svg.appendChild(needle);

    // center dot
    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', cy);
    dot.setAttribute('r', 6);
    dot.setAttribute('fill', '#222');
    svg.appendChild(dot);

    // label
    const lbl = document.createElementNS(svgNS, 'text');
    lbl.setAttribute('x', cx);
    lbl.setAttribute('y', cy - r * 0.35);
    lbl.setAttribute('text-anchor', 'middle');
    lbl.setAttribute('font-size', Math.max(12, Math.floor(width/30)));
    lbl.setAttribute('fill', '#111');
    lbl.textContent = `Advance/Decline Ratio: ${advanceDeclineRatio != null ? advanceDeclineRatio.toFixed(2) : '--'}`;
    svg.appendChild(lbl);

    el.appendChild(svg);
}

async function renderSectorPerformance(containerId, sectorData) {
    const el = clearContainer(containerId);
    if (!el) return;
    await ensureChartJS();
    const dataArr = Array.isArray(sectorData) ? sectorData : Object.keys(sectorData||{}).map(k=>({ sector:k, changePercent: sectorData[k] }));
    // sort by performance descending
    dataArr.sort((a,b)=>b.changePercent - a.changePercent);
    const labels = dataArr.map(d=>d.sector);
    const values = dataArr.map(d=>d.changePercent);
    const colors = values.map(v => v >= 0 ? 'rgba(40,167,69,0.9)' : 'rgba(220,53,69,0.9)');
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = Math.max(120, labels.length * 28) + 'px';
    el.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    // create horizontal bar chart
    // eslint-disable-next-line no-undef
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{ data: values, backgroundColor: colors }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { callback: v => v + '%' }, grid: { color: 'rgba(0,0,0,0.05)' } },
                y: { grid: { display: false } }
            }
        }
    });
}

async function renderSignalDistribution(containerId, signals) {
    const el = clearContainer(containerId);
    if (!el) return;
    await ensureChartJS();
    const arr = Array.isArray(signals) ? signals : [];
    const counts = {};
    arr.forEach(s => { const key = s.strategy || s.type || 'Other'; counts[key] = (counts[key]||0) + 1; });
    const labels = Object.keys(counts);
    const values = labels.map(l => counts[l]);
    const palette = [ '#2ecc71', '#3498db', '#f39c12', '#e74c3c', '#9b59b6', '#95a5a6' ];
    const colors = labels.map((_,i) => palette[i % palette.length]);
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '220px';
    el.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    // eslint-disable-next-line no-undef
    new Chart(ctx, {
        type: 'pie',
        data: { labels, datasets: [{ data: values, backgroundColor: colors }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: { callbacks: { label: ctxItem => `${ctxItem.label}: ${ctxItem.formattedValue} (${((ctxItem.raw / values.reduce((a,b)=>a+b,0))*100).toFixed(0)}%)` } }
            }
        }
    });
}

export { renderMarketBreadthGauge, renderSectorPerformance, renderSignalDistribution };
