const request = require('postman-request');
const base_url = 'https://rabid-rabbit.org/api/public/v1';
const market_url_template = 'https://rabid-rabbit.org/market/{coin}_{base}';

// initialize the rate limiter to wait 2 seconds between requests to prevent abusing external apis
const rateLimitLib = require('../ratelimit');
const rateLimit = new rateLimitLib.RateLimit(1, 2000, false);

function get_summary(coin, exchange, api_error_msg, cb) {
  // Format: RIN_USDT (underscore separator)
  const pair = coin + '_' + exchange;
  const req_url = base_url + '/ticker?format=json';

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
          // API returns object with pairs as keys
          const ticker = body[pair];
          
          if (!ticker)
            return cb('Trading pair not found', null);
          
          const summary = {
            'high': 0, // Not available in ticker endpoint
            'low': 0, // Not available in ticker endpoint
            'volume': parseFloat(ticker.base_volume) || 0,
            'volume_btc': parseFloat(ticker.quote_volume) || 0,
            'bid': 0, // Not available in ticker endpoint
            'ask': 0, // Not available in ticker endpoint
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

function get_summary_enhanced(coin, exchange, api_error_msg, cb) {
  // Format: RIN_USDT (underscore separator) - API requires UPPERCASE
  const pair = coin.toUpperCase() + '_' + exchange.toUpperCase();
  const req_url = base_url + '/summary?format=json';

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
          // API returns object with data property containing pairs
          const data = body.data || body;
          const ticker = data[pair];
          
          if (!ticker)
            return cb('Trading pair not found', null);
          
          // Handle null values from API - use 0 as fallback
          const summary = {
            'high': (ticker.high_24h != null && !isNaN(parseFloat(ticker.high_24h))) ? parseFloat(ticker.high_24h) : 0,
            'low': (ticker.low_24h != null && !isNaN(parseFloat(ticker.low_24h))) ? parseFloat(ticker.low_24h) : 0,
            'volume': (ticker.base_volume != null && !isNaN(parseFloat(ticker.base_volume))) ? parseFloat(ticker.base_volume) : 0,
            'volume_btc': (ticker.quote_volume != null && !isNaN(parseFloat(ticker.quote_volume))) ? parseFloat(ticker.quote_volume) : 0,
            'bid': (ticker.highest_bid != null && !isNaN(parseFloat(ticker.highest_bid))) ? parseFloat(ticker.highest_bid) : 0,
            'ask': (ticker.lowest_ask != null && !isNaN(parseFloat(ticker.lowest_ask))) ? parseFloat(ticker.lowest_ask) : 0,
            'last': (ticker.last_price != null && !isNaN(parseFloat(ticker.last_price))) ? parseFloat(ticker.last_price) : 0,
            'prev': 0,
            'change': (ticker.percent_change != null && !isNaN(parseFloat(ticker.percent_change))) ? parseFloat(ticker.percent_change) : 0
          };

          return cb(null, summary);
        } catch(err) {
          return cb(api_error_msg, null);
        }
      }
    });
}

