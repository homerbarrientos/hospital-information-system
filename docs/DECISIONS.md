# Architecture and Product Decisions

| ID | Decision | Status |
|---|---|---|
| D001 | Use Next.js App Router, TypeScript, Supabase PostgreSQL/Auth/Storage, and Vercel-compatible deployment. | Approved |
| D002 | First build is the common Infirmary Core MVP; it must not assume Level 1 or Level 2 capability. | Approved |
| D003 | Demonstration mode uses visibly synthetic data and remains available before credentials are connected. | Approved for development |
| D004 | Direct browser mutations are denied initially; high-risk workflow writes use privilege-aware server functions. | Approved |
| D005 | Hospital-specific clinical, discount, NBB, numbering, retention, and approval rules remain unresolved until pilot validation. | Pending hospital SME |
| D006 | ADT, orders/results, pharmacy, and inventory are MVP core modules, not deferred modules. | Approved |
| D007 | MVP acceptance requires one complete patient-to-payment-to-report scenario. | Approved |
