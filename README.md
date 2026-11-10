# ETHAN PAY v4.0

**Platform:** ETHAN PAY  
**Domain:** pay.ethandigitalacademy.org  
**Purpose:** Central payment portal for the Ethan Digital Academy ecosystem.

## Current architecture

- Node.js and Express application server.
- Dedicated Neon PostgreSQL database for Ethan Pay.
- Render web service for application and API hosting.
- HTTP-only signed sessions, password hashing, rate-limited authentication and role checks.
- Payment records and administrator actions stored centrally on the server.
- Receipts are created only after an administrator verifies a transfer.

## Customer workflow

1. Create an account or sign in.
2. Select an Ethan service and enter the amount confirmed by that department.
3. Generate a unique Ethan Pay payment reference.
4. Transfer to an official company bank account.
5. Submit the bank transfer reference and transfer date.
6. Track the payment while Finance reviews it.
7. Print or save the receipt after the payment is verified.

## Administrator workflow

- One-time first-admin setup, restricted to the configured owner email and setup token.
- View payment totals and the verification queue.
- Verify transfers only after matching funds against official bank records.
- Reject submissions with a reason.
- Activate or deactivate company bank accounts.
- Create invoices.
- Review audit events and export payment data to CSV.

## Official company bank accounts

| Bank | Account name | Account number |
| --- | --- | --- |
| Kuda MFB | ALLONMAADIAH INTERNATIONAL LIMITED | 3003847218 |
| United Bank for Africa (UBA) | ALLON-MAADIAH INTERNATIONAL LIMITED | 1021643438 |

The portal currently supports NGN bank transfers. Paystack/card processing and foreign-currency settlements remain disabled until merchant credentials and settlement accounts are configured. A payment reference or transfer submission is not proof that funds have been received.

## Render environment variables

Set these as private service environment variables:

- DATABASE_URL — Neon connection string for the ethan_pay database.
- SESSION_SECRET — long random signing secret for sessions.
- ADMIN_BOOTSTRAP_TOKEN — one-time first-administrator setup token.
- BOOTSTRAP_ADMIN_EMAIL — owner email allowed to create the first administrator.
- NODE_ENV — set to production.

Never commit database credentials, session secrets, bootstrap tokens or payment-provider secrets to Git.

## Local development

Install dependencies with npm install. Configure DATABASE_URL and SESSION_SECRET in your environment, then run npm start. Use npm run check to run syntax checks.

## Security notes

- Do not add browser-side database credentials or service-role keys.
- Do not create public transaction-write policies.
- Keep administrator verification behind the authenticated admin role.
- Only verified payments may produce official receipts.
- Gateway integration requires server-side provider signature verification and idempotent callbacks.
