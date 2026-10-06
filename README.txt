# Fresh Supabase-only Feed MIS Site

This is a completely new standalone site. It does not use Google Sheets or Google APIs.

## Setup
1. Create a Supabase project.
2. Create a table named `feed_mis`.
3. Open `index.html`.
4. Replace:
   - `YOUR_SUPABASE_URL`
   - `YOUR_SUPABASE_ANON_KEY`
5. Open `index.html` in a browser.

The page reads data directly from Supabase using the Supabase JS client.

## Notes
- The page automatically displays all columns returned by `feed_mis`.
- Search works with `material_name`, `material`, or `part_name`.
- Date filtering works with `date` or `mis_date`.
- It currently loads up to 1000 rows per refresh to keep the first version simple.
- No old project files are required.
