# Hospital ONE Implementation Plan

## Current milestone

Infirmary Core foundation and complete patient-to-payment workflow.

## Completed

- Next.js App Router and TypeScript project initialized.
- Responsive hospital application shell and navigation.
- Demonstration views for Dashboard, Patients, Queue, OPD Clinical, Billing, Reports, Administration, and Audit.
- Supabase browser and server client factories.
- Initial normalized PostgreSQL schema and deny-by-default RLS foundation.
- Environment example and local Supabase configuration.
- Infirmary module navigation and demonstration views for ADT, orders/results, pharmacy, and inventory.
- Extended schema for wards, beds, stays, clinical orders/results, products, stock, and dispensing.

## Next

1. Connect a dedicated Supabase development project.
2. Apply and test the foundation migration.
3. Create authentication, onboarding, and facility-selection workflows.
4. Implement privilege-aware database functions and RLS tests.
5. Replace synthetic data with the complete working journey: register patient, consult or admit, order, record result, dispense, charge, pay, and report.
6. Validate every workflow with infirmary process owners before pilot use.

## Rule

Live patient information must not be entered until authentication, RLS tests, private storage controls, audit verification, and pilot approval are complete.
