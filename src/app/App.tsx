import { useState, useRef, useEffect } from "react";
import { toast, Toaster } from "sonner";
import {
  ChevronLeft, ChevronRight, Eye, EyeOff, Camera,
  FileText, CheckCircle, AlertCircle, Home, CreditCard,
  Bell, UserCircle, LogOut, Users, X, MessageSquare,
  Wallet, Plus, Search, Percent, Check, BarChart2,
  Download, Upload, ChevronDown, Info, Menu, Phone, Database,
  Mail, Shield, RefreshCw, Printer, ArrowRight, Trash2,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

// ─── API helper ──────────────────────────────────────────────
let csrfReady: Promise<void> | null = null;
function ensureCsrf() {
  if (!csrfReady) csrfReady = fetch('/sanctum/csrf-cookie', { credentials: 'include' }).then(() => {});
  return csrfReady;
}

let globalTriggerLogout: (() => void) | null = null;

async function fileToBase64(blobUrl: string): Promise<string> {
  if (blobUrl.startsWith('data:')) return blobUrl;
  const resp = await fetch(blobUrl);
  const blob = await resp.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function compressImage(dataUrl: string, maxWidth = 800, maxHeight = 800, quality = 0.75): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } else {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

let isWaking = false;
let wakePromise: Promise<void> | null = null;
const requestQueue: { run: () => Promise<any>; resolve: (value: any) => void; reject: (reason: any) => void }[] = [];

let globalSetWakingState: ((waking: boolean, message: string) => void) | null = null;

function setWakingState(waking: boolean, message: string = "") {
  isWaking = waking;
  if (globalSetWakingState) {
    globalSetWakingState(waking, message);
  }
}

async function silentWakeUp(): Promise<void> {
  if (wakePromise) return wakePromise;

  wakePromise = (async () => {
    setWakingState(true, "Connecting to server...");
    let attempts = 0;
    while (true) {
      try {
        const res = await fetch('/api/health', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.status === 'ok') {
            break;
          }
        }
      } catch (e) {
        // Silent error
      }
      
      attempts++;
      if (attempts >= 1) {
        setWakingState(true, "Preparing secure connection...");
      }
      await new Promise(r => setTimeout(r, 5000));
    }
    setWakingState(false);
    wakePromise = null;
  })();

  return wakePromise;
}

const activeRequests = new Map<string, Promise<any>>();

async function api(path: string, opts: RequestInit = {}): Promise<any> {
  if (path === '/health') {
    return executeFetch(path, opts);
  }

  const requestKey = opts.method === 'GET' || !opts.method 
    ? `${path}:${JSON.stringify(opts.headers || {})}`
    : null;

  if (requestKey && activeRequests.has(requestKey)) {
    return activeRequests.get(requestKey);
  }

  const promise = (async () => {
    if (wakePromise || isWaking) {
      return new Promise((resolve, reject) => {
        requestQueue.push({
          run: () => apiWithRetry(path, opts),
          resolve,
          reject
        });
      });
    }

    try {
      return await apiWithRetry(path, opts);
    } catch (err: any) {
      const errMsg = err.message || "";
      const isNetworkError = errMsg.includes("Failed to fetch") || 
                            errMsg.includes("NetworkError") || 
                            errMsg.includes("419") || 
                            errMsg.includes("502") || 
                            errMsg.includes("503") || 
                            errMsg.includes("504");
      if (isNetworkError) {
        const retryPromise = new Promise((resolve, reject) => {
          requestQueue.push({
            run: () => apiWithRetry(path, opts),
            resolve,
            reject
          });
        });

        await silentWakeUp();
        await processQueue();
        return retryPromise;
      }
      throw err;
    }
  })();

  if (requestKey) {
    activeRequests.set(requestKey, promise);
    promise.finally(() => activeRequests.delete(requestKey));
  }

  return promise;
}

async function processQueue() {
  while (requestQueue.length > 0) {
    const req = requestQueue.shift();
    if (req) {
      try {
        const res = await req.run();
        req.resolve(res);
      } catch (err) {
        req.reject(err);
      }
    }
  }
}

async function apiWithRetry(path: string, opts: RequestInit = {}, attempt = 0): Promise<any> {
    const retryDelays = [5000, 10000, 20000, 20000, 20000];
    const maxRetries = 5;

    try {
      return await executeFetch(path, opts);
    } catch (err: any) {
      const errMsg = err.message || "";
      const isNetworkError = errMsg.includes("Failed to fetch") || 
                            errMsg.includes("NetworkError") || 
                            errMsg.includes("502") || 
                            errMsg.includes("503") || 
                            errMsg.includes("504");
      if (isNetworkError && attempt < maxRetries) {
        const delay = retryDelays[attempt] || 20000;
        setWakingState(true, `Retrying connection (${attempt + 1}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, delay));
        return apiWithRetry(path, opts, attempt + 1);
      }
      throw err;
    }
}

async function executeFetch(path: string, opts: RequestInit = {}) {
  if (path !== '/health' && opts.method && opts.method !== 'GET') {
    await ensureCsrf();
  }
  const xsrf = document.cookie
    .split('; ')
    .find(c => c.startsWith('XSRF-TOKEN='))
    ?.split('=')[1];
  const res = await fetch(`/api${path}`, {
    ...opts,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(xsrf ? { 'X-XSRF-TOKEN': decodeURIComponent(xsrf) } : {}),
      ...(opts.headers as Record<string, string> || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 419) {
      // CSRF expired — refresh token and retry once
      csrfReady = null;
      await ensureCsrf();
      // Retry the request once with fresh CSRF
      const xsrf2 = document.cookie.split('; ').find(c => c.startsWith('XSRF-TOKEN='))?.split('=')[1];
      const res2 = await fetch(`/api${path}`, {
        ...opts,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(xsrf2 ? { 'X-XSRF-TOKEN': decodeURIComponent(xsrf2) } : {}),
          ...(opts.headers as Record<string, string> || {}),
        },
      });
      const data2 = await res2.json().catch(() => ({}));
      if (!res2.ok) {
        if (res2.status === 401) {
          toast.error('Session expired. Please log in again.');
          if (globalTriggerLogout) globalTriggerLogout();
        }
        throw new Error(data2.message || `Request failed: ${res2.status}`);
      }
      return data2;
    }
    // On 401: redirect to login with friendly message (don't wipe data)
    if (res.status === 401 && path !== '/auth/session' && path !== '/health') {
      toast.error('Session expired. Please log in again.');
      if (globalTriggerLogout) globalTriggerLogout();
    }
    throw new Error(data.message || `Request failed: ${res.status}`);
  }
  return data;
}

// ─── File upload helper ──────────────────────────────────────
async function apiUpload(dataUrl: string, filename: string): Promise<string> {
  await ensureCsrf();
  const xsrf = document.cookie.split('; ').find(c => c.startsWith('XSRF-TOKEN='))?.split('=')[1];
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  const fd = new FormData();
  fd.append('file', blob, filename);
  const res = await fetch('/api/uploads', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', ...(xsrf ? { 'X-XSRF-TOKEN': decodeURIComponent(xsrf) } : {}) },
    body: fd,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Upload failed');
  return data.path;
}

// Helper to fetch and view PDF in a new window with correct auth
async function openPdf(appId: string) {
  try {
    toast.loading("Generating PDF...", { id: "pdf-load" });
    await ensureCsrf();
    const xsrf = document.cookie
      .split('; ')
      .find(c => c.startsWith('XSRF-TOKEN='))
      ?.split('=')[1];
    
    const res = await fetch(`/api/loans/${appId}/pdf`, {
      credentials: 'include',
      headers: {
        Accept: 'text/html',
        ...(xsrf ? { 'X-XSRF-TOKEN': decodeURIComponent(xsrf) } : {}),
      }
    });

    if (!res.ok) {
      toast.dismiss("pdf-load");
      if (res.status === 401) {
        toast.error("Session expired. Please log in again.");
      } else {
        toast.error(`Failed to load PDF (${res.status})`);
      }
      return;
    }

    const html = await res.text();
    toast.dismiss("pdf-load");
    
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
    } else {
      toast.error("Allow popups to view PDF");
    }
  } catch (e) {
    toast.dismiss("pdf-load");
    toast.error("Error loading PDF");
    console.error(e);
  }
}

// ─── Design tokens — yellow / white only ─────────────────────
const Y    = "#FFD93D";   // lighter, softer yellow
const Y2   = "#8B6914";   // dark amber — readable on white/yellow
const YBG  = "#FFFBEB";   // very light tint
const BG   = "#F2F2F7";
const CARD = "#FFFFFF";
const TEXT = "#111827";
const MUTED= "#6B7280";
const BORD = "#E5E7EB";
const OK   = "#16A34A";
const ERR  = "#DC2626";
const WARN = "#EA580C";

// Card accent colors (image-5 style vibrant grid)
const INDIGO = "#4F46E5";
const PINK   = "#DB2777";
const TEAL   = "#0D9488";
const AMBER  = "#D97706";

// ─── EMI ─────────────────────────────────────────────────────
const MAX_AMT = 20000;
function calcEMI(p: number, t: 33 | 66) {
  const daily = t === 33 ? Math.round(p * 0.04) : Math.round(p * 0.02);
  const total = daily * t;
  return { daily, total };
}
const fmt = (n: number) => `₹${n.toLocaleString("en-IN")}`;

// ─── Types ────────────────────────────────────────────────────
type Screen =
  | "splash" | "login" | "register" | "customer-home"
  | "loan-apply" | "emi" | "notifications" | "profile"
  | "loan-status" | "loan-calculator" | "help"
  | "admin-login" | "admin-dashboard" | "admin-database"
  | "agent-login" | "agent-register" | "agent-dashboard";

interface Customer { id:string; name:string; phone:string; password:string; token:string; createdAt:string; }
interface LoanApp {
  id:string; customerId:string; customerName:string; customerPhone:string;
  loanType:"Personal"|"Business"; amount:number; tenure:33|66; dailyEMI:number; totalPayable:number;
  status:"pending"|"approved"|"rejected"|"cancelled"; assignedAgent:string; assignedAgentPhone?:string;
  purpose:string; city:string; createdAt:string; address:string; income:number;
  coBorrowerName:string; coBorrowerPhone:string; coBorrowerRelation:string; coBorrowerAddress:string;
  documents?:Record<string,string>; customerPhoto?:string;
}
interface AgentUser { id:string; name:string; phone:string; password:string; zone:string; }
interface AgentLog { agentId:string; appId:string; action:"visited"|"collected"; time:string; }
interface DB { customers:Customer[]; applications:LoanApp[]; agents:AgentUser[]; agentLogs:AgentLog[]; }
type UserRole = "customer"|"agent"|"admin"|null;
interface Session { role:UserRole; userId:string; name:string; }
interface GP { navigate:(s:Screen)=>void; session:Session; setSession:(s:Session)=>void; db:DB; setDB:React.Dispatch<React.SetStateAction<DB>>; }

// ─── HTML escaper ────────────────────────────────────────────
function esc(s:string|number):string { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ─── Print application ────────────────────────────────────────
function printApplication(app: LoanApp) {
  function openPrint(html: string) {
    const w = window.open('', '_blank', 'width=860,height=680');
    if (w) {
      w.document.write(html);
      w.document.close();
    } else {
      toast.error("Allow popups to print");
    }
  }
  
  const photo = app.documents?.photo || app.customerPhoto;
  const aadhaarImg = app.documents?.aadhaar;
  const panImg = app.documents?.pan;

  const html = `<!DOCTYPE html><html><head><title>Loan Application - ${app.id}</title><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;padding:32px;color:#111;font-size:13px;line-height:1.4}
    .hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:14px;border-bottom:3px solid #F5C518}
    .logo{font-size:22px;font-weight:800}.id{background:#FFF9E6;border:2px solid #F5C518;border-radius:8px;padding:5px 14px;font-weight:700}
    h3{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#C8961A;margin:20px 0 10px;padding-bottom:5px;border-bottom:1px solid #F5C518}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:0}
    .row{padding:7px 0;border-bottom:1px solid #F3F4F6;display:flex;flex-direction:column;gap:2px}
    .lbl{font-size:10px;color:#6B7280}.val{font-weight:600}.full{grid-column:1/-1}
    .profile-container{display:flex;gap:24px;align-items:flex-start}
    .profile-details{flex:1}
    .profile-photo{width:110px;height:130px;object-fit:cover;border:2px solid #E5E7EB;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.05);margin-top:4px}
    .sig-row{display:grid;grid-template-columns:1fr 1fr;gap:48px;margin-top:48px}
    .sig{border-top:1px solid #111;padding-top:6px;font-size:11px;color:#6B7280}
    .footer{margin-top:32px;padding-top:12px;border-top:1px solid #E5E7EB;font-size:10px;color:#9CA3AF;text-align:center}
    .page-break{page-break-before:always}
    .doc-box{border:1px solid #E5E7EB;border-radius:8px;padding:12px;text-align:center;background:#FAFAFA}
    .doc-title{font-weight:700;font-size:10px;color:#4B5563;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em}
    .doc-img{max-width:100%;max-height:220px;object-fit:contain;border-radius:4px;border:1px solid #E5E7EB;background:#fff}
    @media print{
      body{padding:20px}
      .no-print{display:none}
      .page-break{page-break-before:always}
    }
  </style></head><body>
  <div class="hdr"><div class="logo">🏛 Laxmi Finance Ltd.</div><div class="id">${app.id}</div></div>
  
  <h3>Loan Details</h3>
  <div class="grid">
    <div class="row"><span class="lbl">Loan Type</span><span class="val">${app.loanType} Loan</span></div>
    <div class="row"><span class="lbl">Applied Amount</span><span class="val">₹${app.amount.toLocaleString("en-IN")}</span></div>
    <div class="row"><span class="lbl">Tenure</span><span class="val">${app.tenure} Days (Daily EMI)</span></div>
    <div class="row"><span class="lbl">Daily EMI</span><span class="val">₹${app.dailyEMI.toLocaleString("en-IN")}</span></div>
    <div class="row"><span class="lbl">Total Payable</span><span class="val">₹${app.totalPayable.toLocaleString("en-IN")}</span></div>
    <div class="row"><span class="lbl">Interest</span><span class="val">₹${(app.totalPayable-app.amount).toLocaleString("en-IN")} (₹${Math.round(app.amount*0.04)}/day × ${app.tenure} days)</span></div>
    <div class="row full"><span class="lbl">Purpose</span><span class="val">${esc(app.purpose)}</span></div>
    <div class="row"><span class="lbl">Applied On</span><span class="val">${esc(app.createdAt)}</span></div>
    <div class="row"><span class="lbl">Assigned Agent</span><span class="val">${esc(app.assignedAgent||"Unassigned")}</span></div>
  </div>

  <h3>Applicant Details</h3>
  <div class="profile-container">
    <div class="profile-details">
      <div class="grid">
        <div class="row"><span class="lbl">Full Name</span><span class="val">${esc(app.customerName)}</span></div>
        <div class="row"><span class="lbl">Mobile</span><span class="val">+91 ${esc(app.customerPhone)}</span></div>
        <div class="row"><span class="lbl">Aadhaar Number</span><span class="val">${esc(app.aadhaar || "—")}</span></div>
        <div class="row"><span class="lbl">PAN Number</span><span class="val">${esc(app.pan || "—")}</span></div>
        <div class="row"><span class="lbl">City</span><span class="val">${esc(app.city)}</span></div>
        <div class="row"><span class="lbl">Monthly Income</span><span class="val">₹${(app.income||0).toLocaleString("en-IN")}</span></div>
        <div class="row full"><span class="lbl">Address</span><span class="val">${esc(app.address)}</span></div>
      </div>
    </div>
    ${photo ? `<div><img src="${photo}" class="profile-photo" /></div>` : ''}
  </div>

  <h3>Co-Borrower Details</h3>
  <div class="grid">
    <div class="row"><span class="lbl">Full Name</span><span class="val">${esc(app.coBorrowerName||"—")}</span></div>
    <div class="row"><span class="lbl">Mobile</span><span class="val">+91 ${esc(app.coBorrowerPhone||"—")}</span></div>
    <div class="row"><span class="lbl">Relationship</span><span class="val">${esc(app.coBorrowerRelation||"—")}</span></div>
    <div class="row full"><span class="lbl">Address</span><span class="val">${esc(app.coBorrowerAddress||"—")}</span></div>
  </div>

  <div class="sig-row">
    <div class="sig">Applicant Signature</div><div class="sig">Co-Borrower Signature</div>
    <div class="sig">Authorised Signatory — Laxmi Finance</div><div class="sig">Date</div>
  </div>
  
  <div class="footer">Laxmi Finance Ltd. · RBI Licensed NBFC · Generated: ${new Date().toLocaleString("en-IN")}</div>

  ${(aadhaarImg || panImg) ? `
    <div class="page-break"></div>
    <div class="hdr"><div class="logo">🏛 Laxmi Finance Ltd.</div><div class="id">${app.id}</div></div>
    <h3>Uploaded KYC Documents</h3>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 16px;">
      ${aadhaarImg ? `
        <div class="doc-box">
          <div class="doc-title">Aadhaar Card</div>
          <img src="${aadhaarImg}" class="doc-img" />
        </div>
      ` : ''}
      ${panImg ? `
        <div class="doc-box">
          <div class="doc-title">PAN Card</div>
          <img src="${panImg}" class="doc-img" />
        </div>
      ` : ''}
    </div>
    <div class="footer" style="margin-top: 64px;">Laxmi Finance Ltd. · RBI Licensed NBFC · Generated: ${new Date().toLocaleString("en-IN")}</div>
  ` : ''}

  <script>window.onload=()=>setTimeout(()=>window.print(),500)</script>
  </body></html>`;
  openPrint(html);
}

function printLoanAgreement(app: LoanApp) {
  function openPrint(html: string) {
    const w = window.open('', '_blank', 'width=860,height=900');
    if (w) {
      w.document.write(html);
      w.document.close();
    } else {
      toast.error("Allow popups to print");
    }
  }
  const today = new Date().toLocaleDateString("en-IN", { day:"numeric", month:"long", year:"numeric" });
  const html = `<!DOCTYPE html><html><head><title>Loan Agreement - ${app.id}</title><style>
    *{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;padding:40px;color:#111;font-size:13px;line-height:1.7}
    .hdr{text-align:center;margin-bottom:28px;padding-bottom:16px;border-bottom:3px solid #F5C518}
    .logo{font-size:22px;font-weight:800;margin-bottom:4px}
    .title{font-size:16px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-top:6px}
    .ref{font-size:11px;color:#6B7280;margin-top:4px}
    h3{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#C8961A;margin:22px 0 10px;padding-bottom:5px;border-bottom:1px solid #F5C518}
    p{margin-bottom:8px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:0}.row{padding:7px 0;border-bottom:1px solid #F3F4F6;display:flex;flex-direction:column;gap:2px}
    .lbl{font-size:10px;color:#6B7280}.val{font-weight:600}
    .terms{font-size:11px;color:#374151;margin:16px 0}
    .terms ol{padding-left:18px}
    .terms li{margin-bottom:6px}
    .sig-row{display:grid;grid-template-columns:1fr 1fr;gap:48px;margin-top:56px}
    .sig{border-top:1px solid #111;padding-top:6px;font-size:11px;color:#6B7280}
    .stamp{text-align:center;margin-top:20px;padding:10px;border:2px solid #F5C518;border-radius:8px;font-size:11px;font-weight:700;color:#C8961A}
    .footer{margin-top:32px;padding-top:12px;border-top:1px solid #E5E7EB;font-size:10px;color:#9CA3AF;text-align:center}
    @media print{body{padding:24px}}
  </style></head><body>
  <div class="hdr">
    <div class="logo">🏛 Laxmi Finance Ltd.</div>
    <div class="title">Loan Agreement</div>
    <div class="ref">Agreement No: ${app.id} · Date: ${today}</div>
  </div>
  <p>This Loan Agreement ("Agreement") is entered into on <strong>${today}</strong> between:</p>
  <p><strong>Lender:</strong> Laxmi Finance Ltd., a licensed NBFC ("Company")</p>
  <p><strong>Borrower:</strong> ${app.customerName}, Mobile: +91 ${app.customerPhone}, Address: ${app.address || "—"} ("Borrower")</p>
  <p><strong>Co-Borrower:</strong> ${app.coBorrowerName || "—"}, Mobile: +91 ${app.coBorrowerPhone || "—"}, Relationship: ${app.coBorrowerRelation || "—"} ("Co-Borrower")</p>

  <h3>Loan Details</h3>
  <div class="grid">
    <div class="row"><span class="lbl">Loan Type</span><span class="val">${app.loanType} Loan</span></div>
    <div class="row"><span class="lbl">Principal Amount</span><span class="val">₹${app.amount.toLocaleString("en-IN")}</span></div>
    <div class="row"><span class="lbl">Tenure</span><span class="val">${app.tenure} Days (Daily EMI)</span></div>
    <div class="row"><span class="lbl">Daily EMI</span><span class="val">₹${app.dailyEMI.toLocaleString("en-IN")}</span></div>
    <div class="row"><span class="lbl">Total Payable</span><span class="val">₹${app.totalPayable.toLocaleString("en-IN")}</span></div>
    <div class="row"><span class="lbl">Interest</span><span class="val">₹${(app.totalPayable - app.amount).toLocaleString("en-IN")}</span></div>
  </div>

  <h3>Terms and Conditions</h3>
  <div class="terms"><ol>
    <li>The Borrower agrees to repay the loan in daily installments of <strong>₹${app.dailyEMI.toLocaleString("en-IN")}</strong> for <strong>${app.tenure} consecutive days</strong> starting from the date of disbursement.</li>
    <li>The Co-Borrower is equally liable for repayment of the entire loan amount including interest.</li>
    <li>A late fee of ₹10 per day will be charged for each missed EMI payment.</li>
    <li>The Borrower may prepay the loan at any time without penalty.</li>
    <li>In case of default exceeding 7 consecutive days, the Company reserves the right to initiate recovery proceedings.</li>
    <li>The loan amount will be disbursed to the Borrower within 48 hours of agreement execution.</li>
    <li>All disputes shall be subject to the jurisdiction of courts in Kolkata, West Bengal.</li>
    <li>This agreement is governed by the laws of India and RBI guidelines for NBFCs.</li>
  </ol></div>

  <p style="font-size:12px;font-weight:600;margin-top:20px">By signing below, all parties acknowledge and agree to the terms stated above.</p>

  <div class="sig-row">
    <div class="sig">Borrower Signature<br/><br/>${app.customerName}</div>
    <div class="sig">Co-Borrower Signature<br/><br/>${app.coBorrowerName || "—"}</div>
  </div>
  <div class="sig-row" style="margin-top:28px">
    <div class="sig">Authorised Signatory<br/>Laxmi Finance Ltd.</div>
    <div class="sig">Field Agent: ${app.assignedAgent || "—"}<br/>Date: ${today}</div>
  </div>

  <div class="stamp">LAXMI FINANCE LTD. · OFFICIAL LOAN AGREEMENT · ${app.id}</div>
  <div class="footer">This is a computer-generated document. · Laxmi Finance Ltd. · RBI Licensed NBFC · Generated: ${new Date().toLocaleString("en-IN")}</div>
  <script>window.onload=()=>setTimeout(()=>window.print(),500)</script>
  </body></html>`;
  openPrint(html);
}

// ─── Shared UI ────────────────────────────────────────────────
function Lbl({ ch }: { ch: React.ReactNode }) {
  return <label className="block text-[10px] font-bold uppercase tracking-[0.13em] mb-1.5" style={{ color:MUTED }}>{ch}</label>;
}
function F({ label, children }: { label:string; children:React.ReactNode }) {
  return <div><Lbl ch={label}/>{children}</div>;
}
const inp  = "w-full px-4 py-3.5 border-2 rounded-2xl text-sm outline-none transition-all placeholder-gray-400 focus:border-[#C8961A]";
const iSt  = { borderColor:BORD, color:TEXT, background:CARD } as React.CSSProperties;

function Chip({ status }: { status:string }) {
  const m: Record<string,[string,string]> = {
    pending:[WARN,"rgba(234,88,12,0.1)"], approved:[OK,"rgba(22,163,74,0.1)"], rejected:[ERR,"rgba(220,38,38,0.09)"], cancelled:[MUTED,"rgba(107,114,128,0.1)"],
  };
  const lbl: Record<string,string> = { pending:"Pending", approved:"Approved", rejected:"Rejected", cancelled:"Cancelled" };
  const [c,bg]=m[status]??[MUTED,"rgba(107,122,141,0.1)"];
  return <span className="px-2.5 py-1 rounded-full text-[10px] font-bold" style={{ background:bg, color:c }}>{lbl[status]??status}</span>;
}

function LFLogo({ size=40 }: { size?:number }) {
  return (
    <div className="flex items-center justify-center shrink-0" style={{ width:size, height:size, background:Y, borderRadius:Math.round(size*0.26) }}>
      <svg width={size*0.56} height={size*0.56} viewBox="0 0 28 28" fill="none">
        <path d="M6 4v20h13v-3.5H9.5V4H6z" fill={TEXT}/>
        <path d="M6 16h9" stroke={TEXT} strokeWidth="2" strokeLinecap="round"/>
        <circle cx="21" cy="8" r="4.5" fill={TEXT} fillOpacity=".35"/>
        <circle cx="21" cy="8" r="2.2" fill={TEXT}/>
      </svg>
    </div>
  );
}

// ─── Live Camera ──────────────────────────────────────────────
function LiveCamera({ label, onCapture, onClose }: { label:string; onCapture:(url:string)=>void; onClose:()=>void }) {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const [ready,   setReady]   = useState(false);
  const [preview, setPreview] = useState<string|null>(null);
  const [facing,  setFacing]  = useState<"user"|"environment">("environment");
  const streamRef = useRef<MediaStream|null>(null);

  useEffect(() => { startCamera(); return () => stopCamera(); }, [facing]);

  async function startCamera() {
    try {
      stopCamera();
      const s = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:facing } });
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play(); setReady(true); }
    } catch { toast.error("Camera access denied"); }
  }
  function stopCamera() { streamRef.current?.getTracks().forEach(t=>t.stop()); streamRef.current=null; setReady(false); }
  function capture() {
    if (!videoRef.current) return;
    const c = document.createElement("canvas");
    c.width = videoRef.current.videoWidth||640; c.height = videoRef.current.videoHeight||480;
    c.getContext("2d")?.drawImage(videoRef.current,0,0);
    setPreview(c.toDataURL("image/jpeg",.85)); stopCamera();
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background:"#000" }}>
      <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ background:"rgba(0,0,0,0.7)" }}>
        <button onClick={()=>{ stopCamera(); onClose(); }} style={{ color:"white" }}><X size={22}/></button>
        <p className="text-white text-sm font-semibold">{label}</p>
        {!preview && <button onClick={()=>setFacing(f=>f==="user"?"environment":"user")} style={{ color:"white" }}><RefreshCw size={20}/></button>}
        {preview && <div className="w-6"/>}
      </div>
      <div className="flex-1 relative overflow-hidden">
        {!preview ? (
          <>
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted autoPlay/>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="rounded-3xl border-4 opacity-70" style={{ width:"78%", height:"65%", borderColor:Y }}/>
            </div>
            {!ready && <div className="absolute inset-0 flex items-center justify-center" style={{ background:"rgba(0,0,0,0.6)" }}>
              <div className="text-center text-white"><div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-2"/><p className="text-sm">Starting camera…</p></div>
            </div>}
          </>
        ) : <img src={preview} className="w-full h-full object-cover"/>}
      </div>
      <div className="px-6 pb-10 pt-5 shrink-0" style={{ background:"rgba(0,0,0,0.8)" }}>
        {!preview ? (
          <div className="flex items-center justify-center">
            <button onClick={capture} className="w-20 h-20 rounded-full border-4 flex items-center justify-center" style={{ background:Y, borderColor:"rgba(255,255,255,0.3)" }}>
              <Camera size={28} color={TEXT}/>
            </button>
          </div>
        ) : (
          <div className="flex gap-3">
            <button onClick={()=>{ setPreview(null); startCamera(); }} className="flex-1 py-4 rounded-2xl font-bold text-sm border-2 text-white" style={{ borderColor:"rgba(255,255,255,0.3)" }}>Retake</button>
            <button onClick={()=>{ if(preview){ onCapture(preview); onClose(); }}} className="flex-1 py-4 rounded-2xl font-bold text-sm" style={{ background:Y, color:TEXT }}>Use Photo ✓</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Doc Upload ───────────────────────────────────────────────
function DocUpload({ label, tag, fieldKey, files, setFiles, allowCamera, cameraLabel }:{
  label:string; tag:string; fieldKey:string;
  files:Record<string,{name:string;url:string}|null>;
  setFiles:React.Dispatch<React.SetStateAction<Record<string,{name:string;url:string}|null>>>;
  allowCamera?:boolean; cameraLabel?:string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [showCam,setShowCam] = useState(false);
  const f = files[fieldKey];
  function handleFile(file:File) { setFiles(p=>({...p,[fieldKey]:{name:file.name,url:URL.createObjectURL(file)}})); toast.success(`${label} uploaded`); }
  return (
    <>
      {showCam && <LiveCamera label={cameraLabel||label} onCapture={url=>{ setFiles(p=>({...p,[fieldKey]:{name:"Camera photo",url}})); toast.success(`${label} captured`); }} onClose={()=>setShowCam(false)}/>}
      <div className="border-2 rounded-2xl p-4 transition-all" style={{ borderColor:f?Y2:BORD, background:f?YBG:CARD }}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-sm font-bold" style={{ color:TEXT }}>{label}</p>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:tag==="Mandatory"?"rgba(220,38,38,0.08)":"rgba(107,122,141,0.1)", color:tag==="Mandatory"?ERR:MUTED }}>{tag}</span>
            {f && <span className="ml-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:"rgba(22,163,74,0.1)", color:OK }}>✓ Done</span>}
          </div>
          {f ? (
            <button onClick={()=>setFiles(p=>({...p,[fieldKey]:null}))} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background:"rgba(220,38,38,0.1)" }}><X size={13} color={ERR}/></button>
          ) : (
            <div className="flex gap-2">
              {allowCamera && <button onClick={()=>setShowCam(true)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-bold" style={{ background:YBG, color:Y2 }}><Camera size={11}/> Camera</button>}
              <button onClick={()=>inputRef.current?.click()} className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-bold" style={{ background:YBG, color:Y2 }}><Upload size={11}/> File</button>
            </div>
          )}
          <input ref={inputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={e=>{ const file=e.target.files?.[0]; if(file) handleFile(file); e.target.value=""; }}/>
        </div>
        {f ? (
          <div>{f.url.startsWith("data:image")||f.url.startsWith("blob:")
            ? <img src={f.url} className="w-full h-28 object-cover rounded-xl"/>
            : <p className="text-xs truncate" style={{ color:MUTED }}>📄 {f.name}</p>}
          </div>
        ) : (
          <button onClick={()=>inputRef.current?.click()} className="w-full h-14 rounded-xl border-2 border-dashed flex items-center justify-center" style={{ borderColor:BORD }}>
            <p className="text-xs" style={{ color:MUTED }}>Tap File or use Camera</p>
          </button>
        )}
      </div>
    </>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────
function Sidebar({ screen, navigate, session }:{ screen:Screen; navigate:(s:Screen)=>void; session:Session }) {
  const isAdmin=session.role==="admin"; const isAgent=session.role==="agent";
  type NavItem = [Screen, React.ComponentType<{size?:number;color?:string}>, string];
  const custNav: NavItem[] = [["customer-home",Home,"Dashboard"],["loan-apply",Plus,"Apply for Loan"],["loan-status",CreditCard,"My Loans"],["emi",Wallet,"EMI Tracker"],["loan-calculator",Percent,"Calculator"],["notifications",Bell,"Notifications"],["profile",UserCircle,"Profile"],["help",MessageSquare,"Help"]];
  const adminNav: NavItem[] = [["admin-dashboard",BarChart2,"Dashboard"],["notifications",Bell,"Alerts"],["admin-database",Database,"Database"]];
  const agentNav: NavItem[] = [["agent-dashboard",BarChart2,"Dashboard"],["loan-apply",Plus,"Apply Loan"]];
  const items = isAdmin?adminNav:isAgent?agentNav:custNav;
  return (
    <div className="hidden md:flex flex-col w-[220px] shrink-0 h-screen sticky top-0 border-r" style={{ background:CARD, borderColor:BORD }}>
      <div className="flex items-center gap-3 px-5 py-5 border-b" style={{ background:"#1A1A2E", borderColor:"rgba(255,255,255,0.08)" }}>
        <LFLogo size={36}/><div><p className="text-sm font-bold text-white">Laxmi Finance</p><p className="text-[9px] font-bold uppercase tracking-widest" style={{ color:Y }}>{isAdmin?"Admin":isAgent?"Agent":"Customer"}</p></div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {items.map(([id,Icon,label])=>{
          const a=screen===id;
          return <button key={id} onClick={()=>navigate(id)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left transition-all" style={{ background:a?Y:"transparent", color:a?TEXT:MUTED, fontWeight:a?700:500 }}><Icon size={16} color={a?TEXT:"#9CA3AF"}/><span className="text-sm">{label}</span>{a&&<div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background:TEXT }}/>}</button>;
        })}
      </nav>
      <div className="px-3 py-3 border-t" style={{ borderColor:BORD }}>
        <p className="text-[10px] px-3 mb-1 truncate font-semibold" style={{ color:MUTED }}>{session.name}</p>
        <button onClick={()=>navigate("splash")} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl" style={{ color:MUTED }}><LogOut size={14} color={MUTED}/><span className="text-xs">Logout</span></button>
      </div>
    </div>
  );
}

function TopBar({ session, onMenu }:{ session:Session; onMenu:()=>void }) {
  const r=session.role==="admin"?"Admin":session.role==="agent"?"Agent":"Customer";
  return (
    <div className="md:hidden flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ background:"#1A1A2E", borderColor:"rgba(255,255,255,0.08)" }}>
      <div className="flex items-center gap-2.5"><LFLogo size={30}/><div><p className="text-sm font-bold text-white">Laxmi Finance</p><p className="text-[9px] font-bold uppercase tracking-widest" style={{ color:Y }}>{r}</p></div></div>
      <button onClick={onMenu} className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background:"rgba(255,255,255,0.12)" }}><Menu size={18} color="#fff"/></button>
    </div>
  );
}

function BottomNav({ active, navigate }:{ active:string; navigate:(s:Screen)=>void }) {
  type NavItem = [Screen, React.ComponentType<{size?:number;color?:string}>, string];
  const items: NavItem[] = [["customer-home",Home,"Home"],["loan-status",CreditCard,"Loans"],["emi",Wallet,"EMI"],["notifications",Bell,"Alerts"],["profile",UserCircle,"Profile"]];
  return (
    <div className="shrink-0 md:hidden flex px-1 pt-1.5 pb-4 border-t" style={{ background:CARD, borderColor:BORD }}>
      {items.map(([id,Icon,label])=>(
        <button key={id} onClick={()=>navigate(id)} className="flex-1 flex flex-col items-center gap-0.5">
          <div className="w-9 h-7 rounded-xl flex items-center justify-center" style={{ background:active===id?Y:"transparent" }}><Icon size={17} color={active===id?TEXT:"#9CA3AF"}/></div>
          <span className="text-[9px] font-semibold" style={{ color:active===id?Y2:"#9CA3AF" }}>{label}</span>
        </button>
      ))}
    </div>
  );
}

function PH({ title, sub, onBack }:{ title:string; sub?:string; onBack?:()=>void }) {
  return (
    <div className="px-5 pt-4 pb-5 shrink-0" style={{ background:Y }}>
      {onBack && <button onClick={onBack} className="flex items-center gap-1 text-sm mb-3" style={{ color:Y2 }}><ChevronLeft size={15}/> Back</button>}
      <h1 className="text-2xl font-black" style={{ color:TEXT }}>{title}</h1>
      {sub && <p className="text-sm mt-0.5" style={{ color:Y2 }}>{sub}</p>}
    </div>
  );
}

// ─── SPLASH ──────────────────────────────────────────────────
function SplashScreen({ navigate }:GP) {
  const [showActions, setShowActions] = useState(false);

  if (showActions) {
    return (
      <div className="min-h-[100svh] flex flex-col justify-center px-6 py-8 relative overflow-hidden" style={{ background:CARD }}>
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full pointer-events-none" style={{ background:YBG }}/>
        <div className="absolute -bottom-28 -left-24 w-72 h-72 rounded-full pointer-events-none" style={{ background:YBG }}/>
        <div className="relative w-full max-w-sm mx-auto">
          <div className="flex flex-col items-center text-center mb-8">
            <LFLogo size={48}/>
            <h1 className="mt-4 text-2xl font-black" style={{ color:TEXT }}>Laxmi Finance</h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] mt-1" style={{ color:Y2 }}>SECURE. GROW. PROSPER</p>
          </div>

          <div className="space-y-3">
            <button onClick={()=>navigate("login")}
              className="w-full py-4 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
              style={{ background:TEXT, color:Y }}>
              CUSTOMER LOGIN
            </button>
            <button onClick={()=>navigate("register")}
              className="w-full py-4 rounded-2xl font-bold text-sm border-2 transition-all active:scale-[0.98]"
              style={{ borderColor:TEXT, color:TEXT, background:CARD }}>
              CREATE ACCOUNT
            </button>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <button onClick={()=>navigate("agent-login")}
                className="py-3.5 rounded-2xl text-xs font-bold border text-center"
                style={{ borderColor:BORD, color:MUTED, background:CARD }}>
                Agent Login
              </button>
              <button onClick={()=>navigate("admin-login")}
                className="py-3.5 rounded-2xl text-xs font-bold border text-center"
                style={{ borderColor:BORD, color:MUTED, background:CARD }}>
                Admin Access
              </button>
            </div>
          </div>

          <button onClick={()=>setShowActions(false)} className="w-full mt-7 py-2 text-xs font-bold" style={{ color:MUTED }}>
            Back
          </button>
          <p className="text-center text-[10px] mt-10" style={{ color:MUTED }}>Made by Xaggment Technologies</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-[100svh]" style={{ background:Y }}>

      {/* ── Section 1 — full yellow ─────────────────────────── */}
      <div className="flex flex-col gap-0 px-7 relative overflow-hidden transition-all duration-300 min-h-[100svh] pt-6 pb-5" style={{ background:Y }}>
        {/* decorative circles */}
        <div className="absolute -top-16 -right-16 w-72 h-72 rounded-full pointer-events-none" style={{ background:"rgba(0,0,0,0.06)" }}/>
        <div className="absolute -bottom-16 -left-16 w-56 h-56 rounded-full pointer-events-none" style={{ background:"rgba(0,0,0,0.04)" }}/>

        {/* Top: logo */}
        <div className="flex items-center gap-2.5">
          <LFLogo size={34}/>
          <div>
            <h1 className="hidden" style={{ color:TEXT }}>Laxmi Finance</h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em]" style={{ color:Y2 }}>SECURE. GROW. PROSPER</p>
          </div>
        </div>

        {/* Middle: headline */}
        <div className="mt-[clamp(28px,5svh,54px)]">
          <h2 className="text-[38px] sm:text-5xl font-black leading-[1.08] mb-3" style={{ color:TEXT }}>
            Fast Loans.<br/>Simple<br/>Repayment.<br/><span className="text-[22px] sm:text-3xl leading-tight">with LAXMI FINANCE.</span>
          </h2>
          <p className="text-[14px] leading-relaxed mb-5" style={{ color:"rgba(0,0,0,0.55)" }}>
            Personal & Business loans up to <strong style={{ color:TEXT }}>₹20,000</strong>.<br/>
            Daily EMI — 33 or 66 day plans.
          </p>
          <div className="grid grid-cols-3 gap-2.5 max-w-[286px]">
            {[["₹20K","Max Loan"],["Daily","EMI"],["48 hrs","Approval"]].map(([v,l])=>(
              <div key={l} className="rounded-2xl px-2 py-2.5 text-center min-h-[62px] flex flex-col items-center justify-center" style={{ background:"rgba(0,0,0,0.1)" }}>
                <p className="font-black text-base leading-tight" style={{ color:TEXT }}>{v}</p>
                <p className="text-[10px] mt-0.5 font-semibold" style={{ color:"rgba(0,0,0,0.5)" }}>{l}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom of yellow: "Get Started" label + black pill button */}
        <div className="mt-[clamp(30px,7svh,78px)]">
          <button onClick={()=>setShowActions(true)}
            className="flex items-center gap-2 px-6 py-3 rounded-full font-bold text-sm transition-all active:scale-[0.97]"
            style={{ background:TEXT, color:Y }}>
            GET STARTED <ArrowRight size={16}/>
          </button>
          <p className="text-center text-[10px] mt-10" style={{ color:"rgba(0,0,0,0.35)" }}>Made by Xaggment Technologies</p>
        </div>
      </div>
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────
function LoginScreen({ navigate, db, setDB, setSession }:GP) {
  const [phone,setPhone]=useState(""); const [pw,setPw]=useState(""); const [show,setShow]=useState(false);
  const [err,setErr]=useState(""); const [loading,setLoading]=useState(false);
  async function go() {
    setErr("");
    if(!phone||!pw){setErr("Enter phone and password");return;}
    setLoading(true);
    try {
      const { user } = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ phone, password: pw }),
      });
      setSession({role:user.role||"customer",userId:String(user.id),name:user.name});
      const data = await api('/data');
      setDB(d => ({...d, ...data}));
      if(user.role==="agent") navigate("agent-dashboard");
      else if(user.role==="admin") navigate("admin-dashboard");
      else navigate("customer-home");
      toast.success(`Welcome back, ${user.name}!`);
    } catch (e: any) {
      setErr(e.message || "Invalid phone number or password.");
    } finally { setLoading(false); }
  }
  return (
    <div className="flex flex-col sm:flex-row min-h-screen" style={{ background:BG }}>
      <div className="hidden sm:flex sm:w-[300px] shrink-0 flex-col justify-center items-start px-10" style={{ background:Y }}>
        <LFLogo size={52}/><h2 className="text-3xl font-black mt-5 mb-2" style={{ color:TEXT }}>Customer<br/>Login</h2>
        <p style={{ color:Y2 }} className="text-sm">Sign in with your registered mobile and password.</p>
        <button onClick={()=>navigate("register")} className="mt-8 px-5 py-3 rounded-2xl text-sm font-bold" style={{ background:TEXT, color:Y }}>New? Register →</button>
      </div>
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 py-12 max-w-md mx-auto w-full">
        <div className="sm:hidden flex items-center gap-3 mb-10"><LFLogo size={40}/><div><p className="text-xl font-bold" style={{ color:TEXT }}>Laxmi Finance</p></div></div>
        <h2 className="text-3xl font-black mb-7 hidden sm:block" style={{ color:TEXT }}>Sign In</h2>
        <div className="space-y-4 mb-5">
          <F label="Mobile Number">
            <div className="flex items-stretch border-2 rounded-2xl overflow-hidden focus-within:border-[#C8961A]" style={{ borderColor:BORD }}>
              <div className="px-4 flex items-center border-r text-sm font-bold shrink-0" style={{ background:YBG, borderColor:BORD, color:Y2 }}>+91</div>
              <input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} maxLength={10} placeholder="10-digit mobile" className="flex-1 px-4 py-3.5 text-sm bg-white outline-none placeholder-gray-400" style={{ color:TEXT }}/>
            </div>
          </F>
          <F label="Password">
            <div className="flex items-center border-2 rounded-2xl" style={{ borderColor:BORD }}>
              <input type={show?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)} placeholder="Your password" className="flex-1 px-4 py-3.5 text-sm bg-transparent outline-none placeholder-gray-400" style={{ color:TEXT }}/>
              <button onClick={()=>setShow(!show)} className="px-4" style={{ color:"#9CA3AF" }}>{show?<EyeOff size={16}/>:<Eye size={16}/>}</button>
            </div>
          </F>
          {err&&<p className="text-xs font-semibold px-1" style={{ color:ERR }}>{err}</p>}
        </div>
        <button onClick={go} disabled={loading} className="w-full py-4 rounded-2xl font-bold text-sm mb-5 flex items-center justify-center gap-2 transition-all active:scale-[0.98]" style={{ background:Y, color:TEXT, opacity:loading?0.7:1 }}>
          {loading?<><div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin"/>Signing in…</>:"Sign In →"}
        </button>
        <p className="text-center text-sm" style={{ color:MUTED }}>{"Don't have an account? "}<button onClick={()=>navigate("register")} className="font-bold" style={{ color:Y2 }}>Register</button></p>
        <p className="text-center mt-2 text-xs" style={{ color:MUTED }}><button onClick={()=>navigate("agent-login")} style={{ color:Y2 }}>Agent Login</button> · <button onClick={()=>navigate("admin-login")} style={{ color:MUTED }}>Admin</button></p>
      </div>
    </div>
  );
}

// ─── REGISTER ─────────────────────────────────────────────────
// ─── Auto-advance OTP Input ───────────────────────────────────
function OTPInput({ onComplete }: { onComplete?: (val: string) => void }) {
  const refs = [useRef<HTMLInputElement>(null),useRef<HTMLInputElement>(null),useRef<HTMLInputElement>(null),useRef<HTMLInputElement>(null),useRef<HTMLInputElement>(null),useRef<HTMLInputElement>(null)];
  const [vals, setVals] = useState(["","","","","",""]);
  function handleChange(i: number, v: string) {
    const ch = v.replace(/\D/g,"").slice(-1);
    const next = [...vals]; next[i] = ch; setVals(next);
    if (ch && i < 5) refs[i+1].current?.focus();
    if (next.every(Boolean) && onComplete) onComplete(next.join(""));
  }
  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !vals[i] && i > 0) { refs[i-1].current?.focus(); }
    if (e.key === "ArrowLeft" && i > 0) refs[i-1].current?.focus();
    if (e.key === "ArrowRight" && i < 5) refs[i+1].current?.focus();
  }
  function handlePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text").replace(/\D/g,"").slice(0,6);
    if (!text) return; e.preventDefault();
    const next = ["","","","","",""];
    text.split("").forEach((c,i) => { if(i<6) next[i]=c; });
    setVals(next); refs[Math.min(text.length, 5)].current?.focus();
    if (next.every(Boolean) && onComplete) onComplete(next.join(""));
  }
  return (
    <div className="grid grid-cols-6 gap-2 w-full">
      {refs.map((ref, i) => (
        <input key={i} ref={ref} type="text" inputMode="numeric" maxLength={1} value={vals[i]}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKeyDown(i, e)}
          onPaste={handlePaste}
          className="w-full min-w-0 text-center border-2 rounded-2xl font-bold text-xl outline-none transition-colors"
          style={{ borderColor: vals[i] ? Y2 : BORD, color: TEXT, background: vals[i] ? YBG : CARD, height: 52 }}
        />
      ))}
    </div>
  );
}

function RegisterScreen({ navigate, db, setDB, setSession }:GP) {
  const [step,setStep]=useState(0); const [phone,setPhone]=useState(""); const [name,setName]=useState("");
  const [pw,setPw]=useState(""); const [conf,setConf]=useState(""); const [show,setShow]=useState(false);
  const [err,setErr]=useState(""); const [token,setToken]=useState(""); const [loading,setLoading]=useState(false);
  const pwStr=pw.length===0?0:pw.length<6?1:pw.length<10?2:3;
  const pwC=["transparent",ERR,WARN,OK]; const pwL=["","Weak","Good","Strong"];
  function sendOTP(){
    if(phone.length!==10){setErr("Enter valid 10-digit mobile");return;}
    setErr(""); setStep(1);
  }
  async function create(){
    if(!name.trim()){setErr("Enter your full name");return;}
    if(pw.length<6){setErr("Password must be at least 6 characters");return;}
    if(pw!==conf){setErr("Passwords do not match");return;}
    setLoading(true);
    setErr("");
    try {
      const { user } = await api('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name:name.trim(), phone, password:pw, password_confirmation:conf }),
      });
      setDB(d=>({...d,customers:[...d.customers,{id:String(user.id),name:user.name,phone:user.phone,password:"",token:user.token||"",createdAt:new Date().toLocaleDateString("en-IN")}]}));
      setToken(user.token||"");
      setSession({role:"customer",userId:String(user.id),name:user.name});
      try { const data = await api('/data'); setDB(d=>({...d,...data})); } catch {}
      setStep(2);
      toast.success("Account created!");
    } catch(e:any) { setErr(e.message||"Registration failed. Try again."); }
    setLoading(false);
  }
  return (
    <div className="flex flex-col min-h-screen" style={{ background:BG }}>
      {step<2&&(
        <div className="px-5 pt-4 pb-5 shrink-0" style={{ background:Y }}>
          <button onClick={()=>step===0?navigate("splash"):setStep(s=>s-1)} className="flex items-center gap-1 text-sm mb-3" style={{ color:Y2 }}><ChevronLeft size={15}/>{step===0?"Back":"Previous"}</button>
          <p className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color:Y2 }}>Step {step+1} of 2</p>
          <h1 className="text-2xl font-black mb-4" style={{ color:TEXT }}>{["Create Account","Your Details"][step]}</h1>
          <div className="flex gap-2">{[0,1].map(i=><div key={i} className="h-1.5 flex-1 rounded-full" style={{ background:i<=step?"rgba(0,0,0,0.4)":"rgba(0,0,0,0.18)" }}/>)}</div>
        </div>
      )}
      <div className="flex-1 px-5 pt-5 pb-8" style={{ background:CARD }}>
        <div className="max-w-md mx-auto">
          {step===0&&(
            <div className="space-y-5">
              <F label="Mobile Number">
                <div className="flex items-stretch border-2 rounded-2xl overflow-hidden focus-within:border-[#C8961A]" style={{ borderColor:BORD }}>
                  <div className="px-4 flex items-center border-r text-sm font-bold shrink-0" style={{ background:YBG, borderColor:BORD, color:Y2 }}>+91</div>
                  <input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} maxLength={10} placeholder="10-digit mobile" className="flex-1 px-4 py-3.5 text-sm bg-white outline-none placeholder-gray-400" style={{ color:TEXT }}/>
                </div>
                <p className="text-xs mt-1.5" style={{ color:MUTED }}>A 6-digit OTP will be sent for verification.</p>
              </F>
              {err&&<p className="text-xs font-semibold" style={{ color:ERR }}>{err}</p>}
              <button onClick={sendOTP} className="w-full py-4 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]" style={{ background:Y, color:TEXT }}>Send OTP →</button>
              <p className="text-center text-sm" style={{ color:MUTED }}>Already registered? <button onClick={()=>navigate("login")} className="font-bold" style={{ color:Y2 }}>Login</button></p>
            </div>
          )}
          {step===1&&(
            <div className="space-y-4">
              <div>
                <p className="text-sm mb-3" style={{ color:MUTED }}>OTP sent to <strong style={{ color:TEXT }}>+91 {phone}</strong></p>
                <OTPInput/>
                <div className="flex justify-between mt-2"><span className="text-xs" style={{ color:MUTED }}>Expires in 4:45</span><button onClick={()=>toast.success("OTP resent to +91 "+phone)} className="text-xs font-bold" style={{ color:Y2 }}>Resend OTP</button></div>
              </div>
              <F label="Full Name (as per Aadhaar)"><input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Ravi Kumar Sharma" className={inp} style={iSt}/></F>
              <F label="Create Password">
                <div className="flex items-center border-2 rounded-2xl" style={{ borderColor:BORD }}>
                  <input type={show?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)} placeholder="Min 6 characters" className="flex-1 px-4 py-3.5 text-sm bg-transparent outline-none placeholder-gray-400" style={{ color:TEXT }}/>
                  <button onClick={()=>setShow(!show)} className="px-4" style={{ color:"#9CA3AF" }}>{show?<EyeOff size={16}/>:<Eye size={16}/>}</button>
                </div>
                {pw.length>0&&<div className="flex items-center gap-2 mt-1.5"><div className="flex gap-1 flex-1">{[1,2,3].map(i=><div key={i} className="h-1 flex-1 rounded-full" style={{ background:i<=pwStr?pwC[pwStr]:BORD }}/>)}</div><span className="text-[10px] font-bold" style={{ color:pwC[pwStr] }}>{pwL[pwStr]}</span></div>}
              </F>
              <F label="Confirm Password"><input type="password" value={conf} onChange={e=>setConf(e.target.value)} placeholder="Re-enter password" className={inp} style={{ ...iSt, borderColor:conf&&conf!==pw?ERR:BORD }}/></F>
              {err&&<p className="text-xs font-semibold" style={{ color:ERR }}>{err}</p>}
              <button onClick={create} disabled={loading} className="w-full py-4 rounded-2xl font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2" style={{ background:loading?"#F5C518":Y, color:TEXT, opacity:loading?0.85:1 }}>{loading ? <><RefreshCw className="animate-spin" size={16}/><span>Creating your account...</span></> : "Create Account"}</button>
            </div>
          )}
          {step===2&&(
            <div className="flex flex-col items-center text-center py-8">
              <div className="w-24 h-24 rounded-full flex items-center justify-center mb-6" style={{ background:Y }}><CheckCircle size={48} color={TEXT}/></div>
              <h2 className="text-2xl font-black mb-2" style={{ color:TEXT }}>Account Ready!</h2>
              <p className="text-sm leading-relaxed mb-7 max-w-xs" style={{ color:MUTED }}>Your customer token has been issued. No loan applied yet.</p>
              <div className="w-full rounded-2xl p-5 mb-5 text-left" style={{ background:YBG, border:`2px solid ${Y}` }}>
                <p className="text-[9px] font-bold uppercase tracking-[0.2em] mb-2" style={{ color:Y2 }}>Customer Token</p>
                <p className="text-xl font-bold tracking-wider mb-1.5" style={{ color:TEXT, fontFamily:"monospace" }}>{token}</p>
                <p className="text-xs" style={{ color:MUTED }}>Converts to a permanent Loan ID upon approval.</p>
              </div>
              <button onClick={()=>navigate("customer-home")} className="w-full py-4 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]" style={{ background:Y, color:TEXT }}>Go to Dashboard →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── CUSTOMER HOME ────────────────────────────────────────────
function CustomerHomeScreen({ navigate, session, db }:GP) {
  const customer = db.customers.find(c=>c.id===session.userId);
  const myApps   = db.applications.filter(a=>a.customerId===session.userId);
  const latest   = myApps[myApps.length-1];

  // Vibrant action cards (image-5 style)
  const actions: [Screen, React.ComponentType<{size?:number;color?:string}>, string, string][] = [
    ["loan-apply",      Plus,          "Apply\nfor Loan",     INDIGO],
    ["loan-calculator", Percent,       "EMI\nCalculator",     PINK],
    ["loan-status",     CreditCard,    "My Loans\n& Status",  TEAL],
    ["help",            MessageSquare, "Help &\nSupport",     AMBER],
  ];

  return (
    <div className="flex flex-col h-full" style={{ background:BG }}>
      {/* Yellow hero */}
      <div className="px-4 sm:px-5 pt-5 pb-16 shrink-0 relative overflow-hidden" style={{ background:"#1A1A2E" }}>
        <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full opacity-10 pointer-events-none" style={{ background:"#fff" }}/>
        <div className="flex justify-between items-center mb-5 sm:mb-6">
          <div>
            <p className="text-xs sm:text-sm font-semibold" style={{ color:"rgba(255,255,255,0.55)" }}>Welcome back,</p>
            <h2 className="text-xl sm:text-2xl font-black text-white truncate">{session.name}</h2>
          </div>
          <div className="flex gap-2">
            <button onClick={()=>navigate("notifications")} className="w-10 h-10 rounded-full flex items-center justify-center relative" style={{ background:"rgba(255,255,255,0.12)" }}>
              <Bell size={18} color="#fff"/><span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full border-2 border-[#1A1A2E]" style={{ background:ERR }}/>
            </button>
            <button onClick={()=>navigate("profile")} className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background:"rgba(255,255,255,0.12)" }}>
              <UserCircle size={18} color="#fff"/>
            </button>
          </div>
        </div>
        {/* Loan / token card */}
        {latest ? (
          <div className="rounded-3xl p-5" style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.12)" }}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-widest mb-0.5" style={{ color:Y }}>{latest.status==="approved"?"Loan ID":"Application Token"}</p>
                <p className="text-base font-bold tracking-wider text-white" style={{ fontFamily:"monospace" }}>{customer?.token}</p>
              </div>
              <Chip status={latest.status}/>
            </div>
            <div className="flex gap-5">
              {[["Amount",fmt(latest.amount)],["Plan",`${latest.tenure}d`],["Daily EMI",fmt(latest.dailyEMI)]].map(([k,v])=>(
                <div key={k}><p className="text-[9px] font-semibold" style={{ color:"rgba(255,255,255,0.5)" }}>{k}</p><p className="text-sm font-black mt-0.5 text-white">{v}</p></div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-3xl p-5 flex items-center gap-4" style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.12)" }}>
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background:Y }}><Plus size={22} color={TEXT}/></div>
            <div className="flex-1"><p className="font-bold text-white">No active loan</p><p className="text-xs" style={{ color:"rgba(255,255,255,0.55)" }}>Apply for Personal or Business loan</p></div>
            <button onClick={()=>navigate("loan-apply")} className="px-4 py-2.5 rounded-2xl text-sm font-bold shrink-0" style={{ background:Y, color:TEXT }}>Apply →</button>
          </div>
        )}
      </div>

      {/* White pull-up content */}
      <div className="flex-1 overflow-y-auto -mt-8 rounded-t-[32px] bg-white px-4 sm:px-5 pt-6 sm:pt-7 pb-4">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Colorful 2×2 action grid */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color:MUTED }}>Quick Actions</p>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              {actions.map(([s,Icon,label,bg])=>(
                <button key={s} onClick={()=>navigate(s)} className="p-4 sm:p-5 rounded-3xl text-left active:scale-[0.96] transition-transform shadow-sm min-w-0" style={{ background:bg }}>
                  <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl flex items-center justify-center mb-3 sm:mb-4" style={{ background:"rgba(255,255,255,0.22)" }}><Icon size={20} color="white"/></div>
                  <p className="text-white font-bold text-xs sm:text-sm leading-snug whitespace-pre-line">{label}</p>
                  <ArrowRight size={14} color="rgba(255,255,255,0.55)" className="mt-1.5 sm:mt-2"/>
                </button>
              ))}
            </div>
          </div>

          {/* Status banners & timeline */}
          {latest?.status==="approved" && (
            <div className="rounded-3xl p-5" style={{ background:YBG, border:`2px solid ${Y}` }}>
              <p className="font-bold mb-1" style={{ color:TEXT }}>🎉 Loan Approved & Disbursed!</p>
              <p className="text-sm" style={{ color:Y2 }}>Pay {fmt(latest.dailyEMI)} daily for {latest.tenure} days.</p>
              {latest.assignedAgent && (
                <div className="mt-3 p-3 rounded-2xl flex items-center gap-3" style={{ background:CARD, border:`1px solid ${BORD}` }}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background:TEXT }}><Users size={15} color={Y}/></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold" style={{ color:TEXT }}>Agent: {latest.assignedAgent}</p>
                    {latest.assignedAgentPhone && <p className="text-xs" style={{ color:MUTED }}>+91 {latest.assignedAgentPhone}</p>}
                  </div>
                  {latest.assignedAgentPhone && <a href={`tel:+91${latest.assignedAgentPhone}`} className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background:"rgba(22,163,74,0.1)" }}><Phone size={14} color={OK}/></a>}
                </div>
              )}
              <button onClick={()=>navigate("emi")} className="mt-3 flex items-center gap-1.5 text-xs font-bold" style={{ color:Y2 }}>View EMI Tracker <ArrowRight size={12}/></button>
            </div>
          )}
          {latest?.status==="pending" && (
            <div className="rounded-3xl p-5 border" style={{ background:CARD, borderColor:BORD }}>
              <div className="flex justify-between items-center mb-5">
                <p className="font-bold" style={{ color:TEXT }}>Application Progress</p>
                <button onClick={()=>navigate("loan-status")} className="text-xs font-bold" style={{ color:Y2 }}>Details →</button>
              </div>
              {[
                { l:"Submitted",          done:true,   date:latest.createdAt },
                { l:"Document Verified",  done:true,   date:"Completed" },
                { l:"Field Verification", active:true, date:"In progress" },
                { l:"Credit Assessment",  done:false },
                { l:"Disbursement",       done:false },
              ].map((s,i,arr)=>(
                <div key={s.l} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 border-2" style={{ borderColor:s.done?OK:(s as any).active?Y:BORD, background:s.done?OK:(s as any).active?Y:"white" }}>
                      {s.done&&<Check size={12} color="white"/>}{(s as any).active&&<div className="w-2 h-2 rounded-full" style={{ background:TEXT }}/>}
                    </div>
                    {i<arr.length-1&&<div className="w-0.5 h-4 my-1" style={{ background:s.done?OK:BORD }}/>}
                  </div>
                  <div className="flex-1 pb-0.5 flex justify-between items-center">
                    <p className="text-sm font-semibold" style={{ color:s.done||(s as any).active?TEXT:"#C4C4C4" }}>{s.l}</p>
                    {s.date&&<p className="text-xs" style={{ color:(s as any).active?Y2:MUTED }}>{s.date}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {latest?.status==="rejected" && (
            <div className="rounded-3xl p-5 border-2" style={{ background:"rgba(220,38,38,0.05)", borderColor:"rgba(220,38,38,0.2)" }}>
              <p className="font-bold mb-1" style={{ color:"#7F1D1D" }}>Application Not Approved</p>
              <p className="text-sm" style={{ color:"#991B1B" }}>You may reapply after 90 days or contact support.</p>
            </div>
          )}
          {myApps.length>0 && (
            <div className="rounded-3xl p-5 border" style={{ background:CARD, borderColor:BORD }}>
              <div className="flex justify-between items-center mb-4"><p className="font-bold" style={{ color:TEXT }}>Loan History</p><button onClick={()=>navigate("loan-status")} className="text-xs font-bold" style={{ color:Y2 }}>View All →</button></div>
              {[...myApps].reverse().slice(0,3).map(app=>(
                <div key={app.id} className="flex items-center gap-3 py-3 border-b last:border-0" style={{ borderColor:BORD }}>
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0" style={{ background:YBG }}><CreditCard size={18} color={Y2}/></div>
                  <div className="flex-1"><p className="text-sm font-bold" style={{ color:TEXT }}>{app.loanType} · {fmt(app.amount)}</p><p className="text-xs" style={{ color:MUTED }}>{app.tenure} days · {fmt(app.dailyEMI)}/day</p></div>
                  <Chip status={app.status}/>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <BottomNav active="customer-home" navigate={navigate}/>
    </div>
  );
}

// ─── LOAN APPLICATION ─────────────────────────────────────────
function LoanApplicationScreen({ navigate, session, db, setDB }:GP) {
  const [step,setStep]=useState(0);
  const [form,setForm]=useState({ name:session.name||"", phone:"", dob:"", gender:"Male", address:"", city:"", pinCode:"", income:"", coName:"", coPhone:"", coRelation:"Spouse", coAddress:"", loanType:"Personal" as "Personal"|"Business", amount:"", tenure:33 as 33|66, purpose:"", declared:false, aadhaar:"", pan:"" });
  const [files,setFiles]=useState<Record<string,{name:string;url:string}|null>>({});
  const [submitting,setSubmitting]=useState(false);
  const setF=(k:keyof typeof form,v:any)=>setForm(f=>({...f,[k]:v}));
  const amt=parseInt(form.amount)||0; const safeAmt=Math.min(amt,MAX_AMT);
  const selEMI=safeAmt>=1000?calcEMI(safeAmt,form.tenure):null;
  const labels=["Personal Details","Co-Borrower","Loan Details","KYC Documents","Others","Review & Submit"];
  function canProceed(){
    if(step===0){ const pin=parseInt(form.pinCode); return form.name&&form.phone.length===10&&form.aadhaar.length===12&&form.pan.length===10&&form.dob&&form.city&&form.address&&form.pinCode.length===6&&pin>=700108&&pin<=700131&&form.income; }
    if(step===1) return form.coName&&form.coPhone.length===10&&form.coAddress;
    if(step===2) return safeAmt>=1000&&form.purpose;
    if(step===3) return !!(files.aadhaar&&files.pan&&files.photo);
    if(step===5) return form.declared;
    return true;
  }
  async function handleSubmit(){
    if(!selEMI||submitting) return;
    setSubmitting(true);
    try {
      // Step 1: Upload each document to the server first and get back file paths.
      // This keeps the loan JSON small and avoids CSRF/session issues from large payloads.
      const docs: Record<string, string> = {};
      for (const [key, file] of Object.entries(files)) {
        if (file) {
          try {
            // Use apiUpload to POST the file as multipart/form-data and get a /storage/… path
            const path = await apiUpload(file.url, `${key}-${Date.now()}.jpg`);
            docs[key] = path;
          } catch {
            // Fallback: compress and embed as base64 (smaller, ~50–80 KB per image)
            try {
              const base64 = await fileToBase64(file.url);
              docs[key] = await compressImage(base64, 600, 600, 0.6);
            } catch {
              docs[key] = 'local';
            }
          }
        }
      }

      // Step 2: Fresh CSRF token before the loan POST (prevents stale-token 419 → 401 loop)
      csrfReady = null;
      await ensureCsrf();

      const { loan } = await api('/loans', {
        method: 'POST',
        body: JSON.stringify({
          loan_type: form.loanType, amount: safeAmt, tenure_days: form.tenure,
          purpose: form.purpose, city: form.city, address: form.address,
          monthly_income: parseInt(form.income) || 0,
          co_borrower: { name: form.coName, phone: form.coPhone, relation: form.coRelation, address: form.coAddress },
          documents: docs,
          customer_phone: session.role==="agent" ? form.phone : undefined,
          customer_name: form.name,
          aadhaar: form.aadhaar,
          pan: form.pan,
        }),
      });
      setDB(d=>({...d, applications:[...d.applications.filter(a=>a.id!==loan.id), loan]}));
      toast.success("Application submitted!",{description:loan.id});
      navigate(session.role==="agent"?"agent-dashboard":"customer-home");
    } catch(e: any) { toast.error(e.message || "Failed to submit application"); }
    setSubmitting(false);
  }
  return (
    <div className="flex flex-col h-full" style={{ background:CARD }}>
      <div className="px-5 pt-5 pb-8 shrink-0" style={{ background:Y }}>
        <button onClick={()=>step===0?navigate(session.role==="agent"?"agent-dashboard":"customer-home"):setStep(s=>s-1)} className="flex items-center gap-1 text-sm mb-4" style={{ color:Y2 }}><ChevronLeft size={15}/>{step===0?"Cancel":"Back"}</button>
        <div className="flex justify-between items-end mb-3">
          <div><p className="text-[9px] font-bold uppercase tracking-[0.2em] mb-1" style={{ color:Y2 }}>Step {step+1} of {labels.length}</p><h1 className="text-xl font-black" style={{ color:TEXT }}>{labels[step]}</h1></div>
          <span className="text-[10px] font-bold px-3 py-1.5 rounded-full" style={{ background:"rgba(0,0,0,0.15)", color:TEXT }}>{Math.round((step/labels.length)*100)}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background:"rgba(0,0,0,0.15)" }}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width:`${((step+1)/labels.length)*100}%`, background:TEXT }}/>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto -mt-4 rounded-t-[28px] px-4 sm:px-5 pt-6 sm:pt-7 pb-8" style={{ background:CARD }}>
        <div className="max-w-lg mx-auto space-y-4">
          {step===0&&(<>
            <div className="grid sm:grid-cols-2 gap-4">
              <F label="Full Name"><input value={form.name} onChange={e=>setF("name",e.target.value)} placeholder="Full name" className={inp} style={iSt}/></F>
              <F label="Mobile Number"><input type="tel" value={form.phone} onChange={e=>setF("phone",e.target.value)} maxLength={10} placeholder="10-digit" className={inp} style={iSt}/></F>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <F label="Aadhaar Number"><input type="text" inputMode="numeric" value={form.aadhaar || ""} onChange={e=>setF("aadhaar",e.target.value.replace(/\D/g,"").slice(0,12))} maxLength={12} placeholder="12-digit Aadhaar number" className={inp} style={iSt}/></F>
              <F label="PAN Card Number"><input type="text" value={form.pan || ""} onChange={e=>setF("pan",e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,10))} maxLength={10} placeholder="10-character PAN card" className={inp} style={iSt}/></F>
            </div>
            <F label="Date of Birth"><input type="date" value={form.dob} onChange={e=>setF("dob",e.target.value)} className={inp} style={iSt}/></F>
            <F label="Gender"><div className="flex gap-3">{["Male","Female","Other"].map(g=><button key={g} onClick={()=>setF("gender",g)} className="flex-1 py-3 rounded-2xl text-sm font-bold border-2 transition-all" style={{ borderColor:form.gender===g?TEXT:BORD, background:form.gender===g?TEXT:BG, color:form.gender===g?Y:MUTED }}>{g}</button>)}</div></F>
            <F label="Full Address"><input value={form.address} onChange={e=>setF("address",e.target.value)} placeholder="House, street, area" className={inp} style={iSt}/></F>
            <div className="grid sm:grid-cols-2 gap-4">
              <F label="City / Town"><input value={form.city} onChange={e=>setF("city",e.target.value)} placeholder="City" className={inp} style={iSt}/></F>
              <F label="PIN Code">
                <input type="text" inputMode="numeric" value={form.pinCode} onChange={e=>setF("pinCode",e.target.value.replace(/\D/g,"").slice(0,6))} maxLength={6} placeholder="e.g. 700108" className={inp} style={{...iSt, borderColor:form.pinCode.length===6&&(parseInt(form.pinCode)<700108||parseInt(form.pinCode)>700131)?ERR:iSt.borderColor}}/>
                {form.pinCode.length===6&&(parseInt(form.pinCode)<700108||parseInt(form.pinCode)>700131)&&<p className="text-xs mt-1 font-semibold" style={{ color:ERR }}>Service available only for PIN codes 700108–700131</p>}
              </F>
            </div>
            <F label="Monthly Income (₹)"><input type="number" value={form.income} onChange={e=>setF("income",e.target.value)} placeholder="e.g. 15000" className={inp} style={iSt}/></F>
          </>)}
          {step===1&&(<>
            <div className="rounded-2xl p-4 border-2" style={{ borderColor:Y, background:YBG }}>
              <div className="flex items-start gap-2.5"><Info size={15} color={Y2} className="mt-0.5 shrink-0"/><p className="text-sm" style={{ color:TEXT }}><strong>Co-Borrower is mandatory</strong> — equally responsible for daily EMI repayment.</p></div>
            </div>
            <F label="Co-Borrower Full Name"><input value={form.coName} onChange={e=>setF("coName",e.target.value)} placeholder="Full name as per Aadhaar" className={inp} style={iSt}/></F>
            <div className="grid sm:grid-cols-2 gap-4">
              <F label="Co-Borrower Mobile"><input type="tel" value={form.coPhone} onChange={e=>setF("coPhone",e.target.value)} maxLength={10} placeholder="10-digit" className={inp} style={iSt}/></F>
              <F label="Relationship">
                <div className="relative"><select value={form.coRelation} onChange={e=>setF("coRelation",e.target.value)} className={inp+" appearance-none pr-10"} style={iSt}>{["Spouse","Parent","Sibling","Child","Friend","Business Partner","Other"].map(o=><option key={o}>{o}</option>)}</select><ChevronDown size={15} className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" color={MUTED}/></div>
              </F>
            </div>
            <F label="Co-Borrower Full Address"><input value={form.coAddress} onChange={e=>setF("coAddress",e.target.value)} placeholder="Residential address" className={inp} style={iSt}/></F>
          </>)}
          {step===2&&(<>
            <F label="Loan Type">
              <div className="grid grid-cols-2 gap-3">
                {(["Personal","Business"] as const).map(t=>(
                  <button key={t} onClick={()=>setF("loanType",t)} className="py-6 rounded-3xl border-2 text-center transition-all active:scale-[0.97]" style={{ borderColor:form.loanType===t?TEXT:BORD, background:form.loanType===t?TEXT:CARD }}>
                    <div className="text-3xl mb-2">{t==="Personal"?"👤":"🏪"}</div>
                    <div className="text-sm font-bold" style={{ color:form.loanType===t?Y:TEXT }}>{t} Loan</div>
                    <div className="text-[10px] mt-0.5" style={{ color:form.loanType===t?"rgba(255,255,255,0.5)":MUTED }}>up to ₹20,000</div>
                  </button>
                ))}
              </div>
            </F>
            <F label={`Loan Amount (max ₹${MAX_AMT.toLocaleString("en-IN")})`}>
              <div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold" style={{ color:MUTED }}>₹</span>
              <input type="number" value={form.amount} onChange={e=>setF("amount",e.target.value)} placeholder="Enter amount" min={1000} max={MAX_AMT} className={inp+" pl-8"} style={iSt}/></div>
              {amt>MAX_AMT&&<p className="text-xs mt-1 font-semibold" style={{ color:ERR }}>Maximum is ₹{MAX_AMT.toLocaleString("en-IN")}</p>}
            </F>
            {safeAmt>=1000&&(
              <F label="Choose EMI Plan">
                <div className="grid grid-cols-2 gap-3">
                  {([33,66] as const).map(t=>{ const e=calcEMI(safeAmt,t); const sel=form.tenure===t; return (
                    <button key={t} onClick={()=>setF("tenure",t)} className="p-4 rounded-2xl border-2 text-left transition-all" style={{ borderColor:sel?TEXT:BORD, background:sel?TEXT:CARD }}>
                      <div className="flex justify-between items-center mb-2"><span className="text-xs font-bold" style={{ color:sel?Y:MUTED }}>{t}-Day Plan</span>{sel&&<Check size={14} color={Y}/>}</div>
                      <p className="text-xl font-black" style={{ color:sel?Y:TEXT }}>{fmt(e.daily)}<span className="text-xs font-normal" style={{ color:sel?"rgba(255,255,255,0.45)":MUTED }}>/day</span></p>
                      <p className="text-[10px] mt-1" style={{ color:sel?"rgba(255,255,255,0.45)":MUTED }}>Total: {fmt(e.total)} · ₹{Math.round(safeAmt*0.04)}/day</p>
                    </button>
                  ); })}
                </div>
              </F>
            )}
            <F label="Purpose of Loan">
              <div className="relative"><select value={form.purpose} onChange={e=>setF("purpose",e.target.value)} className={inp+" appearance-none pr-10"} style={iSt}>
                <option value="">Select purpose</option>
                {form.loanType==="Personal"?["Medical emergency","Education fees","Home repair","Marriage expenses","Consumer goods","Other"].map(o=><option key={o}>{o}</option>):["Stock purchase","Equipment","Business expansion","Working capital","Rent payment","Other"].map(o=><option key={o}>{o}</option>)}
              </select><ChevronDown size={15} className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" color={MUTED}/></div>
            </F>
          </>)}
          {step===3&&(<>
            <div className="rounded-2xl p-3.5 flex items-start gap-2" style={{ background:YBG, border:`1px solid ${Y}` }}>
              <Info size={13} color={Y2} className="mt-0.5 shrink-0"/><p className="text-xs" style={{ color:Y2 }}>Upload clear photos. Use the Camera button for live capture.</p>
            </div>
            <DocUpload label="Aadhaar Card (Front & Back)" tag="Mandatory" fieldKey="aadhaar" files={files} setFiles={setFiles} allowCamera cameraLabel="Capture Aadhaar Card"/>
            <DocUpload label="PAN Card" tag="Mandatory" fieldKey="pan" files={files} setFiles={setFiles} allowCamera cameraLabel="Capture PAN Card"/>
            <DocUpload label="Live Applicant Photograph" tag="Mandatory" fieldKey="photo" files={files} setFiles={setFiles} allowCamera cameraLabel="Take Applicant Photo"/>
          </>)}
          {step===4&&(<>
            <div className="rounded-2xl p-4 border-2" style={{ borderColor:Y, background:YBG }}>
              <p className="text-sm font-bold mb-1" style={{ color:TEXT }}>Others & Business Proof</p>
              <p className="text-xs" style={{ color:Y2 }}>For Business Loans: upload shop photo, license, or GST. All others are optional.</p>
            </div>
            <DocUpload label="Shop / Business Photo" tag={form.loanType==="Business"?"Mandatory":"Optional"} fieldKey="shopPhoto" files={files} setFiles={setFiles} allowCamera cameraLabel="Capture Shop or Business"/>
            <DocUpload label="Business License / GST Certificate" tag="Optional" fieldKey="biz" files={files} setFiles={setFiles} allowCamera cameraLabel="Capture License"/>
            <DocUpload label="Co-Borrower Photograph" tag="Optional" fieldKey="coPhoto" files={files} setFiles={setFiles} allowCamera cameraLabel="Take Co-Borrower Photo"/>
            <DocUpload label="Any Other Document" tag="Optional" fieldKey="other" files={files} setFiles={setFiles} allowCamera cameraLabel="Capture Document"/>
          </>)}
          {step===5&&(<>
            <div className="rounded-2xl p-4 flex items-start gap-2" style={{ background:"rgba(22,163,74,0.07)", border:`1px solid rgba(22,163,74,0.2)` }}>
              <CheckCircle size={14} color={OK} className="mt-0.5 shrink-0"/><p className="text-xs" style={{ color:"#065F46" }}>Review all details before submitting. You cannot edit after submission.</p>
            </div>
            {[
              { t:"Personal",    rows:[["Name",form.name||session.name],["Mobile",form.phone||"—"],["Aadhaar Number",form.aadhaar||"—"],["PAN Number",form.pan||"—"],["City",form.city||"—"],["PIN Code",form.pinCode||"—"],["Income",form.income?fmt(parseInt(form.income)):"—"],["Address",form.address||"—"]] },
              { t:"Co-Borrower", rows:[["Name",form.coName||"—"],["Mobile",form.coPhone||"—"],["Relation",form.coRelation],["Address",form.coAddress||"—"]] },
              { t:"Loan",        rows:[["Type",`${form.loanType} Loan`],["Amount",fmt(safeAmt)],["Plan",`${form.tenure} days daily`],["Daily EMI",selEMI?fmt(selEMI.daily):"—"],["Total",selEMI?fmt(selEMI.total):"—"],["Purpose",form.purpose||"—"]] },
              { t:"Documents",   rows:[["Aadhaar",files.aadhaar?"✓ Uploaded":"Pending"],["PAN Card",files.pan?"✓ Uploaded":"Pending"],["Photo",files.photo?"✓ Captured":"Pending"]] },
            ].map(s=>(
              <div key={s.t} className="rounded-2xl p-4 border-2" style={{ borderColor:BORD }}>
                <p className="text-[9px] font-bold uppercase tracking-widest mb-3" style={{ color:MUTED }}>{s.t}</p>
                {s.rows.map(([k,v])=>(
                  <div key={k} className="flex justify-between py-1.5 border-b last:border-0" style={{ borderColor:BORD }}>
                    <span className="text-xs" style={{ color:MUTED }}>{k}</span><span className="text-xs font-bold" style={{ color:String(v).startsWith("✓")?OK:TEXT }}>{v}</span>
                  </div>
                ))}
              </div>
            ))}
            <label className="flex items-start gap-3 cursor-pointer">
              <div onClick={()=>setF("declared",!form.declared)} className="w-6 h-6 rounded-lg border-2 flex items-center justify-center mt-0.5 shrink-0 transition-all" style={{ borderColor:form.declared?TEXT:BORD, background:form.declared?TEXT:CARD }}>
                {form.declared&&<Check size={13} color={Y}/>}
              </div>
              <p className="text-sm" style={{ color:TEXT }}>I declare all information is accurate and accept the <span style={{ color:Y2 }}>Terms & Conditions</span> of Laxmi Finance.</p>
            </label>
          </>)}
          <button onClick={()=>step<labels.length-1?setStep(s=>s+1):handleSubmit()} disabled={!canProceed()||submitting}
            className="w-full py-4 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]"
            style={{ background:canProceed()&&!submitting?TEXT:BORD, color:canProceed()&&!submitting?Y:MUTED }}>
            {submitting?"Submitting…":step===labels.length-1?"✓ Submit Application":`Continue → ${labels[step+1]}`}
          </button>
          {!canProceed()&&<p className="text-center text-xs" style={{ color:MUTED }}>
            {step===0?(form.pinCode.length===6&&(parseInt(form.pinCode)<700108||parseInt(form.pinCode)>700131)?"PIN code must be between 700108 and 700131":"Fill all required fields"):step===1?"Co-borrower details are mandatory":step===2?"Enter amount and select EMI plan":step===3?"Upload Aadhaar, PAN, and take photo":step===5?"Accept the declaration":""}
          </p>}
        </div>
      </div>
    </div>
  );
}

// ─── LOAN CALCULATOR ─────────────────────────────────────────
function LoanCalculatorScreen({ navigate }:GP) {
  const [amount,setAmount]=useState(10000);
  const e33=calcEMI(amount,33); const e66=calcEMI(amount,66);
  return (
    <div className="flex flex-col h-full" style={{ background:BG }}>
      <PH title="EMI Calculator" sub="Daily repayment — 33 or 66 day plans" onBack={()=>navigate("customer-home")}/>
      <div className="flex-1 overflow-y-auto -mt-4 rounded-t-[28px] px-5 pt-7 pb-8 bg-white">
        <div className="max-w-lg mx-auto space-y-6">
          <div>
            <div className="flex justify-between items-center mb-2"><Lbl ch="Loan Amount"/><span className="text-sm font-black" style={{ color:TEXT }}>{fmt(amount)}</span></div>
            <input type="range" min={1000} max={MAX_AMT} step={500} value={amount} onChange={e=>setAmount(Number(e.target.value))} className="w-full h-3 rounded-full appearance-none cursor-pointer" style={{ accentColor:Y }}/>
            <div className="flex justify-between text-[10px] mt-1" style={{ color:MUTED }}><span>₹1,000</span><span>{fmt(MAX_AMT)}</span></div>
          </div>
          <div className="p-5 rounded-3xl text-center" style={{ background:YBG, border:`2px solid ${Y}` }}>
            <p className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color:Y2 }}>Selected Amount</p>
            <p className="text-4xl font-black" style={{ color:TEXT }}>{fmt(amount)}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[{t:33,e:e33},{t:66,e:e66}].map(p=>(
              <div key={p.t} className="rounded-3xl p-5" style={{ background:TEXT }}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color:"rgba(255,255,255,0.45)" }}>{p.t}-Day Plan</p>
                <p className="text-3xl font-black" style={{ color:Y }}>{fmt(p.e.daily)}</p>
                <p className="text-xs mb-3" style={{ color:"rgba(255,255,255,0.45)" }}>per day</p>
                <div className="space-y-1.5 pt-3 border-t" style={{ borderColor:"rgba(255,255,255,0.1)" }}>
                  {[["Principal",fmt(amount)],["Interest",fmt(p.e.total-amount)],["Total",fmt(p.e.total)]].map(([k,v])=>(
                    <div key={k} className="flex justify-between text-xs"><span style={{ color:"rgba(255,255,255,0.45)" }}>{k}</span><span className="font-bold text-white">{v}</span></div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button onClick={()=>navigate("loan-apply")} className="w-full py-4 rounded-2xl font-bold text-sm transition-all active:scale-[0.98]" style={{ background:Y, color:TEXT }}>Apply for This Loan →</button>
        </div>
      </div>
    </div>
  );
}

// ─── Other customer screens ───────────────────────────────────
function LoanStatusScreen({ navigate, session, db }:GP) {
  const myApps=db.applications.filter(a=>a.customerId===session.userId);
  return (
    <div className="flex flex-col h-full" style={{ background:BG }}>
      <PH title="My Loans" sub={`${myApps.length} application${myApps.length!==1?"s":""}`} onBack={()=>navigate("customer-home")}/>
      <div className="flex-1 overflow-y-auto -mt-4 rounded-t-[28px] px-5 pt-6 pb-4 bg-white">
        <div className="max-w-2xl mx-auto space-y-4">
          {myApps.length===0&&<div className="text-center py-16"><CreditCard size={44} color={BORD} className="mx-auto mb-4"/><p className="font-bold" style={{ color:TEXT }}>No applications yet</p><button onClick={()=>navigate("loan-apply")} className="mt-4 px-6 py-3 rounded-2xl font-bold text-sm" style={{ background:Y, color:TEXT }}>Apply Now</button></div>}
          {[...myApps].reverse().map(app=>(
            <div key={app.id} className="rounded-3xl p-5 border" style={{ background:CARD, borderColor:BORD }}>
              <div className="flex justify-between items-start mb-4"><div><p className="text-[10px] font-mono mb-0.5" style={{ color:MUTED }}>{app.id}</p><p className="text-2xl font-black" style={{ color:TEXT }}>{fmt(app.amount)}</p></div><Chip status={app.status}/></div>
              <div className="grid grid-cols-3 gap-2 p-3 rounded-2xl mb-4" style={{ background:YBG }}>
                {[["Type",app.loanType],["Daily EMI",fmt(app.dailyEMI)],["Plan",`${app.tenure}d`]].map(([k,v])=>(
                  <div key={k} className="text-center"><p className="text-[9px] font-semibold" style={{ color:MUTED }}>{k}</p><p className="text-sm font-bold mt-0.5" style={{ color:TEXT }}>{v}</p></div>
                ))}
              </div>
              <div className="flex justify-between items-center">
                <p className="text-xs" style={{ color:MUTED }}>Applied: {app.createdAt}</p>
                {app.status==="approved"&&<button onClick={()=>openPdf(app.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold" style={{ background:YBG, color:Y2 }}><Download size={11}/> PDF</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <BottomNav active="loan-status" navigate={navigate}/>
    </div>
  );
}

function EMIScreen({ navigate, session, db }:GP) {
  const app=db.applications.filter(a=>a.customerId===session.userId&&a.status==="approved").slice(-1)[0];
  if(!app) return (
    <div className="flex flex-col h-full" style={{ background:BG }}>
      <PH title="EMI Tracker" onBack={()=>navigate("customer-home")}/>
      <div className="flex-1 flex items-center justify-center flex-col gap-3 bg-white rounded-t-[28px] -mt-4 px-5">
        <Wallet size={48} color={BORD}/><p className="font-bold" style={{ color:TEXT }}>No active approved loan</p>
        <button onClick={()=>navigate("loan-apply")} className="mt-2 px-6 py-3 rounded-2xl font-bold text-sm" style={{ background:Y, color:TEXT }}>Apply Now</button>
      </div>
      <BottomNav active="emi" navigate={navigate}/>
    </div>
  );
  const paidLogs=db.agentLogs.filter(l=>l.appId===app.id&&l.action==="collected");
  const paid=paidLogs.length;
  const pct=Math.round(Math.min(paid/app.tenure,1)*100);
  return (
    <div className="flex flex-col h-full" style={{ background:BG }}>
      <div className="px-5 pt-5 pb-16 shrink-0" style={{ background:Y }}>
        <h1 className="text-2xl font-black mb-0.5" style={{ color:TEXT }}>EMI Tracker</h1>
        <p className="text-sm mb-5" style={{ color:Y2 }}>{app.id} · {app.loanType} Loan</p>
        <div className="flex items-center gap-4 sm:gap-5">
          <div className="relative shrink-0">
            <svg width="80" height="80" viewBox="0 0 86 86" className="sm:w-[86px] sm:h-[86px]">
              <circle cx="43" cy="43" r="36" fill="none" stroke="rgba(0,0,0,0.15)" strokeWidth="8"/>
              <circle cx="43" cy="43" r="36" fill="none" stroke={TEXT} strokeWidth="8" strokeDasharray={`${2*Math.PI*36}`} strokeDashoffset={`${2*Math.PI*36*(1-pct/100)}`} strokeLinecap="round" transform="rotate(-90 43 43)"/>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center"><p className="text-xl font-black" style={{ color:TEXT }}>{pct}%</p><p className="text-[9px] font-semibold" style={{ color:Y2 }}>paid</p></div>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-2 sm:gap-2.5">
            {[["Daily EMI",fmt(app.dailyEMI)],["Total Days",`${app.tenure}`],["Paid",`${paid}`],["Balance",fmt(Math.max(0,app.totalPayable-paid*app.dailyEMI))]].map(([k,v])=>(
              <div key={k} className="rounded-2xl p-2.5 sm:p-3 text-center" style={{ background:"rgba(0,0,0,0.1)" }}><p className="font-black text-xs sm:text-sm" style={{ color:TEXT }}>{v}</p><p className="text-[8px] sm:text-[9px] font-semibold" style={{ color:Y2 }}>{k}</p></div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto -mt-8 rounded-t-[32px] px-5 pt-6 pb-4 bg-white">
        <div className="max-w-2xl mx-auto">
          <div className="rounded-3xl p-5 border mb-5" style={{ background:CARD, borderColor:BORD }}>
            <p className="font-bold mb-3" style={{ color:TEXT }}>Payment Summary</p>
            {[["Loan Amount",fmt(app.amount)],["Interest",fmt(app.totalPayable-app.amount)],["Total Payable",fmt(app.totalPayable)],["Amount Paid",fmt(paid*app.dailyEMI)],["Remaining",fmt(Math.max(0,app.totalPayable-paid*app.dailyEMI))]].map(([k,v])=>(
              <div key={k} className="flex justify-between py-2.5 border-b last:border-0" style={{ borderColor:BORD }}><span className="text-sm" style={{ color:MUTED }}>{k}</span><span className="text-sm font-bold" style={{ color:TEXT }}>{v}</span></div>
            ))}
          </div>
          <button onClick={()=>toast.error("Online payment is currently unavailable. Please contact our Agent.")} className="w-full py-4 rounded-2xl font-bold text-sm" style={{ background:Y, color:TEXT }}>Pay Today's EMI — {fmt(app.dailyEMI)}</button>
          {app.assignedAgent && (
            <div className="mt-3 p-3 rounded-2xl flex items-center gap-3 border" style={{ borderColor:BORD }}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background:TEXT }}><Users size={15} color={Y}/></div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold" style={{ color:TEXT }}>Agent: {app.assignedAgent}</p>
                {app.assignedAgentPhone && <p className="text-xs" style={{ color:MUTED }}>+91 {app.assignedAgentPhone}</p>}
              </div>
              {app.assignedAgentPhone && <a href={`tel:+91${app.assignedAgentPhone}`} className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background:"rgba(22,163,74,0.1)" }}><Phone size={14} color={OK}/></a>}
            </div>
          )}
        </div>
      </div>
      <BottomNav active="emi" navigate={navigate}/>
    </div>
  );
}

function NotificationsScreen({ navigate, session, db }:GP) {
  const isAdmin=session.role==="admin"; const isAgent=session.role==="agent";
  const apps=isAdmin||isAgent?db.applications:db.applications.filter(a=>a.customerId===session.userId);
  const notifs=[...apps.map(a=>({ Icon:CheckCircle, color:a.status==="approved"?OK:a.status==="rejected"?ERR:a.status==="cancelled"?MUTED:WARN, title:a.status==="approved"?"Loan Approved":a.status==="rejected"?"Application Rejected":a.status==="cancelled"?"Loan Cancelled":"Application Submitted", body:`${a.id} · ${a.customerName} · ${fmt(a.amount)} — ${a.status}.`, time:a.createdAt, unread:a.status==="pending" }))];
  if(notifs.length===0) notifs.push({ Icon:Bell, color:MUTED, title:"No notifications", body:"No activity to show yet.", time:"", unread:false });
  const backScreen=isAdmin?"admin-dashboard":isAgent?"agent-dashboard":"customer-home";
  return (
    <div className="flex flex-col h-full" style={{ background:BG }}>
      <PH title="Notifications" sub={`${notifs.filter(n=>n.unread).length} unread`} onBack={()=>navigate(backScreen)}/>
      <div className="flex-1 overflow-y-auto -mt-4 rounded-t-[28px] px-5 pt-6 pb-4 bg-white">
        <div className="max-w-2xl mx-auto space-y-3">
          {notifs.map((n,i)=>(
            <div key={i} className="rounded-2xl p-4 flex gap-3.5 border" style={{ background:CARD, borderColor:BORD, borderLeft:n.unread?`4px solid ${Y}`:"4px solid transparent" }}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background:`${n.color}15` }}><n.Icon size={16} color={n.color}/></div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between gap-2"><p className="text-sm font-bold" style={{ color:TEXT }}>{n.title}</p><span className="text-[10px] shrink-0" style={{ color:MUTED }}>{n.time}</span></div>
                <p className="text-xs mt-0.5" style={{ color:MUTED }}>{n.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      {!isAdmin&&!isAgent&&<BottomNav active="notifications" navigate={navigate}/>}
    </div>
  );
}

function ProfileScreen({ navigate, session, db }:GP) {
  const customer=db.customers.find(c=>c.id===session.userId);
  const initials=session.name.split(" ").map((n:string)=>n[0]).slice(0,2).join("").toUpperCase();
  const [deleting,setDeleting]=useState(false);
  async function deleteAccount(){
    if(!confirm("Are you sure you want to delete your account? This action cannot be undone.")) return;
    setDeleting(true);
    try {
      await api('/auth/account',{method:'DELETE'});
      toast.success("Account deleted successfully");
      navigate("splash");
    } catch(e:any){ toast.error(e.message||"Cannot delete account"); }
    setDeleting(false);
  }
  return (
    <div className="flex flex-col h-full" style={{ background:BG }}>
      <div className="px-5 pt-5 pb-16 shrink-0" style={{ background:Y }}>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full flex items-center justify-center font-black text-xl shrink-0" style={{ background:"rgba(0,0,0,0.15)", color:TEXT }}>{initials}</div>
          <div><h2 className="text-xl font-black" style={{ color:TEXT }}>{session.name}</h2><p className="text-sm" style={{ color:Y2 }}>+91 {customer?.phone||"—"}</p><span className="inline-block text-[10px] font-bold px-2.5 py-1 rounded-full mt-1" style={{ background:"rgba(0,0,0,0.12)", color:TEXT }}>{customer?.token||"—"}</span></div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto -mt-8 rounded-t-[32px] px-5 pt-6 pb-4 bg-white">
        <div className="max-w-2xl mx-auto space-y-2.5">
          {([
            {Icon:FileText,label:"My Documents",sub:"Aadhaar, PAN and KYC",fn:()=>toast.success("Your KYC documents are securely stored")},
            {Icon:Shield,label:"Security",sub:"Password & account",fn:()=>toast.success("Contact support to update your password")},
            {Icon:Bell,label:"Notifications",sub:"Alert preferences",nav:"notifications" as Screen},
            {Icon:Download,label:"Download Statements",sub:"Loan PDF documents",fn:()=>{const apps=db.applications.filter(a=>a.customerId===session.userId&&a.status==="approved");if(apps.length>0)openPdf(apps[apps.length-1].id);else toast.success("No approved loans to download yet");}},
            {Icon:MessageSquare,label:"Help & Support",sub:"FAQ and contact",nav:"help" as Screen},
          ] as {Icon:any;label:string;sub:string;fn?:()=>void;nav?:Screen}[]).map((item,i)=>(
            <button key={i} onClick={()=>item.nav?navigate(item.nav):item.fn?item.fn():undefined} className="w-full rounded-2xl p-4 flex items-center gap-4 text-left border" style={{ background:CARD, borderColor:BORD }}>
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0" style={{ background:YBG }}><item.Icon size={18} color={Y2}/></div>
              <div className="flex-1"><p className="text-sm font-bold" style={{ color:TEXT }}>{item.label}</p><p className="text-xs" style={{ color:MUTED }}>{item.sub}</p></div>
              <ChevronRight size={15} color="#9CA3AF"/>
            </button>
          ))}
          <button onClick={()=>navigate("splash")} className="w-full rounded-2xl p-4 flex items-center gap-4 border" style={{ background:"rgba(220,38,38,0.04)", borderColor:"rgba(220,38,38,0.15)" }}>
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0" style={{ background:"rgba(220,38,38,0.08)" }}><LogOut size={18} color={ERR}/></div>
            <span className="text-sm font-bold" style={{ color:ERR }}>Logout</span>
          </button>
          <button onClick={deleteAccount} disabled={deleting} className="w-full rounded-2xl p-4 flex items-center gap-4 border" style={{ background:"rgba(220,38,38,0.04)", borderColor:"rgba(220,38,38,0.15)", opacity:deleting?0.6:1 }}>
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0" style={{ background:"rgba(220,38,38,0.08)" }}><Trash2 size={18} color={ERR}/></div>
            <div className="flex-1"><span className="text-sm font-bold" style={{ color:ERR }}>{deleting?"Deleting…":"Delete Account"}</span><p className="text-[10px]" style={{ color:MUTED }}>Permanently remove your account</p></div>
          </button>
        </div>
      </div>
      <BottomNav active="profile" navigate={navigate}/>
    </div>
  );
}

function HelpScreen({ navigate }:GP) {
  const [open,setOpen]=useState<number|null>(null);
  const faqs=[["How much can I borrow?","₹1,000 to ₹20,000."],["What are the EMI plans?","33 days or 66 days — daily repayment at ₹40 per ₹1,000 per day."],["Is co-borrower mandatory?","Yes. All loans require a co-borrower equally responsible for repayment."],["What documents do I need?","Aadhaar, PAN, live photo. Business loans also need shop/business proof."],["How long does approval take?","24–48 hours after field verification."],["Can I repay early?","Yes, anytime. No prepayment penalty."],["What if I miss a payment?","₹10/day late fee. Contact support if you need help."]];
  return (
    <div className="flex flex-col h-full" style={{ background:BG }}>
      <PH title="Help & Support" sub="We're here 24/7" onBack={()=>navigate("customer-home")}/>
      <div className="flex-1 overflow-y-auto -mt-4 rounded-t-[28px] px-5 pt-7 pb-8 bg-white">
        <div className="max-w-lg mx-auto">
          <div className="grid grid-cols-3 gap-3 mb-7">
            {[{Icon:Phone,l:"Call",s:"9AM–9PM",c:OK,fn:()=>toast.success("Call us at 1800-XXX-XXXX (toll-free)")},{Icon:MessageSquare,l:"Chat",s:"Instant",c:INDIGO,fn:()=>toast.success("Live chat coming soon!")},{Icon:Mail,l:"Email",s:"24h reply",c:PINK,fn:()=>toast.success("Email: support@laxmifinance.in")}].map(c=>(
              <button key={c.l} onClick={c.fn} className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2" style={{ borderColor:Y, background:YBG }}>
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background:c.c }}><c.Icon size={18} color="white"/></div>
                <p className="text-xs font-bold" style={{ color:TEXT }}>{c.l}</p><p className="text-[10px]" style={{ color:MUTED }}>{c.s}</p>
              </button>
            ))}
          </div>
          <p className="text-[9px] font-bold uppercase tracking-widest mb-4" style={{ color:MUTED }}>FAQ</p>
          <div className="space-y-2">
            {faqs.map(([q,a],i)=>(
              <div key={i} className="rounded-2xl overflow-hidden border-2" style={{ borderColor:open===i?TEXT:BORD }}>
                <button onClick={()=>setOpen(open===i?null:i)} className="w-full flex items-start justify-between gap-3 p-4 text-left" style={{ background:open===i?TEXT:CARD }}>
                  <p className="text-sm font-bold flex-1" style={{ color:open===i?Y:TEXT }}>{q}</p>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background:open===i?Y:YBG }}><ChevronDown size={13} color={TEXT} style={{ transform:open===i?"rotate(180deg)":"none", transition:"transform 0.2s" }}/></div>
                </button>
                {open===i&&<div className="px-4 pb-4 pt-2" style={{ background:TEXT }}><p className="text-sm leading-relaxed" style={{ color:"rgba(255,255,255,0.65)" }}>{a}</p></div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── AGENT LOGIN ──────────────────────────────────────────────
function AgentLoginScreen({ navigate, db, setDB, setSession }:GP) {
  const [phone,setPhone]=useState(""); const [pw,setPw]=useState(""); const [show,setShow]=useState(false); const [err,setErr]=useState(""); const [loading,setLoading]=useState(false);
  async function go(){
    setErr("");
    if(!phone||!pw){setErr("Enter phone and password");return;}
    setLoading(true);
    try {
      const { user } = await api('/auth/login', { method:'POST', body:JSON.stringify({ phone, password:pw }) });
      if(user.role!=='agent'){api('/auth/logout',{method:'POST'}).catch(()=>{});setErr("Not an agent account");setLoading(false);return;}
      setSession({role:"agent",userId:String(user.id),name:user.name});
      const data = await api('/data');
      setDB((d: DB)=>({...d,...data}));
      navigate("agent-dashboard"); toast.success(`Welcome, ${user.name}!`);
    } catch(e:any){ setErr(e.message||"Invalid credentials"); }
    setLoading(false);
  }
  return (
    <div className="flex flex-col sm:flex-row min-h-screen" style={{ background:BG }}>
      <div className="hidden sm:flex sm:w-[280px] shrink-0 flex-col justify-center items-start px-10" style={{ background:Y }}>
        <LFLogo size={52}/><h2 className="text-3xl font-black mt-5 mb-2" style={{ color:TEXT }}>Agent Portal</h2>
        <p style={{ color:Y2 }} className="text-sm">Verify customers and collect daily EMI.</p>
      </div>
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 py-12 max-w-md mx-auto w-full">
        <div className="sm:hidden mb-8 flex items-center gap-3"><LFLogo size={40}/><div><p className="text-xl font-bold" style={{ color:TEXT }}>Agent Login</p></div></div>
        <p className="text-sm mb-7" style={{ color:MUTED }}>Sign in with your agent credentials</p>
        <div className="space-y-4 mb-5">
          <F label="Mobile Number">
            <div className="flex items-stretch border-2 rounded-2xl overflow-hidden focus-within:border-[#C8961A]" style={{ borderColor:BORD }}>
              <div className="px-4 flex items-center border-r text-sm font-bold shrink-0" style={{ background:YBG, borderColor:BORD, color:Y2 }}>+91</div>
              <input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} maxLength={10} placeholder="Agent mobile" className="flex-1 px-4 py-3.5 text-sm bg-white outline-none placeholder-gray-400" style={{ color:TEXT }}/>
            </div>
          </F>
          <F label="Password">
            <div className="flex items-center border-2 rounded-2xl" style={{ borderColor:BORD }}>
              <input type={show?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)} placeholder="Password" className="flex-1 px-4 py-3.5 text-sm bg-transparent outline-none placeholder-gray-400" style={{ color:TEXT }}/>
              <button onClick={()=>setShow(!show)} className="px-4" style={{ color:"#9CA3AF" }}>{show?<EyeOff size={16}/>:<Eye size={16}/>}</button>
            </div>
          </F>
          {err&&<p className="text-xs font-semibold" style={{ color:ERR }}>{err}</p>}
        </div>
        <button onClick={go} disabled={loading} className="w-full py-4 rounded-2xl font-bold text-sm mb-4 flex items-center justify-center gap-2 transition-all active:scale-[0.98]" style={{ background:Y, color:TEXT, opacity:loading?0.7:1 }}>
          {loading?<><div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin"/>Signing in…</>:"Sign In as Agent →"}</button>
        <p className="text-center text-sm mb-2" style={{ color:MUTED }}>{"Don't have an agent account? "}<button onClick={()=>navigate("agent-register")} className="font-bold" style={{ color:Y2 }}>Register</button></p>
        <button onClick={()=>navigate("splash")} className="w-full py-2 text-center text-xs" style={{ color:MUTED }}>← Back to main</button>
      </div>
    </div>
  );
}

// ─── AGENT REGISTER ──────────────────────────────────────────
function AgentRegisterScreen({ navigate, setSession, setDB }:GP) {
  const [name,setName]=useState(""); const [phone,setPhone]=useState(""); const [pw,setPw]=useState(""); const [pw2,setPw2]=useState("");
  const [zone,setZone]=useState(""); const [show,setShow]=useState(false); const [err,setErr]=useState(""); const [loading,setLoading]=useState(false);
  async function go(){
    setErr("");
    if(!name||!phone||!pw){setErr("All fields are required");return;}
    if(phone.length!==10){setErr("Enter a valid 10-digit phone");return;}
    if(pw.length<6){setErr("Password must be at least 6 characters");return;}
    if(pw!==pw2){setErr("Passwords do not match");return;}
    setLoading(true);
    try {
      const { user } = await api('/auth/register', { method:'POST', body:JSON.stringify({ name, phone, password:pw, password_confirmation:pw2, role:'agent', zone:zone||undefined }) });
      setSession({role:"agent",userId:String(user.id),name:user.name});
      const data = await api('/data');
      setDB((d: DB)=>({...d,...data}));
      navigate("agent-dashboard"); toast.success(`Welcome, ${user.name}!`);
    } catch(e:any){ setErr(e.message||"Registration failed"); }
    setLoading(false);
  }
  return (
    <div className="flex flex-col sm:flex-row min-h-screen" style={{ background:BG }}>
      <div className="hidden sm:flex sm:w-[280px] shrink-0 flex-col justify-center items-start px-10" style={{ background:Y }}>
        <LFLogo size={52}/><h2 className="text-3xl font-black mt-5 mb-2" style={{ color:TEXT }}>Agent Portal</h2>
        <p style={{ color:Y2 }} className="text-sm">Register as a field agent.</p>
      </div>
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 py-12 max-w-md mx-auto w-full">
        <div className="sm:hidden mb-8 flex items-center gap-3"><LFLogo size={40}/><div><p className="text-xl font-bold" style={{ color:TEXT }}>Agent Registration</p></div></div>
        <div className="space-y-4 mb-5">
          <F label="Full Name"><input type="text" value={name} onChange={e=>setName(e.target.value)} placeholder="Your full name" className={inp} style={iSt}/></F>
          <F label="Mobile Number">
            <div className="flex items-stretch border-2 rounded-2xl overflow-hidden focus-within:border-[#C8961A]" style={{ borderColor:BORD }}>
              <div className="px-4 flex items-center border-r text-sm font-bold shrink-0" style={{ background:YBG, borderColor:BORD, color:Y2 }}>+91</div>
              <input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} maxLength={10} placeholder="Agent mobile" className="flex-1 px-4 py-3.5 text-sm bg-white outline-none placeholder-gray-400" style={{ color:TEXT }}/>
            </div>
          </F>
          <F label="Zone / Area (optional)"><input type="text" value={zone} onChange={e=>setZone(e.target.value)} placeholder="e.g. North Kolkata" className={inp} style={iSt}/></F>
          <F label="Password">
            <div className="flex items-center border-2 rounded-2xl" style={{ borderColor:BORD }}>
              <input type={show?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)} placeholder="Min 6 characters" className="flex-1 px-4 py-3.5 text-sm bg-transparent outline-none placeholder-gray-400" style={{ color:TEXT }}/>
              <button onClick={()=>setShow(!show)} className="px-4" style={{ color:"#9CA3AF" }}>{show?<EyeOff size={16}/>:<Eye size={16}/>}</button>
            </div>
          </F>
          <F label="Confirm Password"><input type="password" value={pw2} onChange={e=>setPw2(e.target.value)} placeholder="Repeat password" className={inp} style={iSt}/></F>
          {err&&<p className="text-xs font-semibold" style={{ color:ERR }}>{err}</p>}
        </div>
        <button onClick={go} disabled={loading} className="w-full py-4 rounded-2xl font-bold text-sm mb-4 transition-all active:scale-[0.98] flex items-center justify-center gap-2" style={{ background:Y, color:TEXT, opacity:loading?0.7:1 }}>
          {loading?<><div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin"/>Registering…</>:"Create Agent Account →"}
        </button>
        <p className="text-center text-sm mb-2" style={{ color:MUTED }}>{"Already have an account? "}<button onClick={()=>navigate("agent-login")} className="font-bold" style={{ color:Y2 }}>Sign In</button></p>
        <button onClick={()=>navigate("splash")} className="w-full py-2 text-center text-xs" style={{ color:MUTED }}>← Back to main</button>
      </div>
    </div>
  );
}

// ─── AGENT DASHBOARD ─────────────────────────────────────────
function AgentDashboardScreen({ navigate, session, db, setDB }:GP) {
  const [tab,setTab]=useState<"visits"|"collection">("visits");
  const [search,setSearch]=useState("");
  const [visited,setVisited]=useState<Record<string,boolean>>({});
  const [collected,setCollected]=useState<Record<string,boolean>>({});
  const [collecting,setCollecting]=useState<Record<string,boolean>>({});
  const [deleting,setDeleting]=useState(false);

  async function handleCollect(appId: string, file: File) {
    if(collecting[appId]) return;
    setCollecting(c=>({...c,[appId]:true}));
    try {
      const url = URL.createObjectURL(file);
      const receiptPath = await apiUpload(url, `receipt-${appId}-${Date.now()}.jpg`);
      await api('/agent/log', {
        method: 'POST',
        body: JSON.stringify({ application_number: appId, action: 'collected', receipt: receiptPath })
      });
      setCollected(c=>({...c,[appId]:true}));
      setDB(d=>({...d,agentLogs:[...d.agentLogs,{agentId:session.userId,appId:appId,action:"collected",time:new Date().toLocaleString(),receipt:receiptPath}]}));
      toast.success("EMI collected successfully!");
    } catch (e: any) {
      toast.error(e.message || "Failed to collect EMI");
    }
    setCollecting(c=>({...c,[appId]:false}));
  }

  // Only approved loans assigned to this agent are shown
  const myAssignedApps = db.applications.filter(a => a.assignedAgent === session.name && a.status === "approved");
  const allApps=myAssignedApps;
  const filtered=allApps.filter(a=>!search||a.customerName.toLowerCase().includes(search.toLowerCase())||a.id.includes(search));
  const approved=allApps.filter(a=>a.status==="approved");

  // Helper functions for assignment stats
  const parseDate = (dateStr: string) => {
    const [d, m, y] = dateStr.split("/").map(Number);
    return new Date(y, m - 1, d);
  };
  const getWeekRangeString = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    const sunday = new Date(d.setDate(diff + 6));
    const format = (dt: Date) => dt.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
    return `${format(monday)} - ${format(sunday)}`;
  };
  const getMonthYearString = (date: Date) => {
    return date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  };

  const monthlyStats: Record<string, number> = {};
  const weeklyStats: Record<string, number> = {};

  myAssignedApps.forEach(app => {
    if (!app.createdAt) return;
    try {
      const date = parseDate(app.createdAt);
      if (isNaN(date.getTime())) return;
      
      const monthKey = getMonthYearString(date);
      monthlyStats[monthKey] = (monthlyStats[monthKey] || 0) + 1;

      const weekKey = getWeekRangeString(date);
      weeklyStats[weekKey] = (weeklyStats[weekKey] || 0) + 1;
    } catch {}
  });
  return (
    <div className="flex flex-col h-full" style={{ background:BG }}>
      <div className="px-5 pt-5 pb-16 shrink-0" style={{ background:"#1A1A2E" }}>
        <div className="flex justify-between items-center mb-5">
          <div><p className="text-[10px] font-bold uppercase tracking-widest" style={{ color:Y }}>Field Agent</p><h1 className="text-2xl font-black text-white">{session.name}</h1></div>
          <div className="flex gap-2">
            <button onClick={()=>navigate("notifications")} className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background:"rgba(255,255,255,0.12)" }}><Bell size={16} color="#fff"/></button>
            <button onClick={async()=>{ if(!confirm("Delete your agent account? This cannot be undone.")) return; setDeleting(true); try { await api('/auth/account',{method:'DELETE'}); toast.success("Account deleted"); navigate("splash"); } catch(e:any){ toast.error(e.message||"Failed"); } setDeleting(false); }} disabled={deleting} className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background:"rgba(220,38,38,0.25)" }}><Trash2 size={16} color="#FF6B6B"/></button>
            <button onClick={()=>navigate("splash")} className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background:"rgba(255,255,255,0.12)" }}><LogOut size={16} color="#fff"/></button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {[["Applications",allApps.length],["Visited",db.agentLogs.filter(l=>l.action==="visited").length+Object.values(visited).filter(Boolean).length],["Collected",db.agentLogs.filter(l=>l.action==="collected").length+Object.values(collected).filter(Boolean).length]].map(([k,v])=>(
            <div key={k} className="rounded-2xl p-2.5 sm:p-3 text-center min-w-0" style={{ background:"rgba(255,255,255,0.08)" }}><p className="text-xl sm:text-2xl font-black text-white">{v}</p><p className="text-[8px] sm:text-[9px] font-semibold truncate" style={{ color:"rgba(255,255,255,0.55)" }}>{k}</p></div>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto -mt-8 rounded-t-[32px] px-4 sm:px-5 pt-6 pb-8 bg-white">
        <div className="max-w-2xl mx-auto">
          <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-5">
            {[{l:"Visit\nReports",Icon:Users,fn:()=>setTab("visits")},{l:"EMI\nCollection",Icon:Wallet,fn:()=>setTab("collection")},{l:"Apply\nLoan",Icon:Plus,fn:()=>navigate("loan-apply")}].map(a=>(
              <button key={a.l} onClick={a.fn} className="flex flex-col items-center gap-1.5 p-3 sm:p-4 rounded-2xl border-2 active:scale-[0.97] transition-transform min-w-0" style={{ borderColor:Y, background:YBG }}>
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl flex items-center justify-center shrink-0" style={{ background:Y }}><a.Icon size={16} color={TEXT}/></div>
                <span className="text-[9px] sm:text-[10px] font-bold text-center leading-tight whitespace-pre-line" style={{ color:TEXT }}>{a.l}</span>
              </button>
            ))}
          </div>

          {/* Assignment Analytics */}
          <div className="bg-white rounded-3xl p-5 border-2 mb-5" style={{ borderColor: BORD }}>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: MUTED }}>Assignment Analytics</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-[9px] font-semibold mb-2" style={{ color: MUTED }}>Weekly View</p>
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {Object.keys(weeklyStats).length === 0 ? (
                    <p className="text-xs italic" style={{ color: MUTED }}>No customer assignments this week</p>
                  ) : (
                    Object.entries(weeklyStats).map(([week, count]) => (
                      <div key={week} className="flex justify-between items-center p-2.5 rounded-xl border" style={{ borderColor: BORD, background: "#FCFCFD" }}>
                        <span className="text-xs font-semibold" style={{ color: TEXT }}>{week}</span>
                        <span className="text-xs font-black px-2 py-0.5 rounded-full" style={{ background: Y, color: TEXT }}>{count}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div>
                <p className="text-[9px] font-semibold mb-2" style={{ color: MUTED }}>Monthly View</p>
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {Object.keys(monthlyStats).length === 0 ? (
                    <p className="text-xs italic" style={{ color: MUTED }}>No customer assignments this month</p>
                  ) : (
                    Object.entries(monthlyStats).map(([month, count]) => (
                      <div key={month} className="flex justify-between items-center p-2.5 rounded-xl border" style={{ borderColor: BORD, background: "#FCFCFD" }}>
                        <span className="text-xs font-semibold" style={{ color: TEXT }}>{month}</span>
                        <span className="text-xs font-black px-2 py-0.5 rounded-full" style={{ background: Y, color: TEXT }}>{count}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex p-1 rounded-2xl mb-5 border" style={{ borderColor:BORD }}>
            {(["visits","collection"] as const).map(t=>(
              <button key={t} onClick={()=>setTab(t)} className="flex-1 py-2.5 rounded-xl text-xs font-bold capitalize transition-all" style={{ background:tab===t?TEXT:"transparent", color:tab===t?Y:MUTED }}>
                {t==="visits"?"Customer Visits":"EMI Collection"}
              </button>
            ))}
          </div>
          {tab==="visits"&&(<>
            <div className="flex items-center gap-2 border-2 rounded-2xl px-3 py-2.5 mb-4" style={{ borderColor:BORD }}>
              <Search size={14} color={MUTED}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" className="flex-1 text-xs bg-transparent outline-none" style={{ color:TEXT }}/>
              {search&&<button onClick={()=>setSearch("")} style={{ color:MUTED }}><X size={12}/></button>}
            </div>
            {filtered.length===0&&<p className="text-center py-8 text-sm" style={{ color:MUTED }}>{allApps.length===0?"No applications yet. New customer registrations appear here.":"No results"}</p>}
            <div className="space-y-4">
              {filtered.map(app=>(
                <div key={app.id} className="rounded-3xl p-5 border-2" style={{ background:CARD, borderColor:BORD }}>
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="flex items-center gap-2"><p className="font-bold" style={{ color:TEXT }}>{app.customerName}</p>{visited[app.id]&&<span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background:"rgba(22,163,74,0.1)", color:OK }}>Visited ✓</span>}</div>
                      <p className="text-[10px] font-mono" style={{ color:MUTED }}>{app.id}</p>
                    </div>
                    <Chip status={app.status}/>
                  </div>
                  <div className="grid grid-cols-3 gap-2 p-3 rounded-2xl mb-4" style={{ background:YBG }}>
                    {[["Amount",fmt(app.amount)],["Daily EMI",fmt(app.dailyEMI)],["Plan",`${app.tenure}d`]].map(([k,v])=>(
                      <div key={k} className="text-center"><p className="text-[9px] font-semibold" style={{ color:MUTED }}>{k}</p><p className="text-sm font-bold mt-0.5" style={{ color:TEXT }}>{v}</p></div>
                    ))}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={()=>{ api('/agent/log',{method:'POST',body:JSON.stringify({application_number:app.id,action:'visited'})}).then(()=>{ setVisited(v=>({...v,[app.id]:true})); setDB(d=>({...d,agentLogs:[...d.agentLogs,{agentId:session.userId,appId:app.id,action:"visited",time:new Date().toLocaleString()}]})); toast.success("Visit marked"); }).catch((e:any)=>toast.error(e.message)); }}
                      className="px-3 py-2 rounded-xl text-[11px] font-bold active:opacity-85 whitespace-nowrap" style={{ background:visited[app.id]?"rgba(22,163,74,0.1)":YBG, color:visited[app.id]?OK:Y2 }}>
                      {visited[app.id]?"✓ Visited":"Mark Visited"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>)}
          {tab==="collection"&&(
            <div className="space-y-4">
              {approved.length===0&&<p className="text-center py-8 text-sm" style={{ color:MUTED }}>No approved loans yet</p>}
              {approved.map(app=>(
                <div key={app.id} className="rounded-3xl p-5 border-2" style={{ background:CARD, borderColor:BORD }}>
                  <div className="flex justify-between items-start mb-3">
                    <div><p className="font-bold" style={{ color:TEXT }}>{app.customerName}</p><p className="text-[10px] font-mono" style={{ color:MUTED }}>{app.id}</p></div>
                    {collected[app.id]?<span className="px-2.5 py-1 rounded-full text-[10px] font-bold" style={{ background:"rgba(22,163,74,0.1)", color:OK }}>Collected ✓</span>:<span className="px-2.5 py-1 rounded-full text-[10px] font-bold" style={{ background:YBG, color:Y2 }}>Pending</span>}
                  </div>
                  <div className="flex items-center gap-3 sm:gap-4 pt-3 border-t flex-wrap" style={{ borderColor:BORD }}>
                    <div className="flex-1 min-w-0"><p className="text-[9px] font-semibold" style={{ color:MUTED }}>Daily EMI Due</p><p className="text-xl sm:text-2xl font-black" style={{ color:TEXT }}>{fmt(app.dailyEMI)}</p></div>
                    {!collected[app.id]&&!collecting[app.id]&&(
                      <label className="px-4 sm:px-5 py-2.5 sm:py-3 rounded-2xl text-xs sm:text-sm font-bold text-white active:opacity-85 whitespace-nowrap cursor-pointer flex items-center gap-1.5" style={{ background:OK }}>
                        <Upload size={14}/> Collect & Upload Receipt
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e=>{if(e.target.files?.[0])handleCollect(app.id,e.target.files[0]);e.target.value='';}}/>
                      </label>
                    )}
                    {collecting[app.id]&&<div className="px-4 py-2.5 rounded-2xl text-xs font-bold text-white flex items-center gap-2" style={{ background:"#6B7280" }}><RefreshCw className="animate-spin" size={14}/> Collecting...</div>}
                    {collected[app.id]&&<button onClick={()=>toast.success("Receipt uploaded")} className="px-3 sm:px-4 py-2 sm:py-2.5 rounded-2xl text-[11px] sm:text-xs font-bold flex items-center gap-1 whitespace-nowrap" style={{ background:YBG, color:Y2 }}><Check size={11}/> Uploaded</button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ADMIN LOGIN ──────────────────────────────────────────────
function AdminLoginScreen({ navigate, setSession, setDB }:GP) {
  const [email,setEmail]=useState(""); const [pw,setPw]=useState(""); const [show,setShow]=useState(false); const [err,setErr]=useState(""); const [loading,setLoading]=useState(false);
  async function go(){
    setErr("");
    if(!email||!pw){setErr("Enter email and password");return;}
    setLoading(true);
    try {
      const { user } = await api('/auth/login', { method:'POST', body:JSON.stringify({ email, password:pw }) });
      if(user.role!=='admin'){api('/auth/logout',{method:'POST'}).catch(()=>{});setErr("Not an admin account");setLoading(false);return;}
      setSession({role:"admin",userId:String(user.id),name:user.name});
      const data = await api('/data');
      setDB((d: DB)=>({...d,...data}));
      navigate("admin-dashboard"); toast.success("Welcome, Admin!");
    } catch(e:any){ setErr(e.message||"Invalid credentials"); }
    setLoading(false);
  }
  return (
    <div className="flex flex-col sm:flex-row min-h-screen" style={{ background:BG }}>
      <div className="hidden sm:flex sm:w-[280px] shrink-0 flex-col justify-center items-start px-10" style={{ background:Y }}>
        <LFLogo size={52}/><h2 className="text-3xl font-black mt-5 mb-2" style={{ color:TEXT }}>Admin Panel</h2>
        <p style={{ color:Y2 }} className="text-sm">Manage loans, customers and agents.</p>
      </div>
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 py-12 max-w-md mx-auto w-full">
        <div className="sm:hidden mb-8 flex items-center gap-3"><LFLogo size={40}/><div><p className="text-xl font-bold" style={{ color:TEXT }}>Admin Login</p></div></div>
        <p className="text-sm mb-7" style={{ color:MUTED }}>Sign in with your admin credentials</p>
        <div className="space-y-4 mb-5">
          <F label="Admin ID"><input type="text" value={email} onChange={e=>setEmail(e.target.value)} placeholder="laxmifinance_admin" className={inp} style={iSt}/></F>
          <F label="Password">
            <div className="flex items-center border-2 rounded-2xl" style={{ borderColor:BORD }}>
              <input type={show?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)} placeholder="Password" className="flex-1 px-4 py-3.5 text-sm bg-transparent outline-none placeholder-gray-400" style={{ color:TEXT }}/>
              <button onClick={()=>setShow(!show)} className="px-4" style={{ color:"#9CA3AF" }}>{show?<EyeOff size={16}/>:<Eye size={16}/>}</button>
            </div>
          </F>
          {err&&<p className="text-xs font-semibold" style={{ color:ERR }}>{err}</p>}
        </div>
        <button onClick={go} disabled={loading} className="w-full py-4 rounded-2xl font-bold text-sm mb-3 flex items-center justify-center gap-2 transition-all active:scale-[0.98]" style={{ background:Y, color:TEXT, opacity:loading?0.7:1 }}>
          {loading?<><div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin"/>Signing in…</>:"Sign In →"}
        </button>
        <button onClick={()=>navigate("splash")} className="w-full py-2 text-center text-xs" style={{ color:MUTED }}>← Back to main</button>
      </div>
    </div>
  );
}

// ─── ADMIN: Full Application Detail Modal ─────────────────────
function AppDetailModal({ app, agents, db, onClose, onApprove, onReject, onAssign, onCancel, onDelete, approving }:{
  app:LoanApp; agents:AgentUser[]; db:DB;
  onClose:()=>void; onApprove:()=>void; onReject:()=>void; onAssign:(a:string)=>void;
  onCancel?:()=>void; onDelete?:()=>void; approving?:boolean;
}) {
  const logs = db.agentLogs.filter(l=>l.appId===app.id);
  const [selectedAgent,setSelectedAgent] = useState(app.assignedAgent||"");
  const docs = app.documents||{};
  const docLabels: Record<string,string> = { photo:"Applicant Photo", aadhaar:"Aadhaar Card", pan:"PAN Card", shopPhoto:"Shop / Business Photo", biz:"Business Proof", coPhoto:"Co-Borrower Photo", other:"Other Document" };
  const photoUrl = docs.photo || app.customerPhoto || "";

  return (
    <div className="absolute inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background:"rgba(0,0,0,0.5)" }}>
      <div className="w-full sm:max-w-xl h-[94%] sm:max-h-[90vh] rounded-t-[32px] sm:rounded-3xl flex flex-col shadow-2xl overflow-hidden" style={{ background:CARD }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b shrink-0" style={{ background:"#1A1A2E", borderColor:"rgba(255,255,255,0.08)" }}>
          <div className="min-w-0 flex-1"><p className="text-[9px] font-bold uppercase tracking-widest" style={{ color:Y }}>Application Review</p><p className="font-black text-xs sm:text-sm text-white truncate" style={{ fontFamily:"monospace" }}>{app.id}</p></div>
          <div className="flex gap-2">
            <button onClick={()=>printApplication(app)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold active:opacity-85" style={{ background:"rgba(255,255,255,0.12)", color:"#fff" }}>
              <Printer size={13}/> Print
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background:"rgba(255,255,255,0.12)" }}><X size={16} color="#fff"/></button>
          </div>
        </div>
        {/* Status bar */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0" style={{ borderColor:BORD }}>
          <Chip status={app.status}/>
          <div className="flex gap-2">
            {app.status==="pending"&&(
              <>
                <button onClick={onApprove} disabled={approving} className="px-4 py-2 rounded-xl text-xs font-bold text-white active:opacity-85 flex items-center gap-1.5" style={{ background:OK, opacity:approving?0.7:1 }}>
                  {approving ? <><RefreshCw size={12} className="animate-spin"/> Approving...</> : <>✓ Approve</>}
                </button>
                <button onClick={onReject} disabled={approving} className="px-4 py-2 rounded-xl text-xs font-bold text-white active:opacity-85" style={{ background:ERR, opacity:approving?0.7:1 }}>✕ Reject</button>
              </>
            )}
            {app.status==="approved"&&onCancel&&(
              <button onClick={onCancel} className="px-4 py-2 rounded-xl text-xs font-bold text-white active:opacity-85" style={{ background:WARN }}>Cancel Loan</button>
            )}
            {onDelete&&(
              <button onClick={onDelete} className="px-3 py-2 rounded-xl text-xs font-bold active:opacity-85" style={{ background:"rgba(220,38,38,0.1)", color:ERR }}><Trash2 size={13}/></button>
            )}
          </div>
        </div>
        {/* Scrollable content — Resume style */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Profile header with photo */}
          <div className="flex items-start gap-4 p-4 rounded-3xl" style={{ background:YBG, border:`2px solid ${Y}` }}>
            {photoUrl ? (
              <img src={photoUrl} alt="Customer" className="w-20 h-20 rounded-2xl object-cover border-2 shrink-0" style={{ borderColor:Y }}/>
            ) : (
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-black shrink-0" style={{ background:Y, color:TEXT }}>
                {app.customerName.split(" ").map(n=>n[0]).slice(0,2).join("").toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-black truncate" style={{ color:TEXT }}>{app.customerName}</h3>
              <p className="text-sm" style={{ color:Y2 }}>+91 {app.customerPhone}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background:TEXT, color:Y }}>{app.loanType}</span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold" style={{ background:TEXT, color:"#fff" }}>{app.tenure} Days</span>
              </div>
            </div>
          </div>

          {/* Loan summary */}
          <div className="rounded-3xl p-4 sm:p-5" style={{ background:TEXT }}>
            <p className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color:"rgba(255,255,255,0.45)" }}>Loan Summary</p>
            <p className="text-2xl sm:text-3xl font-black mb-2" style={{ color:Y }}>{fmt(app.amount)}</p>
            <div className="flex gap-3 sm:gap-4 flex-wrap">
              {[["Daily EMI",fmt(app.dailyEMI)],["Plan",`${app.tenure} days`],["Total",fmt(app.totalPayable)],["Interest",fmt(app.totalPayable-app.amount)]].map(([k,v])=>(
                <div key={k}><p className="text-[9px]" style={{ color:"rgba(255,255,255,0.4)" }}>{k}</p><p className="text-xs font-bold text-white">{v}</p></div>
              ))}
            </div>
          </div>

          {/* Applicant Details — resume grid */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest mb-3" style={{ color:MUTED }}>Applicant Details</p>
            <div className="grid grid-cols-2 gap-2">
              {[["Full Name",app.customerName],["Mobile",`+91 ${app.customerPhone}`],["Aadhaar Card",app.aadhaar||"—"],["PAN Card",app.pan||"—"],["City",app.city],["Monthly Income",fmt(app.income||0)],["Purpose",app.purpose],["Applied On",app.createdAt]].map(([k,v])=>(
                <div key={k} className="p-3 rounded-2xl" style={{ background:BG }}><p className="text-[9px] font-semibold" style={{ color:MUTED }}>{k}</p><p className="text-sm font-bold mt-0.5 truncate" style={{ color:TEXT }}>{v}</p></div>
              ))}
              <div className="p-3 rounded-2xl col-span-2" style={{ background:BG }}><p className="text-[9px] font-semibold" style={{ color:MUTED }}>Address</p><p className="text-sm font-bold mt-0.5" style={{ color:TEXT }}>{app.address||"—"}</p></div>
            </div>
          </div>

          {/* Co-Borrower */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest mb-3" style={{ color:MUTED }}>Co-Borrower Details</p>
            <div className="grid grid-cols-2 gap-2">
              {[["Name",app.coBorrowerName||"—"],["Mobile",`+91 ${app.coBorrowerPhone||"—"}`],["Relationship",app.coBorrowerRelation||"—"],["Address",app.coBorrowerAddress||"—"]].map(([k,v])=>(
                <div key={k} className="p-3 rounded-2xl" style={{ background:BG }}><p className="text-[9px] font-semibold" style={{ color:MUTED }}>{k}</p><p className="text-sm font-bold mt-0.5" style={{ color:TEXT }}>{v}</p></div>
              ))}
            </div>
          </div>

          {/* Uploaded Documents */}
          {Object.keys(docs).length>0 && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest mb-3" style={{ color:MUTED }}>Uploaded Documents</p>
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(docs).map(([key,url])=>(
                  <div key={key} onClick={() => {
                    if (!url) return;
                    const html = `<!DOCTYPE html><html><head><title>${docLabels[key] || key}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column}img{max-width:100%;max-height:90vh;object-fit:contain;border-radius:8px}p{color:#aaa;margin-top:12px;font-family:sans-serif;font-size:13px}</style></head><body><img src="${url}" /><p>${docLabels[key] || key}</p></body></html>`;
                    const w = window.open('', '_blank');
                    if (w) {
                      w.document.write(html);
                      w.document.close();
                    } else {
                      toast.error("Allow popups to view document");
                    }
                  }} className="block rounded-2xl overflow-hidden border-2 hover:shadow-lg transition-shadow cursor-pointer animate-fadeIn" style={{ borderColor:BORD }}>
                    <div className="h-28 bg-gray-100 flex items-center justify-center overflow-hidden">
                      <img src={url as string} alt={docLabels[key]||key} className="w-full h-full object-cover" onError={e=>{(e.target as HTMLImageElement).style.display='none';(e.target as HTMLImageElement).parentElement!.innerHTML=`<div class="flex flex-col items-center gap-1"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${MUTED}" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg><span style="font-size:10px;color:${MUTED}">View File</span></div>`;}}/>
                    </div>
                    <div className="px-3 py-2" style={{ background:YBG }}>
                      <p className="text-[10px] font-bold truncate" style={{ color:TEXT }}>{docLabels[key]||key}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Assign Agent */}
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest mb-3" style={{ color:MUTED }}>Assign Field Agent</p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <select value={selectedAgent} onChange={e=>setSelectedAgent(e.target.value)} className="w-full px-4 py-3 border-2 rounded-2xl text-sm outline-none appearance-none" style={{ borderColor:BORD, color:TEXT }}>
                  <option value="">Select agent…</option>
                  {agents.map(a=><option key={a.id} value={a.name}>{a.name} · {a.zone}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" color={MUTED}/>
              </div>
              <button onClick={()=>{ if(selectedAgent){ onAssign(selectedAgent); toast.success(`Assigned to ${selectedAgent}`); }}} className="px-4 py-3 rounded-2xl text-sm font-bold" style={{ background:Y, color:TEXT }}>Assign</button>
            </div>
            {app.assignedAgent&&<p className="text-xs mt-2" style={{ color:MUTED }}>Currently: <strong style={{ color:TEXT }}>{app.assignedAgent}</strong></p>}
          </div>

          {/* Agent Activity */}
          {logs.length>0&&(
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest mb-3" style={{ color:MUTED }}>Agent Activity Log</p>
              <div className="space-y-2">
                {logs.map((l,i)=>(
                  <div key={i} className="flex items-center gap-3 p-3 rounded-2xl" style={{ background:BG }}>
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background:l.action==="collected"?OK:Y }}>
                      {l.action==="collected"?<Check size={14} color="white"/>:<Users size={14} color={TEXT}/>}
                    </div>
                    <div className="flex-1"><p className="text-xs font-bold" style={{ color:TEXT }}>{l.action==="visited"?"Visit Completed":"EMI Collected"}</p><p className="text-[10px]" style={{ color:MUTED }}>{l.time}</p></div>
                    {l.receipt && (
                      <a href={l.receipt} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 rounded-full text-[10px] font-bold flex items-center gap-1 shrink-0" style={{ background:CARD, color:TEXT, border:`1px solid ${BORD}` }}>
                        <Search size={10}/> Receipt
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ADMIN DASHBOARD ──────────────────────────────────────────
function AdminDashboardScreen({ navigate, session, db, setDB }:GP) {
  const [tab,setTab]=useState<"overview"|"applications"|"customers"|"agents"|"dues">("overview");
  const [search,setSearch]=useState("");
  const [viewApp,setViewApp]=useState<LoanApp|null>(null);
  const [approving,setApproving]=useState(false);
  const [dues,setDues]=useState<{id:string;customerName:string;customerPhone:string;dailyEMI:number;dueCount:number;dueAmount:number;assignedAgent:string}[]>([]);
  const apps=db.applications; const custs=db.customers;
  const pending=apps.filter(a=>a.status==="pending");
  const approved=apps.filter(a=>a.status==="approved");
  const rejected=apps.filter(a=>a.status==="rejected");
  const cancelled=apps.filter(a=>a.status==="cancelled");
  const filtered=apps.filter(a=>!search||a.customerName.toLowerCase().includes(search.toLowerCase())||a.id.includes(search));
  
  function approve(id:string){ 
    setApproving(true);
    api(`/loans/${id}/status`,{method:'PUT',body:JSON.stringify({status:'approved'})})
      .then(({loan,customer_token})=>{ setDB(d=>({...d,applications:d.applications.map(a=>a.id===id?loan:a),customers:customer_token?d.customers.map(c=>c.id===loan.customerId?{...c,token:customer_token}:c):d.customers})); setViewApp(null); toast.success("Loan approved!"); setApproving(false); })
      .catch((e:any)=>{ toast.error(e.message); setApproving(false); }); 
  }
  function reject(id:string){ api(`/loans/${id}/status`,{method:'PUT',body:JSON.stringify({status:'rejected'})}).then(({loan})=>{ setDB(d=>({...d,applications:d.applications.map(a=>a.id===id?loan:a)})); setViewApp(null); toast.error("Application rejected"); }).catch((e:any)=>toast.error(e.message)); }
  function cancel(id:string){ if(!confirm("Cancel this approved loan?")) return; api(`/loans/${id}/status`,{method:'PUT',body:JSON.stringify({status:'cancelled'})}).then(({loan})=>{ setDB(d=>({...d,applications:d.applications.map(a=>a.id===id?loan:a)})); setViewApp(null); toast.success("Loan cancelled"); }).catch((e:any)=>toast.error(e.message)); }
  function deleteLoan(id:string){ if(!confirm("Permanently delete this application? This cannot be undone.")) return; api(`/loans/${id}`,{method:'DELETE'}).then(()=>{ setDB(d=>({...d,applications:d.applications.filter(a=>a.id!==id)})); setViewApp(null); toast.success("Application deleted"); }).catch((e:any)=>toast.error(e.message)); }
  function clearAllLogs(){ if(!confirm("Clear all agent activity and collection logs?")) return; api(`/admin/logs`,{method:'DELETE'}).then(()=>{ setDB(d=>({...d,agentLogs:[]})); toast.success("All logs cleared!"); }).catch((e:any)=>toast.error(e.message)); }
  function assignAgent(id:string,agentName:string){ api(`/loans/${id}/assign`,{method:'PUT',body:JSON.stringify({agent_name:agentName})}).then(({loan})=>{ setDB(d=>({...d,applications:d.applications.map(a=>a.id===id?loan:a)})); setViewApp(loan); }).catch((e:any)=>toast.error(e.message)); }
  function loadDues(){ api('/emi-dues').then(d=>setDues(d.dues||[])).catch(()=>{}); }
  useEffect(()=>{ if(tab==="dues") loadDues(); },[tab]);
  function exportCSV(){
    const rows=[["ID","Customer","Phone","Type","Amount","Tenure","Daily EMI","Total","Status","Agent","Date"],...apps.map(a=>[a.id,a.customerName,a.customerPhone,a.loanType,a.amount,a.tenure,a.dailyEMI,a.totalPayable,a.status,a.assignedAgent||"—",a.createdAt])];
    const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob=new Blob([csv],{type:"text/csv"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=`laxmi-finance-applications-${new Date().toISOString().split("T")[0]}.csv`; a.click();
    URL.revokeObjectURL(url); toast.success("CSV exported!");
  }
  function exportPDFReport(){
    const today=new Date().toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"});
    const htmlContent = `<!DOCTYPE html><html><head><title>Portfolio Report</title><style>
      *{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;padding:32px;color:#111;font-size:12px}
      .hdr{text-align:center;margin-bottom:20px;padding-bottom:12px;border-bottom:3px solid #F5C518}
      .logo{font-size:20px;font-weight:800}table{width:100%;border-collapse:collapse;margin:16px 0}
      th,td{border:1px solid #E5E7EB;padding:6px 8px;text-align:left;font-size:11px}
      th{background:#F9FAFB;font-weight:700;font-size:10px;text-transform:uppercase}
      .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}
      .stat{padding:12px;border:1px solid #E5E7EB;border-radius:8px;text-align:center}
      .stat .v{font-size:22px;font-weight:800}.stat .l{font-size:10px;color:#6B7280}
      .footer{margin-top:24px;text-align:center;font-size:10px;color:#9CA3AF;border-top:1px solid #E5E7EB;padding-top:12px}
      @media print{body{padding:16px}}
    </style></head><body>
    <div class="hdr"><div class="logo">🏛 Laxmi Finance Ltd.</div><p style="font-size:14px;font-weight:700;margin-top:4px">Portfolio Report — ${today}</p></div>
    <div class="summary">
      <div class="stat"><div class="v">${pending.length}</div><div class="l">Pending</div></div>
      <div class="stat"><div class="v">${approved.length}</div><div class="l">Approved</div></div>
      <div class="stat"><div class="v">${rejected.length}</div><div class="l">Rejected</div></div>
      <div class="stat"><div class="v">${custs.length}</div><div class="l">Customers</div></div>
    </div>
    <p style="margin:8px 0;font-weight:700">Total Disbursed: ₹${approved.reduce((s,a)=>s+a.amount,0).toLocaleString("en-IN")} · Total Receivable: ₹${approved.reduce((s,a)=>s+a.totalPayable,0).toLocaleString("en-IN")}</p>
    <table><tr><th>ID</th><th>Customer</th><th>Phone</th><th>Type</th><th>Amount</th><th>EMI/day</th><th>Total</th><th>Status</th><th>Agent</th><th>Date</th></tr>
    ${apps.map(a=>`<tr><td>${esc(a.id)}</td><td>${esc(a.customerName)}</td><td>${esc(a.customerPhone)}</td><td>${esc(a.loanType)}</td><td>₹${(a.amount||0).toLocaleString("en-IN")}</td><td>₹${(a.dailyEMI||0).toLocaleString("en-IN")}</td><td>₹${(a.totalPayable||0).toLocaleString("en-IN")}</td><td>${esc(a.status)}</td><td>${esc(a.assignedAgent||"—")}</td><td>${esc(a.createdAt)}</td></tr>`).join("")}
    </table>
    <div class="footer">Generated: ${new Date().toLocaleString("en-IN")} · Laxmi Finance Ltd. · Confidential</div>
    <script>window.onload=()=>setTimeout(()=>window.print(),500)</script>
    </body></html>`;
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(htmlContent);
      w.document.close();
    } else {
      toast.error("Allow popups");
    }
  }

  return (
    <div className="flex flex-col h-full relative" style={{ background:BG }}>
      {viewApp&&<AppDetailModal app={viewApp} agents={db.agents} db={db} onClose={()=>setViewApp(null)} onApprove={()=>approve(viewApp.id)} onReject={()=>reject(viewApp.id)} onAssign={(a)=>assignAgent(viewApp.id,a)} onCancel={()=>cancel(viewApp.id)} onDelete={()=>deleteLoan(viewApp.id)}/>}

      <div className="px-5 pt-5 pb-5 shrink-0" style={{ background:"#1A1A2E" }}>
        <div className="flex justify-between items-start mb-5">
          <div><p className="text-[9px] font-bold uppercase tracking-widest" style={{ color:Y }}>Laxmi Finance</p><h1 className="text-2xl font-black text-white">Admin Dashboard</h1></div>
          <div className="flex gap-2">
            <button onClick={()=>setTab("dues")} className="w-10 h-10 rounded-full flex items-center justify-center relative" style={{ background:"rgba(255,255,255,0.12)" }}>
              <Bell size={16} color="#fff"/>{dues.length>0&&<span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full border-2 border-[#1A1A2E]" style={{ background:ERR }}/>}
            </button>
            <button onClick={()=>navigate("splash")} className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background:"rgba(255,255,255,0.12)" }}><LogOut size={16} color="#fff"/></button>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {(["overview","applications","customers","agents","dues"] as const).map(t=>(
            <button key={t} onClick={()=>setTab(t)} className="px-3 sm:px-4 py-2 rounded-full text-[11px] sm:text-xs font-bold capitalize whitespace-nowrap transition-all shrink-0"
              style={{ background:tab===t?Y:"rgba(255,255,255,0.1)", color:tab===t?TEXT:"rgba(255,255,255,0.6)" }}>{t==="dues"?"EMI Dues":t}</button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto -mt-2 rounded-t-[28px] px-4 sm:px-5 pt-6 pb-8 bg-white">
        <div className="max-w-2xl mx-auto space-y-4">

          {tab==="overview"&&(<>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              {[{l:"Pending",v:pending.length,c:AMBER},{l:"Approved",v:approved.length,c:OK},{l:"Rejected",v:rejected.length,c:ERR},{l:"Customers",v:custs.length,c:INDIGO}].map(s=>(
                <div key={s.l} className="rounded-3xl p-4 sm:p-5 border-2" style={{ background:CARD, borderColor:BORD }}>
                  <p className="text-3xl sm:text-4xl font-black mb-1" style={{ color:s.c }}>{s.v}</p>
                  <p className="text-xs sm:text-sm font-bold" style={{ color:TEXT }}>{s.l}</p>
                  <div className="w-10 h-1.5 rounded-full mt-2" style={{ background:s.c }}/>
                </div>
              ))}
            </div>
            <div className="rounded-3xl p-5 border" style={{ background:CARD, borderColor:BORD }}>
              <p className="font-bold mb-4" style={{ color:TEXT }}>Applications Overview</p>
              <div style={{ height:130 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[{m:"Current",approved:approved.length,pending:pending.length,rejected:rejected.length,cancelled:cancelled.length}]} barSize={24}>
                    <XAxis dataKey="m" tick={{ fontSize:11, fill:MUTED }} axisLine={false} tickLine={false}/>
                    <YAxis hide/>
                    <Tooltip contentStyle={{ fontSize:11, background:TEXT, border:"none", borderRadius:12, color:"white" }} cursor={{ fill:`${Y}20` }}/>
                    <Bar key="approved" dataKey="approved" fill={OK}  name="Approved" radius={[4,4,0,0]}/>
                    <Bar key="pending"  dataKey="pending"  fill={Y}   name="Pending"  radius={[4,4,0,0]}/>
                    <Bar key="rejected" dataKey="rejected" fill={ERR} name="Rejected" radius={[4,4,0,0]}/>
                    <Bar key="cancelled" dataKey="cancelled" fill={MUTED} name="Cancelled" radius={[4,4,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-3xl p-5 border" style={{ background:CARD, borderColor:BORD }}>
              <p className="font-bold mb-3" style={{ color:TEXT }}>Portfolio Summary</p>
              {[["Total Disbursed",fmt(approved.reduce((s,a)=>s+a.amount,0))],["Total Receivable",fmt(approved.reduce((s,a)=>s+a.totalPayable,0))],["Pending Applications",pending.length],["Registered Customers",custs.length]].map(([k,v])=>(
                <div key={k} className="flex justify-between py-2.5 border-b last:border-0" style={{ borderColor:BORD }}><span className="text-sm" style={{ color:MUTED }}>{k}</span><span className="text-sm font-bold" style={{ color:TEXT }}>{v}</span></div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[{l:"Export CSV",fn:exportCSV},{l:"PDF Report",fn:exportPDFReport},{l:"Agreement",fn:()=>{const a=approved[0]; if(a) printLoanAgreement(a); else toast.error("No approved loans");}}].map(a=>(
                <button key={a.l} onClick={a.fn} className="p-3 sm:p-4 rounded-2xl border-2 text-center active:opacity-85 min-w-0" style={{ borderColor:Y, background:YBG }}>
                  <Download size={18} color={Y2} className="mx-auto mb-1.5"/>
                  <span className="text-[9px] sm:text-[10px] font-bold truncate block" style={{ color:TEXT }}>{a.l}</span>
                </button>
              ))}
            </div>
          </>)}

          {tab==="applications"&&(
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-2 rounded-2xl px-3 py-2.5" style={{ borderColor:BORD }}>
                <Search size={14} color={MUTED}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by name or application ID…" className="flex-1 text-xs bg-transparent outline-none" style={{ color:TEXT }}/>
                {search&&<button onClick={()=>setSearch("")} style={{ color:MUTED }}><X size={12}/></button>}
              </div>
              {filtered.length===0&&<div className="text-center py-10"><FileText size={40} color={BORD} className="mx-auto mb-3"/><p className="text-sm" style={{ color:MUTED }}>{apps.length===0?"No applications yet. Customers need to register and apply.":"No results for \""+search+"\""}</p></div>}
              {filtered.map(app=>(
                <div key={app.id} className="rounded-3xl p-5 border-2 cursor-pointer transition-colors hover:border-yellow-400" style={{ background:CARD, borderColor:BORD }} onClick={()=>setViewApp(app)}>
                  <div className="flex justify-between items-start mb-3"><div><p className="font-bold" style={{ color:TEXT }}>{app.customerName}</p><p className="text-[10px] font-mono" style={{ color:MUTED }}>{app.id} · {app.createdAt}</p></div><Chip status={app.status}/></div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-2xl mb-3" style={{ background:YBG }}>
                    {[["Amount",fmt(app.amount)],["EMI",fmt(app.dailyEMI)+"/day"],["Plan",app.tenure+"d"],["Co-Borrower",app.coBorrowerName||"—"]].map(([k,v])=>(
                      <div key={k} className="text-center"><p className="text-[9px] font-semibold" style={{ color:MUTED }}>{k}</p><p className="text-xs font-bold mt-0.5 truncate" style={{ color:TEXT }}>{v}</p></div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs" style={{ color:MUTED }}>Agent: {app.assignedAgent||"Unassigned"}</p>
                    <div className="flex items-center gap-2">
                      <button onClick={e=>{e.stopPropagation();deleteLoan(app.id);}} className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background:"rgba(220,38,38,0.08)" }}><Trash2 size={14} color={ERR}/></button>
                      <button onClick={e=>{e.stopPropagation();setViewApp(app);}} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold" style={{ background:Y, color:TEXT }}>Review Details →</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab==="customers"&&(
            <div className="space-y-4">
              {custs.length===0&&<div className="text-center py-10"><Users size={40} color={BORD} className="mx-auto mb-3"/><p className="text-sm" style={{ color:MUTED }}>No customers registered yet.</p></div>}
              {custs.map(c=>{
                const ca=db.applications.filter(a=>a.customerId===c.id); const last=ca[ca.length-1];
                return (
                  <div key={c.id} className="rounded-3xl p-5 border-2" style={{ background:CARD, borderColor:BORD }}>
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full flex items-center justify-center font-black text-sm shrink-0" style={{ background:Y, color:TEXT }}>{c.name.split(" ").map(n=>n[0]).slice(0,2).join("")}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold" style={{ color:TEXT }}>{c.name}</p>
                        <p className="text-xs" style={{ color:MUTED }}>+91 {c.phone} · Registered {c.createdAt}</p>
                        <p className="text-[10px] font-mono" style={{ color:MUTED }}>{c.token}</p>
                      </div>
                      <div className="text-right shrink-0"><p className="text-sm font-bold" style={{ color:TEXT }}>{ca.length} loan{ca.length!==1?"s":""}</p>{last&&<Chip status={last.status}/>}</div>
                    </div>
                    {ca.length>0&&<div className="mt-4 pt-4 border-t grid grid-cols-3 gap-2" style={{ borderColor:BORD }}>
                      {[["Amount",fmt(ca[ca.length-1].amount)],["Daily EMI",fmt(ca[ca.length-1].dailyEMI)],["Plan",ca[ca.length-1].tenure+"d"]].map(([k,v])=>(
                        <div key={k} className="p-2 rounded-xl text-center" style={{ background:YBG }}><p className="text-[9px] font-semibold" style={{ color:MUTED }}>{k}</p><p className="text-xs font-bold" style={{ color:TEXT }}>{v}</p></div>
                      ))}
                    </div>}
                  </div>
                );
              })}
            </div>
          )}

          {tab==="agents"&&(
            <div className="space-y-4">
              {db.agents.length===0&&<div className="text-center py-10"><Users size={40} color={BORD} className="mx-auto mb-3"/><p className="text-sm" style={{ color:MUTED }}>No agents registered yet.</p></div>}
              {db.agents.map(agent=>{
                const agentApps=db.applications.filter(a=>a.assignedAgent===agent.name);
                const agentLogs=db.agentLogs.filter(l=>l.agentId===agent.id);
                return (
                  <div key={agent.id} className="rounded-3xl p-5 border-2" style={{ background:CARD, borderColor:BORD }}>
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 rounded-full flex items-center justify-center font-black text-sm shrink-0" style={{ background:TEXT, color:Y }}>{agent.name.split(" ").map(n=>n[0]).slice(0,2).join("")}</div>
                      <div><p className="font-bold" style={{ color:TEXT }}>{agent.name}</p><p className="text-xs" style={{ color:MUTED }}>+91 {agent.phone} · {agent.zone}</p><span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:"rgba(22,163,74,0.1)", color:OK }}>● Active</span></div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      {[["Assigned",agentApps.length],["Visits Done",agentLogs.filter(l=>l.action==="visited").length],["EMI Collected",agentLogs.filter(l=>l.action==="collected").length]].map(([k,v])=>(
                        <div key={k} className="rounded-2xl p-3 text-center" style={{ background:YBG }}><p className="text-2xl font-black" style={{ color:TEXT }}>{v}</p><p className="text-[9px] font-semibold" style={{ color:MUTED }}>{k}</p></div>
                      ))}
                    </div>
                    {agentLogs.length>0&&<div className="pt-4 border-t" style={{ borderColor:BORD }}>
                      <p className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color:MUTED }}>Recent Activity</p>
                      {agentLogs.slice(-3).reverse().map((l,i)=>(
                        <div key={i} className="flex items-center gap-2.5 py-1.5">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ background:l.action==="collected"?OK:Y }}/>
                          <p className="text-xs" style={{ color:TEXT }}>{l.action==="collected"?"EMI Collected":"Visit Completed"}</p>
                          <p className="text-[10px] ml-auto" style={{ color:MUTED }}>{l.time}</p>
                        </div>
                      ))}
                    </div>}
                  </div>
                );
              })}
            </div>
          )}

          {tab==="dues"&&(
            <div className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                <p className="font-bold" style={{ color:TEXT }}>Overdue EMIs</p>
                <button onClick={loadDues} className="text-xs font-bold px-3 py-1.5 rounded-xl" style={{ background:Y, color:TEXT }}>Refresh</button>
              </div>
              {dues.length===0&&<div className="text-center py-10"><CheckCircle size={40} color={OK} className="mx-auto mb-3"/><p className="text-sm font-bold" style={{ color:OK }}>All EMIs are up to date!</p><p className="text-xs mt-1" style={{ color:MUTED }}>No overdue payments found.</p></div>}
              {dues.map(d=>(
                <div key={d.id} className="rounded-3xl p-5 border-2" style={{ background:CARD, borderColor:ERR+"30" }}>
                  <div className="flex items-start justify-between mb-3">
                    <div><p className="font-bold" style={{ color:TEXT }}>{d.customerName}</p><p className="text-[10px] font-mono" style={{ color:MUTED }}>{d.id} · +91 {d.customerPhone}</p></div>
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background:"rgba(220,38,38,0.1)", color:ERR }}>{d.dueCount} OVERDUE</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 p-3 rounded-2xl" style={{ background:"rgba(220,38,38,0.04)" }}>
                    <div className="text-center"><p className="text-[9px] font-semibold" style={{ color:MUTED }}>Daily EMI</p><p className="text-xs font-bold" style={{ color:TEXT }}>{fmt(d.dailyEMI)}</p></div>
                    <div className="text-center"><p className="text-[9px] font-semibold" style={{ color:MUTED }}>Due Days</p><p className="text-xs font-bold" style={{ color:ERR }}>{d.dueCount}</p></div>
                    <div className="text-center"><p className="text-[9px] font-semibold" style={{ color:MUTED }}>Due Amount</p><p className="text-xs font-bold" style={{ color:ERR }}>{fmt(d.dueAmount)}</p></div>
                  </div>
                  <p className="text-xs mt-3" style={{ color:MUTED }}>Agent: {d.assignedAgent||"Unassigned"}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ADMIN DATABASE SCREEN ──────────────────────────────────
function AdminDatabaseScreen({ navigate, session }: GP) {
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [columns, setColumns] = useState<{ name: string; type: string }[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api("/admin/db/tables")
      .then(res => {
        setTables(res.tables || []);
        if (res.tables && res.tables.length > 0) {
          setSelectedTable(res.tables[0]);
        }
      })
      .catch(e => toast.error(e.message));
  }, []);

  useEffect(() => {
    if (!selectedTable) return;
    setLoading(true);
    api(`/admin/db/tables/${selectedTable}`)
      .then(res => {
        setColumns(res.columns || []);
        setRows(res.rows || []);
      })
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [selectedTable]);

  // Filter rows based on search
  const filteredRows = rows.filter(row => {
    if (!search) return true;
    return Object.values(row).some(val => 
      String(val).toLowerCase().includes(search.toLowerCase())
    );
  });

  const [editingRow, setEditingRow] = useState<any>(null);
  const [editFormData, setEditFormData] = useState<Record<string, any>>({});

  useEffect(() => {
    if (editingRow) {
      setEditFormData({ ...editingRow });
    } else {
      setEditFormData({});
    }
  }, [editingRow]);

  function handleUpdateRow() {
    if (!editingRow) return;
    setLoading(true);
    api(`/admin/db/tables/${selectedTable}/row`, {
      method: "PUT",
      body: JSON.stringify({
        id: editingRow.id,
        data: editFormData
      })
    })
      .then(() => {
        toast.success("Row updated successfully!");
        setEditingRow(null);
        return api(`/admin/db/tables/${selectedTable}`);
      })
      .then(res => {
        if (res) {
          setColumns(res.columns || []);
          setRows(res.rows || []);
        }
      })
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  }

  function handleDeleteRow(id: any) {
    if (!confirm("Are you sure you want to delete this record? This is permanent!")) return;
    setLoading(true);
    api(`/admin/db/tables/${selectedTable}/row/${id}`, {
      method: "DELETE"
    })
      .then(() => {
        toast.success("Row deleted successfully!");
        return api(`/admin/db/tables/${selectedTable}`);
      })
      .then(res => {
        if (res) {
          setColumns(res.columns || []);
          setRows(res.rows || []);
        }
      })
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <PH title="Database Browser" sub="Live data direct from Supabase PostgreSQL" onBack={() => navigate("admin-dashboard")} />
      
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden p-5 gap-5">
        {/* Table Selector */}
        <div className="w-full md:w-64 shrink-0 flex flex-col bg-white rounded-3xl p-4 border-2 overflow-hidden min-h-0" style={{ borderColor: BORD }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: MUTED }}>Tables</p>
          <div className="flex-1 overflow-y-auto space-y-1 max-h-48 md:max-h-none">
            {tables.map(t => {
              const active = selectedTable === t;
              return (
                <button
                  key={t}
                  onClick={() => setSelectedTable(t)}
                  className="w-full text-left px-4 py-2.5 rounded-xl text-xs font-bold transition-all truncate"
                  style={{
                    background: active ? Y : "transparent",
                    color: active ? TEXT : MUTED
                  }}
                >
                  📁 {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* Table Data View */}
        <div className="flex-1 flex flex-col bg-white rounded-3xl border-2 overflow-hidden" style={{ borderColor: BORD }}>
          <div className="p-4 border-b flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3" style={{ borderColor: BORD }}>
            <div>
              <h2 className="text-sm font-black text-gray-800">Table: {selectedTable || "None Selected"}</h2>
              <p className="text-[10px]" style={{ color: MUTED }}>
                {columns.length} columns · {filteredRows.length} of {rows.length} rows loaded
              </p>
            </div>
            
            {/* Search */}
            <div className="flex items-center gap-2 border-2 rounded-xl px-3 py-1.5 w-full sm:w-64" style={{ borderColor: BORD }}>
              <Search size={12} color={MUTED}/>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search rows..."
                className="flex-1 text-xs bg-transparent outline-none"
                style={{ color: TEXT }}
              />
              {search && <button onClick={() => setSearch("")} style={{ color: MUTED }}><X size={10}/></button>}
            </div>
          </div>

          {/* Grid Table */}
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="h-full flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="h-full flex items-center justify-center p-8 text-xs text-gray-400">
                No records found
              </div>
            ) : (
              <table className="w-full text-left border-collapse min-w-[600px]">
                <thead>
                  <tr className="border-b" style={{ borderColor: BORD, background: "#F9FAFB" }}>
                    {columns.map(col => (
                      <th key={col.name} className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        {col.name}
                        <span className="block text-[8px] font-normal lowercase text-gray-400">({col.type})</span>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-gray-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: BORD }}>
                  {filteredRows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 transition-colors">
                      {columns.map(col => {
                        const val = row[col.name];
                        let displayVal = "";
                        if (val === null) {
                          displayVal = "null";
                        } else if (typeof val === "object") {
                          displayVal = JSON.stringify(val);
                        } else {
                          displayVal = String(val);
                        }
                        return (
                          <td key={col.name} className="px-4 py-3 text-xs font-medium text-gray-700 max-w-xs truncate" title={displayVal}>
                            {val === null ? <span className="text-gray-400 italic">null</span> : displayVal}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-xs text-right whitespace-nowrap space-x-1.5">
                        <button onClick={() => setEditingRow(row)} className="px-2.5 py-1 text-[10px] font-bold rounded-xl text-amber-600 bg-amber-50 hover:bg-amber-100 transition-colors">Edit</button>
                        <button onClick={() => handleDeleteRow(row.id)} className="px-2.5 py-1 text-[10px] font-bold rounded-xl text-red-600 bg-red-50 hover:bg-red-100 transition-colors">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editingRow && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-lg flex flex-col max-h-[85vh] border-2" style={{ borderColor: BORD }}>
            <div className="flex justify-between items-center mb-4 shrink-0">
              <div>
                <h3 className="text-base font-black text-gray-800">Edit Record</h3>
                <p className="text-[10px]" style={{ color: MUTED }}>Table: {selectedTable} · Row ID: {editingRow.id}</p>
              </div>
              <button onClick={() => setEditingRow(null)} style={{ color: MUTED }}><X size={18}/></button>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-1 space-y-4 py-2">
              {columns
                .filter(col => !["id", "created_at", "updated_at", "customer_name", "zone"].includes(col.name))
                .map(col => {
                  const val = editFormData[col.name];
                  const label = col.name.replace(/_/g, " ");
                  return (
                    <F key={col.name} label={`${label} (${col.type})`}>
                      {col.type?.includes("json") || typeof val === "object" ? (
                        <textarea
                          value={typeof val === "object" ? JSON.stringify(val) : (val || "")}
                          onChange={e => {
                            try {
                              setEditFormData(fd => ({ ...fd, [col.name]: JSON.parse(e.target.value) }));
                            } catch {
                              setEditFormData(fd => ({ ...fd, [col.name]: e.target.value }));
                            }
                          }}
                          className={inp + " h-20 font-mono text-xs"}
                          style={iSt}
                        />
                      ) : col.type?.includes("boolean") ? (
                        <select
                          value={val === true || val === 1 || val === "1" ? "true" : "false"}
                          onChange={e => setEditFormData(fd => ({ ...fd, [col.name]: e.target.value === "true" }))}
                          className={inp}
                          style={iSt}
                        >
                          <option value="true">True</option>
                          <option value="false">False</option>
                        </select>
                      ) : col.type?.includes("int") || col.type?.includes("dec") || col.type?.includes("num") ? (
                        <input
                          type="number"
                          value={val !== null && val !== undefined ? val : ""}
                          onChange={e => setEditFormData(fd => ({ ...fd, [col.name]: e.target.value !== "" ? Number(e.target.value) : null }))}
                          className={inp}
                          style={iSt}
                        />
                      ) : (
                        <input
                          type="text"
                          value={val !== null && val !== undefined ? val : ""}
                          onChange={e => setEditFormData(fd => ({ ...fd, [col.name]: e.target.value }))}
                          className={inp}
                          style={iSt}
                        />
                      )}
                    </F>
                  );
                })}
              
              {/* Allow editing of virtual fields customer_name and zone if they exist in the current view */}
              {columns.some(col => col.name === "customer_name") && (
                <F label="Customer Name">
                  <input
                    type="text"
                    value={editFormData["customer_name"] || ""}
                    onChange={e => setEditFormData(fd => ({ ...fd, customer_name: e.target.value }))}
                    className={inp}
                    style={iSt}
                  />
                </F>
              )}
              {columns.some(col => col.name === "zone") && (
                <F label="Zone / City">
                  <input
                    type="text"
                    value={editFormData["zone"] || ""}
                    onChange={e => setEditFormData(fd => ({ ...fd, zone: e.target.value }))}
                    className={inp}
                    style={iSt}
                  />
                </F>
              )}
            </div>
            
            <div className="flex gap-3 mt-5 shrink-0 pt-4 border-t" style={{ borderColor: BORD }}>
              <button onClick={() => setEditingRow(null)} className="flex-1 py-3 rounded-2xl text-xs font-bold border" style={{ borderColor: BORD, color: MUTED }}>Cancel</button>
              <button onClick={handleUpdateRow} className="flex-1 py-3 rounded-2xl text-xs font-bold text-white" style={{ background: OK }}>Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── APP ROOT ─────────────────────────────────────────────────
const INIT_DB: DB = {
  customers:[], applications:[],
  agents:[],
  agentLogs:[],
};
const AUTH_SCREENS: Screen[] = ["splash","login","register","admin-login","agent-login","agent-register"];

export default function App() {
  const [screen,  setScreen]  = useState<Screen>("splash");
  const [session, setSession] = useState<Session>({ role:null, userId:"", name:"" });
  const [db,      setDB]      = useState<DB>(INIT_DB);
  const [drawer,  setDrawer]  = useState(false);
  const [wakingStatus, setWakingStatus] = useState<{ waking: boolean; message: string }>({ waking: false, message: "" });

  // Automatically save session changes to localStorage
  useEffect(() => {
    if (session.role) {
      localStorage.setItem('lf_session', JSON.stringify(session));
    } else {
      localStorage.removeItem('lf_session');
    }
  }, [session]);

  useEffect(() => {
    globalSetWakingState = (waking, message) => {
      setWakingStatus({ waking, message });
    };

    globalTriggerLogout = () => {
      // Navigate to login — keep localStorage so user can re-login easily
      // Only a manual logout (clicking the logout button) should wipe localStorage
      setSession({ role: null, userId: "", name: "" });
      setScreen("login");
    };

    // Restore session instantly from localStorage before fetching server status
    const saved = localStorage.getItem('lf_session');
    if (saved) {
      try {
        const sess = JSON.parse(saved);
        setSession(sess);
        if (sess.role === 'admin') setScreen('admin-dashboard');
        else if (sess.role === 'agent') setScreen('agent-dashboard');
        else setScreen('customer-home');
        // Pre-fetch fresh database content in background
        api('/data').then(data => setDB(d => ({...d,...data}))).catch(() => {});
      } catch {}
    }

    silentWakeUp();

    const handleWakeup = () => {
      if (document.visibilityState === 'visible') {
        silentWakeUp();
      }
    };
    window.addEventListener('visibilitychange', handleWakeup);
    window.addEventListener('focus', handleWakeup);

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        api('/health').catch(() => {});
      }
    }, 4 * 60 * 1000);

    ensureCsrf();
    api('/auth/session').then(async ({ user }) => {
      if (user && user.role) {
        const freshSess = { role: user.role, userId: String(user.id), name: user.name };
        setSession(freshSess);
        localStorage.setItem('lf_session', JSON.stringify(freshSess));
        try { const data = await api('/data'); setDB(d => ({...d,...data})); } catch {}
        if (user.role === 'admin') setScreen('admin-dashboard');
        else if (user.role === 'agent') setScreen('agent-dashboard');
        else setScreen('customer-home');
      }
      // If server says no session, DON'T log out — keep localStorage session alive.
      // The user may just need to re-login the next time they try an authenticated action.
    }).catch(() => {
      // Server is waking up or offline — keep localStorage session. Don't log out.
    });

    return () => {
      window.removeEventListener('visibilitychange', handleWakeup);
      window.removeEventListener('focus', handleWakeup);
      clearInterval(interval);
    };
  }, []);

  const navigate=(s:Screen)=>{ if(s==='splash'&&session.role){api('/auth/logout',{method:'POST'}).catch(()=>{});setSession({role:null,userId:'',name:''});setDB(INIT_DB); localStorage.removeItem('lf_session');} setScreen(s); setDrawer(false); };
  const isAuth=AUTH_SCREENS.includes(screen);
  const isAdmin=screen==="admin-dashboard";
  const isAgent=screen==="agent-dashboard";
  const props:GP={ navigate, session, setSession, db, setDB };

  function renderScreen() {
    switch(screen){
      case "splash":           return <SplashScreen           {...props}/>;
      case "login":            return <LoginScreen            {...props}/>;
      case "register":         return <RegisterScreen         {...props}/>;
      case "customer-home":    return <CustomerHomeScreen     {...props}/>;
      case "loan-apply":       return <LoanApplicationScreen  {...props}/>;
      case "loan-calculator":  return <LoanCalculatorScreen   {...props}/>;
      case "loan-status":      return <LoanStatusScreen       {...props}/>;
      case "emi":              return <EMIScreen              {...props}/>;
      case "notifications":    return <NotificationsScreen    {...props}/>;
      case "profile":          return <ProfileScreen          {...props}/>;
      case "help":             return <HelpScreen             {...props}/>;
      case "agent-login":      return <AgentLoginScreen       {...props}/>;
      case "agent-register":   return <AgentRegisterScreen    {...props}/>;
      case "agent-dashboard":  return <AgentDashboardScreen   {...props}/>;
      case "admin-login":      return <AdminLoginScreen       {...props}/>;
      case "admin-dashboard":  return <AdminDashboardScreen   {...props}/>;
      case "admin-database":   return <AdminDatabaseScreen    {...props}/>;
      default:                 return <SplashScreen           {...props}/>;
    }
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ fontFamily:"'DM Sans','Inter',system-ui,sans-serif", background:BG }}>
      {!isAuth && <Sidebar screen={screen} navigate={navigate} session={session}/>}

      {/* Connection Waking Overlay */}
      {wakingStatus.waking && (
        <div className="fixed inset-0 bg-black/60 z-[9999] flex flex-col items-center justify-center p-6 text-white text-center backdrop-blur-sm">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-t-transparent mb-4" style={{ borderColor: Y, borderTopColor: 'transparent' }}></div>
          <p className="text-sm font-bold tracking-wide animate-pulse" style={{ color: Y }}>{wakingStatus.message}</p>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {!isAuth && <TopBar session={session} onMenu={()=>setDrawer(o=>!o)}/>}

        {drawer&&!isAuth&&(
          <div className="md:hidden absolute inset-0 z-50 flex">
            <div className="flex-1 bg-black/40" onClick={()=>setDrawer(false)}/>
            <div className="w-[240px] h-full flex flex-col" style={{ background:CARD, borderLeft:`1px solid ${BORD}` }}>
              <div className="flex items-center justify-between px-4 py-4 border-b" style={{ background:"#1A1A2E", borderColor:"rgba(255,255,255,0.08)" }}>
                <div className="flex items-center gap-2.5"><LFLogo size={32}/><p className="font-bold text-white">Laxmi Finance</p></div>
                <button onClick={()=>setDrawer(false)} className="text-white opacity-60"><X size={18}/></button>
              </div>
              <nav className="flex-1 px-2.5 py-3 space-y-0.5 overflow-y-auto">
                {(isAdmin?[["admin-dashboard","Dashboard",BarChart2],["notifications","Alerts",Bell],["admin-database","Database",Database]]:isAgent?[["agent-dashboard","Dashboard",BarChart2],["loan-apply","Apply Loan",Plus]]:[["customer-home","Dashboard",Home],["loan-apply","Apply Loan",Plus],["loan-status","My Loans",CreditCard],["emi","EMI",Wallet],["loan-calculator","Calculator",Percent],["notifications","Alerts",Bell],["profile","Profile",UserCircle],["help","Help",MessageSquare]]).map(([id,label,Icon])=>(
                  <button key={id as string} onClick={()=>navigate(id as Screen)} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left" style={{ background:screen===id?Y:"transparent", color:screen===id?TEXT:MUTED, fontWeight:screen===id?700:500 }}>
                    {(()=>{ const I=Icon as React.ComponentType<{size?:number;color?:string}>; return <I size={16} color={screen===id?TEXT:"#9CA3AF"}/>; })()}<span className="text-sm">{label as string}</span>
                  </button>
                ))}
              </nav>
              <div className="px-3 py-3 border-t" style={{ borderColor:BORD }}>
                <button onClick={()=>navigate("splash")} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl" style={{ color:MUTED }}><LogOut size={14} color={MUTED}/><span className="text-xs">Logout</span></button>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-hidden">{renderScreen()}</div>
      </div>

      <Toaster position="bottom-center" swipeDirection="up" toastOptions={{ style:{ fontFamily:"'DM Sans','Inter',sans-serif", fontSize:13, borderRadius:16, padding:"14px 18px", boxShadow:"0 -4px 24px rgba(0,0,0,0.12)" }, duration:3000 }}/>
    </div>
  );
}
