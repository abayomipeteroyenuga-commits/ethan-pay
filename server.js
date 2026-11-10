'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { neon } = require('@neondatabase/serverless');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const SESSION_SECRET = process.env.SESSION_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const COOKIE_NAME = 'ethan_pay_session';

if (!DATABASE_URL || !SESSION_SECRET) {
  throw new Error('DATABASE_URL and SESSION_SECRET must be configured as server environment variables.');
}

const db = neon(DATABASE_URL);
const query = (text, params) => db.query(text, params || []);
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://track.ethandigitalacademy.org'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'https:', 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false });
const publicLimiter = rateLimit({ windowMs: 60 * 1000, limit: 80, standardHeaders: 'draft-7', legacyHeaders: false });

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}
function cleanText(value, max) {
  return String(value || '').trim().slice(0, max || 240);
}
function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function makeReference(prefix) {
  return prefix + '-' + new Date().getFullYear() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}
function publicUser(row) {
  return { id: row.id, email: row.email, fullName: row.full_name, phone: row.phone || '', role: row.role };
}
function setSession(res, user) {
  const token = jwt.sign({ sub: user.id }, SESSION_SECRET, { expiresIn: '12h', issuer: 'ethan-pay' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60 * 1000
  });
}
function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
}
const authRequired = wrap(async (req, res, next) => {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
  let payload;
  try {
    payload = jwt.verify(token, SESSION_SECRET, { issuer: 'ethan-pay' });
  } catch (_) {
    clearSession(res);
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
  const rows = await query('SELECT id, email, full_name, phone, role, is_active FROM public.payment_users WHERE id = $1 LIMIT 1', [payload.sub]);
  const user = rows[0];
  if (!user || !user.is_active) {
    clearSession(res);
    return res.status(401).json({ error: 'This account is unavailable. Contact Ethan Pay support.' });
  }
  req.user = user;
  next();
});
const adminRequired = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Administrator access is required.' });
  next();
};
async function audit(actorId, action, entityType, entityId, details) {
  await query(
    'INSERT INTO public.payment_audit_log(actor_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5::jsonb)',
    [actorId || null, action, entityType, entityId ? String(entityId) : null, JSON.stringify(details || {})]
  );
}

app.get('/healthz', wrap(async (_req, res) => {
  await query('SELECT 1 AS ok');
  res.json({ status: 'ok', service: 'ethan-pay', database: 'connected' });
}));

app.get('/api/setup/status', publicLimiter, wrap(async (_req, res) => {
  const rows = await query("SELECT COUNT(*)::int AS total FROM public.payment_users WHERE role = 'admin'");
  res.json({ adminSetupRequired: Number(rows[0].total) === 0 });
}));

app.post('/api/setup/admin', authLimiter, wrap(async (req, res) => {
  const token = String(req.body.setupToken || '');
  const expected = process.env.ADMIN_BOOTSTRAP_TOKEN || '';
  const configuredEmail = cleanEmail(process.env.BOOTSTRAP_ADMIN_EMAIL || '');
  const email = cleanEmail(req.body.email);
  const fullName = cleanText(req.body.fullName, 120);
  const password = String(req.body.password || '');
  if (!expected || !configuredEmail || !crypto.timingSafeEqual(Buffer.from(token.padEnd(64, ' ').slice(0, 64)), Buffer.from(expected.padEnd(64, ' ').slice(0, 64)))) {
    return res.status(403).json({ error: 'The administrator setup code is invalid.' });
  }
  if (email !== configuredEmail) return res.status(403).json({ error: 'Use the designated Ethan Pay administrator email.' });
  if (!validEmail(email) || !fullName || password.length < 12) {
    return res.status(400).json({ error: 'Enter your full name and a valid email. Password must be at least 12 characters.' });
  }
  const existing = await query("SELECT COUNT(*)::int AS total FROM public.payment_users WHERE role = 'admin'");
  if (Number(existing[0].total) > 0) return res.status(409).json({ error: 'Administrator setup has already been completed.' });
  const passwordHash = await bcrypt.hash(password, 12);
  const existingUser = await query('SELECT id FROM public.payment_users WHERE email = $1 LIMIT 1', [email]);
  const rows = existingUser[0]
    ? await query(
        "UPDATE public.payment_users SET full_name=$2,password_hash=$3,role='admin',is_active=true,updated_at=now() WHERE id=$1 RETURNING id,email,full_name,phone,role",
        [existingUser[0].id, fullName, passwordHash]
      )
    : await query(
        "INSERT INTO public.payment_users(email,full_name,password_hash,role) VALUES($1,$2,$3,'admin') RETURNING id,email,full_name,phone,role",
        [email, fullName, passwordHash]
      );
  await audit(rows[0].id, 'ADMIN_ACCOUNT_CREATED', 'user', rows[0].id, { email });
  setSession(res, rows[0]);
  res.status(201).json({ user: publicUser(rows[0]) });
}));

