import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ackasdvzyusmsvdanmav.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFja2FzZHZ6eXVzbXN2ZGFubWF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMjUwOTEsImV4cCI6MjEwNDcwMTA5MX0.MeD6h_YX1OU68ECb344cMGlOEZCtjUM0n4FSXK86Ctg";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
