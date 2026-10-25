// Deployment only: the OS resolver cannot resolve this COS CNAME in the current network.
// Address was checked against two public DNS resolvers; TLS still verifies the original host.
const dns = require('node:dns');
const originalLookup = dns.lookup;
const host = 'function-codes-1258016615.cos.ap-guangzhou.myqcloud.com';
const address = '223.109.215.252';
dns.lookup = function lookup(hostname, options, callback) {
  if (hostname !== host) return originalLookup.apply(this, arguments);
  const actualOptions = typeof options === 'function' ? {} : options ?? {};
  const done = typeof options === 'function' ? options : callback;
  if (actualOptions.all) done(null, [{ address, family: 4 }]);
  else done(null, address, 4);
};