app.post('/api/auth/register', authLimiter, wrap(async (req, res) => {
  const fullName = cleanText(req.body.fullName, 120);
  const email = cleanEmail(req.body.email);
  const phone = cleanText(req.body.phone, 40);
  const password = String(req.body.password || '');
  if (email && email === cleanEmail(process.env.BOOTSTRAP_ADMIN_EMAIL || '')) {
    return res.status(403).json({ error: 'This email is reserved for the Ethan Pay administrator setup.' });
  }
  if (!fullName || !validEmail(email) || password.length < 12) {
    return res.status(400).json({ error: 'Enter your name, a valid email and a password of at least 12 characters.' });
  }
  const hash = await bcrypt.hash(password, 12);
  const rows = await query(
    "INSERT INTO public.payment_users(email,full_name,phone,password_hash,role) VALUES($1,$2,$3,$4,'customer') RETURNING id,email,full_name,phone,role",
    [email, fullName, phone || null, hash]
  );
  setSession(res, rows[0]);
  await audit(rows[0].id, 'CUSTOMER_REGISTERED', 'user', rows[0].id, {});
  res.status(201).json({ user: publicUser(rows[0]) });
}));

app.post('/api/auth/login', authLimiter, wrap(async (req, res) => {
  const email = cleanEmail(req.body.email);
  const password = String(req.body.password || '');
  const rows = await query('SELECT id,email,full_name,phone,password_hash,role,is_active FROM public.payment_users WHERE email = $1 LIMIT 1', [email]);
  const user = rows[0];
  if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'The email or password is incorrect.' });
  }
  setSession(res, user);
  await audit(user.id, 'USER_SIGNED_IN', 'user', user.id, {});
  res.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get('/api/services', publicLimiter, wrap(async (_req, res) => {
  const rows = await query('SELECT code,name,description,allowed_currencies FROM public.payment_service_catalog WHERE active = true ORDER BY display_order,name');
  res.json({ services: rows });
}));

app.get('/api/banks', publicLimiter, wrap(async (_req, res) => {
  const rows = await query('SELECT id,bank_name,account_name,account_number,currency,instructions FROM public.payment_bank_accounts WHERE is_active = true ORDER BY display_order,bank_name');
  res.json({ accounts: rows });
}));

app.post('/api/payments', authRequired, publicLimiter, wrap(async (req, res) => {
  const code = cleanText(req.body.serviceCode, 32).toUpperCase();
  const amount = Number(req.body.amount);
  const currency = cleanText(req.body.currency, 3).toUpperCase();
  const description = cleanText(req.body.description, 500);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000 || currency !== 'NGN') {
    return res.status(400).json({ error: 'Enter a valid amount. Nigerian bank-transfer payments are currently available in NGN only.' });
  }
  const services = await query('SELECT code,name,active FROM public.payment_service_catalog WHERE code = $1 AND active = true LIMIT 1', [code]);
  if (!services[0]) return res.status(400).json({ error: 'Choose an available Ethan payment service.' });
  const reference = makeReference('EP');
  const rows = await query(
    "INSERT INTO public.payment_transactions(reference,user_id,payer_name,payer_email,service_code,service_name,description,amount,currency,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'created') RETURNING id,reference,service_name,description,amount,currency,status,created_at",
    [reference, req.user.id, req.user.full_name, req.user.email, code, services[0].name, description || null, amount, currency]
  );
  await audit(req.user.id, 'PAYMENT_REFERENCE_CREATED', 'payment', rows[0].id, { reference, amount, currency, service: services[0].name });
  res.status(201).json({ payment: rows[0] });
}));

