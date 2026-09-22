/* =========================================================
 * Pampa — where the database is, and whether there is one yet
 *
 * The app shipped as a device-only prototype: every account, booking and
 * escrow entry lived in localStorage, which meant two people could never
 * book each other. This file is the switch between that world and a real
 * Postgres database.
 *
 * Fill in the two values below and the app talks to Supabase. Leave them
 * empty and it behaves exactly as it does today — local, offline, one device.
 * That is deliberate: the deployed site stays working while the database is
 * being migrated, instead of being half-wired and broken.
 *
 * Where to find the values: your Supabase project → Settings → API.
 *   url      — "Project URL", like https://abcdefghijklm.supabase.co
 *   anonKey  — the "anon / public" key
 *
 * The anon key is not a secret. It is in this file, in the shipped bundle and
 * in every browser that opens the app, and that is fine — it grants nothing on
 * its own. What protects the data is that every table is closed in Row Level
 * Security and every read and write has to go through a database function that
 * authenticates the session token (see supabase/migrations/).
 *
 * The one key that must NEVER appear in this file is the service_role key. It
 * bypasses Row Level Security entirely, and anything in this file is public.
 * It belongs on a server — an Edge Function, or the push relay.
 * ========================================================= */

const PAMPA_SUPABASE = {
  url: "",
  anonKey: "",
};

/* True once the two values above are filled in. Everything that talks to the
   database checks this first and falls back to local storage when it is false,
   which is why an empty config is a supported state and not a broken one. */
function dbConfigured() {
  return !!(PAMPA_SUPABASE.url && PAMPA_SUPABASE.anonKey);
}
