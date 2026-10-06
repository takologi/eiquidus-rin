describe('tx_flags', function() {
  var tx_flags = require('../lib/tx_flags');

  // live mainnet vectors
  var p2pkh_sig = '3044022012c3006be579dd8264a882187ea4cfff4591a3a79eeb7e52602d0e3061a314c70220463a2664cbd2ef6aaa7b047a069f1a429a76aa8bf94c2c42309a39056c7a055d01';
  var pubkey = '02dda58a6ad5d96d1e3d36b0bc7e4604f493ff13e54d8b0578e868907e9b1882c5';
  var p2pkh_tx = {
    version: 2,
    vin: [{ scriptSig: { hex: '47' + p2pkh_sig + '21' + pubkey } }]
  };
  var p2wpkh_tx = {
    version: 2,
    vin: [{
      scriptSig: { hex: '' },
      txinwitness: [
        '304402205de207012c9e1f505d107fd496a63b2905c5a389d3762351578d3953bcc0671a02200a671453d5461bba6c4909df0eaa6f952bdfe3e14ab647e2b8e82cc81922bef601',
        '03e9c476723b89f5544e151a62457db653d20d5716ce746016ffe4a0e36a02e4c2'
      ]
    }]
  };

  function with_hashtype(sig, hashtype) {
    return sig.slice(0, -2) + hashtype;
  }

  describe('analyze_tx', function() {
    it('should find a legacy P2PKH signature', function() {
      expect(tx_flags.analyze_tx(p2pkh_tx)).toEqual({ version: 2, sighash: [1], sigs: 1, unsigned: 0, cb_tag: null });
    });

    it('should find a P2WPKH witness signature', function() {
      expect(tx_flags.analyze_tx(p2wpkh_tx)).toEqual({ version: 2, sighash: [1], sigs: 1, unsigned: 0, cb_tag: null });
    });

    it('should report SIGHASH_FORKID and other hashtypes as raw bytes', function() {
      var tx = {
        version: 2,
        vin: [
          { scriptSig: { hex: '47' + with_hashtype(p2pkh_sig, '41') + '21' + pubkey } },
          { scriptSig: { hex: '47' + with_hashtype(p2pkh_sig, '83') + '21' + pubkey } },
          { scriptSig: { hex: '47' + with_hashtype(p2pkh_sig, '41') + '21' + pubkey } }
        ]
      };

      expect(tx_flags.analyze_tx(tx).sighash).toEqual([0x41, 0x83]);
      expect(tx_flags.analyze_tx(tx).sigs).toEqual(3);
    });

    it('should keep the RIN3 version', function() {
      var tx = { version: 1380535859, vin: p2pkh_tx.vin };

      expect(tx_flags.analyze_tx(tx).version).toEqual(tx_flags.RIN3_VERSION);
    });

    it('should count inputs without a signature', function() {
      var tx = {
        version: 2,
        vin: [p2pkh_tx.vin[0], { scriptSig: { hex: '51' } }, { scriptSig: { hex: '' }, txinwitness: [] }]
      };

      expect(tx_flags.analyze_tx(tx).unsigned).toEqual(2);
    });

    it('should not count a P2SH multisig redeemScript as a signature', function() {
      var redeem = '52' + '21' + pubkey + '21' + pubkey + '52ae';
      var tx = {
        version: 2,
        vin: [{ scriptSig: { hex: '00' + '47' + p2pkh_sig + '47' + p2pkh_sig + '4c' + (redeem.length / 2).toString(16) + redeem } }]
      };

      expect(tx_flags.analyze_tx(tx)).toEqual({ version: 2, sighash: [1], sigs: 2, unsigned: 0, cb_tag: null });
    });

    it('should extract the coinbase tag after the height push', function() {
      var tx = { version: 1, vin: [{ coinbase: '0354a90b043127c16a088000f0c0000000002f7a706f6f6c2e63612fefcaa1fe2f00' }] };

      expect(tx_flags.analyze_tx(tx)).toEqual({ version: 1, sighash: [], sigs: 0, unsigned: 0, cb_tag: '/zpool.ca/' });
    });

    it('should not join printable extranonce bytes to the coinbase tag', function() {
      // extranonce 80011be8...6d ends with 'm'
      expect(tx_flags.get_coinbase_tag('033c880b04a353b86a0880011be8000000' + '6d' + '2f7a706f6f6c2e63612f' + 'd69c2f00')).toEqual('/zpool.ca/');
      expect(tx_flags.get_coinbase_tag('0332a90b047321c16a08fabe6d6d00000000000000000000000000000000000000000000000000000000000000000100000000000000' + '9a1538768c6d5fac' + '0f706f6f6c2e72706c616e742e78797a')).toEqual('pool.rplant.xyz');
      expect(tx_flags.get_coinbase_tag('0355a90b047227c16a0010000026000000000a4d696e696e67636f7265')).toEqual('Miningcore');
      // extranonce ending with 0a 2e looks like a push of the 10 bytes './zpool.ca'
      expect(tx_flags.get_coinbase_tag('033c880b04a353b86a0880011be800000a2e' + '2f7a706f6f6c2e63612f' + 'd69c2f00')).toEqual('/zpool.ca/');
    });

    it('should find the /RCC/ signal in a coinbase', function() {
      expect(tx_flags.get_coinbase_tag('0355a90b' + '00' + '052f5243432f')).toEqual('/RCC/');
    });

    it('should return null for a coinbase without text', function() {
      expect(tx_flags.get_coinbase_tag('0355a90b04a1b2c3d4')).toEqual(null);
    });
  });

  describe('hashtype_name', function() {
    it('should name the hashtypes', function() {
      expect(tx_flags.hashtype_name(0x01)).toEqual('ALL');
      expect(tx_flags.hashtype_name(0x41)).toEqual('ALL|FORKID');
      expect(tx_flags.hashtype_name(0xc3)).toEqual('SINGLE|FORKID|ANYONECANPAY');
      expect(tx_flags.hashtype_name(0x00)).toEqual('0x00');
    });
  });
});
