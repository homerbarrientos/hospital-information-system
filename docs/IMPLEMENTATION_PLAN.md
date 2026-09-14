# Hospital ONE Implementation Plan

## Current milestone

Increment 0 and the demonstrable shell of the Phase 1 workflows.

## Completed

- Next.js App Router and TypeScript project initialized.
- Responsive hospital application shell and navigation.
- Demonstration views for Dashboard, Patients, Queue, OPD Clinical, Billing, Reports, Administration, and Audit.
- Supabase browser and server client factories.
- Initial normalized PostgreSQL schema and deny-by-default RLS foundation.
- Environment example and local Supabase configuration.

## Next

1. Connect a dedicated Supabase development project.
2. Apply and test the foundation migration.
3. Create authentication, onboarding, and facility-selection workflows.
4. Implement privilege-aware database functions and RLS tests.
5. Replace synthetic patient list with the first real patient identity vertical slice.
6. Add registration, duplicate review, appointment, and queue mutations.

## Rule

Live patient information must not be entered until authentication, RLS tests, private storage controls, audit verification, and pilot approval are complete.
