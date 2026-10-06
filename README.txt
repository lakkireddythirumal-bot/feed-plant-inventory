Feed MIS Supabase Site

- Supabase only; no Google API.
- Date selector uses activity_date.
- Category tabs filter the selected date.
- Main stock uses latest_activity.Closing (or CLOSING for PP).
- Clicking a material shows Latest Activity, For The Month and For The Year using the actual dynamic JSON keys.
- Edit SUPABASE_KEY in index.html only if your project publishable key changes.
- Never put a Supabase secret/service-role key in this site.
