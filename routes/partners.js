import express from 'express';
import { requireUser } from '../services/requireUser.js';
import { getSupabaseAdmin } from '../services/supabaseAdmin.js';

const router = express.Router();

// Haversine distance in km between two lat/lon points.
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// GET /api/partners/nearby?lat=&lon=&radius_km=&state=&district=
// Never fabricates a center: if none exist in range, returns an empty list
// and the frontend must say so plainly (no invented results).
router.get('/nearby', requireUser, async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const radiusKm = parseFloat(req.query.radius_km) || 25;
  const { state, district } = req.query;

  try {
    const supabase = getSupabaseAdmin();
    let query = supabase.from('partner_centers').select('*').eq('active', true);
    if (state) query = query.eq('state', state);
    if (district) query = query.eq('district', district);
    const { data, error } = await query;
    if (error) throw error;

    let centers = data || [];

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      centers = centers
        .map((c) => ({
          ...c,
          distance_km: (c.latitude !== null && c.longitude !== null)
            ? Math.round(distanceKm(lat, lon, c.latitude, c.longitude) * 10) / 10
            : null,
        }))
        .filter((c) => c.distance_km === null || c.distance_km <= radiusKm)
        .sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));
    }

    res.json({ centers, searchedBy: Number.isFinite(lat) ? 'location' : (state || district) ? 'state_district' : 'none' });
  } catch (err) {
    console.error('partners nearby error:', err.message);
    res.status(500).json({ error: 'Could not search for nearby assistance centers', code: 'PARTNERS_ERROR' });
  }
});

export default router;
