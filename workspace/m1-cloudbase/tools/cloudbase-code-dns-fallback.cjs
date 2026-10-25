// Scoped to a backup-download CLI process. Resolve Tencent COS code storage
// through Tencent DNS when the host's default resolver cannot answer.
const dns = require('node:dns');
const target = 'function-codes-1258016615.cos.ap-guangzhou.myqcloud.com';
const resolver = new dns.Resolver();
resolver.setServers(['119.29.29.29']);
const original = dns.lookup;

dns.lookup = function lookup(hostname, options, callback) {
  if (hostname !== target) return original.apply(dns, arguments);
  const cb = typeof options === 'function' ? options : callback;
  const all = typeof options === 'object' && options?.all === true;
  resolver.resolve4(target, (error, addresses) => {
    if (error || !addresses?.length) return cb(error ?? new Error('DNS_UNAVAILABLE'));
    if (all) return cb(null, addresses.map(address => ({ address, family: 4 })));
    return cb(null, addresses[0], 4);
  });
};
