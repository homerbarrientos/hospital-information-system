# Hospital ONE Infirmary Core MVP Claude Code Build Specification

## 1 Purpose

Build a runnable Infirmary Core MVP of Hospital ONE for a Philippine infirmary. The product must deliver a secure, working end-to-end operational chain covering patient identity, consultation or admission, clinical orders and results, medicine or supply dispensing, automatic charge capture, payment, reporting, administration, roles, and audit history. The same configurable core must support later expansion to Level 1 and Level 2 hospitals without a code fork.

This release is the first implementation slice of a broader Hospital Management Information System. It must use real persistence, permissions, workflows, validation, audit records, and automated tests. Do not implement the application as disconnected mock screens. Modules planned for later phases must be represented by clean domain boundaries and integration contracts, but must not be partially implemented in Phase 1.

The source product definition is `Hospital_ONE_MVP_Product_Definition_Pack_v0.1.docx`, dated 14 September 2026. If this specification and the source pack appear to conflict, protect the narrower Phase 1 boundary in this specification and record the conflict in `docs/DECISIONS.md` for Product Owner review.

## 2 Confirmed Product Decisions

- Release strategy: phased core MVP.
- Initial facility profile: Philippine infirmary; do not assume Level 1 or Level 2 capability.
- Frontend and application framework: Next.js with TypeScript.
- Database, authentication, authorization policy enforcement, and file storage: Supabase.
- Database engine: PostgreSQL managed through Supabase.
- Deployment target: Vercel-compatible web application with Supabase backend.
- Client form factor: responsive web application suitable for desktop workstations and tablets.
- Product model: configurable core, not a hospital-specific code fork.
- Accounting boundary: produce traceable transaction data and export-ready journal summaries; do not build a full general ledger, accounts payable, payroll, HRIS, procurement, or asset-management system.
- Regulatory position: integration-ready and validation-ready. Do not claim DOH, PhilHealth, privacy, security, or clinical certification merely because features are present.

## 3 Operating Instructions for Claude Code

Follow this specification as the implementation contract.

1. Inspect the repository before changing it. Preserve working conventions and compatible user changes.
2. If the repository is empty, initialize the architecture described here.
3. Maintain a short implementation plan in `docs/IMPLEMENTATION_PLAN.md` and update it as work progresses.
4. Record assumptions and architectural decisions in `docs/DECISIONS.md`.
5. Implement work in vertical slices. Each slice must include UI, server-side authorization, database migration, validation, audit behavior, tests, and documentation where applicable.
6. Never use UI hiding as the only authorization control. Enforce access in server code and Supabase Row Level Security.
7. Never use mock data in production paths. Demo data must be created only by an explicit seed command and clearly labeled.
8. Never expose the Supabase service-role key to the browser. Privileged operations must run only in trusted server contexts.
9. Do not hard-code secrets, passwords, hospital identifiers, rates, or clinical reference values.
10. Use migrations for every database change. Do not instruct the user to make undocumented manual database changes.
11. Run linting, type checking, automated tests, and the production build before declaring a milestone complete.
12. Stop and document a blocker when a required external interface, clinical rule, or hospital-approved form is unavailable. Implement a safe adapter or simulator only when explicitly identified as non-production.

## 4 Phase 1 Outcome

At the end of the MVP, authorized infirmary staff must be able to complete these connected journeys:

1. Configure the pilot facility, departments, locations, users, roles, services, prices, payers, discount rules, and clinical templates.
2. Search for an existing patient or register a new patient with duplicate warnings.
3. Schedule or create a walk-in OPD visit and place the patient in a configurable queue.
4. Record a consultation or admit the patient to a configured ward and bed, including transfer and discharge.
5. Create clinical orders, route them to a worklist, record and validate results, and return results to the encounter.
6. Validate and dispense prescribed medicines or issued supplies by store, lot, and expiry.
7. Automatically create billable ledger entries from consultations, admission services, completed orders, medicines, and supplies.
8. Review the patient ledger, receive partial or full payment, issue a receipt reference, and close the encounter after clinical and financial clearance.
9. Retrieve the longitudinal clinical record and produce essential census, clinical, pharmacy, inventory, billing, cashier, and management reports.

