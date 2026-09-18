# Clinical Registry and Automatic Billing UAT

Run migrations `202609180003_clinical_registry_ai_foundation.sql` and
`202609180004_icd_import_and_automatic_billing.sql` before this test.

## Diagnosis master import

1. Open **Clinical Registry → Diagnosis Master → Import CSV**.
2. Download the template, then populate it from an approved WHO ICD-10 release and
   the current PhilHealth case-rate annex. Record the exact source/version.
3. Import a small validation file first. Confirm the created, updated, and skipped
   row counts. Re-import the same file and confirm records are updated, not duplicated.
4. Verify chapter, category, disease class, reportable flag, and PhilHealth mapping.

## Encounter workflow

1. Open an existing encounter in **Clinical Registry**.
2. Assign at least two doctors and mark exactly one as primary/attending.
3. Add one principal diagnosis and two secondary diagnoses.
4. Mark one secondary diagnosis as comorbidity, another as complication, and set
   present-on-admission values.
5. Finalize the principal diagnosis and resolve one secondary diagnosis with a reason.
6. Verify the encounter timeline and Disease Census reflect the changes.
7. Attempt a second active principal diagnosis and a second active primary doctor;
   both must be rejected or replace the former primary through the controlled workflow.

## Automatic billing

Before testing, map active products and wards to active Charge Master services and
ensure each mapped service has a current facility price.

1. Approve a doctor professional fee. Confirm one ledger charge is created and the
   care-team row changes to `posted`.
2. Repeat the approval request. Confirm no second ledger charge is created.
3. Advance laboratory, imaging, or procedure order items to their configured
   `charge_on` status. Confirm one charge per order item.
4. Dispense medicine by lot, issue a patient supply using source type
   `patient_encounter`, and complete a bed stay. Confirm the calculated charges.
5. Retry or repeat each source event. Confirm the idempotency key prevents duplicates.

## Read-only invariant checks

Run `supabase/tests/clinical_registry_invariants.sql` after UAT. Every result count
must be zero. Any non-zero result is a release blocker.
