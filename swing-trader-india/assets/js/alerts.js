import { fetchStockPrice, fetchStockNews } from './api.js';
import { loadSettings, saveSettings } from './storage.js';
import { formatIndianCurrency } from './utils.js';

class AlertManager {
    constructor() {
        this.settings = loadSettings() || {};
        this.notificationQueue = [];
        this.processing = false;
        this.recentNotifications = {}; // key -> timestamp
        this.cooldownMs = (this.settings.alertCooldownMinutes || 5) * 60 * 1000;
        this.snoozes = this.settings.alertSnoozes || {}; // symbol -> untilTimestamp
        this.toastContainerId = 'toastContainer';
    }

    requestNotificationPermission() {
        try {
            if (!('Notification' in window)) return Promise.resolve('unsupported');
            return Notification.requestPermission().then(perm => {
                this.settings.notificationPermission = perm;
                saveSettings(this.settings);
                return perm;
            });
        } catch (e) {
            console.error('requestNotificationPermission error', e);
            return Promise.resolve('error');
        }
    }

    async sendNotification(title, message, data = {}) {
        try {
            const key = data.key || `${title}|${message}`;
            const now = Date.now();
            // check snooze (if symbol provided)
            if (data.symbol && this.isSnoozed(data.symbol)) return false;
            // cooldown check
            const last = this.recentNotifications[key];
            if (last && (now - last) < this.cooldownMs) return false;
            this.recentNotifications[key] = now;

            // push to queue and process
            this.notificationQueue.push({ title, message, data });
            this.processQueue();
            // also show in-app toast
            this.showInAppAlert(data.type || 'info', `${title}: ${message}`, data);
            return true;
        } catch (e) {
            console.error('sendNotification error', e);
            return false;
        }
    }

    async processQueue() {
        if (this.processing) return;
        this.processing = true;
        while (this.notificationQueue.length) {
            const item = this.notificationQueue.shift();
            try {
                if ('Notification' in window && Notification.permission === 'granted') {
                    const note = new Notification(item.title, { body: item.message, data: item.data });
                    // optionally handle click
                    note.onclick = () => { window.focus(); };
                }
            } catch (e) {
                console.warn('processQueue notification failed', e);
            }
            // short delay to avoid spam
            await new Promise(r => setTimeout(r, 600));
        }
        this.processing = false;
    }

    isSnoozed(symbol) {
        const until = this.snoozes[symbol];
        if (!until) return false;
        if (Date.now() > until) {
            // expired
            delete this.snoozes[symbol];
            this.settings.alertSnoozes = this.snoozes;
            saveSettings(this.settings);
            return false;
        }
        return true;
    }

    snooze(symbol, minutes = 60) {
        const until = Date.now() + Math.max(1, minutes) * 60 * 1000;
        this.snoozes[symbol] = until;
        this.settings.alertSnoozes = this.snoozes;
        saveSettings(this.settings);
        this.showInAppAlert('info', `Alerts snoozed for ${symbol} for ${minutes} minutes`);
    }

    async checkPriceAlerts() {
        try {
            const alerts = (this.settings.priceAlerts || []);
            for (const a of alerts) {
                if (!a.enabled) continue;
                const symbol = a.symbol;
                if (this.isSnoozed(symbol)) continue;
                try {
                    const p = await fetchStockPrice(symbol);
                    const price = p.price || 0;
                    const dir = a.direction || 'above';
                    const target = Number(a.target);
                    if (!target) continue;
                    let triggered = false;
                    if (dir === 'above' && price >= target) triggered = true;
                    if (dir === 'below' && price <= target) triggered = true;
                    if (triggered) {
                        const title = `🔔 Price Alert: ${symbol}`;
                        const msg = `${symbol} ${dir} ${formatIndianCurrency(target)} (now ${formatIndianCurrency(price)})`;
                        await this.sendNotification(title, msg, { symbol, key: `price|${symbol}|${target}` });
                        if (a.autoDisable) a.enabled = false; // optional
                        this.settings.priceAlerts = alerts;
                        saveSettings(this.settings);
                    }
                } catch (e) {
                    console.warn('checkPriceAlerts fetch failed', a.symbol, e);
                }
            }
        } catch (e) {
            console.error('checkPriceAlerts error', e);
        }
    }

