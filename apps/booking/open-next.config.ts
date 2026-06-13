import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// OpenNext → Cloudflare Workers adapter for the SundayBooking app.
// Default config is sufficient: all state lives in Supabase (no ISR / edge
// cache to configure). Deployed at booking.sundaysuite.app.
export default defineCloudflareConfig();
