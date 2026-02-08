const request = require('postman-request');
const base_url = 'https://trade.nestex.one/api/cg';
const market_url_template = 'https://trade.nestex.one/spot/{coin}_{base}';

// initialize the rate limiter to wait 2 seconds between requests to prevent abusing external apis
const rateLimitLib = require('../ratelimit');
const rateLimit = new rateLimitLib.RateLimit(1, 2000, false);

function get_summary(coin, exchange, api_error_msg, cb) {
  // Format: RIN_USDT
  const pair = coin + '_' + exchange;
  const req_url = base_url + '/tickers/' + pair;

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
          // API returns array with single ticker object
          const ticker = Array.isArray(body) ? body[0] : body;
          
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
  const pair = coin + '_' + exchange;
  const req_url = base_url + '/tradebook/' + pair + '?page=1';

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

          // API returns object with data array
          const tradeData = body.data || [];
          
          for (let t = 0; t < tradeData.length; t++) {
            trades.push({
              ordertype: tradeData[t].side.toLowerCase(), // BUY -> buy, SELL -> sell
              price: parseFloat(tradeData[t].price) || 0,
              quantity: parseFloat(tradeData[t].quantity) || 0,
              timestamp: parseInt(tradeData[t].timestamp / 1000) // Convert from milliseconds to seconds
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
  const pair = coin + '_' + exchange;
  const req_url = base_url + '/orderbook/' + pair + '?depth=100';

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

        // Nestex returns bids and asks as objects with price as key and quantity as value
        const bidsObj = body.bids || {};
        const asksObj = body.asks || {};

        // Convert object to array format
        for (let price in bidsObj) {
          buys.push({
            price: parseFloat(price) || 0,
            quantity: parseFloat(bidsObj[price]) || 0
          });
        }

        for (let price in asksObj) {
          sells.push({
            price: parseFloat(price) || 0,
            quantity: parseFloat(asksObj[price]) || 0
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
  // Nestex API documentation does not include candlestick/OHLCV endpoint
  // Return null to indicate no chart data available
  return cb(null, null);
}

module.exports = {
  market_name: 'Nestex',
  market_logo: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQAgMAAABinRfyAAADaHpUWHRSYXcgcHJvZmlsZSB0eXBlIGV4aWYAAHjaxZdrkusoDIX/axWzBCQhHsvBNlTdHczy54CJu5NO+pYTV02oGCyDOJwPk26q//5p9A8+4kIgbzGFHILDx2efpaCR3P7Za3Z+XOeNuzXu4nQ8EIQUte63oc7+BXH7GhD9jC/3cYrrzJNmolvmmVD7zILG7JdmIpU9zvOe8hxX/LflzG/w7m49j/c+wozNkE+FpCqrwzX0WbR/g5ZR92tEp6O9X597R0fzwbyj9eCdKzOu91aQC7NDePBoxtmeezcceqB2m/nuQVuOKX5419qWWqv76ooPcCrQXNRtKaOFjgus1DEsoER8De04SkZJWOIKYhtoLigrcWaB2409b1y4cR31yiskeqkCu0VkFR2xBPuzrDCd1ffCTaJm3UgTmKygpgjLoYXHvHnMt3LCzBujpzCSMUb8KPQs+E45ErXWty6zS4dX0CV9T0NGJ9ev6AUg3KanNvwdhb7tG/cNrIKgDZsTFljcsqdYjL/2lg7Oin7mPLl923PcZgJYhLkNYlhBwAVW48AuikRm+JjAp0C5qJcFBNhMNqYGNqoBcJL0uTEm8ugrJnsYRwtAGF6dCDRZC2B5b9g/0SfsoWJqnswsWLRk2UrQ4IOFEGLoZ1SJGn20GGKMKeZYkiafLIUUU0o5lSxZcYRZDjlSTjnnUjBpQeqC0QU9Sllk0cUvtoQlLmnJS1mxfVa/2hrWuKY1r2WTTTe8/lvYIm1py1upXLGVqq9WQ4011VxLw15r2nyzFlpsqeVWDmqT6j01fiD3OzWe1DoxP/rFL2oIx3hLwf04sc4MxMQziMdOABtaOjOX2Hvp5DozlwUvhQmosXU4G3diIOgrizU+2H2R+5UbmT/FTV6Ro47uCnLU0U1yP7k9obaV8YuiA1B/C7unThsONnSoqUgq/Tfp7Zo+TfBeIhzku/i2JtdKcGU8cVqV1tFeYITW4N+XRJ9J+arp0PahNPpYyqzpIfC2NJKLJJG7SBJ97s5e06sHZ6XRawk/Mv2qkV6LPaeRLrBn1FROSPpronNuPB9A5xfxPBMt72X667t2eaLTtpG7SNL5l/aFNHIXSaL3z497afQB8buaLjj4hzS6YDMOJXTNz+PJY+Q3E/6nPyJOJ2r4gwr/ftN/T53wiWtCBlsAAAAJUExURQAAYgAAAP/JBUuAGGkAAAABdFJOUwBA5thmAAAAAWJLR0QAiAUdSAAAAAlwSFlzAAAnEAAAJxABlGlRGQAAAAd0SU1FB+oCBwEHIOnxJaUAAAAzSURBVAjXY2BAAgtARAMQK3EACQUGKIsDxGNQAJJdXAsWgLgKDExKHUCxVauAhNYKJCMA2fgGo/G2iNgAAAAASUVORK5CYII=',
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
