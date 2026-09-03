# TransportDesk

Transport management system for Euro International School.

## Project Structure

- frontend/     Website source (live). Plain ES modules, no build step
- app/          Older copy of the frontend
- sql/          Database objects
- supabase/     Supabase configuration & migrations
- python/       Automation & routing tools
- docs/         Documentation — start with docs/HANDOFF.md
- tests/        Testing


## Running it

```bash
python -m http.server 8000 --directory frontend
```

No build step, no bundler. The backend is Supabase; there is no server of our own.

## For developers

Read [docs/HANDOFF.md](docs/HANDOFF.md) first, then
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/DOMAIN_RULES.md](docs/DOMAIN_RULES.md) and
[docs/ANALYSIS_METHODS.md](docs/ANALYSIS_METHODS.md).

**This repository is public and must never contain student names, addresses, coordinates or
GPS tracks.** `.env`, `GPS Files/` and the analysis bundle are shared privately.
