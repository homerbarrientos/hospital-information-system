# Hospital ONE — End-to-End UAT

## Entry criteria

- All migrations through `202609210002_operational_reports.sql` completed successfully.
- Test users have the correct facility and role assignments.
- Test patients, doctors, services, medicines, rooms, beds, prices, and billing mappings exist.
- Only synthetic test data is used.

## End-to-end scenario

| Step | Module | Test action | Expected result |
|---:|---|---|---|
| 1 | Patients | Register a patient with PhilHealth and emergency-contact details. Edit one field with a reason. | MRN is unique; updated data persists; change is audited. |
| 2 | Appointment & Queue | Create an appointment, mark arrival, enqueue, call, and start service. | Status follows the valid sequence and the encounter is linked once. |
| 3 | Consultation | Record complaint, vitals, SOAP note, allergy, and working diagnosis. Complete consultation. | Required fields validate; finalized clinical data remains traceable. |
| 4 | Clinical Registry | Add attending and consultant doctors. Add principal and secondary ICD diagnoses. | Only one primary doctor and principal diagnosis; disease census updates. |
| 5 | Admission & Transfer | Admit to an available bed, transfer once, and prepare discharge. | Previous bed stay closes; new stay opens; bed statuses remain accurate. |
| 6 | Orders & Results | Order laboratory/imaging services, progress status, enter and validate results. | Charge posts only at configured trigger; repeated status action does not duplicate it. |
| 7 | Pharmacy | Prescribe two medicines and dispense from valid lots. | FEFO stock is available; dispense is audited; stock and billing decrease/post exactly once. |
| 8 | Inventory | Receive stock, post an adjustment with reason, and transfer stock. | Stock cards reconcile and quantity never becomes negative. |
| 9 | Billing | Prepare the admission bill and inspect room, order, supply, medicine, and PF charges. | Encounter totals reconcile; room transfer produces daily non-duplicate charges. |
| 10 | Coverage | Request and approve PhilHealth/HMO or Senior/PWD deduction. | Approved credit posts once; rejected requests create no ledger entry. |
| 11 | Cashier | Open shift, accept partial then final payment, and close/reconcile shift. | Official receipts post; allocations and expected cash reconcile. |
| 12 | Clearance | Finalize bill and issue clearance after balance reaches zero. Reopen with reason, then finalize again. | Outstanding bills cannot clear; reopening is audited; late charges reopen automatically. |
| 13 | Reports | Apply date range, switch all tabs, search, export CSV, and print. | Counts/totals match source transactions; export uses the selected report and period. |
| 14 | Audit | Search the actions performed above. | Create, update, approval, reversal, finalization, and clearance events are present. |

## Negative tests

- Attempt duplicate MRN registration.
- Attempt admission to an occupied/inactive bed.
- Attempt dispensing above available or expired stock.
- Repeat the same order/dispense/accommodation posting.
- Finalize with pending coverage or price adjustment.
- Clear a bill with an outstanding balance.
- Reopen without an adequate reason.
- Access another facility's records.

## Automated database checks

Run these scripts after the manual scenario:

1. `supabase/tests/clinical_registry_invariants.sql`
2. `supabase/tests/billing_clearance_invariants.sql`
3. `supabase/tests/reports_invariants.sql`
4. `supabase/tests/full_system_uat.sql`
5. `supabase/tests/admin_rbac_invariants.sql`

Every query must return zero rows. Any returned row is a UAT finding and must be investigated before sign-off.

For Employee ID authentication, verify account creation, one-time temporary credential display, forced first-login password change, administrator reset, Employee ID modification, deny-by-default access, and the resulting `staff.account_created`, `staff.temporary_password_issued`, `staff.employee_id_updated`, and `staff.password_changed` audit events.

## Sign-off fields

- Environment / deployment:
- Facility:
- Tester:
- Test date:
- Passed scenarios:
- Failed scenarios:
- Open findings:
- Evidence links:
- Decision: Accept / Accept with conditions / Reject