## 5 Scope Boundaries

### 5.1 Included in Phase 1

- Organization and facility configuration.
- Departments, locations, clinics, service points, and basic operating schedules.
- Named user accounts, invitations or controlled provisioning, deactivation, password reset support, and user-to-staff profile linking.
- Role and privilege management using a governed permission catalog.
- Facility and department assignments.
- Patient master index, identifiers, demographics, contacts, addresses, next of kin, consent records, and duplicate warnings.
- Controlled patient demographic correction and patient merge workflow.
- Appointment scheduling, referrals, walk-ins, arrivals, cancellations, no-shows, priority, and queue boards.
- OPD encounters and basic electronic medical record.
- Triage, vital signs, allergies, problems, clinical notes, diagnoses, orders, prescriptions, attachments, and encounter disposition.
- Finalization and addendum behavior for clinical records.
- Service catalog, charge master, effective-dated prices, payer types, discount types, and approval rules.
- Automatic and manual charge capture with full source traceability.
- Patient ledger, payer allocation, discounts, deposits, payments, void requests, refunds, shift opening and closing, SOA, and receipt records.
- Basic government patient classification fields and financial assistance referral. Full medical social service case management is deferred.
- Operational dashboards and the minimum Phase 1 reports specified below.
- Notifications for appointments, queue events, incomplete work, approvals, and system exceptions.
- Immutable application audit trail and administrative audit search.
- Secure document upload for patient registration, clinical attachments, and financial supporting documents.
- Backup, restoration instructions, observability hooks, error handling, and environment separation.

### 5.2 Explicitly Deferred

- Advanced emergency-department acuity tracking beyond the common consultation/admission core.
- Advanced nursing care plans and electronic medication administration record.
- Laboratory analyzer integration and advanced laboratory specialty workflows.
- PACS image archive, DICOM integration, and advanced radiology scheduling.
- Controlled-drug regulatory workflows beyond controlled permissions and audit placeholders.
- Full PhilHealth eClaims submission, CF5, eSOA XML generation, DRG, Return-to-Hospital handling, and payment reconciliation.
- Full medical social service assessment, guarantee letters, utilization, and agency receivables.
- Full procurement, purchase orders, supplier canvassing, and asset lifecycle.
- Medical records deficiency, coding, release-of-information, retention, and registry workflows beyond basic encounter history and controlled document access.
- Operating room, ICU, blood bank, patient portal, predictive analytics, and AI diagnosis.
- Full accounting, accounts payable, payroll, recruitment, attendance, procurement, and asset lifecycle.

Create `docs/ROADMAP.md` describing the deferred modules and their dependency on the Phase 1 domain model. Do not place non-functional placeholder buttons in production navigation unless labeled `Coming in a future release` and controlled by a feature flag.

## 6 Users and Authorization

### 6.1 Required Role Templates

- System Administrator
- Hospital Administrator
- Registrar and Admissions Clerk
- Appointment and Queue Clerk
- Triage Nurse
- OPD Nurse
- Physician
- Billing Clerk
- Cashier
- Finance Supervisor
- Medical Records Officer
- Auditor and Compliance Reviewer
- Data Protection Officer
- IT Support Read Only

Roles are templates composed of privileges. The database must support additional roles without source-code changes.

### 6.2 Authorization Dimensions

Evaluate access using all applicable dimensions:

- authenticated user;
- active account status;
- organization and facility assignment;
- department assignment;
- role and explicit privileges;
- care-team or encounter assignment where applicable;
- object status, such as draft, finalized, posted, voided, or closed;
- sensitive-record restrictions;
- action type, including view, create, update, finalize, approve, void, refund, merge, export, print, or disclose.