app.post('/api/payments/:reference/submit-transfer', authRequired, publicLimiter, wrap(async (req, res) => {
  const reference = cleanText(req.params.reference, 64).toUpperCase();
  const bankAccountId = cleanText(req.body.bankAccountId, 64);
  const transferReference = cleanText(req.body.transferReference, 120);
  const transferDate = cleanText(req.body.transferDate, 10);
  const note = cleanText(req.body.note, 500);
  if (!transferReference || !/^\d{4}-\d{2}-\d{2}$/.test(transferDate) || !bankAccountId) {
    return res.status(400).json({ error: 'Select the destination account and provide the transfer reference and date.' });
  }
  const paymentRows = await query("SELECT id,reference,currency,status FROM public.payment_transactions WHERE reference=$1 AND user_id=$2 LIMIT 1", [reference, req.user.id]);
  const payment = paymentRows[0];
  if (!payment) return res.status(404).json({ error: 'Payment reference not found.' });
  if (payment.status !== 'created') return res.status(409).json({ error: 'This payment reference has already been submitted or reviewed.' });
  const bankRows = await query('SELECT id,bank_name,account_number,currency FROM public.payment_bank_accounts WHERE id=$1 AND is_active=true LIMIT 1', [bankAccountId]);
  const bank = bankRows[0];
  if (!bank || bank.currency !== payment.currency) return res.status(400).json({ error: 'Choose an active bank account in the payment currency.' });
  const rows = await query(
    "WITH changed AS (UPDATE public.payment_transactions SET status='pending_review',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='created' RETURNING id,reference), submitted AS (INSERT INTO public.payment_manual_submissions(transaction_id,bank_account_id,bank_name,account_number,transfer_reference,transfer_date,note) SELECT id,$3,$4,$5,$6,$7,$8 FROM changed RETURNING transaction_id,bank_name,transfer_reference,transfer_date) SELECT changed.reference,submitted.bank_name,submitted.transfer_reference,submitted.transfer_date FROM changed JOIN submitted ON submitted.transaction_id=changed.id",
    [payment.id, req.user.id, bank.id, bank.bank_name, bank.account_number, transferReference, transferDate, note || null]
  );
  if (!rows[0]) return res.status(409).json({ error: 'The payment could not be submitted. Refresh and try again.' });
  await audit(req.user.id, 'BANK_TRANSFER_SUBMITTED', 'payment', payment.id, { reference, bank: bank.bank_name, transferReference });
  res.json({ ok: true, message: 'Your transfer details have been submitted for review.', reference });
}));

app.get('/api/payments', authRequired, wrap(async (req, res) => {
  const rows = await query(
    'SELECT p.id,p.reference,p.service_name,p.description,p.amount,p.currency,p.status,p.created_at,p.reviewed_at,r.receipt_number,s.bank_name,s.transfer_reference,s.transfer_date FROM public.payment_transactions p LEFT JOIN public.payment_receipts r ON r.transaction_id=p.id LEFT JOIN public.payment_manual_submissions s ON s.transaction_id=p.id WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 100',
    [req.user.id]
  );
  res.json({ payments: rows });
}));

app.get('/api/payments/:reference', authRequired, wrap(async (req, res) => {
  const rows = await query(
    'SELECT p.id,p.reference,p.service_name,p.description,p.amount,p.currency,p.status,p.created_at,p.reviewed_at,p.review_note,r.receipt_number,s.bank_name,s.transfer_reference,s.transfer_date FROM public.payment_transactions p LEFT JOIN public.payment_receipts r ON r.transaction_id=p.id LEFT JOIN public.payment_manual_submissions s ON s.transaction_id=p.id WHERE p.reference=$1 AND (p.user_id=$2 OR $3=true) LIMIT 1',
    [cleanText(req.params.reference, 64).toUpperCase(), req.user.id, req.user.role === 'admin']
  );
  if (!rows[0]) return res.status(404).json({ error: 'No payment record was found for this reference.' });
  res.json({ payment: rows[0] });
}));

