# Hospital ONE Architecture

The application is a responsive Next.js App Router system. Supabase provides PostgreSQL, authentication, private object storage, and Row Level Security. Server Components handle read-oriented pages. Trusted Server Actions or Route Handlers validate commands and call domain-specific database functions for governed mutations.

The migrations create facility-scoped identity, patient, encounter, queue, ADT, clinical order/result, pharmacy, inventory, ledger, cashier, and audit foundations. RLS is deny-by-default. The initial select policies demonstrate facility scoping, while direct browser mutations remain deliberately unavailable until each vertical slice has privilege-aware functions and tests.

Demo mode contains synthetic records in source code so UI review is possible without a database. It is not a production fallback and must never accept real patient data.
