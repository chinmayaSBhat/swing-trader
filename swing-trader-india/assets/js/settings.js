// settings page logic
import { loadSettings, saveSettings, clearOldData } from './storage.js';
import { alertManager } from './alerts.js';

function loadForm() {
    const s = loadSettings();
    document.getElementById('alertBrowser').checked = s.alertBrowser || false;
    ['Signals','Price','News','Stop'].forEach(type => {
        const el = document.getElementById(`alertType${type}`);
        if (el) el.checked = s.alertTypes?.includes(type.toLowerCase());
    });
    document.getElementById('alertFreq').value = s.alertFreq || 'Real-time';
    document.getElementById('prefCapital').value = s.capital || '';
    document.getElementById('prefRisk').value = s.risk || '2%';
    document.getElementById('prefMinRR').value = s.minRR || '1:1';
    ['Pullback','Breakout','Support','MACross'].forEach(id => {
        const el = document.getElementById(`prefStrat${id}`);
        if (el) el.checked = s.preferredStrategies?.includes(id.toLowerCase());
    });
    document.getElementById('displayDarkMode').checked = s.darkMode || false;
    document.getElementById('displayChartColor').value = s.chartColor || 'Light';
    document.getElementById('displayRows').value = s.rows || '20';
}

function saveForm() {
    const s = {};
    s.alertBrowser = document.getElementById('alertBrowser').checked;
    s.alertTypes = [];
    ['Signals','Price','News','Stop'].forEach(type => {
        const el = document.getElementById(`alertType${type}`);
        if (el && el.checked) s.alertTypes.push(type.toLowerCase());
    });
    s.alertFreq = document.getElementById('alertFreq').value;
    const capVal = parseFloat(document.getElementById('prefCapital').value);
    if (isNaN(capVal) || capVal < 0) {
        alertManager.showInAppAlert('error', 'Invalid capital amount, resetting to 0');
        s.capital = 0;
    } else {
        s.capital = capVal;
    }
    const riskVal = document.getElementById('prefRisk').value;
    // expect percentage e.g. "2%" or number
    const rv = parseFloat(riskVal);
    if (isNaN(rv) || rv < 0 || rv > 100) {
        alertManager.showInAppAlert('error', 'Invalid risk percentage, using 2%');
        s.risk = '2%';
    } else {
        s.risk = riskVal;
    }
    s.minRR = document.getElementById('prefMinRR').value;
    s.preferredStrategies = [];
    ['Pullback','Breakout','Support','MACross'].forEach(id => {
        const el = document.getElementById(`prefStrat${id}`);
        if (el && el.checked) s.preferredStrategies.push(id.toLowerCase());
    });
    s.darkMode = document.getElementById('displayDarkMode').checked;
    s.chartColor = document.getElementById('displayChartColor').value;
    s.rows = document.getElementById('displayRows').value;
    saveSettings(s);
}

function setupButtons() {
    document.getElementById('clearCacheBtn').addEventListener('click', () => {
        localStorage.clear();
        alert('Cache cleared');
    });
    document.getElementById('clearSignalsBtn').addEventListener('click', () => {
        // removing signals older than 30 days would be handled by storage logic
        clearOldData();
        alert('Old signals cleared');
    });
    document.getElementById('resetDefaultsBtn').addEventListener('click', () => {
        localStorage.removeItem('settings');
        loadForm();
        alert('Settings reset to defaults');
    });
}

function setupSaveEvent() {
    document.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('change', saveForm);
    });
}

function init() {
    loadForm();
    setupButtons();
    setupSaveEvent();
}

document.addEventListener('DOMContentLoaded', init);
