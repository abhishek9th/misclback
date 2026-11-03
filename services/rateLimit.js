// Small in-process rate limiter (no dependency). Counts requests per client key in a sliding
// 1-minute window. Fine for one server instance; behind several instances use a shared store.
export function rateLimit({ max = 120, windowMs = 60000, key = (req) => req.user?.id || req.ip, message = 'Too many requests. Please wait a moment and try again.' } = {}) {
  const hits = new Map();
  setInterval(() => {                       // drop stale clients so the map cannot grow forever
    const now = Date.now();
    for (const [k, arr] of hits) if (!arr.some((t) => now - t < windowMs)) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const k = key(req);
    const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: message, code: 'RATE_LIMITED' });
    }
    arr.push(now);
    hits.set(k, arr);
    return next();
  };
}

// Origins allowed to call this API from a browser. Set ALLOWED_ORIGINS=https://your-site.vercel.app
// (comma separated). Localhost is always allowed for development. If it is not set, every origin is
// allowed (so an existing deployment does not break) and a warning is printed.
export function corsOptions() {
  const list = String(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  if (list.length === 0) {
    console.warn('WARNING: ALLOWED_ORIGINS is not set — CORS allows every origin. Set it in production.');
    return {};
  }
  return {
    origin(origin, cb) {
      if (!origin) return cb(null, true);                                   // same-origin / curl / server-to-server
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
      return cb(null, list.includes(origin.replace(/\/$/, '')));
    },
  };
}