function get_trades(coin, exchange, api_error_msg, cb) {
  // Format: RIN_USDT (underscore separator) - API requires UPPERCASE
  const pair = coin.toUpperCase() + '_' + exchange.toUpperCase();
  const req_url = base_url + '/trades/' + pair + '?format=json';

  // NOTE: no rate limiting here for faster page loads
  request({uri: req_url, json: true}, function (error, response, body) {
    if (error)
      return cb(error, null);
    else if (body == null || body == '' || !Array.isArray(body))
      return cb(api_error_msg, null);
    else {
      try {
        const trades = [];
        
        // Process trades array - format: {trade_id, price, base_volume, quote_volume, trade_timestamp, type}
        for (let t = 0; t < body.length; t++) {
          trades.push({
            ordertype: body[t].type.toUpperCase(), // 'buy' or 'sell' -> 'BUY' or 'SELL'
            price: parseFloat(body[t].price) || 0,
            quantity: parseFloat(body[t].base_volume) || 0,
            total: parseFloat(body[t].quote_volume) || 0,
            timestamp: parseInt(body[t].trade_timestamp) || 0
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
  // Format: RIN_USDT (underscore separator) - API requires UPPERCASE
  const pair = coin.toUpperCase() + '_' + exchange.toUpperCase();
  const req_url = base_url + '/orderbook/' + pair + '?depth=500&format=json';

  // NOTE: no rate limiting here for faster page loads
  request({uri: req_url, json: true}, function (error, response, body) {
    if (error)
      return cb(error, null, null);
    else if (body == null || body == '' || typeof body !== 'object')
      return cb(api_error_msg, null, null);
    else if (body.error != null)
      return cb((body.error.message != null ? body.error.message : api_error_msg), null, null);
    else {
      try {
        const buys = [];
        const sells = [];
        
        // Process bids (buy orders) - format: [price, quantity]
        if (body.bids && Array.isArray(body.bids)) {
          body.bids.forEach(function(order) {
            buys.push({
              price: parseFloat(order[0]),
              quantity: parseFloat(order[1])
            });
          });
        }
        
        // Process asks (sell orders) - format: [price, quantity]
        if (body.asks && Array.isArray(body.asks)) {
          body.asks.forEach(function(order) {
            sells.push({
              price: parseFloat(order[0]),
              quantity: parseFloat(order[1])
            });
          });
        }
        
        return cb(null, buys, sells);
      } catch(err) {
        return cb(api_error_msg, null, null);
      }
    }
  });
}

function get_chartdata(coin, exchange, api_error_msg, cb) {
  // Rabid Rabbit API does not include candlestick/OHLCV endpoint
  // Return null to indicate no chart data available
  return cb(null, null);
}

module.exports = {
  market_name: 'Rabid Rabbit',
  market_logo: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAB2AAAAdgFOeyYIAAAAGXRFWHRTb2Z0d2FyZQB3d3cuaW5rc2NhcGUub3Jnm+48GgAAAk5JREFUOI19kUtIVHEUxn//O3fuvTNaar4GMmo2mo5OD6kgq0UQZRSR0KJVGyVoU4vGRRERQQvdBK4iKHBrpNEiC2mXCj3Q1OxhmaPZ4HPUbO69473/NumkM3SW55zfd76PI6SUWA9u1iY/90dImiFA5/9l4TWGRLCqKevi7U719/3rtU5PZ4e0EhpAPAlR0yW8SVlHecr34cbGkPNTAEViarxmGc4o7teBxlXYdCQt+YfprTiZdvbplr30nW5EaAYA0kpocvR9RMG2KlaXDI+gPDZA5ZFjTJjuGqwEttP1up/S0R6kbaZUbbNSwZXGv5fO+uYZedNNt5O71psrq6H2YDW+7o71tlxprA8KeIQg/PYxw1pRSmBbJccnXoHjpEVLEwDYnS1xoh+JWRKlsIRyfQV3pC/TamaBK8MWJRr0xF08uw5BfArf5bsZBdSNjZglGfEWMJ9bTEPQz5LqZ67iKNmGRk5OPnJh9v8OArqgKbDIzKdBxid/8utHlNLCXPIeXkuD1xzodZeQC7NIj4rwauwBWrvauTppUH+unrHGOtq/TKMgmElKBLA/T0Eml1UVwH7ZBl4NxcgCZwX82bQ5xQhD0PkhSlXoAKfiz7ClYNGRAOwwBKLAcFQUYcr49GaA1SdJIVjyhgntLGEm+o1AqBrz3QuQEhCp/LqaUNCMoY25hJRE7H7ye59wvqwIs/XOX3jDnuEfUEQw3CR0n53pRRe2qliPWjKNELrPJhhuFlJKlu/dOCG/D0awEyHAyEikyhS6b5BguDmr4dbzP1iE4xDyuLKAAAAAAElFTkSuQmCC',
  market_url_template: market_url_template,
  market_url_case: 'u',
  get_data: function(settings, cb) {
    get_orders(settings.coin, settings.exchange, settings.api_error_msg, function(order_error, buys, sells) {
      if (order_error == null) {
        get_trades(settings.coin, settings.exchange, settings.api_error_msg, function(trade_error, trades) {
          if (trade_error == null) {
            get_summary_enhanced(settings.coin, settings.exchange, settings.api_error_msg, function(summary_error, stats) {
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