Clinical access and financial access must be separate. A cashier must not receive unrestricted clinical access. Export, printing, patient merge, price override, void, refund, discount approval, role management, and audit access must be explicit privileges.

### 6.3 Privileged Access

- Require MFA for administrators and privileged approvers when supported by the selected Supabase plan and configuration.
- Prohibit shared accounts.
- Log login, logout, failed authentication, password reset, privilege change, export, print, disclosure, approval, override, merge, void, and refund events.
- Provide a break-glass data model and workflow stub for future sensitive or emergency access. Do not enable break-glass access in Phase 1 without approved policy and review workflow.
- Deactivating a user must immediately prevent new access without deleting historical authorship.

## 7 Core Domain Requirements

### 7.1 Organization and Configuration

Support organizations, facilities, departments, locations, clinics, service points, facility time zones, operating schedules, identifiers, document numbering, and configuration settings.

Configuration affecting prices, payers, discounts, permissions, workflows, and clinical templates must support draft, review, approved, scheduled, active, and retired states when appropriate. Effective dates are mandatory for prices and financial rules. Historical transactions must continue to use the configuration version that applied at posting time.

### 7.2 Patient Identity

Maintain one stable internal patient ID and configurable medical record number. Store external identifiers with identifier type and issuing authority.

Required patient capabilities:

- search by medical record number, government or hospital identifier, name, date of birth, phone number, and combinations of demographic fields;
- register complete or minimum-data patients;
- capture legal name, preferred name, sex at birth, gender field where configured, birth date or estimated age, civil status, nationality, religion when hospital-approved, address, contacts, occupation, next of kin, guardian, and emergency contact;
- record privacy notice acknowledgement and consent metadata;
- identify deceased status without deleting the record;
- warn about probable duplicates using normalized name, birth date, sex, phone, and identifier comparisons;
- require privileged review for patient merge;
- preserve both source records, identifiers, references, merge reason, approver, and audit evidence;
- never silently merge patients automatically.

### 7.3 Appointments and Queue

Support scheduled appointments, referrals, and walk-ins. Allow configurable clinic schedules, providers, service points, slot duration, capacity, priority categories, and queue numbering.

Appointment statuses:

`draft`, `scheduled`, `confirmed`, `arrived`, `in_queue`, `in_service`, `completed`, `cancelled`, `no_show`.

Every transition must validate permissions and allowed prior states. Queue boards must avoid exposing unnecessary patient information on public-facing displays. Staff views may show only the minimum data needed for service.

### 7.4 OPD Encounter and Basic Clinical Record

An encounter belongs to one patient, facility, service date, department, encounter type, attending or responsible clinician, and status.

Encounter statuses:

`planned`, `arrived`, `triaged`, `in_consultation`, `awaiting_service`, `for_billing`, `completed`, `cancelled`.

Capture:

- chief complaint and reason for visit;
- arrival source and referral information;
- triage category and triage notes;
- temperature, pulse, respiratory rate, blood pressure, oxygen saturation, height, weight, BMI, pain score, and measurement metadata;
- allergies and reaction/severity, including an explicit no-known-allergies state;
- active and historical problems;
- clinical notes using configurable templates;
- diagnoses with code system, code, description, type, and status;
- service orders with priority, instructions, ordering clinician, and status;
- prescriptions with medication reference, dose, unit, route, frequency, duration, quantity, and instructions;
- attachments with document category, author, encounter context, access policy, and malware-scan state;
- disposition, follow-up instructions, referral, and encounter completion.

Clinical notes must support `draft`, `final`, and `amended`. Routine users must not edit final content in place. An amendment must preserve the original, author, timestamps, reason, and link to the superseding version.

Phase 1 orders do not execute full laboratory, radiology, or pharmacy workflows. They create traceable requests with `requested`, `acknowledged`, `completed`, or `cancelled` status and may generate charges only according to configured charge events. Clearly label this limited behavior.

### 7.5 Charge Capture and Patient Ledger

