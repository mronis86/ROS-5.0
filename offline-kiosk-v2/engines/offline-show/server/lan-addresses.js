'use strict';

const os = require('os');

/** IPv4 LAN addresses (skip loopback / internal pseudo-interfaces). */
function getLanIPv4Addresses() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;
      addrs.push({ name, address: net.address });
    }
  }
  return addrs;
}

function formatLanUrls(port) {
  const p = Number(port) || 3004;
  const urls = [`http://127.0.0.1:${p}/`];
  for (const { address } of getLanIPv4Addresses()) {
    urls.push(`http://${address}:${p}/`);
  }
  return urls;
}

module.exports = { getLanIPv4Addresses, formatLanUrls };
