/**
 * URL validation with SSRF prevention (OWASP A10).
 * Rejects private/internal IP addresses, localhost, and non-HTTP schemes.
 * Also blocks IPv6-mapped IPv4 addresses in both dotted-decimal and hex forms.
 */
export function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Invalid URL scheme: ${parsed.protocol}. Only http: and https: are allowed.`);
  }

  // new URL('http://[::1]/').hostname === '::1' (brackets already stripped)
  const hostname = parsed.hostname.toLowerCase();

  // Block localhost variants
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    throw new Error(`SSRF blocked: localhost URLs are not allowed.`);
  }

  // Block private IP ranges (RFC 1918, link-local, loopback)
  if (isPrivateIp(hostname)) {
    throw new Error(`SSRF blocked: private/internal IP addresses are not allowed.`);
  }

  // Block metadata endpoints (cloud providers)
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    throw new Error(`SSRF blocked: cloud metadata endpoints are not allowed.`);
  }
}

function isPrivateIp(hostname: string): boolean {
  // Remove brackets for IPv6 (URL.hostname strips them, but be safe)
  const h = hostname.replace(/^\[|\]$/g, '');

  // Handle IPv6-mapped IPv4 in dotted-decimal form (::ffff:10.0.0.1)
  const mappedDottedMatch = h.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (mappedDottedMatch) {
    return isPrivateIpv4(mappedDottedMatch[1]);
  }

  // Handle IPv6-mapped IPv4 in hex form (::ffff:a00:1)
  // Node's URL parser normalizes [::ffff:10.0.0.1] → ::ffff:a00:1
  const mappedHexMatch = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mappedHexMatch) {
    const hi = parseInt(mappedHexMatch[1], 16);
    const lo = parseInt(mappedHexMatch[2], 16);
    const a = (hi >> 8) & 0xff;
    const b = hi & 0xff;
    const c = (lo >> 8) & 0xff;
    const d = lo & 0xff;
    return isPrivateIpv4(`${a}.${b}.${c}.${d}`);
  }

  // Plain IPv4
  if (isPrivateIpv4(h)) return true;

  // IPv6 loopback
  if (h === '::1') return true;
  // IPv6 link-local (fe80::)
  if (h.startsWith('fe80:')) return true;
  // IPv6 private (fc00::/7 — covers fc and fd prefixes)
  if (h.startsWith('fc') || h.startsWith('fd')) return true;
  // IPv6 unspecified (::)
  if (h === '::' || h === '0:0:0:0:0:0:0:0') return true;

  return false;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!parts) return false;

  const [, aStr, bStr] = parts;
  const a = Number(aStr);
  const b = Number(bStr);

  // Validate octets are in range
  if (a > 255 || b > 255) return false;

  // 0.0.0.0/8
  if (a === 0) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local, AWS metadata)
  if (a === 169 && b === 254) return true;

  return false;
}