app.get('/api/receipts/:reference', authRequired, wrap(async (req, res) => {
  const rows = await query(
    "SELECT r.receipt_number,r.snapshot,r.issued_at,p.reference,p.payer_name,p.payer_email,p.service_name,p.amount,p.currency,p.status FROM public.payment_receipts r JOIN public.payment_transactions p ON p.id=r.transaction_id WHERE p.reference=$1 AND (p.user_id=$2 OR $3=true) AND p.status='verified' LIMIT 1",
    [cleanText(req.params.reference, 64).toUpperCase(), req.user.id, req.user.role === 'admin']
  );
  if (!rows[0]) return res.status(404).json({ error: 'A receipt is issued only after an administrator verifies the payment.' });
  res.json({ receipt: rows[0] });
}));

app.post('/api/refunds', authRequired, wrap(async (req, res) => {
  const reference = cleanText(req.body.reference, 64).toUpperCase();
  const amount = Number(req.body.amount);
  const reason = cleanText(req.body.reason, 500);
  const payments = await query("SELECT id,amount,status FROM public.payment_transactions WHERE reference=$1 AND user_id=$2 LIMIT 1", [reference, req.user.id]);
  const payment = payments[0];
  if (!payment || payment.status !== 'verified') return res.status(400).json({ error: 'Refund requests are available only for verified payments on your account.' });
  if (!Number.isFinite(amount) || amount <= 0 || amount > Number(payment.amount) || !reason) return res.status(400).json({ error: 'Check the refund amount and reason.' });
  const rows = await query("INSERT INTO public.payment_refunds(transaction_id,requested_by,amount,reason) VALUES($1,$2,$3,$4) RETURNING id,status,created_at", [payment.id, req.user.id, amount, reason]);
  await audit(req.user.id, 'REFUND_REQUESTED', 'refund', rows[0].id, { reference, amount, reason });
  res.status(201).json({ refund: rows[0] });
}));

app.get('/api/admin/overview', authRequired, adminRequired, wrap(async (_req, res) => {
  const rows = await query(
    "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='created')::int AS awaiting_transfer, COUNT(*) FILTER (WHERE status='pending_review')::int AS pending_review, COUNT(*) FILTER (WHERE status='verified')::int AS verified, COUNT(*) FILTER (WHERE status='rejected')::int AS rejected, COALESCE(SUM(amount) FILTER (WHERE status='verified' AND currency='NGN'),0)::numeric(14,2) AS verified_ngn FROM public.payment_transactions"
  );
  res.json({ overview: rows[0] });
}));

app.get('/api/admin/payments', authRequired, adminRequired, wrap(async (req, res) => {
  const status = cleanText(req.query.status, 32);
  const limit = Math.min(250, Math.max(1, Number(req.query.limit) || 100));
  const rows = status
    ? await query('SELECT p.id,p.reference,p.payer_name,p.payer_email,p.service_name,p.description,p.amount,p.currency,p.status,p.created_at,p.reviewed_at,p.review_note,s.bank_name,s.account_number,s.transfer_reference,s.transfer_date FROM public.payment_transactions p LEFT JOIN public.payment_manual_submissions s ON s.transaction_id=p.id WHERE p.status=$1 ORDER BY p.created_at DESC LIMIT $2', [status, limit])
    : await query('SELECT p.id,p.reference,p.payer_name,p.payer_email,p.service_name,p.description,p.amount,p.currency,p.status,p.created_at,p.reviewed_at,p.review_note,s.bank_name,s.account_number,s.transfer_reference,s.transfer_date FROM public.payment_transactions p LEFT JOIN public.payment_manual_submissions s ON s.transaction_id=p.id ORDER BY p.created_at DESC LIMIT $1', [limit]);
  res.json({ payments: rows });
}));

