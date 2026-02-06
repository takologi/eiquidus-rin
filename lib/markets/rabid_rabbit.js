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
  // Format: RIN_USDT (underscore separator)
  const pair = coin + '_' + exchange;
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
          
          const summary = {
            'high': parseFloat(ticker.high_24h) || 0,
            'low': parseFloat(ticker.low_24h) || 0,
            'volume': parseFloat(ticker.base_volume) || 0,
            'volume_btc': parseFloat(ticker.quote_volume) || 0,
            'bid': parseFloat(ticker.highest_bid) || 0,
            'ask': parseFloat(ticker.lowest_ask) || 0,
            'last': parseFloat(ticker.last_price) || 0,
            'prev': 0,
            'change': parseFloat(ticker.percent_change) || 0
          };

          return cb(null, summary);
        } catch(err) {
          return cb(api_error_msg, null);
        }
      }
    });
}

function get_trades(coin, exchange, api_error_msg, cb) {
  // Rabid Rabbit doesn't appear to have a public trades endpoint
  // Return empty array for now
  return cb(null, []);
}

function get_orders(coin, exchange, api_error_msg, cb) {
  // Rabid Rabbit doesn't appear to have a public orderbook endpoint
  // Return empty arrays for now
  return cb(null, [], []);
}

function get_chartdata(coin, exchange, api_error_msg, cb) {
  // Rabid Rabbit API does not include candlestick/OHLCV endpoint
  // Return null to indicate no chart data available
  return cb(null, null);
}

module.exports = {
  market_name: 'Rabid Rabbit',
  market_logo: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  market_url_template: market_url_template,
  market_url_case: 'l',
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
