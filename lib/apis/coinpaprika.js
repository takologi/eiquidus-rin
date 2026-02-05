const request = require('postman-request');
const base_url = 'https://api.coinpaprika.com/v1/tickers/'

function get_simple_price(currency, cb) {
  request({ uri: base_url + currency, json: true}, function (error, response, body) {
    if (error)
      return cb(error, 0, 0);
    else if (body == null || body == '' || typeof body !== 'object')
      return cb('No data returned', 0, 0);
    else if (body['status'] != null && body['status']['error_message'] != null && body['status']['error_message'] != '')
      return cb(body['status']['error_message'], 0, 0);
    else {

      let last_price = body.quotes.USD.price;
      let last_usd_price = body.quotes.USD.price;

      return cb(null, last_price, last_usd_price);
    }

  });
}

module.exports = {
  get_market_prices: function (currency, cb) {
    get_simple_price(currency, function (err, last_price, last_usd) {
      if (last_price == null)
        console.log(`Error: "${currency}" is not a valid coingecko api currency`);

      return cb(err, last_price, last_usd);
    });
  },
};