No charge may exist without patient, encounter or authorized non-encounter context, service date, source department, accountable user, charge item, quantity, unit price, and configuration version.

Support:

- automatic charges from configured service-order or completion events;
- authorized manual charges with a mandatory reason;
- positive charges, discounts, payments, refunds, reversals, and adjustments as separate immutable ledger entries;
- prevention of duplicate automatic charge creation using a source transaction and idempotency key;
- effective-dated prices;
- government, PhilHealth, patient, agency, HMO, or other configured payer categories;
- multiple payer allocation with validation that allocations do not exceed eligible balances;
- Senior Citizen and PWD discount types as configurable rules requiring hospital and legal validation before production activation;
- discount request and approval thresholds;
- statement of account by encounter and consolidated patient account;
- open, partially paid, paid, voided, refunded, and written-off states, with write-off disabled unless explicitly configured and authorized.

Use decimal database types for monetary values. Never use floating-point arithmetic for currency. Store currency as PHP by default but keep the design currency-aware.

### 7.6 Cashiering

Support cashier shifts, opening amount, collections, payment methods, receipt numbering, partial payments, payment allocations, change, void requests, refunds, closing count, expected total, actual total, variance, supervisor review, and printable accountability reports.

Payment methods must be configurable and initially include cash, bank transfer, card or payment-gateway reference, cheque, and government or agency reference where applicable. A payment must not be treated as confirmed merely from an untrusted browser response.

Posted payments and closed shifts must not be overwritten. Corrections require a linked reversal, void, or refund transaction with reason and authorization.

### 7.7 Infirmary Profile

Activate only services and departments actually available in the pilot infirmary. Keep facility capabilities configurable so laboratory, radiology, ward, pharmacy, and supply functions can be enabled independently. Include configurable patient financial classifications and basic PhilHealth or assistance reference fields without claiming claims certification.

Phase 1 does not determine legal benefit eligibility autonomously. Present these as workflow data and verification states. Any discount or NBB computation must be configurable, reviewable, effective-dated, and disabled by default until approved by the pilot hospital.

## 8 Data Model

Create normalized PostgreSQL tables with UUID primary keys, timestamps, actor references, organization/facility scoping, appropriate foreign keys, unique constraints, check constraints, and indexes.

At minimum, model these domains:

- organizations, facilities, departments, locations, clinics, schedules;
- profiles, staff members, providers, roles, privileges, role privileges, user roles, facility assignments, department assignments;
- patients, patient identifiers, contacts, addresses, relationships, consents, duplicate candidates, merge requests, merge events;
- appointments, appointment resources, queue entries, referrals;
- encounters, encounter participants, movements or status history;
- vital observations, allergies, problems, clinical notes, note versions, diagnoses, orders, order items, prescriptions, clinical attachments;
- service catalog, charge items, price lists, price versions, payers, discount rules, approval rules;
- patient accounts, charges, ledger entries, payer allocations, discount requests, statements, cashier shifts, payments, payment allocations, void requests, refunds;
- configuration versions, notification templates, notifications;
- audit events, export events, integration messages, idempotency keys;
- file metadata and access records.

### 8.1 Integrity Rules

- Use stable internal IDs while preserving external identifiers and issuing authorities.
- Add organization and facility scope to all relevant business records.
- Enforce required relationships at database and service layers.
- Preserve finalized clinical records and posted financial entries.
- Keep status history for patient merges, appointments, queues, encounters, approvals, charges, payments, and shifts.
- Store all system timestamps in UTC and display the configured facility time zone.
- Use soft retirement or explicit status for governed master data. Do not cascade-delete historical healthcare or financial records.
- Use database transactions for multi-record clinical and financial postings.
- Apply optimistic concurrency or version checking to records subject to conflicting edits.

### 8.2 Row Level Security

Enable RLS on every exposed table. Policies must deny access by default and validate organization/facility membership. Sensitive data access should go through controlled database functions or server-side services where direct table policies would be too permissive. Provide automated RLS tests proving that users cannot read or mutate another facility's data or perform unauthorized financial and clinical actions.

