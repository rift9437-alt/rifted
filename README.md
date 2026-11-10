# Riftted Realities

Public gaming platform + separate admin portal.

## Run

```bash
npm install
npm start
```

- Public site: http://localhost:3000
- Admin portal: http://localhost:3000/admin

## Admin login (local default)

- Email: admin@riftted.local
- Password: ChangeMeNow!123

Change these in production via environment variables:

- ADMIN_EMAIL
- ADMIN_PASSWORD
- SESSION_SECRET
- DATABASE_URL (optional Neon PostgreSQL)

## Structure

- index.html — public SPA + admin SPA (URL-selected)
- server.js — Express API, sessions, admin routes
- games/ — independent game folders (City of Crime preserved)

## Security notes

- Admin sessions: HTTP-only cookies
- CSRF token required on mutating admin routes
- Login rate limited
- Private request notes never exposed on public APIs
- No public admin registration
