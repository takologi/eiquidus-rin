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
          // API may return either a single object or an array with one ticker object
          const ticker = (Array.isArray(body) ? body[0] : body);
          const lastPrice = parseFloat(ticker.last_price) || 0;
          const yesterdayPrice = parseFloat(
            ticker.oldltp24h != null
              ? ticker.oldltp24h
              : (ticker.yesterdayPriceNumber != null ? ticker.yesterdayPriceNumber : (ticker.prev != null ? ticker.prev : 0))
          ) || 0;
          const changePercent = (lastPrice > 0 && yesterdayPrice > 0
            ? (((lastPrice - yesterdayPrice) / yesterdayPrice) * 100)
            : 0);

          const summary = {
            'high': parseFloat(ticker.high) || 0,
            'low': parseFloat(ticker.low) || 0,
            'volume': parseFloat(ticker.base_volume) || 0,
            'volume_btc': parseFloat(ticker.target_volume) || 0,
            'bid': parseFloat(ticker.bid) || 0,
            'ask': parseFloat(ticker.ask) || 0,
            'last': lastPrice,
            'prev': yesterdayPrice,
            'change': changePercent
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
  const MAX_TRADE_PAGES = 5;
  const PAGE_SIZE_HINT = 100;
  const tradeMap = new Map();

  function parsePageAndMaybeContinue(page) {
    const req_url = base_url + '/tradebook/' + pair + '?page=' + page;

    request({uri: req_url, json: true}, function (error, response, body) {
      if (error)
        return cb(error, null);
      else if (body == null || body == '' || typeof body !== 'object')
        return cb(api_error_msg, null);
      else if (body.error != null)
        return cb((body.error.message != null ? body.error.message : api_error_msg), null);
      else {
        try {
          const tradeData = (Array.isArray(body.data) ? body.data : []);

          for (let t = 0; t < tradeData.length; t++) {
            const tsMs = parseInt(tradeData[t].timestamp) || 0;
            const side = ((tradeData[t].side || '').toString().toLowerCase() === 'sell' ? 'sell' : 'buy');
            const price = parseFloat(tradeData[t].price) || 0;
            const quantity = parseFloat(tradeData[t].quantity) || 0;

            if (!(price > 0) || !(quantity > 0) || !(tsMs > 0))
              continue;

            const key = `${side}|${tsMs}|${price}|${quantity}`;

            if (!tradeMap.has(key)) {
              tradeMap.set(key, {
                ordertype: side,
                price: price,
                quantity: quantity,
                timestamp: Math.floor(tsMs / 1000)
              });
            }
          }

          const totalPages = Math.max(1, parseInt(body.totalPages || body.total_pages || body.pages || 1) || 1);
          const hasAnotherPageByMetadata = (page < totalPages);
          const hasAnotherPageByDensity = (tradeData.length >= PAGE_SIZE_HINT);

          if (page < MAX_TRADE_PAGES && (hasAnotherPageByMetadata || hasAnotherPageByDensity))
            return parsePageAndMaybeContinue(page + 1);

          const trades = Array.from(tradeMap.values()).sort(function(a, b) {
            if (b.timestamp === a.timestamp)
              return (b.price - a.price);
            return (b.timestamp - a.timestamp);
          });

          return cb(null, trades);
        } catch(err) {
          return cb(api_error_msg, null);
        }
      }
    });
  }

  // NOTE: no rate limiting here for faster page loads
  return parsePageAndMaybeContinue(1);
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

        function truncateOnExtremeGap(rows, side) {
          if (!Array.isArray(rows) || rows.length < 2)
            return rows;

          // If we hit a giant jump in ladder levels, treat remaining rows as synthetic/outlier tails.
          // This keeps top-of-book realistic while avoiding payload artifacts like 10/50/100/1000 ladders.
          const GAP_RATIO = 5;

          for (let i = 1; i < rows.length; i++) {
            const prev = Number(rows[i - 1].price || 0);
            const curr = Number(rows[i].price || 0);

            if (!(prev > 0) || !(curr > 0))
              continue;

            const ratio = (side === 'sell' ? (curr / prev) : (prev / curr));

            if (ratio >= GAP_RATIO)
              return rows.slice(0, i);
          }

          return rows;
        }

        buys = truncateOnExtremeGap(buys, 'buy');
        sells = truncateOnExtremeGap(sells, 'sell');

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
  market_logo: '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',
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
