// Indian market utility functions

function formatIndianCurrency(amount) {
  if (amount == null || isNaN(amount)) return '--';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(amount);
}

function formatIndianNumber(num) {
  if (num == null || isNaN(num)) return '--';
  if (num >= 10000000) return `${(num/10000000).toFixed(2)} Cr`;
  if (num >= 100000) return `${(num/100000).toFixed(2)} L`;
  return new Intl.NumberFormat('en-IN').format(num);
}

function normalizeSymbol(symbol) {
  if (!symbol) return '';
  // if contains exchange suffix remove for display
  if (symbol.includes('.')) {
    return symbol.split('.')[0].toUpperCase();
  }
  // otherwise assume NSE and append suffix
  return `${symbol.toUpperCase()}.NS`;
}

function getStockExchangeLink(symbol) {
  const norm = normalizeSymbol(symbol);
  const bare = norm.replace(/\.(NS|BO)$/i, '');
  return `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(bare)}`;
}

export { formatIndianCurrency, formatIndianNumber, normalizeSymbol, getStockExchangeLink };
