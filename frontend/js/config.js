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

// Used ONLY for the occasional one-time route recompute (Directions API). Keep it
// HTTP-referrer restricted to your site's domain in Google Cloud Console, and limited
// to the Directions API. Rotate it since it was shared in chat.
export const GOOGLE_DIRECTIONS_KEY = "AIzaSyA9tqHUw96KjrH1sdRxKTXs3Yl9ge3g2xk";
