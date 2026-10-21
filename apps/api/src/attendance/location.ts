import { BlockList, isIP } from 'node:net';

export interface SiteRule {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  ipRanges: string[];
}

/** Great-circle distance in metres. */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** "::ffff:203.0.113.5" → "203.0.113.5"; anything that isn't an IP → null. */
export function normalizeIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const v = ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  return isIP(v) ? v : null;
}

/** Whether "203.0.113.0/24" or "2001:db8::/32" or a bare address is valid. */
export function isValidRange(range: string): boolean {
  const [addr, prefix] = range.split('/');
  const family = isIP(addr ?? '');
  if (!family) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

export function ipInRanges(ip: string, ranges: string[]): boolean {
  const family = isIP(ip);
  if (!family || ranges.length === 0) return false;
  const list = new BlockList();
  for (const r of ranges) {
    const [addr, prefix] = r.split('/') as [string, string | undefined];
    const f = isIP(addr);
    if (!f) continue;
    const type = f === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) list.addAddress(addr, type);
    else list.addSubnet(addr, Number(prefix), type);
  }
  return list.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/** GPS accuracy beyond this is too vague to place someone inside a site. */
const MAX_TRUSTED_ACCURACY = 150;

export interface ZoneResult {
  /** null when there are no rules to check against. */
  inZone: boolean | null;
  siteId: string | null;
  flags: ('outside_zone' | 'no_location')[];
}

/**
 * Checks a check-in against the workspace's sites. Outside every site is flagged,
 * never blocked. Remote people, and workspaces without sites, aren't checked.
 */
export function checkZone(
  sites: SiteRule[],
  where: { ip: string | null; latitude?: number; longitude?: number; accuracyMeters?: number },
  remote: boolean,
): ZoneResult {
  if (remote || sites.length === 0) return { inZone: null, siteId: null, flags: [] };
  const hasGps = where.latitude !== undefined && where.longitude !== undefined;
  for (const s of sites) {
    if (where.ip && ipInRanges(where.ip, s.ipRanges)) return { inZone: true, siteId: s.id, flags: [] };
    if (hasGps && s.latitude !== null && s.longitude !== null && s.radiusMeters !== null) {
      const slack = Math.min(where.accuracyMeters ?? 0, MAX_TRUSTED_ACCURACY);
      if (distanceMeters(where.latitude!, where.longitude!, s.latitude, s.longitude) <= s.radiusMeters + slack) {
        return { inZone: true, siteId: s.id, flags: [] };
      }
    }
  }
  return { inZone: false, siteId: null, flags: hasGps ? ['outside_zone'] : ['outside_zone', 'no_location'] };
}

/** "Chrome on Android", "Safari on iPhone", … from a user-agent string. */
export function deviceLabel(userAgent: string | undefined | null): string | null {
  if (!userAgent) return null;
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /SamsungBrowser\//.test(ua)
        ? 'Samsung Internet'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown device';
}