## 9 Technical Architecture

### 9.1 Required Stack

- Next.js current stable version using App Router.
- TypeScript with strict mode.
- React Server Components by default; client components only when interaction requires them.
- Supabase PostgreSQL, Auth, Storage, and Row Level Security.
- Server Actions or Route Handlers for application mutations, with explicit authorization and schema validation.
- Zod or an equivalent TypeScript-first schema validator.
- A mature accessible component foundation; keep design tokens and components local and customizable.
- A form library suitable for typed complex forms.
- A deterministic test stack for unit, integration, and browser-level tests.

Pin dependency versions in the lockfile. Document material architecture choices in `docs/ARCHITECTURE.md`.

### 9.2 Application Structure

Organize code by business domain rather than one large collection of pages or utilities. Suggested boundaries:

- platform and configuration;
- identity and access;
- patient identity;
- access and queue;
- clinical encounter;
- revenue cycle;
- reporting;
- audit and compliance;
- notifications and integrations.

Domain services must own workflow transitions and invariants. UI code must not directly implement posting, approval, merge, finalization, or reversal rules.

### 9.3 Environment Separation

Support development, test, UAT/training, and production configurations. Development must use synthetic data. Do not copy live patient data into development. Provide `.env.example` containing variable names and explanations but no secrets.

### 9.4 File Storage

Use private Supabase Storage buckets. Store only metadata and object references in PostgreSQL. Use signed, short-lived access URLs after permission checks. Define size and MIME allowlists, file-name normalization, malware-scan state, rejected/quarantined states, and audit events. If malware scanning is not configured in the local MVP, uploads must remain marked `pending_scan` and the limitation must be documented; do not falsely mark them safe.

## 10 User Experience

- Provide a responsive desktop and tablet layout.
- Use a persistent application header with facility context, user identity, notifications, help, and logout.
- Use role-aware navigation without treating it as the security boundary.
- Make patient identity and encounter context visually persistent in clinical and billing screens.
- Warn users before navigating away from unsaved clinical or financial forms.
- Use clear status badges, timestamps, responsible users, validation messages, and empty states.
- Require confirmation and reason entry for high-risk actions.
- Do not expose diagnoses, balances, or other sensitive details on public queue displays.
- Meet WCAG 2.1 AA-oriented fundamentals: keyboard operation, semantic labels, focus visibility, sufficient contrast, non-color status cues, and screen-reader-friendly form errors.
- Support printable A4 and Letter outputs for SOA, receipt copy, patient summary, queue list, and reports.

## 11 Required Screens

### Administration

- Facility and organization setup
- Departments, locations, clinics, and schedules
- Users and staff profiles
- Roles and privileges
- User assignments
- Services and charge items
- Price lists and effective-dated prices
- Payers, discounts, and approval rules
- Clinical note templates
- Notification templates
- Configuration publication history
- Audit search

### Patient Access

- Patient search
- New and edit patient
- Duplicate review
- Patient merge request and approval
- Patient summary and longitudinal encounter history
- Appointment calendar/list
- Appointment form
- Arrival and queue assignment
- Staff queue board
- Privacy-safe public queue view
- Referral capture
- Consent history

### OPD Clinical Care

- Triage worklist
- Triage and vital-sign form
- Physician encounter worklist
- Encounter workspace
- Allergies and problems
- Clinical note editor
- Diagnosis entry
- Order entry and order status
- Prescription entry
- Attachments
- Disposition and follow-up
- Clinical record finalization and addendum

### Billing and Cashiering

- Patient account and encounter ledger
- Charge review
- Manual charge form
- Payer allocation
- Discount request and approval
- SOA preview and print
- Cashier shift open and close
- Payment posting and allocation
- Receipt view and print
- Void request and approval
- Refund request and approval
- Cashier accountability

### Dashboards and Reports

