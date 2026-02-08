const request = require('postman-request');
const base_url = 'https://api.exbitron.com/api/v1/cg';
const market_url_template = 'https://app.exbitron.com/exchange/?market={coin}-{base}';

// initialize the rate limiter to wait 2 seconds between requests to prevent abusing external apis
const rateLimitLib = require('../ratelimit');
const rateLimit = new rateLimitLib.RateLimit(1, 2000, false);

function get_summary(coin, exchange, api_error_msg, cb) {
  // Format: RIN-USDT (dash separator)
  const pair = coin + '-' + exchange;
  const req_url = base_url + '/tickers';

  // NOTE: no rate limiting here for faster page loads
  request({uri: req_url, json: true}, function (error, response, body) {
      if (error)
        return cb(error, null);
      else if (body == null || body == '' || typeof body !== 'object')
        return cb(api_error_msg, null);
      else if (body.error != null)
        return cb((body.error.message != null ? body.error.message : api_error_msg), null);
      else {
        try {
          // API returns array of tickers, find matching pair
          const ticker = Array.isArray(body) ? body.find(t => t.ticker_id === pair) : null;
          
          if (!ticker)
            return cb('Trading pair not found', null);
          
          const summary = {
            'high': parseFloat(ticker.high) || 0,
            'low': parseFloat(ticker.low) || 0,
            'volume': parseFloat(ticker.base_volume) || 0,
            'volume_btc': parseFloat(ticker.target_volume) || 0,
            'bid': parseFloat(ticker.bid) || 0,
            'ask': parseFloat(ticker.ask) || 0,
            'last': parseFloat(ticker.last_price) || 0,
            'prev': 0,
            'change': 0
          };

          return cb(null, summary);
        } catch(err) {
          return cb(api_error_msg, null);
        }
      }
    });
}

function get_trades(coin, exchange, api_error_msg, cb) {
  const pair = coin + '-' + exchange;
  const req_url = base_url + '/historical_trades?ticker_id=' + pair + '&limit=100';

  // NOTE: no rate limiting here for faster page loads
  request({uri: req_url, json: true}, function (error, response, body) {
      if (error)
        return cb(error, null);
      else if (body == null || body == '' || typeof body !== 'object')
        return cb(api_error_msg, null);
      else if (body.error != null)
        return cb((body.error.message != null ? body.error.message : api_error_msg), null);
      else {
        try {
          let trades = [];

          // CoinGecko format returns buy/sell array
          const buy = body.buy || [];
          const sell = body.sell || [];
          const allTrades = [...buy, ...sell];
          
          for (let t = 0; t < allTrades.length; t++) {
            trades.push({
              ordertype: allTrades[t].type.toLowerCase(),
              price: parseFloat(allTrades[t].price) || 0,
              quantity: parseFloat(allTrades[t].base_volume) || 0,
              timestamp: parseInt(allTrades[t].trade_timestamp) // Already in seconds
            });
          }

          return cb(null, trades);
        } catch(err) {
          return cb(api_error_msg, null);
        }
      }
    });
}

function get_orders(coin, exchange, api_error_msg, cb) {
  const pair = coin + '-' + exchange;
  const req_url = base_url + '/orderbook?ticker_id=' + pair + '&depth=100';

  // NOTE: no need to pause here because this is the first api call
  request({uri: req_url, json: true}, function (error, response, body) {
    if (error)
      return cb(error, null, null);
    else if (body == null || body == '' || typeof body !== 'object')
      return cb(api_error_msg, null, null);
    else if (body.error != null)
      return cb((body.error.message != null ? body.error.message : api_error_msg), null, null);
    else {
      try {
        let buys = [];
        let sells = [];

        // CoinGecko format returns bids and asks as arrays of [price, quantity]
        const bids = body.bids || [];
        const asks = body.asks || [];

        for (let b = 0; b < bids.length; b++) {
          buys.push({
            price: parseFloat(bids[b][0]) || 0,
            quantity: parseFloat(bids[b][1]) || 0
          });
        }

        for (let s = 0; s < asks.length; s++) {
          sells.push({
            price: parseFloat(asks[s][0]) || 0,
            quantity: parseFloat(asks[s][1]) || 0
          });
        }

        // Sort buy orders by price descending (highest first)
        buys.sort((a, b) => b.price - a.price);
        
        // Sort sell orders by price ascending (lowest first)
        sells.sort((a, b) => a.price - b.price);

        return cb(null, buys, sells);
      } catch(err) {
        return cb(api_error_msg, null, null);
      }
    }
  });
}

function get_chartdata(coin, exchange, api_error_msg, cb) {
  // Exbitron CoinGecko API does not include candlestick/OHLCV endpoint
  // Return null to indicate no chart data available
  return cb(null, null);
}

module.exports = {
  market_name: 'Exbitron',
  market_logo: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAeeAAAHngHiI+4IAAAAGXRFWHRTb2Z0d2FyZQB3d3cuaW5rc2NhcGUub3Jnm+48GgAAAgRJREFUOI2Fk89L02Ecx19bY9vXH8cKolsRlUY0Izt2iA5FkvWVAtFIF1pChwSZ5AQt2C4T7A9ISxdGoXRopw5dOpgaBJOi2qEI1sQO4Tf9znLvDptb+8F6w4fnw8P7/X4+n+d5PkiiJAxJw5K+SLIzmcyGpISkUUm1pfxS8UAqldJ1v18Nhw8VRXfXNSWTSUm686/GIYkcpqenptrD4RDVcLu/n66u7mdAG4Azt98xOzv7XzHAWCTCk5kZE+gFshXYtp053uRzABw94GbvbldF8bfUH9593ATgzcKiampqnC6g9f74uGOb1Ha6lgunaisaPH/1K28wFok4hoLBKw5Jj042n+iwLAuA9rN1NDd6KhrMx9NEY1me1+tlcentUxfQsC0GiMYs4p83mbq7q8zgp5XJ57ZtAxwsa/bIfjfRe+VigMKDFeAC4nV19T7LWgPg8pls/w9frGGtFys+ff2dzw3DAFh2AXOmaXZOTk4Uka+eqy87LfZ6nZfzGwC0tl4EmHNIIp1ObzX5jjkBGve52bNzR75kAeTW7z+2WE5kX2FhcUmGYThdAB6PpzMUCk8PDgaIJzaJJypeQR4jI6MYhuGHwk+Mnm9pmQgGh6srgUBgkEum+Rh4kCuzaJhura6uqu/mjbJh6u3p0crKiiQNVJtGJLklBSS9VwEfJA1J8pTy/wIUaVLSmUJbpQAAAABJRU5ErkJggg==',
  market_url_template: market_url_template,
  market_url_case: 'u',
  get_data: function(settings, cb) {
    get_orders(settings.coin, settings.exchange, settings.api_error_msg, function(order_error, buys, sells) {
      if (order_error == null) {
        get_trades(settings.coin, settings.exchange, settings.api_error_msg, function(trade_error, trades) {
          if (trade_error == null) {
            get_summary(settings.coin, settings.exchange, settings.api_error_msg, function(summary_error, stats) {
              if (summary_error == null) {
                get_chartdata(settings.coin, settings.exchange, settings.api_error_msg, function (chart_error, chartdata) {
                  if (chart_error == null)
                    return cb(null, {buys: buys, sells: sells, trades: trades, stats: stats, chartdata: chartdata});
                  else
                    return cb(chart_error, null);
                });
              } else
                return cb(summary_error, null);
            });
          } else
            return cb(trade_error, null);
        });
      } else
        return cb(order_error, null);
    });
  }
};
