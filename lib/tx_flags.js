// Per-transaction replay-protection facts for the height-840,000 Rincoin transition:
// the raw nVersion (RIP-0009 "RIN3" marker), the hashtype bytes of all ECDSA signatures
// (SIGHASH_FORKID, Rincoin Community Core) and the ASCII tag of a coinbase scriptSig.
// Only raw facts are stored; labels are derived when they are displayed.

const RIN3_VERSION = 0x52494e33;
const SIGHASH_FORKID = 0x40;
const SIGHASH_ANYONECANPAY = 0x80;
const CB_TAG_MAX_LENGTH = 64;
const CB_TAG_MIN_RUN = 4;

const base_hashtype_names = {
  1: 'ALL',
  2: 'NONE',
  3: 'SINGLE'
};

// split a script into its data pushes; stops at the first malformed push
function get_script_pushes(buf) {
  let pushes = [];
  let i = 0;

  while (i < buf.length) {
    const opcode = buf[i++];
    let len = -1;

    if (opcode >= 0x01 && opcode <= 0x4b)
      len = opcode;
    else if (opcode == 0x4c && i + 1 <= buf.length) {
      len = buf[i];
      i += 1;
    } else if (opcode == 0x4d && i + 2 <= buf.length) {
      len = buf.readUInt16LE(i);
      i += 2;
    } else if (opcode == 0x4e && i + 4 <= buf.length) {
      len = buf.readUInt32LE(i);
      i += 4;
    } else if (opcode >= 0x4c && opcode <= 0x4e)
      break;

    if (len >= 0) {
      if (i + len > buf.length)
        break;

      pushes.push(buf.subarray(i, i + len));
      i += len;
    }
  }

  return pushes;
}

// strict DER signature shape followed by one hashtype byte
function is_ecdsa_sig(buf) {
  if (buf.length < 9 || buf.length > 73)
    return false;

  if (buf[0] != 0x30 || buf[1] != buf.length - 3)
    return false;

  const len_r = buf[3];

  if (buf[2] != 0x02 || len_r == 0 || 5 + len_r >= buf.length)
    return false;

  const len_s = buf[5 + len_r];

  if (buf[4 + len_r] != 0x02 || len_s == 0 || len_r + len_s + 7 != buf.length)
    return false;

  return true;
}

function get_input_sigs(input) {
  let items = [];

  if (input.scriptSig != null && input.scriptSig.hex)
    items = get_script_pushes(Buffer.from(input.scriptSig.hex, 'hex'));

  if (Array.isArray(input.txinwitness))
    input.txinwitness.forEach(function(item) {
      items.push(Buffer.from(item, 'hex'));
    });

  return items.filter(is_ecdsa_sig);
}

function is_printable(buf) {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] < 0x20 || buf[i] > 0x7e)
      return false;
  }

  return true;
}

function get_printable_runs(buf) {
  const found = buf.toString('latin1').match(new RegExp('[\\x20-\\x7e]{' + CB_TAG_MIN_RUN + ',}', 'g'));

  return (found == null ? [] : found.map(function(run) { return run.trim(); }));
}

// text of the coinbase scriptSig after the BIP34 height push.
// Pools lay out the time, extranonce and tag differently, and printable bytes of the binary extranonce
// must not end up in the tag, so the text is looked for in this order:
// 1. pushed text anywhere: a push opcode followed by exactly that many printable bytes and then no more text (e.g. Miningcore, /RCC/)
// 2. raw text appended after the last parseable push (e.g. zpool)
// 3. any printable runs
function get_coinbase_tag(coinbase_hex) {
  const buf = Buffer.from(coinbase_hex, 'hex');
  let start = 0;

  if (buf.length > 0 && buf[0] >= 0x01 && buf[0] <= 0x4b)
    start = 1 + buf[0];

  let runs = [];

  for (let i = start; i < buf.length; i++) {
    const len = buf[i];

    // the pushed text must not run on into more text, or it is part of a raw tag after a binary byte
    if (len >= CB_TAG_MIN_RUN && len <= 0x4b && i + 1 + len <= buf.length && is_printable(buf.subarray(i + 1, i + 1 + len)) && (i + 1 + len == buf.length || !is_printable(buf.subarray(i + 1 + len, i + 2 + len)))) {
      runs.push(buf.subarray(i + 1, i + 1 + len).toString('latin1').trim());
      i += len;
    }
  }

  if (runs.length == 0) {
    let i = start;

    while (i < buf.length && buf[i] <= 0x4b && i + 1 + buf[i] <= buf.length)
      i += 1 + buf[i];

    runs = get_printable_runs(buf.subarray(i));
  }

  if (runs.length == 0)
    runs = get_printable_runs(buf.subarray(start));

  return (runs.length == 0 ? null : runs.join(' ').substring(0, CB_TAG_MAX_LENGTH));
}

function analyze_tx(tx) {
  let sighash = [];
  let sigs = 0;
  let unsigned = 0;
  let cb_tag = null;

  (tx.vin || []).forEach(function(input) {
    if (input.coinbase != null) {
      cb_tag = get_coinbase_tag(input.coinbase);
      return;
    }

    const input_sigs = get_input_sigs(input);

    if (input_sigs.length == 0)
      unsigned++;

    input_sigs.forEach(function(sig) {
      const hashtype = sig[sig.length - 1];

      sigs++;

      if (sighash.indexOf(hashtype) == -1)
        sighash.push(hashtype);
    });
  });

  return {
    version: tx.version,
    sighash: sighash.sort(function(a, b) { return a - b; }),
    sigs: sigs,
    unsigned: unsigned,
    cb_tag: cb_tag
  };
}

function hashtype_name(hashtype) {
  const base = base_hashtype_names[hashtype & 0x1f];

  if (base == null)
    return '0x' + ('0' + hashtype.toString(16)).slice(-2);

  return base +
    (hashtype & SIGHASH_FORKID ? '|FORKID' : '') +
    (hashtype & SIGHASH_ANYONECANPAY ? '|ANYONECANPAY' : '');
}

module.exports = {
  RIN3_VERSION: RIN3_VERSION,
  SIGHASH_FORKID: SIGHASH_FORKID,
  analyze_tx: analyze_tx,
  hashtype_name: hashtype_name,
  is_ecdsa_sig: is_ecdsa_sig,
  get_coinbase_tag: get_coinbase_tag
};
