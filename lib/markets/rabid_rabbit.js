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
  market_logo: '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',
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
