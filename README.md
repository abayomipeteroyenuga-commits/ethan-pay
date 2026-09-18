# Ethan Pay v3.0 — Complete Pre-Gateway Build
Platform: ETHAN PAY
Code: ETH-PAY
Domain: pay.ethandigitalacademy.org

This is the deep pre-Paystack build.

Included:
- professional payer portal
- service and currency selection
- payment-reference creation
- manual bank-payment submission workflow
- transaction history and status lookup
- administration preview with search/filter
- manual review/verify/reject workflow
- receipt centre and printable preview receipts
- invoice creation and printable preview invoices
- reconciliation summary
- refund-request register
- audit trail preview
- CSV transaction export
- four-currency readiness
- responsive UI
- backend configuration file
- Supabase-ready normalized schema for transactions, submissions, receipts, refunds, service catalogue and audit log
- RLS enabled by default with no anonymous transaction writes
- Ethan ID integration readiness
- Ethan Store/Learn/LMS/Certificate service catalogue readiness

Intentionally excluded:
- Paystack or any other live payment gateway
- Ethan ID/SSO connection (to be done in the ecosystem integration phase)
- real email/SMS delivery
- real bank API connection

Production deployment:
1. Keep the current UI deployable on Vercel.
2. Create/configure the Ethan Pay backend and run supabase/schema.sql.
3. Add Ethan ID policies during SSO integration.
4. Move transaction mutations to trusted server/Edge Functions.
5. Add provider integration later. Never expose provider secrets or Supabase service-role keys in browser code.
6. Only issue a final production receipt after server-side verification.

The browser continues to use local preview storage until the backend and Ethan ID are connected, so this build can be deployed safely without pretending local records are authoritative.
