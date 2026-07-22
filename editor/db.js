// Supabase client for AkashicSwaps — the persistence layer for stars, levels,
// progress and (later) cloud-saved bundles. Replaces localStorage-only state.
//
// The PUBLISHABLE (anon) key is DESIGNED to ship in client code — Row Level
// Security in schema.sql is the security boundary, NOT the key. Secret /
// service_role keys never live in this file or anywhere in the repo.
//
// CDN ESM import, no build step — matches the site's vanilla-JS, no-bundler
// stack. If the service worker (network-first) ever needs to cache this at a
// version, it passes through untouched like every other module.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://eodepykfvphrsuvlasum.supabase.co';
// Publishable key — safe to ship (RLS is the boundary). Rotate here if ever needed.
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ofI9efm2CEvJiQ-qRt5NvA_FesTRmax';

// Single shared client. Auth session persists in localStorage (Supabase default),
// so a signed-in player stays signed in across visits.
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
