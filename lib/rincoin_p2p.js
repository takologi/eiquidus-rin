'use strict';

// Minimal, defensive Bitcoin-family p2p wire protocol client used only to crawl the
// network for reachability + version/subversion + address gossip (getaddr/addr).
// This intentionally implements only version/verack/getaddr/addr - nothing else -
// and never trusts data received from a peer without bounds-checking it first.

const net = require('net');
const crypto = require('crypto');
const settings = require('./settings');

const HEADER_LEN = 24;
const CMD_LEN = 12;
const MAX_PAYLOAD_LEN = 4 * 1024 * 1024; // refuse to allocate for anything bigger than this
const IPV4_MAPPED_PREFIX = Buffer.from('00000000000000000000ffff', 'hex');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function doubleSha256(buf) {
  return sha256(sha256(buf));
}

function getMagicBytes() {
  const hex = (settings.network_crawler && settings.network_crawler.magic_bytes) || '52494e43';
  return Buffer.from(hex, 'hex');
}

function encodeVarInt(n) {
  if (n < 0xfd) {
    return Buffer.from([n]);
  } else if (n <= 0xffff) {
    const b = Buffer.alloc(3);
    b.writeUInt8(0xfd, 0);
    b.writeUInt16LE(n, 1);
    return b;
  } else if (n <= 0xffffffff) {
    const b = Buffer.alloc(5);
    b.writeUInt8(0xfe, 0);
    b.writeUInt32LE(n, 1);
    return b;
  }
  const b = Buffer.alloc(9);
  b.writeUInt8(0xff, 0);
  b.writeBigUInt64LE(BigInt(n), 1);
  return b;
}

// reads a varint from buf starting at offset, returns { value, next } or null if not enough data yet
function readVarInt(buf, offset) {
  if (offset >= buf.length) return null;
  const first = buf.readUInt8(offset);
  if (first < 0xfd) {
    return { value: first, next: offset + 1 };
  } else if (first === 0xfd) {
    if (offset + 3 > buf.length) return null;
    return { value: buf.readUInt16LE(offset + 1), next: offset + 3 };
  } else if (first === 0xfe) {
    if (offset + 5 > buf.length) return null;
    return { value: buf.readUInt32LE(offset + 1), next: offset + 5 };
  }
  if (offset + 9 > buf.length) return null;
  const value = buf.readBigUInt64LE(offset + 1);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return null; // refuse absurd sizes
  return { value: Number(value), next: offset + 9 };
}

function encodeVarString(str) {
  const strBuf = Buffer.from(str, 'utf8');
  return Buffer.concat([encodeVarInt(strBuf.length), strBuf]);
}

// canonical (RFC 5952) text form of an ipv6 address - the same form the coin daemon's rpc output uses,
// so addresses learned via addr gossip and via getpeerinfo/getnodeaddresses key to the same db record.
// The WHATWG URL parser does the validation + canonicalization (lowercase, longest zero run compressed,
// dotted ipv4 tails converted to hex); returns null for anything that isn't a valid ipv6 address
function canonicalIpv6(ipStr) {
  if (!net.isIPv6(ipStr)) return null;
  try {
    return new URL('http://[' + ipStr + ']/').hostname.slice(1, -1);
  } catch (e) {
    return null;
  }
}

function ipv6ToBytes(ipStr) {
  const canonical = canonicalIpv6(ipStr);
  if (canonical == null) return null;

  const halves = canonical.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = (halves.length > 1 && halves[1]) ? halves[1].split(':') : [];
  const groups = head.concat(new Array(8 - head.length - tail.length).fill('0'), tail);
  const buf = Buffer.alloc(16);

  groups.forEach((g, i) => buf.writeUInt16BE(parseInt(g, 16), i * 2));
  return buf;
}

function ipToNetAddrBytes(ipStr) {
  const buf = Buffer.alloc(16);

  if (net.isIPv4(ipStr)) {
    buf[10] = 0xff;
    buf[11] = 0xff;
    Buffer.from(ipStr.split('.').map(Number)).copy(buf, 12);
  } else {
    const v6 = ipv6ToBytes(ipStr);
    // leave as zero buffer for any unparsable address - dummy addr fields are fine here
    if (v6 != null) v6.copy(buf, 0);
  }

  return buf;
}

// converts a raw 16-byte net_addr ip field back to a display string, or null if unparsable
function netAddrBytesToIp(buf16) {
  if (!Buffer.isBuffer(buf16) || buf16.length !== 16) return null;

  if (buf16.subarray(0, 12).equals(IPV4_MAPPED_PREFIX)) {
    return Array.from(buf16.subarray(12, 16)).join('.');
  }

  const groups = [];
  for (let i = 0; i < 16; i += 2) groups.push(buf16.readUInt16BE(i).toString(16));
  return canonicalIpv6(groups.join(':'));
}

