// Insert your Supabase credentials and export a ready client.
export const SUPABASE_URL = "https://imhkmeudblufdvekrwvo.supabase.co"; // <-- ändern
export const SUPABASE_ANON_KEY = "sb_publishable_3qgnAtJepW90yQfIRhqCFA_hv76Wudl"; // <-- ändern

if (SUPABASE_URL.includes("YOUR-PROJECT")) {
  console.warn("Bitte SUPABASE_URL und SUPABASE_ANON_KEY in supabase.js eintragen.");
}

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: "public" }
});
