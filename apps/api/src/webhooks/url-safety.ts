import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { lookup as dnsLookupAsync } from 'node:dns/promises';
import { BlockList, isIP, type LookupFunction } from 'node:net';

// A webhook address is typed by a customer, and WorkHub's servers then call it. Without
// these checks it could point at our own network (the database, cloud metadata on
// 169.254.169.254, the API on localhost). Addresses are checked when a webhook is saved
// and again at every connection, after DNS, so a name can't switch to a private address
// later. Redirects are never followed.

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6');
}

/** True for an address on the public internet. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !blocked.check(ip, 'ipv4');
  if (family === 6) {
    // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is judged as IPv4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return isPublicAddress(mapped[1]!);
    return !blocked.check(ip, 'ipv6');
  }
  return false;
}

export class UnsafeUrlError extends Error {}

/**
 * The address's shape: https only, no user name or password, and not a private address
 * typed in directly. `allowPrivate` (development and tests only) also allows http and
 * private addresses.
 */
export function checkUrl(raw: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Enter a full web address, starting with https://');
  }
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) throw new UnsafeUrlError('The address must start with https://');
  if (url.username || url.password) throw new UnsafeUrlError("Don't put a user name or password in the address.");
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) ? !isPublicAddress(host) : host === 'localhost' || host.endsWith('.localhost') || !host.includes('.')) {
    throw new UnsafeUrlError('The address must be on the public internet, not a private or local network.');
  }
  return url;
}

/** Saving a webhook: the name must exist and point only at public addresses. */
export async function checkResolves(url: URL, allowPrivate: boolean, lookup = dnsLookupAsync): Promise<void> {
  if (allowPrivate || isIP(url.hostname.replace(/^\[|\]$/g, ''))) return;
  let addresses: LookupAddress[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new UnsafeUrlError(`We couldn't find ${url.hostname}. Check the address.`);
  }
  if (addresses.length === 0 || !addresses.every((a) => isPublicAddress(a.address))) {
    throw new UnsafeUrlError('The address must be on the public internet, not a private or local network.');
  }
}

/** For http(s).request: resolves the name, then refuses to connect to a private address. */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as LookupAddress[];
    const unsafe = list.find((a) => !isPublicAddress(a.address));
    if (unsafe || list.length === 0) return callback(new UnsafeUrlError(`Refused: ${hostname} points to a private address`), '', 0);
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};