function encodeNetAddr(ipStr, port, services) {
  // pre-BIP155 net_addr with no leading timestamp, used inside the version message
  const buf = Buffer.alloc(26);
  buf.writeBigUInt64LE(BigInt(services || 0), 0);
  ipToNetAddrBytes(ipStr).copy(buf, 8);
  buf.writeUInt16BE(port || 0, 24);
  return buf;
}

function buildMessage(command, payload) {
  const magic = getMagicBytes();
  const cmdBuf = Buffer.alloc(CMD_LEN, 0);
  cmdBuf.write(command, 0, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(payload.length, 0);
  const checksum = doubleSha256(payload).slice(0, 4);
  return Buffer.concat([magic, cmdBuf, lenBuf, checksum, payload]);
}

function buildVersionPayload(opts) {
  const version = Buffer.alloc(4);
  version.writeInt32LE(opts.protocolVersion, 0);
  const services = Buffer.alloc(8);
  services.writeBigUInt64LE(BigInt(0), 0); // NODE_NONE - we are a crawler, not a full node
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1000)), 0);
  const addrRecv = encodeNetAddr(opts.remoteIp, opts.remotePort, 0);
  const addrFrom = encodeNetAddr('0.0.0.0', 0, 0);
  const nonce = crypto.randomBytes(8);
  const userAgent = encodeVarString(opts.userAgent);
  const startHeight = Buffer.alloc(4);
  startHeight.writeInt32LE(0, 0);
  const relay = Buffer.from([0]);

  return Buffer.concat([version, services, timestamp, addrRecv, addrFrom, nonce, userAgent, startHeight, relay]);
}

// parses a version message payload, returns { protocolVersion, services, userAgent, startHeight } or null on malformed data
function parseVersionPayload(payload) {
  if (payload.length < 4 + 8 + 8 + 26 + 26 + 8) return null; // minimum length up to (excluding) nonce+useragent
  let offset = 0;
  const protocolVersion = payload.readInt32LE(offset); offset += 4;
  const services = payload.readBigUInt64LE(offset).toString(); offset += 8;
  offset += 8; // timestamp, unused
  offset += 26; // addr_recv, unused
  offset += 26; // addr_from, unused
  offset += 8; // nonce, unused

  const uaLen = readVarInt(payload, offset);
  if (!uaLen || uaLen.next + uaLen.value > payload.length) return null;
  const userAgent = payload.slice(uaLen.next, uaLen.next + uaLen.value).toString('utf8').replace(/[^\x20-\x7e]/g, '');
  offset = uaLen.next + uaLen.value;

  let startHeight = 0;
  if (offset + 4 <= payload.length) {
    startHeight = payload.readInt32LE(offset);
  }

  return { protocolVersion, services, userAgent, startHeight };
}

// parses a legacy addr message payload, returns array of { address, port, services, time } or null on malformed data
function parseAddrPayload(payload) {
  const count = readVarInt(payload, 0);
  if (!count) return null;
  if (count.value > 10000) return null; // sanity cap, standard bitcoin addr messages cap at 1000

  const entries = [];
  let offset = count.next;
  const ENTRY_LEN = 4 + 8 + 16 + 2; // time + services + ip + port

  for (let i = 0; i < count.value; i++) {
    if (offset + ENTRY_LEN > payload.length) return null;
    const time = payload.readUInt32LE(offset);
    const services = payload.readBigUInt64LE(offset + 4).toString();
    const ipBytes = payload.slice(offset + 12, offset + 28);
    const port = payload.readUInt16BE(offset + 28);
    const address = netAddrBytesToIp(ipBytes);

    if (address) {
      entries.push({ address, port, services, time });
    }

    offset += ENTRY_LEN;
  }

  return entries;
}