    async checkStopLossAlerts(positions = []) {
        try {
            for (const pos of positions) {
                try {
                    const sym = pos.symbol;
                    if (this.isSnoozed(sym)) continue;
                    const p = await fetchStockPrice(sym);
                    const price = p.price || 0;
                    if (pos.stopLoss && price <= pos.stopLoss) {
                        const title = `⚠️ Stop Loss Hit: ${sym}`;
                        const msg = `${sym} hit stop loss ${formatIndianCurrency(pos.stopLoss)} (now ${formatIndianCurrency(price)})`;
                        await this.sendNotification(title, msg, { symbol: sym, type: 'stop', key: `stop|${sym}|${pos.stopLoss}` });
                    }
                    // trailing stop suggestion: if price moved favorably
                    if (pos.trailing && pos.entry) {
                        const profit = price - pos.entry;
                        if (profit > (pos.trailing.moveUp || 0)) {
                            const title = `🔁 Trailing Stop Suggestion: ${sym}`;
                            const msg = `${sym} up ${formatIndianCurrency(profit)} — consider moving trailing stop.`;
                            await this.sendNotification(title, msg, { symbol: sym, type: 'trailing', key: `trail|${sym}` });
                        }
                    }
                } catch (e) {
                    console.warn('checkStopLossAlerts failed for', pos, e);
                }
            }
        } catch (e) {
            console.error('checkStopLossAlerts error', e);
        }
    }

    async checkNewsAlerts(watchlist = []) {
        try {
            for (const symbol of watchlist) {
                try {
                    if (this.isSnoozed(symbol)) continue;
                    const items = await fetchStockNews(symbol);
                    if (!items || !items.length) continue;
                    // simple heuristic: alert if headline contains high-impact words
                    const highImpact = items.find(it => /profit|loss|merger|acquisition|fraud|upgrade|downgrade|results|profit warning/i.test(it.title + ' ' + (it.summary||'')));
                    if (highImpact) {
                        const title = `📰 News: ${symbol}`;
                        const msg = highImpact.title || 'Important news';
                        await this.sendNotification(title, msg, { symbol, type: 'news', key: `news|${symbol}|${highImpact.pubDate||highImpact.link}` });
                    }
                } catch (e) {
                    console.warn('checkNewsAlerts failed for', symbol, e);
                }
            }
        } catch (e) {
            console.error('checkNewsAlerts error', e);
        }
    }

    // In-app toast using Bootstrap toasts
    showInAppAlert(type = 'info', message = '', data = {}) {
        try {
            let container = document.getElementById(this.toastContainerId);
            if (!container) {
                container = document.createElement('div');
                container.id = this.toastContainerId;
                container.style.position = 'fixed';
                container.style.top = '1rem';
                container.style.right = '1rem';
                container.style.zIndex = 1080;
                document.body.appendChild(container);
            }
            const toast = document.createElement('div');
            toast.className = 'toast align-items-center text-bg-light border';
            toast.setAttribute('role', 'alert');
            toast.setAttribute('aria-live', 'assertive');
            toast.setAttribute('aria-atomic', 'true');
            toast.style.minWidth = '240px';

            const header = document.createElement('div');
            header.className = 'd-flex justify-content-between align-items-center p-2';
            const title = document.createElement('strong');
            title.className = 'me-auto';
            title.textContent = type === 'info' ? 'Info' : (type === 'error' ? 'Error' : 'Alert');
            const snoozeBtn = document.createElement('button');
            snoozeBtn.className = 'btn btn-sm btn-outline-secondary ms-2';
            snoozeBtn.textContent = 'Snooze 60m';
            snoozeBtn.onclick = () => {
                if (data.symbol) this.snooze(data.symbol, 60);
                toast.remove();
            };
            const closeBtn = document.createElement('button');
            closeBtn.className = 'btn-close ms-2';
            closeBtn.onclick = () => toast.remove();
            header.appendChild(title);
            header.appendChild(snoozeBtn);
            header.appendChild(closeBtn);

            const body = document.createElement('div');
            body.className = 'toast-body p-2';
            body.textContent = message;

            toast.appendChild(header);
            toast.appendChild(body);
            container.appendChild(toast);

            // auto-dismiss
            setTimeout(() => { toast.remove(); }, 5000);
        } catch (e) {
            console.error('showInAppAlert error', e);
        }
    }
}

const alertManager = new AlertManager();
export { AlertManager, alertManager };