- Hospital operations dashboard
- OPD volume and queue dashboard
- Revenue cycle dashboard
- Compliance and audit dashboard

## 12 Reports

Provide filterable, paginated, printable, and CSV-exportable reports subject to explicit privileges:

- daily OPD visits by clinic, status, physician, and disposition;
- appointment status, cancellations, and no-shows;
- live and historical queue waiting time;
- common diagnoses and services, clearly labeled as operational rather than clinical research output;
- incomplete and unfinalized encounter documentation;
- charge summary by date, department, service, and payer;
- discounts requested, approved, rejected, and overridden;
- collections by cashier, shift, payment method, and date;
- cashier expected versus actual and variance;
- voids, refunds, reversals, and manual adjustments;
- patient and payer receivables ageing;
- government classification and assistance referrals;
- user access, privileged actions, configuration changes, exports, failed logins, and file-access events;
- interface and notification failures.

Reports must use server-side filtering and enforce the requesting user's scope. Large exports should be bounded or processed asynchronously, with an audit event and expiration policy.

## 13 Audit Requirements

Audit events must include:

- unique event ID;
- event type and action;
- user ID, role context, and session reference;
- organization, facility, and department context;
- patient or business object type and ID;
- before and after reference or structured diff where appropriate;
- reason and approval reference for governed actions;
- workstation metadata or IP where safely available;
- UTC timestamp and facility-local representation;
- success or failure result;
- correlation ID linking related server actions and integration events.

Routine application users must not update or delete audit events. Avoid storing full clinical narratives or secrets in audit payloads; store sufficient structured evidence and references.

## 14 Notifications

Implement in-app notifications and an adapter interface for future SMS and email. Initial triggers include:

- upcoming appointment;
- appointment cancellation or change;
- priority patient arrival;
- patient ready for the next queue step;
- clinical note awaiting finalization;
- discount, void, refund, or merge awaiting approval;
- failed or incomplete financial posting;
- cashier shift variance;
- unusual export or repeated failed login;
- file awaiting or failing malware scanning.

Notification dispatch must be idempotent and maintain pending, sent, delivered when supported, failed, acknowledged, and cancelled states.

## 15 Security and Privacy Baseline

- Apply least privilege and deny-by-default authorization.
- Encrypt traffic in transit and rely on platform-supported encryption at rest.
- Protect cookies and sessions using framework and Supabase security guidance.
- Validate all mutations server-side.
- Prevent cross-site scripting, request forgery where applicable, insecure direct-object reference, mass assignment, SQL injection, unrestricted upload, and sensitive data leakage.
- Do not log passwords, tokens, full payment credentials, or unnecessary patient content.
- Rate-limit authentication-sensitive and export-heavy operations.
- Require reasons and approvals for merge, void, refund, discount override, final-note amendment, and configuration publication.
- Provide account deactivation and session revocation procedures.
- Provide configurable inactivity timeout guidance.
- Provide data-subject request, correction, disclosure-log, retention, and disposal design hooks without claiming automatic legal compliance.
- Include a privacy impact assessment checklist and go-live security checklist under `docs/go-live/`.

## 16 Nonfunctional Targets

- Common patient searches and routine saves should complete within 2 to 3 seconds under an agreed pilot load.
- Target 99.5 percent monthly availability excluding approved maintenance after production infrastructure is established.
- Design for a pilot sizing configuration rather than assuming unlimited scale.
- Use pagination and indexed queries for lists and reports.
- Prevent N+1 query patterns in patient, queue, ledger, and report screens.
- Provide structured error handling, correlation IDs, health endpoints, and application monitoring hooks.
- Provide database backup and restore documentation. Target RPO is 15 to 30 minutes and target RTO is 4 hours, subject to the selected production plan and validation.
- The core design must allow more facilities and departments without database redesign.
- Provide non-proprietary CSV or JSON export for configured master and transactional data where safe and practical.

