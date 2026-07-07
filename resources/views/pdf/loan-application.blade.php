<!DOCTYPE html>
<html>
<head>
<title>{{ $loan->application_number }}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;padding:32px;color:#111;font-size:13px}
.hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:14px;border-bottom:3px solid #F5C518}
.logo{font-size:22px;font-weight:800}
.id{background:#FFF9E6;border:2px solid #F5C518;border-radius:8px;padding:5px 14px;font-weight:700}
h3{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#C8961A;margin:20px 0 10px;padding-bottom:5px;border-bottom:1px solid #F5C518}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:0}
.row{padding:7px 0;border-bottom:1px solid #F3F4F6;display:flex;flex-direction:column;gap:2px}
.lbl{font-size:10px;color:#6B7280}.val{font-weight:600}.full{grid-column:1/-1}
.sig-row{display:grid;grid-template-columns:1fr 1fr;gap:48px;margin-top:48px}
.sig{border-top:1px solid #111;padding-top:6px;font-size:11px;color:#6B7280}
.footer{margin-top:32px;padding-top:12px;border-top:1px solid #E5E7EB;font-size:10px;color:#9CA3AF;text-align:center}
.status{display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase}
.status-pending{background:rgba(234,88,12,0.1);color:#EA580C}
.status-approved{background:rgba(22,163,74,0.1);color:#16A34A}
.status-rejected{background:rgba(220,38,38,0.09);color:#DC2626}
@media print{body{padding:20px}}
</style>
</head>
<body>
<div class="hdr">
  <div class="logo">&#127963; Laxmi Finance Ltd.</div>
  <div class="id">{{ $loan->application_number }}</div>
</div>

<div style="margin-bottom:16px">
  <span class="status status-{{ $loan->status }}">{{ ucfirst($loan->status) }}</span>
</div>

<h3>Loan Details</h3>
<div class="grid">
  <div class="row"><span class="lbl">Loan Type</span><span class="val">{{ $loan->loan_type }} Loan</span></div>
  <div class="row"><span class="lbl">Applied Amount</span><span class="val">&#8377;{{ number_format($loan->amount) }}</span></div>
  <div class="row"><span class="lbl">Tenure</span><span class="val">{{ $loan->tenure_days }} Days (Daily EMI)</span></div>
  <div class="row"><span class="lbl">Daily EMI</span><span class="val">&#8377;{{ number_format($loan->daily_emi, 2) }}</span></div>
  <div class="row"><span class="lbl">Total Payable</span><span class="val">&#8377;{{ number_format($loan->total_payable, 2) }}</span></div>
  <div class="row"><span class="lbl">Interest</span><span class="val">&#8377;{{ number_format($loan->total_payable - $loan->amount, 2) }} ({{ $loan->tenure_days === 33 ? '2%' : '4%' }} flat)</span></div>
  <div class="row full"><span class="lbl">Purpose</span><span class="val">{{ $loan->purpose }}</span></div>
  <div class="row"><span class="lbl">Applied On</span><span class="val">{{ $loan->created_at->format('d/m/Y') }}</span></div>
  <div class="row"><span class="lbl">Assigned Agent</span><span class="val">{{ $loan->assignedAgent?->name ?? 'Unassigned' }}</span></div>
</div>

@php
  $docs = $loan->documents ?? [];
  $photoUrl = $docs['photo'] ?? '';
  if (str_starts_with($photoUrl, '/storage/')) {
      $photoUrl = url($photoUrl);
  }
  $aadhaarUrl = $docs['aadhaar'] ?? '';
  if (str_starts_with($aadhaarUrl, '/storage/')) {
      $aadhaarUrl = url($aadhaarUrl);
  }
  $panUrl = $docs['pan'] ?? '';
  if (str_starts_with($panUrl, '/storage/')) {
      $panUrl = url($panUrl);
  }
@endphp

<h3>Applicant Details</h3>
<div style="margin-bottom:12px; overflow:hidden;">
  @if($photoUrl)
    <img src="{{ $photoUrl }}" style="width:100px; height:120px; border:1px solid #E5E7EB; border-radius:8px; object-fit:cover; float:right; margin-left:16px;" alt="Applicant Photo" />
  @endif
  <div class="grid" style="display:grid; grid-template-columns:1fr 1fr; gap:0;">
    <div class="row"><span class="lbl">Full Name</span><span class="val">{{ $loan->customer?->name }}</span></div>
    <div class="row"><span class="lbl">Mobile</span><span class="val">+91 {{ $loan->customer?->phone }}</span></div>
    <div class="row"><span class="lbl">Aadhaar Number</span><span class="val">{{ $loan->aadhaar ?? '—' }}</span></div>
    <div class="row"><span class="lbl">PAN Number</span><span class="val">{{ $loan->pan ?? '—' }}</span></div>
    <div class="row"><span class="lbl">City</span><span class="val">{{ $loan->city }}</span></div>
    <div class="row"><span class="lbl">Monthly Income</span><span class="val">&#8377;{{ number_format($loan->monthly_income ?? 0) }}</span></div>
    <div class="row full" style="grid-column: 1 / -1;"><span class="lbl">Address</span><span class="val">{{ $loan->address }}</span></div>
  </div>
</div>

<h3>Co-Borrower Details</h3>
<div class="grid">
  <div class="row"><span class="lbl">Full Name</span><span class="val">{{ $loan->co_borrower['name'] ?? '—' }}</span></div>
  <div class="row"><span class="lbl">Mobile</span><span class="val">+91 {{ $loan->co_borrower['phone'] ?? '—' }}</span></div>
  <div class="row"><span class="lbl">Relationship</span><span class="val">{{ $loan->co_borrower['relation'] ?? '—' }}</span></div>
  <div class="row full"><span class="lbl">Address</span><span class="val">{{ $loan->co_borrower['address'] ?? '—' }}</span></div>
</div>

@if($aadhaarUrl || $panUrl)
<h3>Uploaded KYC Documents</h3>
<div style="display:flex; gap:16px; margin-top:8px; margin-bottom:16px; page-break-inside:avoid;">
  @if($aadhaarUrl)
    <div style="flex:1; border:1px solid #E5E7EB; border-radius:8px; padding:10px; text-align:center;">
      <p style="font-size:9px; font-weight:bold; color:#6B7280; margin-bottom:6px; text-transform:uppercase;">Aadhaar Card Attachment</p>
      <img src="{{ $aadhaarUrl }}" style="max-width:100%; max-height:140px; object-fit:contain; border-radius:4px;" />
    </div>
  @endif
  @if($panUrl)
    <div style="flex:1; border:1px solid #E5E7EB; border-radius:8px; padding:10px; text-align:center;">
      <p style="font-size:9px; font-weight:bold; color:#6B7280; margin-bottom:6px; text-transform:uppercase;">PAN Card Attachment</p>
      <img src="{{ $panUrl }}" style="max-width:100%; max-height:140px; object-fit:contain; border-radius:4px;" />
    </div>
  @endif
</div>
@endif

@if($loan->status === 'approved')
<h3>Token Information</h3>
<div class="grid">
  <div class="row"><span class="lbl">Permanent Loan ID</span><span class="val">{{ $loan->customer?->customer_token }}</span></div>
  <div class="row"><span class="lbl">Status</span><span class="val" style="color:#16A34A">Approved & Active</span></div>
</div>
@endif

<div class="sig-row">
  <div class="sig">Applicant Signature</div>
  <div class="sig">Co-Borrower Signature</div>
  <div class="sig">Authorised Signatory — Laxmi Finance</div>
  <div class="sig">Date</div>
</div>

<div class="footer">
  Laxmi Finance Ltd. · RBI Licensed NBFC · Generated: {{ now()->format('d/m/Y H:i') }} · Computer generated document
</div>

<script>window.onload=()=>setTimeout(()=>window.print(),500)</script>
</body>
</html>
