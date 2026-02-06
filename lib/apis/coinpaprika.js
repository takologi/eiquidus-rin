const request = require('postman-request');
const base_url = 'https://api.coinpaprika.com/v1/';

function get_coin_list(cb) {
  request({ uri: base_url + 'coins', json: true}, function (error, response, body) {
    if (error)
      return cb(error, []);
    else if (body == null || body == '' || typeof body !== 'object')
      return cb('No data returned', []);
    else if (body['error'] != null)
      return cb(body['error'], []);
    else
      return cb(null, body);
  });
}

function get_simple_price(id, currency, market_array, cb) {
  request({ uri: base_url + `tickers/${id.toLowerCase()}?quotes=${currency == null || currency == '' ? 'USD' : currency + ',USD'}`, json: true}, function (error, response, body) {
    if (error)
      return cb(error, 0, 0);
    else if (body == null || body == '' || typeof body !== 'object')
      return cb('No data returned', 0, 0);
    else if (body['error'] != null)
      return cb(body['error'], 0, 0);
    else {
      try {
        if (market_array != null) {
          // multiple currencies need to be combined before return
          let last_price = 0;
          let last_usd_price = 0;
          let counter = 0;
          let base_currency_price = null;

          // check if the currency variable is set
          if (currency != null && currency != '') {
            // find the market currency in the market_array
            const base_index = market_array.findIndex(p => p.currency.toLowerCase() == currency.toLowerCase());

            // check if the currency is found in the market_array
            if (base_index > -1 && market_array[base_index].coinpaprika_id) {
              // get the base currency price in USD for conversion
              request({ uri: base_url + `tickers/${market_array[base_index].coinpaprika_id.toLowerCase()}`, json: true}, function (err, res, base_body) {
                if (!err && base_body != null && base_body.quotes && base_body.quotes.USD) {
                  base_currency_price = base_body.quotes.USD.price;
                }

                // process all market currencies
                processMarketArray();
              });
              return;
            }
          }

          // if no base currency conversion needed, process directly
          processMarketArray();

          function processMarketArray() {
            // loop through market_array to calculate average prices
            let processed = 0;
            
            if (market_array.length === 0) {
              return cb(null, 0, 0);
            }

            market_array.forEach(function(market_item) {
              if (market_item.coinpaprika_id) {
                request({ uri: base_url + `tickers/${market_item.coinpaprika_id.toLowerCase()}`, json: true}, function (err, res, item_body) {
                  if (!err && item_body != null && item_body.quotes && item_body.quotes.USD) {
                    // calculate USD price
                    last_usd_price += (market_item.last_price * item_body.quotes.USD.price);

                    // calculate target currency price
                    if (currency != null && currency != '' && base_currency_price != null) {
                      // convert through USD: (market_price * usd_price) / base_currency_usd_price
                      last_price += (market_item.last_price * item_body.quotes.USD.price / base_currency_price);
                    } else if (currency != null && currency != '' && item_body.quotes[currency.toUpperCase()]) {
                      // direct currency quote available
                      last_price += (market_item.last_price * item_body.quotes[currency.toUpperCase()].price);
                    }

                    counter++;
                  }

                  processed++;
                  if (processed === market_array.length) {
                    // average the market and usd prices
                    if (counter > 0) {
                      last_price = (last_price / counter);
                      last_usd_price = (last_usd_price / counter);
                    }
                    return cb(null, last_price, last_usd_price);
                  }
                });
              } else {
                processed++;
                if (processed === market_array.length) {
                  if (counter > 0) {
                    last_price = (last_price / counter);
                    last_usd_price = (last_usd_price / counter);
                  }
                  return cb(null, last_price, last_usd_price);
                }
              }
            });
          }
        } else {
          // single currency
          const quotes = body.quotes || {};
          const currency_price = (currency == null || currency == '' ? 0 : (quotes[currency.toUpperCase()] ? quotes[currency.toUpperCase()].price : 0));
          const usd_price = (quotes['USD'] ? quotes['USD'].price : 0);
          
          return cb(null, currency_price, usd_price);
        }
      } catch(err) {
        return cb('Received unexpected API data response', 0, 0);
      }
    }
  });
}

module.exports = {
  get_coin_data: function (cb) {
    get_coin_list(function (err, coin_list) {
      return cb(err, coin_list);
    });
  },
  get_market_prices: function (id, currency, cb) {
    get_simple_price(id, currency, null, function (err, last_price, last_usd) {
      if (last_price == null)
        console.log(`Error: "${currency}" is not a valid coinpaprika api currency`);

      return cb(err, last_price, last_usd);
    });
  },
  get_avg_market_prices: function (id, currency, market_array, cb) {
    get_simple_price(id, currency, market_array, function (err, last_price, last_usd) {
      if (last_price == null)
        console.log(`Error: "${currency}" is not a valid coinpaprika api currency`);

      return cb(err, last_price, last_usd);
    });
  }
};
