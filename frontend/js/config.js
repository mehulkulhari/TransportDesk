export const CONFIG = {
    APP_NAME: "TransportDesk",

    MAP: {
        DEFAULT_ZOOM: 12,
        MAX_ZOOM: 20
    }
};

// Browser-safe Supabase project settings. The browser client must be created
// from an imported module, before app.js runs its legacy initialization code.
export const SUPABASE_URL = "https://ftlaicvkwmxkehlefeap.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_N4uceGsyAcLOUl_nDgzRbw_HhJCbcOZ";

// Base map uses free OpenStreetMap tiles. Bus routes are drawn as REAL road paths
// decoded from Google Directions results computed once and cached in Supabase
// (table bus_route_geo) — so normal use makes ZERO Google API calls (no ongoing cost).
// Leave this empty to keep the free basemap; only set it if you deliberately want
// Google map tiles (requires enabling the "Maps JavaScript API" + billing, and incurs
// per-load cost).
export const GOOGLE_MAPS_API_KEY = "";

// Used by the Route Planner (and route recompute) for live Google Directions in
// the browser. Safe to ship ONLY because it is HTTP-referrer restricted to this
// site's domain in Google Cloud Console — a copied key won't work elsewhere.
// Keep it restricted; rotate if it ever leaks beyond the referrer allow-list.
export const GOOGLE_DIRECTIONS_KEY = "AIzaSyD13KhPhVE6dEy6b_CZ2_MRyUD2avlELYg";
