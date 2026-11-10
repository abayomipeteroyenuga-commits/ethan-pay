'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));
const modal = $('#modal');
const modalBody = $('#modalBody');
let currentUser = null;
let services = [];
let bankAccounts = [];
let adminSetupRequired = false;
let pendingPaymentCode = '';
let pendingTrack = false;
let adminPayments = [];

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}
function money(amount, currency) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: currency || 'NGN', maximumFractionDigits: 2 }).format(Number(amount || 0));
}
function dateText(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' });
}
function statusName(status) {
  const labels = {
    created: 'Awaiting transfer',
    pending_review: 'Pending review',
    verified: 'Verified',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    refunded: 'Refunded'
  };
  return labels[status] || status || 'Unknown';
}
function statusClass(status) {
  return 'status-pill status-' + String(status || 'unknown').replace(/[^a-z0-9_-]/gi, '');
}
function toast(message, type) {
  const region = $('#toastRegion');
  const item = document.createElement('div');
  item.className = 'toast ' + (type || '');
  item.textContent = message;
  region.appendChild(item);
  window.setTimeout(() => item.remove(), 4200);
}
async function api(path, options) {
  const settings = options || {};
  const response = await fetch(path, {
    method: settings.method || 'GET',
    credentials: 'same-origin',
    headers: Object.assign({ 'Content-Type': 'application/json' }, settings.headers || {}),
    body: settings.body ? JSON.stringify(settings.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
function showModal(content) {
  modalBody.innerHTML = content;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}
function closeModal() {
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}
function serviceOptions(selected) {
  return services.map(service => '<option value="' + escapeHtml(service.code) + '" ' + (service.code === selected ? 'selected' : '') + '>' + escapeHtml(service.name) + '</option>').join('');
}
function setUser(user) {
  currentUser = user || null;
  $('#signInButton').hidden = !!currentUser;
  $('#getStartedButton').hidden = !!currentUser;
  $('#signOutButton').hidden = !currentUser;
  $('#userGreeting').hidden = !currentUser;
  $('#userGreeting').textContent = currentUser ? 'Hello, ' + currentUser.fullName.split(' ')[0] : '';
  $('#recordsNav').hidden = !currentUser;
  $('#paymentWorkspace').hidden = !currentUser;
  $('#adminNav').hidden = !(currentUser && currentUser.role === 'admin');
  $('#adminWorkspace').hidden = !(currentUser && currentUser.role === 'admin');
  if (currentUser) {
    $('#accountSummary').innerHTML = '<div class="account-chip"><span class="account-avatar">' + escapeHtml(currentUser.fullName.charAt(0).toUpperCase()) + '</span><div><b>' + escapeHtml(currentUser.fullName) + '</b><small>' + escapeHtml(currentUser.email) + '</small></div></div><div class="account-chip account-role"><span>ACCOUNT TYPE</span><b>' + (currentUser.role === 'admin' ? 'Administrator' : 'Customer') + '</b></div>';
    loadPayments();
    if (currentUser.role === 'admin') refreshAdmin();
  } else {
    $('#paymentRows').innerHTML = '';
    $('#adminPaymentRows').innerHTML = '';
  }
}
function openAuth(mode) {
  const register = mode === 'register';
  const setupLink = adminSetupRequired ? '<p class="form-assist">First-time administrator? <button class="text-button" id="showAdminSetup">Set up the Ethan Pay admin account</button></p>' : '';
  showModal(
    '<div class="modal-kicker">ETHAN PAY ACCOUNT</div>' +
    '<h2 id="modalTitle">' + (register ? 'Create your account' : 'Welcome back') + '</h2>' +
    '<p class="modal-lede">' + (register ? 'Create a secure account to keep your Ethan payment references and receipts together.' : 'Sign in to manage your payments and view your payment history.') + '</p>' +
    '<form id="authForm" class="modal-form">' +
      (register ? '<label>Full name<input name="fullName" autocomplete="name" required maxlength="120" placeholder="Your full name"></label><label>Phone number <span class="optional">Optional</span><input name="phone" autocomplete="tel" placeholder="e.g. 080..."></label>' : '') +
      '<label>Email address<input name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>' +
      '<label>Password<input name="password" type="password" autocomplete="' + (register ? 'new-password' : 'current-password') + '" required minlength="12" placeholder="At least 12 characters"></label>' +
      '<button class="button button-primary button-block" type="submit">' + (register ? 'Create secure account' : 'Sign in securely') + '</button>' +
    '</form>' +
    '<p class="form-assist">' + (register ? 'Already registered? <button class="text-button" id="switchAuth">Sign in</button>' : 'New to Ethan Pay? <button class="text-button" id="switchAuth">Create an account</button>') + '</p>' +
    setupLink +
    '<p class="modal-footnote">Your session is protected by a secure, httpOnly sign-in cookie.</p>'
  );
  $('#authForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const submit = event.currentTarget.querySelector('button[type=submit]');
    submit.disabled = true;
    submit.textContent = 'Please wait…';
    try {
      const result = await api(register ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: payload });
      setUser(result.user);
      closeModal();
      toast(register ? 'Your Ethan Pay account is ready.' : 'You are signed in.');
      if (pendingPaymentCode) {
        const code = pendingPaymentCode;
        pendingPaymentCode = '';
        startPayment(code);
      } else if (pendingTrack) {
        pendingTrack = false;
        openTrackPayment();
      }
    } catch (error) {
      toast(error.message, 'error');
      submit.disabled = false;
      submit.textContent = register ? 'Create secure account' : 'Sign in securely';
    }
  });
  $('#switchAuth').addEventListener('click', () => openAuth(register ? 'login' : 'register'));
  if ($('#showAdminSetup')) $('#showAdminSetup').addEventListener('click', openAdminSetup);
}
function openAdminSetup() {
  showModal(
    '<div class="modal-kicker">INITIAL ADMINISTRATOR SETUP</div><h2 id="modalTitle">Secure your finance workspace</h2>' +
    '<p class="modal-lede">Create the first Ethan Pay administrator account. This one-time setup requires the private setup code supplied to the owner.</p>' +
    '<form id="adminSetupForm" class="modal-form">' +
      '<label>Full name<input name="fullName" required maxlength="120"></label>' +
      '<label>Administrator email<input name="email" type="email" required value="abayomipeteroyenuga@gmail.com"></label>' +
      '<label>One-time setup code<input name="setupToken" type="password" required autocomplete="one-time-code"></label>' +
      '<label>Create a strong password<input name="password" type="password" minlength="12" required autocomplete="new-password" placeholder="At least 12 characters"></label>' +
      '<button class="button button-primary button-block" type="submit">Create administrator account</button>' +
    '</form><p class="modal-footnote">Administrator setup closes permanently after the first admin account is created.</p>'
  );
  $('#adminSetupForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type=submit]');
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    button.disabled = true;
    try {
      const result = await api('/api/setup/admin', { method: 'POST', body: payload });
      adminSetupRequired = false;
      setUser(result.user);
      closeModal();
      toast('Ethan Pay administrator account created.', 'success');
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  });
}
async function startPayment(code) {
  if (!currentUser) {
    pendingPaymentCode = code || '';
    openAuth('login');
    toast('Sign in or create an account to start a payment.');
    return;
  }
  const service = services.find(item => item.code === code) || services[0];
  if (!service) return toast('No payment services are available right now.', 'error');
  showModal(
    '<div class="modal-kicker">NEW PAYMENT</div><h2 id="modalTitle">Create a payment reference</h2>' +
    '<p class="modal-lede">Choose the correct service and enter the amount already confirmed with the Ethan department.</p>' +
    '<form id="newPaymentForm" class="modal-form">' +
      '<label>Payment service<select name="serviceCode" required>' + serviceOptions(service.code) + '</select></label>' +
      '<label>Amount (NGN)<div class="input-prefix"><span>₦</span><input name="amount" type="number" min="1" max="100000000" step="0.01" required placeholder="Enter amount"></div></label>' +
      '<label>Payment description <span class="optional">Optional</span><input name="description" maxlength="500" placeholder="Course name, order ID or purpose"></label>' +
      '<div class="notice-box"><b>Before you continue</b><span>Only pay the exact amount confirmed by the service team. Creating a reference does not mean money has been received.</span></div>' +
      '<button class="button button-primary button-block" type="submit">Create payment reference</button>' +
    '</form>'
  );
  $('#newPaymentForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type=submit]');
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    payload.amount = Number(payload.amount);
    payload.currency = 'NGN';
    button.disabled = true;
    button.textContent = 'Creating reference…';
    try {
      const result = await api('/api/payments', { method: 'POST', body: payload });
      await loadBankAccounts();
      showTransferInstructions(result.payment);
      loadPayments();
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
      button.textContent = 'Create payment reference';
    }
  });
}
function bankCard(account) {
  return '<div class="bank-card"><div class="bank-card-head"><span>' + escapeHtml(account.bank_name) + '</span><b>' + escapeHtml(account.currency) + '</b></div>' +
    '<small>ACCOUNT NAME</small><strong>' + escapeHtml(account.account_name) + '</strong>' +
    '<small>ACCOUNT NUMBER</small><div class="bank-number"><b>' + escapeHtml(account.account_number) + '</b><button type="button" class="copy-button" data-copy="' + escapeHtml(account.account_number) + '">Copy</button></div></div>';
}
function showTransferInstructions(payment) {
  const options = bankAccounts.filter(account => account.currency === payment.currency).map(account => '<option value="' + escapeHtml(account.id) + '">' + escapeHtml(account.bank_name) + ' — ' + escapeHtml(account.account_number) + '</option>').join('');
  const cards = bankAccounts.filter(account => account.currency === payment.currency).map(bankCard).join('');
  const noAccount = !options;
  showModal(
    '<div class="modal-kicker">PAYMENT REFERENCE CREATED</div><h2 id="modalTitle">Complete your bank transfer</h2>' +
    '<div class="reference-banner"><span>YOUR ETHAN PAY REFERENCE</span><b>' + escapeHtml(payment.reference) + '</b><button type="button" class="copy-button" data-copy="' + escapeHtml(payment.reference) + '">Copy reference</button></div>' +
    '<div class="amount-highlight"><span>AMOUNT TO TRANSFER</span><b>' + money(payment.amount, payment.currency) + '</b><small>' + escapeHtml(payment.service_name) + '</small></div>' +
    '<p class="modal-lede">Transfer only to one of the official company accounts below. Add your reference to the transfer narration where your bank allows it.</p>' +
    '<div class="bank-card-grid">' + (cards || '<div class="notice-box">No active bank account is configured for this currency. Contact Ethan Finance before making payment.</div>') + '</div>' +
    (noAccount ? '' : '<form id="transferForm" class="modal-form transfer-form"><label>Which account did you pay?<select name="bankAccountId" required>' + options + '</select></label><label>Bank transfer reference<input name="transferReference" required maxlength="120" placeholder="Your bank transaction ID"></label><label>Transfer date<input name="transferDate" type="date" max="' + new Date().toISOString().slice(0,10) + '" required value="' + new Date().toISOString().slice(0,10) + '"></label><label>Additional note <span class="optional">Optional</span><textarea name="note" rows="2" maxlength="500" placeholder="Any useful payment detail"></textarea></label><button class="button button-primary button-block" type="submit">Submit transfer for verification</button></form>') +
    '<p class="modal-footnote">Your payment remains pending until Ethan Finance confirms that the funds have arrived in the company account.</p>'
  );
  if (!noAccount) $('#transferForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type=submit]');
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    button.disabled = true;
    button.textContent = 'Submitting transfer…';
    try {
      const result = await api('/api/payments/' + encodeURIComponent(payment.reference) + '/submit-transfer', { method: 'POST', body: payload });
      toast(result.message, 'success');
      closeModal();
      loadPayments();
      document.querySelector('#paymentWorkspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
      button.textContent = 'Submit transfer for verification';
    }
  });
}
async function loadBankAccounts() {
  const result = await api('/api/banks');
  bankAccounts = result.accounts || [];
}
async function loadServices() {
  const result = await api('/api/services');
  services = result.services || [];
  $$('.service-options').forEach(select => { select.innerHTML = serviceOptions('LEARN'); });
}
function paymentAction(payment) {
  if (payment.status === 'created') return '<button class="table-button" data-continue="' + escapeHtml(payment.reference) + '">Continue</button>';
  if (payment.status === 'verified') return '<button class="table-button" data-receipt="' + escapeHtml(payment.reference) + '">Receipt</button>';
  if (payment.status === 'pending_review') return '<span class="action-muted">Awaiting review</span>';
  if (payment.status === 'rejected') return '<button class="table-button" data-track="' + escapeHtml(payment.reference) + '">Details</button>';
  return '<span class="action-muted">—</span>';
}
async function loadPayments() {
  if (!currentUser) return;
  try {
    const result = await api('/api/payments');
    const rows = result.payments || [];
    $('#paymentRows').innerHTML = rows.map(payment => '<tr><td><b class="reference-text">' + escapeHtml(payment.reference) + '</b><small>' + dateText(payment.created_at) + '</small></td><td>' + escapeHtml(payment.service_name) + '<small>' + escapeHtml(payment.description || '') + '</small></td><td><b>' + money(payment.amount, payment.currency) + '</b></td><td>' + dateText(payment.created_at) + '</td><td><span class="' + statusClass(payment.status) + '">' + escapeHtml(statusName(payment.status)) + '</span></td><td>' + paymentAction(payment) + '</td></tr>').join('');
    $('#paymentsEmpty').hidden = rows.length > 0;
  } catch (error) {
    toast(error.message, 'error');
  }
}
function openTrackPayment() {
  if (!currentUser) {
    pendingTrack = true;
    openAuth('login');
    return;
  }
  showModal('<div class="modal-kicker">PAYMENT STATUS</div><h2 id="modalTitle">Track a payment</h2><p class="modal-lede">Enter the Ethan Pay reference connected to your account.</p><form id="trackForm" class="modal-form"><label>Payment reference<input name="reference" required placeholder="EP-2026-XXXXXXXX"></label><button class="button button-primary button-block" type="submit">Check payment status</button></form><div id="trackResult"></div>');
  $('#trackForm').addEventListener('submit', async event => {
    event.preventDefault();
    const reference = new FormData(event.currentTarget).get('reference').trim().toUpperCase();
    try {
      const result = await api('/api/payments/' + encodeURIComponent(reference));
      const payment = result.payment;
      $('#trackResult').innerHTML = '<div class="track-result"><span class="' + statusClass(payment.status) + '">' + escapeHtml(statusName(payment.status)) + '</span><b>' + escapeHtml(payment.reference) + '</b><strong>' + money(payment.amount, payment.currency) + '</strong><small>' + escapeHtml(payment.service_name) + ' • ' + dateText(payment.created_at) + '</small>' + (payment.review_note ? '<p>' + escapeHtml(payment.review_note) + '</p>' : '') + (payment.receipt_number ? '<button class="button button-outline button-block" type="button" data-receipt="' + escapeHtml(payment.reference) + '">Open receipt</button>' : '') + '</div>';
    } catch (error) {
      $('#trackResult').innerHTML = '<div class="notice-box notice-error">' + escapeHtml(error.message) + '</div>';
    }
  });
}
async function openReceipt(reference) {
  try {
    const result = await api('/api/receipts/' + encodeURIComponent(reference));
    const receipt = result.receipt;
    showModal('<div class="receipt-sheet"><div class="receipt-top"><div><b>ETHAN PAY</b><small>OFFICIAL PAYMENT RECEIPT</small></div><span class="receipt-check">✓ VERIFIED</span></div><div class="receipt-number">' + escapeHtml(receipt.receipt_number) + '</div><div class="receipt-line"><span>Payment reference</span><b>' + escapeHtml(receipt.reference) + '</b></div><div class="receipt-line"><span>Payer</span><b>' + escapeHtml(receipt.payer_name) + '</b></div><div class="receipt-line"><span>Email</span><b>' + escapeHtml(receipt.payer_email) + '</b></div><div class="receipt-line"><span>Service</span><b>' + escapeHtml(receipt.service_name) + '</b></div><div class="receipt-amount"><span>AMOUNT VERIFIED</span><b>' + money(receipt.amount, receipt.currency) + '</b></div><div class="receipt-line"><span>Verified on</span><b>' + dateText(receipt.issued_at) + '</b></div><p class="receipt-note">This receipt was issued by ETHAN PAY after successful administrative verification of the payment.</p><button class="button button-primary button-block no-print" id="printReceipt">Print / Save receipt</button></div>');
    $('#printReceipt').addEventListener('click', () => window.print());
  } catch (error) {
    toast(error.message, 'error');
  }
}
function openRefund(reference) {
  showModal('<div class="modal-kicker">REFUND REQUEST</div><h2 id="modalTitle">Request a refund review</h2><p class="modal-lede">A request does not move money. Ethan Finance will review it and contact you.</p><form id="refundForm" class="modal-form"><input type="hidden" name="reference" value="' + escapeHtml(reference) + '"><label>Amount requested (NGN)<input name="amount" type="number" min="1" step="0.01" required></label><label>Reason<textarea name="reason" rows="3" required maxlength="500" placeholder="Explain why you are requesting a refund"></textarea></label><button class="button button-primary button-block" type="submit">Submit refund request</button></form>');
  $('#refundForm').addEventListener('submit', async event => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    payload.amount = Number(payload.amount);
    try {
      await api('/api/refunds', { method: 'POST', body: payload });
      closeModal();
      toast('Your refund request has been sent to Ethan Finance.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}
function renderAdminPayments(rows) {
  adminPayments = rows || [];
  $('#adminPaymentRows').innerHTML = adminPayments.map(payment => {
    const evidence = payment.transfer_reference
      ? '<b>' + escapeHtml(payment.bank_name || '') + '</b><small>' + escapeHtml(payment.transfer_reference) + '</small><small>' + dateText(payment.transfer_date) + '</small>'
      : '<span class="action-muted">Not submitted</span>';
    const actions = payment.status === 'pending_review'
      ? '<div class="review-actions"><button class="mini-button approve" data-verify="' + escapeHtml(payment.id) + '">Verify</button><button class="mini-button reject" data-reject="' + escapeHtml(payment.id) + '">Reject</button></div>'
      : '<span class="action-muted">—</span>';
    return '<tr><td><b>' + escapeHtml(payment.payer_name) + '</b><small>' + escapeHtml(payment.payer_email) + '</small><small class="reference-text">' + escapeHtml(payment.reference) + '</small></td><td>' + escapeHtml(payment.service_name) + '<small>' + escapeHtml(payment.description || '') + '</small></td><td><b>' + money(payment.amount, payment.currency) + '</b></td><td>' + evidence + '</td><td><span class="' + statusClass(payment.status) + '">' + escapeHtml(statusName(payment.status)) + '</span></td><td>' + actions + '</td></tr>';
  }).join('');
  $('#adminPaymentsEmpty').hidden = adminPayments.length > 0;
}
async function refreshAdminPayments() {
  if (!currentUser || currentUser.role !== 'admin') return;
  const status = $('#adminStatusFilter').value;
  const result = await api('/api/admin/payments' + (status ? '?status=' + encodeURIComponent(status) : ''));
  renderAdminPayments(result.payments);
}
async function loadAdminBanks() {
  const result = await api('/api/admin/banks');
  const accounts = result.accounts || [];
  $('#bankAccountList').innerHTML = accounts.map(account => '<div class="admin-bank-row"><div><b>' + escapeHtml(account.bank_name) + '</b><small>' + escapeHtml(account.account_name) + ' • ' + escapeHtml(account.account_number) + '</small><span class="' + (account.is_active ? 'bank-active' : 'bank-inactive') + '">' + (account.is_active ? 'Active for customers' : 'Hidden from customers') + '</span></div><button class="mini-button ' + (account.is_active ? 'reject' : 'approve') + '" data-bank-toggle="' + escapeHtml(account.id) + '" data-active="' + (!account.is_active) + '">' + (account.is_active ? 'Deactivate' : 'Activate') + '</button></div>').join('') || '<p class="action-muted">No bank accounts configured.</p>';
}
async function loadAdminInvoices() {
  const result = await api('/api/admin/invoices');
  $('#invoiceList').innerHTML = (result.invoices || []).slice(0, 5).map(invoice => '<div class="invoice-row"><b>' + escapeHtml(invoice.reference) + '</b><span>' + escapeHtml(invoice.payer_name) + ' · ' + money(invoice.amount, invoice.currency) + '</span><small>' + escapeHtml(invoice.status) + ' · ' + dateText(invoice.created_at) + '</small></div>').join('') || '<p class="action-muted">No invoices created yet.</p>';
}
async function loadAudit() {
  const result = await api('/api/admin/audit');
  $('#auditList').innerHTML = (result.events || []).slice(0, 10).map(event => '<div class="audit-row"><b>' + escapeHtml(event.action.replaceAll('_', ' ')) + '</b><small>' + escapeHtml(event.full_name || 'System') + ' · ' + dateText(event.created_at) + '</small></div>').join('') || '<p class="action-muted">No audit events recorded yet.</p>';
}
async function refreshAdmin() {
  if (!currentUser || currentUser.role !== 'admin') return;
  try {
    const [overview] = await Promise.all([
      api('/api/admin/overview'),
      refreshAdminPayments(),
      loadAdminBanks(),
      loadAdminInvoices(),
      loadAudit()
    ]);
    const data = overview.overview;
    $('#adminMetrics').innerHTML = [
      ['All references', data.total],
      ['Pending review', data.pending_review],
      ['Verified payments', data.verified],
      ['Verified total (NGN)', money(data.verified_ngn, 'NGN')]
    ].map(metric => '<div class="admin-metric"><span>' + escapeHtml(metric[0]) + '</span><b>' + escapeHtml(metric[1]) + '</b></div>').join('');
  } catch (error) {
    toast(error.message, 'error');
  }
}
async function verifyPayment(id) {
  if (!window.confirm('Confirm that the funds have arrived in the official company bank account and match this transfer?')) return;
  try {
    const result = await api('/api/admin/payments/' + encodeURIComponent(id) + '/verify', { method: 'POST', body: { note: 'Funds received and matched against the company bank statement.' } });
    toast('Payment verified. Receipt ' + result.receiptNumber + ' issued.', 'success');
    refreshAdmin();
  } catch (error) {
    toast(error.message, 'error');
  }
}
async function rejectPayment(id) {
  const note = window.prompt('Enter the reason for rejecting this transfer:');
  if (!note || !note.trim()) return;
  try {
    await api('/api/admin/payments/' + encodeURIComponent(id) + '/reject', { method: 'POST', body: { note: note.trim() } });
    toast('Payment submission rejected.');
    refreshAdmin();
  } catch (error) {
    toast(error.message, 'error');
  }
}
function downloadCsv() {
  const columns = ['Reference','Payer','Email','Service','Amount','Currency','Bank','Transfer reference','Transfer date','Status','Date'];
  const lines = [columns].concat(adminPayments.map(payment => [
    payment.reference,payment.payer_name,payment.payer_email,payment.service_name,payment.amount,payment.currency,
    payment.bank_name || '',payment.transfer_reference || '',payment.transfer_date || '',payment.status,payment.created_at
  ])).map(row => row.map(value => '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"').join(','));
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'ethan-pay-transactions.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}
async function handleAdminBankAdd(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    await api('/api/admin/banks', { method: 'POST', body: payload });
    event.currentTarget.reset();
    toast('Company bank account added.');
    loadAdminBanks();
    loadBankAccounts();
  } catch (error) {
    toast(error.message, 'error');
  }
}
async function handleInvoiceCreate(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  payload.amount = Number(payload.amount);
  try {
    const result = await api('/api/admin/invoices', { method: 'POST', body: payload });
    event.currentTarget.reset();
    toast('Invoice created: ' + result.invoice.reference, 'success');
    loadAdminInvoices();
  } catch (error) {
    toast(error.message, 'error');
  }
}

document.addEventListener('click', async event => {
  const serviceButton = event.target.closest('[data-service-code]');
  if (serviceButton) return startPayment(serviceButton.dataset.serviceCode);
  const copy = event.target.closest('[data-copy]');
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.copy); toast('Copied to clipboard.'); }
    catch (_) { toast('Copy was blocked by your browser. Select the number and copy it manually.', 'error'); }
  }
  const continueButton = event.target.closest('[data-continue]');
  if (continueButton) {
    const result = await api('/api/payments/' + encodeURIComponent(continueButton.dataset.continue));
    await loadBankAccounts();
    showTransferInstructions(result.payment);
  }
  const receiptButton = event.target.closest('[data-receipt]');
  if (receiptButton) openReceipt(receiptButton.dataset.receipt);
  const trackButton = event.target.closest('[data-track]');
  if (trackButton) {
    const result = await api('/api/payments/' + encodeURIComponent(trackButton.dataset.track));
    showModal('<div class="modal-kicker">PAYMENT DETAILS</div><h2 id="modalTitle">' + escapeHtml(result.payment.reference) + '</h2><div class="track-result"><span class="' + statusClass(result.payment.status) + '">' + escapeHtml(statusName(result.payment.status)) + '</span><b>' + escapeHtml(result.payment.service_name) + '</b><strong>' + money(result.payment.amount, result.payment.currency) + '</strong><p>' + escapeHtml(result.payment.review_note || 'Check your transfer details or contact Ethan Finance for assistance.') + '</p></div>');
  }
  const verify = event.target.closest('[data-verify]');
  if (verify) verifyPayment(verify.dataset.verify);
  const reject = event.target.closest('[data-reject]');
  if (reject) rejectPayment(reject.dataset.reject);
  const bankToggle = event.target.closest('[data-bank-toggle]');
  if (bankToggle) {
    try {
      await api('/api/admin/banks/' + encodeURIComponent(bankToggle.dataset.bankToggle), { method: 'PATCH', body: { active: bankToggle.dataset.active === 'true' } });
      toast('Bank account availability updated.');
      loadAdminBanks();
      loadBankAccounts();
    } catch (error) { toast(error.message, 'error'); }
  }
});

$('#closeModal').addEventListener('click', closeModal);
modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
$('#signInButton').addEventListener('click', () => openAuth('login'));
$('#getStartedButton').addEventListener('click', () => openAuth('register'));
$('#signOutButton').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); setUser(null); toast('You have signed out.'); }
  catch (error) { toast(error.message, 'error'); }
});
$('#heroPayButton').addEventListener('click', () => startPayment('LEARN'));
$('#newPaymentButton').addEventListener('click', () => startPayment('LEARN'));
$('#heroStatusButton').addEventListener('click', openTrackPayment);
$('#trackButton').addEventListener('click', openTrackPayment);
$('#refreshPayments').addEventListener('click', loadPayments);
$('#refreshAdmin').addEventListener('click', refreshAdmin);
$('#adminStatusFilter').addEventListener('change', refreshAdminPayments);
$('#exportPayments').addEventListener('click', downloadCsv);
$('#addBankForm').addEventListener('submit', handleAdminBankAdd);
$('#invoiceForm').addEventListener('submit', handleInvoiceCreate);
$('#mobileMenu').addEventListener('click', () => {
  const nav = $('#mainNav');
  const open = nav.classList.toggle('nav-open');
  $('#mobileMenu').setAttribute('aria-expanded', String(open));
});
$('#mainNav').addEventListener('click', event => {
  if (event.target.closest('a')) $('#mainNav').classList.remove('nav-open');
});
$('#year').textContent = new Date().getFullYear();

(async function initialise() {
  try {
    await Promise.all([loadServices(), loadBankAccounts()]);
    const setup = await api('/api/setup/status');
    adminSetupRequired = !!setup.adminSetupRequired;
    try {
      const result = await api('/api/auth/me');
      setUser(result.user);
    } catch (_) {
      setUser(null);
    }
  } catch (error) {
    toast('Ethan Pay is temporarily unable to connect. Please refresh or contact support.', 'error');
    console.error(error);
  }
})();