// crawls a single node: connects, performs version/verack handshake, sends getaddr,
// collects any addr replies for getaddrWaitMs, then closes the connection.
// opts.handshakeOnly: stop right after the version/verack handshake instead of sending getaddr and
// waiting out the peer's deliberately delayed addr reply - a cheap liveness check (~1-2s per node
// instead of ~getaddr_wait_ms) used to keep the "Full" view fresh.
// cb(null, result) is always called (never cb(err, ...)) - failures are reflected via result.reachable = false
// so callers never need to distinguish "network error" from "peer refused" - both just mean "not reachable right now".
function crawlNode(targetIp, targetPort, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts;
    opts = {};
  }

  const handshakeOnly = !!(opts && opts.handshakeOnly);
  const cfg = settings.network_crawler || {};
  const connectTimeoutMs = cfg.connect_timeout_ms || 5000;
  const getaddrWaitMs = (handshakeOnly ? 0 : (cfg.getaddr_wait_ms || 6000));
  const protocolVersion = cfg.protocol_version || 70017;
  const userAgent = cfg.user_agent || '/EiquidusNetworkCrawler:1.0/';

  let settled = false;
  let recvBuffer = Buffer.alloc(0);
  let remoteVersionInfo = null;
  const addresses = [];
  let verackReceived = false;
  let getaddrWaitTimer = null;
  let connectTimer = null;

  const result = () => ({
    reachable: !!remoteVersionInfo,
    protocol: remoteVersionInfo ? remoteVersionInfo.protocolVersion : null,
    subversion: remoteVersionInfo ? remoteVersionInfo.userAgent.replace(/^\/|\/$/g, '') : '',
    services: remoteVersionInfo ? remoteVersionInfo.services : '',
    addresses
  });

  const socket = new net.Socket();

  function finish() {
    if (settled) return;
    settled = true;
    clearTimeout(connectTimer);
    clearTimeout(getaddrWaitTimer);
    socket.removeAllListeners();
    socket.destroy();
    cb(null, result());
  }

  connectTimer = setTimeout(finish, connectTimeoutMs + getaddrWaitMs + 2000);

  socket.setTimeout(connectTimeoutMs);

  socket.once('timeout', finish);
  socket.once('error', finish);
  socket.once('close', finish);

  socket.connect(targetPort, targetIp, () => {
    socket.setTimeout(0); // switch to explicit timers now that the connection is live

    const versionPayload = buildVersionPayload({
      protocolVersion,
      userAgent,
      remoteIp: targetIp,
      remotePort: targetPort
    });
    socket.write(buildMessage('version', versionPayload));
  });

  socket.on('data', (chunk) => {
    recvBuffer = Buffer.concat([recvBuffer, chunk]);

    // drain as many complete messages as are currently buffered
    for (;;) {
      if (settled) return; // a handled message may have already finished (and destroyed) this connection
      if (recvBuffer.length < HEADER_LEN) break;

      const magic = getMagicBytes();
      if (!recvBuffer.slice(0, magic.length).equals(magic)) {
        // not our network / garbage - abort this connection entirely
        return finish();
      }

      const command = recvBuffer.slice(4, 4 + CMD_LEN).toString('ascii').replace(/\0+$/, '');
      const payloadLen = recvBuffer.readUInt32LE(16);

      if (payloadLen > MAX_PAYLOAD_LEN) {
        return finish(); // refuse to buffer for an absurd/malicious length claim
      }

      if (recvBuffer.length < HEADER_LEN + payloadLen) break; // wait for more data

      const checksum = recvBuffer.slice(20, 24);
      const payload = recvBuffer.slice(HEADER_LEN, HEADER_LEN + payloadLen);
      recvBuffer = recvBuffer.slice(HEADER_LEN + payloadLen);

      const expectedChecksum = doubleSha256(payload).slice(0, 4);
      if (!checksum.equals(expectedChecksum)) {
        continue; // drop this single malformed message, keep the connection alive
      }

      handleMessage(command, payload);
    }
  });

  function handleMessage(command, payload) {
    if (command === 'version') {
      const parsed = parseVersionPayload(payload);
      if (parsed) {
        remoteVersionInfo = parsed;
      }
      socket.write(buildMessage('verack', Buffer.alloc(0)));

      if (handshakeOnly && verackReceived && remoteVersionInfo) {
        finish();
      }
    } else if (command === 'verack') {
      if (!verackReceived) {
        verackReceived = true;

        if (handshakeOnly) {
          // done once both sides' version/verack have been seen (verack normally follows version)
          if (remoteVersionInfo) {
            finish();
          }
          return;
        }

        socket.write(buildMessage('getaddr', Buffer.alloc(0)));
        getaddrWaitTimer = setTimeout(finish, getaddrWaitMs);
      }
    } else if (command === 'addr') {
      const entries = parseAddrPayload(payload);
      if (entries) {
        addresses.push(...entries);
      }
    } else if (command === 'ping') {
      if (payload.length === 8) {
        socket.write(buildMessage('pong', payload));
      }
    }
    // all other commands are intentionally ignored
  }
}

module.exports = {
  crawlNode,
  // exported for standalone/manual testing only
  buildMessage,
  buildVersionPayload,
  parseVersionPayload,
  parseAddrPayload,
  ipToNetAddrBytes,
  netAddrBytesToIp,
  canonicalIpv6,
  encodeVarInt,
  readVarInt
};
