# Defied MGMT — website

Next.js app. The public site (home / about / team / roster / contact), the staff
dashboard, and the client portal. Data is stored in the browser (localStorage) in
this version — great for launching the public site. To make the dashboard truly
multi-user (clients edit their own splits and everyone sees it), connect a database
(e.g. Supabase) later.

## Run locally
    npm install
    npm run dev
    # open http://localhost:3000

## Deploy to Vercel
1. Push this folder to a new GitHub repo.
2. vercel.com → Add New → Project → Import that repo.
3. Framework auto-detects as Next.js — leave defaults → Deploy.
4. Add your domain under Settings → Domains.

## Demo logins (dashboard/portal)
- Staff:  admin@defiedmgmt.com  /  defied123
- Client: stacke@defiedmgmt.com /  client123

Change these in components/App.jsx (the seed) or via the Users tab.

## Notes
- Roster/team photos load from https://www.defiedmgmt.com/assets/... (your live images).
- Song autofill uses Apple's free iTunes Search API (type song + artist).