Intermittent-network clinical operation is a broader product requirement but is not safely achievable by ordinary PWA caching alone. Phase 1 must detect loss of connectivity, avoid false success, preserve safe unsent drafts only where no clinical or financial posting is implied, and document the future local/hybrid continuity architecture.

## 17 Seed Data and Demo Personas

Provide an idempotent seed command for non-production environments containing:

- one sample government Level 1 hospital;
- representative departments and OPD clinics;
- service points and schedules;
- sample role and privilege templates;
- synthetic staff and provider profiles;
- synthetic patients clearly marked as test data;
- sample appointments, queue entries, encounters, charges, payments, and reports;
- basic service and price configuration;
- government, patient, PhilHealth, and agency payer categories;
- sample notification and clinical-note templates.

Do not commit real passwords. Document how development users are created safely through Supabase Auth or a local setup script.

## 18 Testing Strategy

### 18.1 Automated Tests

Implement:

- unit tests for validation, money calculations, pricing, discounts, payer allocation, queue rules, status transitions, and duplicate scoring;
- database tests for constraints, posting functions, idempotency, and RLS policies;
- integration tests for server actions or APIs;
- browser-level tests for the critical journeys;
- accessibility checks for priority screens;
- security-oriented tests for cross-facility access and privileged actions.

### 18.2 Mandatory End-to-End Acceptance Scenarios

1. Register a new OPD patient, detect no duplicate, schedule or accept a walk-in, triage, consult, record diagnosis, request a service, generate a charge, collect payment, print an SOA or receipt, and complete the encounter.
2. Search and correctly select a returning patient with similar-name duplicate candidates.
3. Attempt a patient merge as an unauthorized user and prove denial; complete a merge request and approval as authorized users while preserving source identity evidence.
4. Finalize a clinical note, prove it cannot be overwritten, then create an authorized addendum that preserves the original.
5. Generate an automatic charge twice from the same source event and prove only one ledger entry posts.
6. Allocate a balance across patient and configured government or payer sources without exceeding the eligible balance.
7. Post a partial payment, then a final payment, and prove correct remaining balance and receipt history.
8. Request and approve a discount using separate users and prove audit evidence.
9. Void or refund a posted payment through a controlled linked transaction without deleting the original.
10. Open and close a cashier shift and report expected, actual, and variance values.
11. Deactivate a staff account and prove new access stops while historical authorship remains visible.
12. Prove a user assigned to Facility A cannot access Facility B patients, encounters, ledgers, files, reports, or audit records.
13. Upload an allowed supporting document, deny a disallowed type, enforce private access, and record file access.
14. Run the backup and restore procedure in a non-production environment and record reconciliation evidence.

### 18.3 Go-Live Defect Rule

- Critical: zero open.
- High: zero open unless formally deferred by the steering committee with a documented risk control.
- Medium: limited accepted backlog with owner and target date.
- Low: may be scheduled after pilot go-live.

## 19 Delivery Plan

Implement in two-week increments where practical.

### Increment 0 Repository and Architecture

- project initialization;
- environment validation;
- database migration framework;
- CI checks;
- design system foundation;
- architecture, decisions, threat model, and development setup documentation.

### Increment 1 Platform and Access

- organizations and facilities;
- user profiles, staff, roles, privileges, assignments;
- authentication and RLS foundation;
- configuration and audit foundation.

### Increment 2 Patient Identity

- patient master index;
- patient search and registration;
- identifiers, contacts, relationships, consent;
- duplicate review and controlled merge.

### Increment 3 Appointments and Queue

- schedules and appointments;
- arrival and walk-in;
- queues and role-specific boards;
- appointment and queue reports.

### Increment 4 OPD Clinical Care

- encounters and participants;
- triage and vitals;
- allergies and problems;
- notes, diagnoses, orders, prescriptions, disposition;
- finalization and addendum.

### Increment 5 Revenue Cycle

- service and charge masters;
- effective prices;
- automatic/manual charge capture;
- patient ledger, payer allocation, discounts, SOA.

### Increment 6 Cashiering