app.post('/api/admin/payments/:id/verify', authRequired, adminRequired, wrap(async (req, res) => {
  const id = cleanText(req.params.id, 64);
  const note = cleanText(req.body.note, 500);
  const rows = await query(
    "WITH changed AS (UPDATE public.payment_transactions SET status='verified',reviewed_at=now(),reviewed_by=$2,review_note=$3,updated_at=now() WHERE id=$1 AND status='pending_review' RETURNING id,reference,payer_name,payer_email,service_name,amount,currency), receipt AS (INSERT INTO public.payment_receipts(transaction_id,receipt_number,snapshot) SELECT id,'EPR-'||to_char(now(),'YYYY')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),jsonb_build_object('reference',reference,'payerName',payer_name,'payerEmail',payer_email,'service',service_name,'amount',amount,'currency',currency,'verifiedAt',now()) FROM changed RETURNING transaction_id,receipt_number), reviewed AS (UPDATE public.payment_manual_submissions SET reviewed_at=now(),reviewed_by=$2,review_note=$3 WHERE transaction_id IN (SELECT id FROM changed) RETURNING transaction_id), logged AS (INSERT INTO public.payment_audit_log(actor_id,action,entity_type,entity_id,details) SELECT $2,'PAYMENT_VERIFIED','payment',id::text,jsonb_build_object('reference',reference,'note',$3) FROM changed RETURNING id) SELECT changed.reference,receipt.receipt_number FROM changed JOIN receipt ON receipt.transaction_id=changed.id",
    [id, req.user.id, note || 'Funds received and verified by administrator.']
  );
  if (!rows[0]) return res.status(409).json({ error: 'Only a pending transfer can be verified. Refresh the list and try again.' });
  res.json({ ok: true, reference: rows[0].reference, receiptNumber: rows[0].receipt_number });
}));

app.post('/api/admin/payments/:id/reject', authRequired, adminRequired, wrap(async (req, res) => {
  const id = cleanText(req.params.id, 64);
  const note = cleanText(req.body.note, 500);
  if (!note) return res.status(400).json({ error: 'Enter a reason for rejecting this transfer.' });
  const rows = await query(
    "WITH changed AS (UPDATE public.payment_transactions SET status='rejected',reviewed_at=now(),reviewed_by=$2,review_note=$3,updated_at=now() WHERE id=$1 AND status='pending_review' RETURNING id,reference), reviewed AS (UPDATE public.payment_manual_submissions SET reviewed_at=now(),reviewed_by=$2,review_note=$3 WHERE transaction_id IN (SELECT id FROM changed) RETURNING transaction_id), logged AS (INSERT INTO public.payment_audit_log(actor_id,action,entity_type,entity_id,details) SELECT $2,'PAYMENT_REJECTED','payment',id::text,jsonb_build_object('reference',reference,'note',$3) FROM changed RETURNING id) SELECT reference FROM changed",
    [id, req.user.id, note]
  );
  if (!rows[0]) return res.status(409).json({ error: 'Only a pending transfer can be rejected.' });
  res.json({ ok: true, reference: rows[0].reference });
}));

app.get('/api/admin/banks', authRequired, adminRequired, wrap(async (_req, res) => {
  const rows = await query('SELECT id,bank_name,account_name,account_number,currency,instructions,is_active,display_order FROM public.payment_bank_accounts ORDER BY display_order,bank_name');
  res.json({ accounts: rows });
}));

app.post('/api/admin/banks', authRequired, adminRequired, wrap(async (req, res) => {
  const bankName = cleanText(req.body.bankName, 120);
  const accountName = cleanText(req.body.accountName, 160);
  const accountNumber = cleanText(req.body.accountNumber, 40);
  const currency = cleanText(req.body.currency, 3).toUpperCase();
  if (!bankName || !accountName || !/^[0-9]{6,24}$/.test(accountNumber) || !['NGN','USD','GBP','EUR'].includes(currency)) {
    return res.status(400).json({ error: 'Enter a valid bank, account name, account number and currency.' });
  }
  const rows = await query('INSERT INTO public.payment_bank_accounts(bank_name,account_name,account_number,currency,instructions,display_order) VALUES($1,$2,$3,$4,$5,10) RETURNING id,bank_name,account_name,account_number,currency,is_active', [bankName, accountName, accountNumber, currency, cleanText(req.body.instructions, 300)]);
  await audit(req.user.id, 'BANK_ACCOUNT_ADDED', 'bank_account', rows[0].id, { bankName, accountNumber });
  res.status(201).json({ account: rows[0] });
}));

