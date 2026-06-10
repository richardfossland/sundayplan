import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// OpenNext → Cloudflare Workers adapter for the SundayPlan web app.
// Default config is sufficient: all state lives in Supabase (no ISR / edge
// cache to configure). Deployed at plan.sundaysuite.app — see DEPLOY.md.
export default defineCloudflareConfig();
