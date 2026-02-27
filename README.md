# Swing Trader India

A simple swing trading suggester for the Indian stock market.

## Structure

```
/swing-trader-india/
  ├── index.html (main dashboard)
  ├── assets/
  │   ├── css/
  │   │   └── style.css (custom styles)
  │   ├── js/
  │   │   ├── app.js (main application)
  │   │   ├── api.js (API handlers)
  │   │   ├── technical.js (technical indicators)
  │   │   ├── signals.js (signal generation)
  │   │   ├── storage.js (localStorage manager)
  │   │   ├── charts.js (chart rendering)
  │   │   └── utils.js (utilities)
  │   └── data/
  │       └── nifty500.json (stock symbols list)
  ├── pages/
  │   ├── watchlist.html
  │   ├── signals.html
  │   └── settings.html
  └── README.md
```

## Usage
Open `index.html` in a browser to start working with the dashboard. Bootstrap 5 and Chart.js are loaded via CDN.