app.patch('/api/admin/banks/:id', authRequired, adminRequired, wrap(async (req, res) => {
  const active = req.body.active === true;
  const rows = await query('UPDATE public.payment_bank_accounts SET is_active=$2,updated_at=now() WHERE id=$1 RETURNING id,bank_name,is_active', [cleanText(req.params.id, 64), active]);
  if (!rows[0]) return res.status(404).json({ error: 'Bank account not found.' });
  await audit(req.user.id, active ? 'BANK_ACCOUNT_ACTIVATED' : 'BANK_ACCOUNT_DEACTIVATED', 'bank_account', rows[0].id, {});
  res.json({ account: rows[0] });
}));

app.get('/api/admin/audit', authRequired, adminRequired, wrap(async (_req, res) => {
  const rows = await query('SELECT a.id,a.action,a.entity_type,a.entity_id,a.details,a.created_at,u.full_name,u.email FROM public.payment_audit_log a LEFT JOIN public.payment_users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 150');
  res.json({ events: rows });
}));

app.get('/api/admin/refunds', authRequired, adminRequired, wrap(async (_req, res) => {
  const rows = await query('SELECT r.id,r.amount,r.reason,r.status,r.created_at,p.reference,p.payer_name,p.payer_email,p.currency FROM public.payment_refunds r JOIN public.payment_transactions p ON p.id=r.transaction_id ORDER BY r.created_at DESC LIMIT 150');
  res.json({ refunds: rows });
}));

app.get('/api/admin/invoices', authRequired, adminRequired, wrap(async (_req, res) => {
  const rows = await query('SELECT i.id,i.reference,i.payer_name,i.payer_email,i.service_name,i.description,i.amount,i.currency,i.due_date,i.status,i.created_at FROM public.payment_invoices i ORDER BY i.created_at DESC LIMIT 150');
  res.json({ invoices: rows });
}));

app.post('/api/admin/invoices', authRequired, adminRequired, wrap(async (req, res) => {
  const payerName = cleanText(req.body.payerName, 120);
  const payerEmail = cleanEmail(req.body.payerEmail);
  const code = cleanText(req.body.serviceCode, 32).toUpperCase();
  const amount = Number(req.body.amount);
  const currency = cleanText(req.body.currency, 3).toUpperCase();
  const description = cleanText(req.body.description, 500);
  const dueDate = cleanText(req.body.dueDate, 10) || null;
  if (!payerName || !validEmail(payerEmail) || !Number.isFinite(amount) || amount <= 0 || currency !== 'NGN') return res.status(400).json({ error: 'Complete the invoice details. Invoices currently support NGN only.' });
  const services = await query('SELECT code,name FROM public.payment_service_catalog WHERE code=$1 AND active=true LIMIT 1', [code]);
  if (!services[0]) return res.status(400).json({ error: 'Choose an active service.' });
  const reference = makeReference('EPI');
  const rows = await query("INSERT INTO public.payment_invoices(reference,payer_name,payer_email,service_code,service_name,description,amount,currency,due_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING reference,payer_name,payer_email,service_name,amount,currency,due_date,status,created_at", [reference,payerName,payerEmail,code,services[0].name,description || null,amount,currency,dueDate,req.user.id]);
  await audit(req.user.id, 'INVOICE_CREATED', 'invoice', reference, { payerEmail, amount });
  res.status(201).json({ invoice: rows[0] });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0, immutable: false }));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('*', (_req, res) => res.status(404).send('Page not found.'));

app.use((err, _req, res, _next) => {
  const message = String(err && err.message || '');
  if (message.includes('duplicate key') || message.includes('unique constraint')) {
    return res.status(409).json({ error: 'A record with these details already exists.' });
  }
  console.error('ETHAN PAY API ERROR:', err);
  res.status(500).json({ error: 'Something went wrong. Please try again or contact Ethan Pay support.' });
});

app.listen(PORT, () => {
  console.log('ETHAN PAY listening on port ' + PORT);
});
