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
// Browser Maps key. This is a PUBLIC client key — it is safe to ship only when it is
// (1) restricted by HTTP referrer to your site's domain, and (2) limited to the Maps
// JavaScript API, Directions API and Distance Matrix API in Google Cloud Console.
// Enable those APIs + billing on the key's project or the map falls back to OpenStreetMap.
export const GOOGLE_MAPS_API_KEY = "AIzaSyA9tqHUw96KjrH1sdRxKTXs3Yl9ge3g2xk";