- shifts;
- payments and allocation;
- receipts;
- void, refund, close, variance, and accountability.

### Increment 7 Reporting and Hardening

- dashboards and required reports;
- export controls;
- performance and accessibility remediation;
- security testing;
- backup/restore rehearsal;
- UAT seed data and guides.

Do not advance an increment merely because screens exist. Apply the Definition of Done below.

## 20 Definition of Ready

A story is ready when:

- the process owner and user roles are named;
- the normal workflow and exceptions are defined;
- fields, validation, permissions, outputs, and dependencies are understood;
- clinical safety, privacy, financial, and audit risks are reviewed;
- acceptance criteria and synthetic test data are available;
- configuration and data ownership are identified.

## 21 Definition of Done

A story is done only when:

- implementation is complete across database, server, UI, authorization, and audit layers;
- migrations apply successfully to a clean database;
- code review checks, lint, type checking, unit tests, integration tests, and relevant browser tests pass;
- permissions, RLS, error paths, concurrency, and audit behavior are tested;
- responsive and accessibility checks pass for affected priority screens;
- user and configuration documentation is updated;
- no open critical patient-safety, privacy, security, or financial defect remains;
- the feature can be demonstrated using synthetic seed data;
- Product Owner and relevant hospital process owner acceptance is documented for UAT releases.

## 22 Required Repository Deliverables

- runnable Next.js application;
- versioned Supabase migrations;
- RLS policies and database test suite;
- non-production seed scripts;
- `.env.example`;
- automated test suites;
- CI workflow running lint, type check, tests, and build;
- `README.md` with prerequisites, local setup, migration, seed, test, build, and deployment steps;
- `docs/ARCHITECTURE.md`;
- `docs/DECISIONS.md`;
- `docs/IMPLEMENTATION_PLAN.md`;
- `docs/ROADMAP.md`;
- `docs/PERMISSION_MATRIX.md`;
- `docs/WORKFLOW_STATES.md`;
- `docs/DATA_DICTIONARY.md`;
- `docs/TEST_PLAN.md`;
- `docs/UAT_GUIDE.md`;
- `docs/go-live/PRIVACY_CHECKLIST.md`;
- `docs/go-live/SECURITY_CHECKLIST.md`;
- `docs/go-live/BACKUP_RESTORE_RUNBOOK.md`;
- `docs/go-live/DOWNTIME_PROCEDURE.md`;
- `docs/go-live/RELEASE_AND_ROLLBACK.md`.

## 23 Claude Code Completion Response

At the end of each implementation session, report:

1. completed vertical slices;
2. files and migrations created or changed;
3. commands and tests run with their results;
4. remaining work mapped to the delivery increments;
5. assumptions or decisions requiring Product Owner or hospital SME validation;
6. known risks and safe next step.

Do not state that the system is production-ready, legally compliant, clinically validated, PhilHealth-certified, or approved for live patient use unless the required external reviews and acceptance evidence have actually been completed.

## 24 Product Owner Validation Items

Track these as unresolved decisions in `docs/DECISIONS.md` and do not invent production rules:

- exact pilot hospital, departments, clinic schedules, user count, peak concurrency, and expected daily patient volume;
- approved patient registration fields and identity-document rules;
- official medical record and receipt numbering formats;
- hospital-approved triage categories, note templates, diagnosis code set, service catalog, and prescription conventions;
- government patient classification, NBB, Senior Citizen, PWD, PhilHealth, and assistance rules;
- price lists, discount thresholds, payer priority, deposit, refund, void, and cashier variance policies;
- clinical record retention, correction, disclosure, and printing policies;
- required signatories and approval thresholds;
- SMS/email provider and consent wording;
- malware scanning service;
- production Supabase and Vercel plan, region, backup retention, point-in-time recovery, monitoring, and disaster-recovery design;
- whether the pilot requires on-premise or hybrid continuity during internet interruption;
- authoritative regulatory and PhilHealth interface specifications at design freeze and go-live review.
