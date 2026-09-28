// Feed Plant Control Center - Modern Card PWA Engine
const API_URL = "https://script.google.com/macros/s/AKfycbxhiO5LAGwqkvDHW9DjH8jynYzYlyjAvNxgYlV9J3Y1GGZJxGb_3oXCvk-Bzefp74oa/exec";
const CACHE_KEY = "feed_plant_cards_data_v3";
const CACHE_TIME_KEY = "feed_plant_cards_time_v3";
const DEFAULT_SAFETY_DAYS = 7;

// Application State
let DATA = {
  stock: [], stockHistory: [], production: [], productionHistory: [],
  bags: [], bagsHistory: [], feedUnitData: [], feedUnitTotals: [],
  productionTrend: [], usage: {}, reorder_items: [], consumption: null,
  efficiency: null, processLoss: null, report_date: null, materialMaster: []
};

let VIEW_DATE = null;
let ACTIVE_VIEW = "overview";
let ACTIVE_RM_TAB = "CONSUMPTION";
let TREND_DAYS = 7;
let DISMISSED_ALERTS = new Set();

try {
  DISMISSED_ALERTS = new Set(JSON.parse(localStorage.getItem("dismissed_alerts_v2") || "[]"));
} catch (e) {}

// Utilities
const clean = v => String(v ?? "").trim();
const norm = v => clean(v).replace(/\s+/g, " ").toUpperCase();
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const val = v => num(v) || 0;
const fmt = (v, maxDec = 2) => {
  if (v === null || v === undefined || v === "") return "--";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: maxDec }) : String(v);
};
const fmtMT = v => v == null ? "--" : `${fmt(v)} MT`;
const fmt0 = v => fmt(v, 0);
const dateOnly = v => {
  const m = clean(v).match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : clean(v).slice(0, 10);
};

const isPremix = name => /\bPREMIX\b/i.test(clean(name));
const unitFor = (mat, fallback = "MT") => isPremix(mat) ? "KG" : fallback;
const inMT = (v, mat) => { const n = val(v); return isPremix(mat) ? n / 1000 : n; };
const txType = t => norm(t?.transaction || t?.type || t?.movement || "");
const txDate = t => dateOnly(t?.report_date || t?.Report_Date || t?.date);

const esc = v => clean(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const jsq = v => clean(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

// DOM Helpers
const $ = id => document.getElementById(id);
const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };

// PWA Install Prompt Hook
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredPrompt = e;
  const banner = $("pwaInstallBanner");
  if (banner) banner.style.display = "flex";
  const btn = $("headerInstallBtn");
  if (btn) btn.style.display = "flex";
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  const banner = $("pwaInstallBanner");
  if (banner) banner.style.display = "none";
  const btn = $("headerInstallBtn");
  if (btn) btn.style.display = "none";
  showToast("Feed Plant App installed!");
});

async function triggerPWAInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      deferredPrompt = null;
      $("pwaInstallBanner") && ($("pwaInstallBanner").style.display = "none");
    }
  } else {
    // Show iOS Safari guidance
    const isIOS = /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase());
    if (isIOS) {
      showModal("📲 Install on iPhone / iPad", `
        <div style="padding:10px 0; font-size:13px; line-height:1.6">
          <p>To install this app on your iPhone or iPad:</p>
          <ol style="margin-left:20px; margin-top:10px;">
            <li>Tap the <strong>Share</strong> button (box with upward arrow) in Safari.</li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong> at top right.</li>
          </ol>
        </div>
      `);
    } else {
      showToast("App is ready for home screen installation");
    }
  }
}

// Connectivity Tracking
function updateNetworkStatus() {
  const isOnline = navigator.onLine;
  const pulse = $("livePulse");
  const text = $("connectionStatus");
  const offlineToast = $("offlineToast");
  
  if (pulse) pulse.classList.toggle("offline", !isOnline);
  if (text) text.textContent = isOnline ? "Live System" : "Offline (Cached)";
  if (offlineToast) offlineToast.style.display = isOnline ? "none" : "flex";
}

window.addEventListener("online", () => { updateNetworkStatus(); refreshData(); });
window.addEventListener("offline", updateNetworkStatus);

// Data Engine & JSONP
function loadApiData() {
  return new Promise((resolve, reject) => {
    const cb = "plantCardsCallback_" + Date.now();
    const script = document.createElement("script");
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; cleanup(); reject(new Error("Network timeout")); }
    }, 15000);

    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cb] = apiData => {
      if (done) return;
      done = true;
      cleanup();
      if (apiData && apiData.status === "success") {
        resolve(apiData);
      } else {
        reject(new Error("Invalid API payload"));
      }
    };

    script.src = `${API_URL}?callback=${cb}&_t=${Date.now()}`;
    script.referrerPolicy = "no-referrer";
    script.onerror = () => {
      if (!done) { done = true; cleanup(); reject(new Error("API connection failed")); }
    };
    document.head.appendChild(script);
  });
}

function applyData(payload, fromCache = false) {
  DATA = {
    stock: Array.isArray(payload.stock) ? payload.stock : [],
    stockHistory: Array.isArray(payload.stock_history) ? payload.stock_history : [],
    production: Array.isArray(payload.production) ? payload.production : [],
    productionHistory: Array.isArray(payload.production_history) ? payload.production_history : [],
    bags: Array.isArray(payload.pp_bags) ? payload.pp_bags : [],
    bagsHistory: Array.isArray(payload.pp_bags_history) ? payload.pp_bags_history : [],
    feedUnitData: Array.isArray(payload.feedUnitData) ? payload.feedUnitData : [],
    feedUnitTotals: payload.feedUnitTotals || [],
    productionTrend: Array.isArray(payload.productionTrend) ? payload.productionTrend : [],
    usage: payload.usage || {},
    reorder_items: Array.isArray(payload.reorder_items) ? payload.reorder_items : [],
    consumption: payload.consumption ?? null,
    efficiency: payload.efficiency ?? null,
    processLoss: payload.processLoss ?? null,
    report_date: payload.report_date ?? null,
    materialMaster: payload.material_master || payload.materialMaster || payload.MATERIAL_MASTER || []
  };

  if (!fromCache) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
      localStorage.setItem(CACHE_TIME_KEY, String(Date.now()));
    } catch (e) {}
  }

  renderApp();
}

function restoreCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.status === "success") {
      applyData(parsed, true);
      const time = Number(localStorage.getItem(CACHE_TIME_KEY) || 0);
      setText("lastSyncTime", time ? "Cached " + new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "Cached");
      return true;
    }
  } catch (e) {}
  return false;
}

let isRefreshing = false;
async function refreshData() {
  if (isRefreshing) return;
  isRefreshing = true;
  setText("lastSyncTime", "Syncing…");
  try {
    const apiData = await loadApiData();
    applyData(apiData, false);
    setText("lastSyncTime", "Updated " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    updateNetworkStatus();
  } catch (err) {
    console.warn("Refresh failed:", err);
    updateNetworkStatus();
    setText("lastSyncTime", "Offline Mode");
  } finally {
    isRefreshing = false;
  }
}

// Domain Calculations
function currentReportDate() {
  return VIEW_DATE ? dateOnly(VIEW_DATE) : dateOnly(DATA.report_date) || availableDates()[0] || "";
}

function availableDates() {
  const set = new Set();
  (DATA.stockHistory || []).forEach(r => { const d = txDate(r); if (d) set.add(d); });
  (DATA.productionHistory || []).forEach(r => { const d = dateOnly(r.report_date || r.Report_Date); if (d) set.add(d); });
  (DATA.bagsHistory || []).forEach(r => { const d = dateOnly(r.report_date || r.Report_Date); if (d) set.add(d); });
  (DATA.feedUnitData || []).forEach(r => { const d = dateOnly(r.Report_Date || r.report_date); if (d) set.add(d); });
  (DATA.production || []).forEach(r => { const d = dateOnly(r.report_date || r.Report_Date); if (d) set.add(d); });
  if (DATA.report_date) set.add(dateOnly(DATA.report_date));
  return [...set].filter(Boolean).sort().reverse();
}

function getMaterials() {
  const d = currentReportDate();
  const hist = (DATA.stockHistory || []).filter(r => txDate(r) === d);
  if (hist.length) {
    return [...new Set(hist.map(r => clean(r.material)).filter(Boolean))];
  }
  return [...new Set((DATA.stock || []).map(r => clean(r.material)).filter(Boolean))];
}

function masterInfo(material) {
  const mNorm = norm(material);
  const mm = (DATA.materialMaster || []).find(x => norm(x.material || x.Material) === mNorm);
  if (mm) return { reorder: val(mm.reorder_level ?? mm.Reorder_Level ?? mm.reorderLevel), unit: mm.unit || mm.Unit || unitFor(material) };
  const ri = (DATA.reorder_items || []).find(x => norm(x.material || x.name) === mNorm);
  if (ri) return { reorder: val(ri.reorder_level ?? ri.Reorder_Level), unit: ri.unit || unitFor(material) };
  const base = (DATA.stock || []).find(x => norm(x.material) === mNorm);
  return { reorder: val(base?.reorder_level ?? base?.Reorder_Level), unit: base?.unit || unitFor(material) };
}

function materialClosing(material, d) {
  const hist = (DATA.stockHistory || []).filter(r => norm(r.material) === norm(material) && txDate(r) === d);
  if (hist.length) {
    const cl = [...hist].reverse().find(t => txType(t) === "CL. STOCK");
    if (cl) return val(cl.for_day);
  }
  const base = (DATA.stock || []).find(r => norm(r.material) === norm(material));
  return val(base?.closing);
}

function materialTransactions(material) {
  const mNorm = norm(material);
  const hist = (DATA.stockHistory || []).filter(r => norm(r.material) === mNorm);
  if (hist.length) return hist;
  const base = (DATA.stock || []).find(r => norm(r.material) === mNorm);
  return base?.transactions || [];
}

function avgConsumption(material, d) {
  const mNorm = norm(material);
  const tx = materialTransactions(material).filter(t => txType(t).includes("CONSUMPT"));
  const valid = tx.map(t => ({ d: txDate(t), v: val(t.for_day) })).filter(x => x.d && x.v > 0 && x.d <= d);
  const recent = valid.filter(x => new Date(x.d) >= new Date(new Date(d + "T00:00:00").getTime() - 29 * 86400000));
  return recent.length ? recent.reduce((a, b) => a + b.v, 0) / recent.length : 0;
}

function stockHealth(closing, reorder, avg) {
  if (reorder > 0 && closing < reorder) return { label: "CRITICAL", cls: "critical", cover: avg > 0 ? closing / avg : null };
  if (reorder > 0 && closing <= reorder * 1.15) return { label: "NEAR REORDER", cls: "near", cover: avg > 0 ? closing / avg : null };
  if (avg > 0 && (closing / avg) < 3) return { label: "LOW COVER", cls: "near", cover: closing / avg };
  if (!reorder && avg <= 0) return { label: "NO LEVEL", cls: "unknown", cover: null };
  return { label: "HEALTHY", cls: "healthy", cover: avg > 0 ? closing / avg : null };
}

function feedRows(d) {
  return (DATA.feedUnitData || []).filter(r => dateOnly(r.Report_Date || r.report_date) === d);
}

function feedTotals(d) {
  const rows = feedRows(d);
  const sum = k => rows.reduce((a, r) => a + inMT(r[k], r.Product || r.product), 0);
  return {
    opening: sum("Opening_Day_MT"),
    production: sum("Production_Day_MT"),
    dispatch: sum("Dispatch_Day_MT"),
    transfer: sum("Transfer_Day_MT"),
    closing: sum("Closing_Day_MT"),
    monthProd: sum("Production_Month_MT"),
    monthDisp: sum("Dispatch_Month_MT")
  };
}

function productionRows(d) {
  if (VIEW_DATE) {
    return (DATA.productionHistory || []).filter(r => dateOnly(r.report_date || r.Report_Date) === d);
  }
  return (DATA.production || []).filter(r => !d || dateOnly(r.report_date || r.Report_Date) === d);
}

function bagRows(d) {
  if (VIEW_DATE) {
    return (DATA.bagsHistory || []).filter(r => dateOnly(r.report_date || r.Report_Date) === d);
  }
  return (DATA.bags || []).filter(r => !d || dateOnly(r.report_date || r.Report_Date) === d);
}

function rmDailySummary(d) {
  const mats = getMaterials();
  let totalClosingMT = 0, totalConsMT = 0, totalRecMT = 0;
  const items = [];

  mats.forEach(m => {
    const info = masterInfo(m);
    const closing = materialClosing(m, d);
    const avg = avgConsumption(m, d);
    const health = stockHealth(closing, info.reorder, avg);
    
    // Day consumption & receipt
    const tx = materialTransactions(m).filter(t => txDate(t) === d);
    const cons = tx.filter(t => txType(t).includes("CONSUMPT")).reduce((a, t) => a + val(t.for_day), 0);
    const rec = tx.filter(t => {
      const ty = txType(t);
      return ty === "PURCHASE" || ty === "RECEIVED" || ty.includes("TRANSFER FROM") || ty === "GAIN";
    }).reduce((a, t) => a + val(t.for_day), 0);

    totalClosingMT += inMT(closing, m);
    totalConsMT += inMT(cons, m);
    totalRecMT += inMT(rec, m);

    items.push({ material: m, closing, unit: info.unit, avg, reorder: info.reorder, cons, rec, health });
  });

  return { totalClosingMT, totalConsMT, totalRecMT, items };
}

// Rendering Views
function renderApp() {
  const d = currentReportDate();
  setText("currentReportDate", d ? d : "Latest");
  setText("selectedDateChip", VIEW_DATE ? d : "Latest");

  renderOverview();
  renderProduction();
  renderInventory();
  renderFeed();
  renderBags();
  renderAlerts();
  renderTrends();
}

function renderOverview() {
  const d = currentReportDate();
  const feed = feedTotals(d);
  const rm = rmDailySummary(d);
  const prod = productionRows(d);
  const bags = bagRows(d);

  // KPIs
  setText("ovProdDay", fmt(feed.production));
  setText("ovDispDay", fmt(feed.dispatch));
  setText("ovFeedClose", fmt(feed.closing));
  setText("ovRMCons", fmt(rm.totalConsMT));
  setText("ovRMRec", fmt(rm.totalRecMT));
  setText("ovRMClose", fmt(rm.totalClosingMT));
  
  // Bag closing
  const bagClose = bags.reduce((a, b) => a + val(b.closing), 0);
  setText("ovBagsClose", fmt0(bagClose));

  // Critical Reorders
  const criticals = rm.items.filter(i => i.health.cls === "critical");
  setText("ovReordersCount", criticals.length);

  // MTD
  setText("mtdProd", fmt(feed.monthProd));
  setText("mtdDisp", fmt(feed.monthDisp));

  // Attention Cards Deck
  const attList = $("attentionCardsList");
  if (attList) {
    const list = [];
    criticals.slice(0, 4).forEach(c => {
      list.push(`
        <div class="app-card interactive item-card" onclick="openMaterialDetails('${jsq(c.material)}')">
          <div class="item-left">
            <div class="item-title">🔴 ${esc(c.material)}</div>
            <div class="item-chips">
              <span>Closing: ${fmt(c.closing)} ${esc(c.unit)}</span>
              <span>·</span>
              <span>Reorder: ${fmt(c.reorder)} ${esc(c.unit)}</span>
            </div>
          </div>
          <div class="item-right">
            <span class="status-chip critical">Critical</span>
          </div>
        </div>
      `);
    });

    const lowCover = rm.items.filter(i => i.health.cls === "near").slice(0, 3);
    lowCover.forEach(c => {
      list.push(`
        <div class="app-card interactive item-card" onclick="openMaterialDetails('${jsq(c.material)}')">
          <div class="item-left">
            <div class="item-title">🟡 ${esc(c.material)}</div>
            <div class="item-chips">
              <span>${c.health.cover ? fmt(c.health.cover, 1) + ' days cover' : 'Low stock'}</span>
            </div>
          </div>
          <div class="item-right">
            <span class="status-chip near">Low Cover</span>
          </div>
        </div>
      `);
    });

    // PP Bag Damage
    const totalDamage = bags.reduce((a, b) => a + val(b.damage), 0);
    if (totalDamage > 0) {
      list.push(`
        <div class="app-card interactive item-card" onclick="switchView('bags')">
          <div class="item-left">
            <div class="item-title">👜 PP Bag Damage Recorded</div>
            <div class="item-chips">
              <span>${fmt0(totalDamage)} bags damaged today</span>
            </div>
          </div>
          <div class="item-right">
            <span class="status-chip near">Review</span>
          </div>
        </div>
      `);
    }

    attList.innerHTML = list.length ? list.join("") : `
      <div class="app-card" style="text-align:center; padding: 20px; color: var(--text-muted); font-size:12px;">
        ✅ All raw materials and feed flows are operating within standard parameters.
      </div>
    `;
  }
}

function renderProduction() {
  const d = currentReportDate();
  const rows = productionRows(d);
  const totalActual = rows.reduce((a, r) => a + val(r.actual_output), 0);
  const totalStd = rows.reduce((a, r) => a + val(r.standard_output), 0);
  const efficiency = totalStd > 0 ? (totalActual / totalStd) * 100 : null;

  setText("prodTotalActual", fmt0(totalActual) + " Bags");
  setText("prodTotalStd", fmt0(totalStd) + " Bags");
  setText("prodEfficiency", efficiency ? fmt(efficiency, 1) + "%" : "--");

  const grid = $("productionCardsGrid");
  if (grid) {
    grid.innerHTML = rows.map(r => {
      const actual = val(r.actual_output);
      const std = val(r.standard_output);
      const loss = num(r.process_loss);
      const outPct = num(r.output_percentage);

      return `
        <div class="app-card interactive item-card" onclick="openProductDetails('${jsq(r.product)}')">
          <div class="item-left">
            <div class="item-title">${esc(r.product)}</div>
            <div class="item-chips">
              <span>Std: ${fmt0(std)}</span>
              <span>·</span>
              <span>Output: ${outPct != null ? fmt(outPct, 1) + '%' : '--'}</span>
              ${loss != null ? `<span>·</span><span style="color:${loss > 5 ? 'var(--accent-rose)' : 'inherit'}">Loss: ${fmt(loss, 1)}%</span>` : ''}
            </div>
          </div>
          <div class="item-right">
            <div class="item-primary-val">${fmt0(actual)} Bags</div>
            <div class="item-secondary-val">Actual Output</div>
          </div>
        </div>
      `;
    }).join("") || `<div class="app-card empty">No production batches recorded for this date.</div>`;
  }
}

function renderInventory() {
  const d = currentReportDate();
  const rm = rmDailySummary(d);
  const search = norm($("rmCardSearch")?.value || "");

  const grid = $("inventoryCardsGrid");
  if (grid) {
    const filtered = rm.items.filter(i => !search || norm(i.material).includes(search));
    grid.innerHTML = filtered.map(i => `
      <div class="app-card interactive material-card" onclick="openMaterialDetails('${jsq(i.material)}')">
        <div class="mat-card-header">
          <div class="mat-title">${esc(i.material)}</div>
          <span class="status-chip ${i.health.cls}">${i.health.label}</span>
        </div>
        <div class="mat-metrics-row">
          <div class="mat-metric-col">
            <span>Closing</span>
            <strong>${fmt(i.closing)} ${esc(i.unit)}</strong>
          </div>
          <div class="mat-metric-col">
            <span>Burn/Day</span>
            <strong>${i.avg > 0 ? fmt(i.avg, 1) : '--'}</strong>
          </div>
          <div class="mat-metric-col">
            <span>Reorder</span>
            <strong>${i.reorder > 0 ? fmt(i.reorder) : '--'}</strong>
          </div>
          <div class="mat-metric-col">
            <span>Coverage</span>
            <strong>${i.health.cover != null ? fmt(i.health.cover, 1) + 'd' : '--'}</strong>
          </div>
        </div>
      </div>
    `).join("") || `<div class="app-card empty">No matching materials found.</div>`;
  }
}

function renderFeed() {
  const d = currentReportDate();
  const rows = feedRows(d);
  const grid = $("feedCardsGrid");
  if (grid) {
    grid.innerHTML = rows.map(r => {
      const p = r.Product || r.product || "--";
      const prod = inMT(r.Production_Day_MT, p);
      const disp = inMT(r.Dispatch_Day_MT, p);
      const close = inMT(r.Closing_Day_MT, p);
      const open = inMT(r.Opening_Day_MT, p);

      return `
        <div class="app-card interactive item-card" onclick="openFeedProductDetails('${jsq(p)}')">
          <div class="item-left">
            <div class="item-title">${esc(p)}</div>
            <div class="item-chips">
              <span>Open: ${fmt(open)} MT</span>
              <span>·</span>
              <span>Prod: ${fmt(prod)} MT</span>
              <span>·</span>
              <span>Disp: ${fmt(disp)} MT</span>
            </div>
          </div>
          <div class="item-right">
            <div class="item-primary-val">${fmt(close)} MT</div>
            <div class="item-secondary-val">Closing Stock</div>
          </div>
        </div>
      `;
    }).join("") || `<div class="app-card empty">No Feed Unit records for this date.</div>`;
  }
}

function renderBags() {
  const d = currentReportDate();
  const rows = bagRows(d);
  const grid = $("bagCardsGrid");
  if (grid) {
    grid.innerHTML = rows.map(r => {
      const p = r.product || "PP Bags";
      const close = val(r.closing);
      const issue = val(r.issue);
      const damage = val(r.damage);

      return `
        <div class="app-card interactive item-card" onclick="openBagDetails('${jsq(p)}')">
          <div class="item-left">
            <div class="item-title">${esc(p)}</div>
            <div class="item-chips">
              <span>Issued: ${fmt0(issue)}</span>
              <span>·</span>
              <span style="color:${damage > 0 ? 'var(--accent-rose)' : 'inherit'}">Damage: ${fmt0(damage)}</span>
            </div>
          </div>
          <div class="item-right">
            <div class="item-primary-val">${fmt0(close)}</div>
            <div class="item-secondary-val">Closing Bags</div>
          </div>
        </div>
      `;
    }).join("") || `<div class="app-card empty">No PP Bag records for this date.</div>`;
  }
}

function renderAlerts() {
  const d = currentReportDate();
  const rm = rmDailySummary(d);
  const critical = rm.items.filter(i => i.health.cls === "critical");
  const near = rm.items.filter(i => i.health.cls === "near");
  const total = critical.length + near.length;

  setText("alertsBadge", total > 0 ? String(total) : "");
  $("alertsBadge") && ($("alertsBadge").classList.toggle("hidden", total === 0));

  const list = $("alertsDeckList");
  if (list) {
    const cards = [];
    critical.forEach(c => {
      cards.push(`
        <div class="app-card item-card" style="border-left:4px solid var(--accent-rose);">
          <div class="item-left">
            <div class="item-title">🔴 ${esc(c.material)} — Critical Stock</div>
            <div class="item-chips">Current ${fmt(c.closing)} ${esc(c.unit)} is below reorder level ${fmt(c.reorder)} ${esc(c.unit)}</div>
          </div>
          <div class="item-right">
            <button class="tab-pill active" onclick="openMaterialDetails('${jsq(c.material)}')">Inspect</button>
          </div>
        </div>
      `);
    });

    near.forEach(c => {
      cards.push(`
        <div class="app-card item-card" style="border-left:4px solid var(--accent-amber);">
          <div class="item-left">
            <div class="item-title">🟡 ${esc(c.material)} — Low Coverage</div>
            <div class="item-chips">Estimated ${c.health.cover ? fmt(c.health.cover, 1) + ' days' : 'few days'} remaining at current burn rate</div>
          </div>
          <div class="item-right">
            <button class="tab-pill" onclick="openMaterialDetails('${jsq(c.material)}')">Details</button>
          </div>
        </div>
      `);
    });

    list.innerHTML = cards.length ? cards.join("") : `<div class="app-card empty">No active alerts for ${esc(d)}. All stocks are healthy.</div>`;
  }
}

function renderTrends() {
  const d = currentReportDate();
  const dates = availableDates().filter(x => x <= d).slice(-TREND_DAYS).reverse();
  
  // Production Trend Canvas
  drawChart("chartProd", dates, dates.map(dt => feedTotals(dt).production), "MT");
  drawChart("chartDisp", dates, dates.map(dt => feedTotals(dt).dispatch), "MT");
}

function drawChart(canvasId, labels, values, unit) {
  const c = $(canvasId);
  if (!c) return;
  const ctx = c.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth || 320;
  const h = 160;

  c.width = w * dpr;
  c.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const nums = values.map(v => val(v));
  if (!nums.length) {
    ctx.fillStyle = "#5d7890";
    ctx.font = "12px sans-serif";
    ctx.fillText("No historical trend data", 14, h / 2);
    return;
  }

  const max = Math.max(...nums, 1);
  const min = Math.min(...nums, 0);
  const range = max - min || 1;
  const p = { l: 30, r: 12, t: 14, b: 24 };

  // Grid
  ctx.strokeStyle = "rgba(22, 50, 77, 0.5)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const y = p.t + (h - p.t - p.b) * (i / 2);
    ctx.beginPath();
    ctx.moveTo(p.l, y);
    ctx.lineTo(w - p.r, y);
    ctx.stroke();
  }

  // Line
  ctx.strokeStyle = "#258cfb";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  nums.forEach((v, i) => {
    const x = p.l + (w - p.l - p.r) * (nums.length === 1 ? 0.5 : i / (nums.length - 1));
    const y = p.t + (h - p.t - p.b) * (1 - (v - min) / range);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Dots
  ctx.fillStyle = "#38bdf8";
  nums.forEach((v, i) => {
    const x = p.l + (w - p.l - p.r) * (nums.length === 1 ? 0.5 : i / (nums.length - 1));
    const y = p.t + (h - p.t - p.b) * (1 - (v - min) / range);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  // Labels
  ctx.fillStyle = "#8ca3b8";
  ctx.font = "10px sans-serif";
  labels.forEach((lbl, i) => {
    if (i % Math.ceil(labels.length / 4) === 0 || i === labels.length - 1) {
      const x = p.l + (w - p.l - p.r) * (nums.length === 1 ? 0.5 : i / (nums.length - 1));
      ctx.fillText(String(lbl).slice(5), x - 12, h - 6);
    }
  });
}

// Navigation & Tab Switching
function switchView(viewName) {
  ACTIVE_VIEW = viewName;
  document.querySelectorAll(".view-section").forEach(s => s.style.display = "none");
  const target = $("view-" + viewName);
  if (target) target.style.display = "block";

  document.querySelectorAll(".nav-tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.view === viewName);
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Modals & Drilldown Sheets
function showModal(title, html) {
  setText("modalTitle", title);
  const body = $("modalBody");
  if (body) body.innerHTML = html;
  const overlay = $("modalOverlay");
  if (overlay) overlay.classList.add("show");
}

function closeModal() {
  const overlay = $("modalOverlay");
  if (overlay) overlay.classList.remove("show");
}

function openMaterialDetails(material) {
  const d = currentReportDate();
  const info = masterInfo(material);
  const closing = materialClosing(material, d);
  const avg = avgConsumption(material, d);
  const health = stockHealth(closing, info.reorder, avg);
  const tx = materialTransactions(material).filter(t => txDate(t) === d);

  let html = `
    <div class="app-card" style="margin-bottom:12px;">
      <div style="font-size:12px; color:var(--text-muted)">Current Closing Stock</div>
      <div style="font-size:24px; font-weight:750; margin:4px 0">${fmt(closing)} ${esc(info.unit)}</div>
      <div class="item-chips">
        <span class="status-chip ${health.cls}">${health.label}</span>
        <span>Reorder Level: ${info.reorder > 0 ? fmt(info.reorder) + ' ' + esc(info.unit) : 'Not configured'}</span>
        <span>Avg Burn: ${avg > 0 ? fmt(avg, 1) + ' ' + esc(info.unit) + '/day' : '--'}</span>
      </div>
    </div>
  `;

  if (tx.length) {
    html += `
      <div style="font-size:12px; font-weight:700; margin:12px 0 6px;">Day Movements (${esc(d)})</div>
      <div class="cards-grid">
    `;
    tx.forEach(t => {
      html += `
        <div class="app-card item-card">
          <div class="item-left">
            <div class="item-title">${esc(t.transaction || txType(t))}</div>
            <div class="item-chips"><span>For Month: ${fmt(t.for_month)}</span></div>
          </div>
          <div class="item-right">
            <div class="item-primary-val">${fmt(t.for_day)} ${esc(info.unit)}</div>
          </div>
        </div>
      `;
    });
    html += `</div>`;
  } else {
    html += `<div class="app-card empty">No transactions recorded for ${esc(d)}.</div>`;
  }

  showModal(`📦 ${esc(material)}`, html);
}

function openProductDetails(product) {
  const d = currentReportDate();
  const rows = productionRows(d).filter(r => norm(r.product) === norm(product));
  const r = rows[0];
  if (!r) return;

  const html = `
    <div class="app-card" style="margin-bottom:12px;">
      <div style="font-size:12px; color:var(--text-muted)">Actual Production</div>
      <div style="font-size:24px; font-weight:750; margin:4px 0">${fmt0(r.actual_output)} Bags</div>
      <div class="item-chips">
        <span>Standard: ${fmt0(r.standard_output)} Bags</span>
        <span>·</span>
        <span>Output %: ${r.output_percentage != null ? fmt(r.output_percentage, 1) + '%' : '--'}</span>
        <span>·</span>
        <span>Loss: ${r.process_loss != null ? fmt(r.process_loss, 1) + '%' : '--'}</span>
      </div>
      ${r.remarks ? `<div style="font-size:11px; color:var(--text-muted); margin-top:8px;">Remarks: ${esc(r.remarks)}</div>` : ''}
    </div>
  `;
  showModal(`🏭 ${esc(product)}`, html);
}

function openFeedProductDetails(product) {
  const d = currentReportDate();
  const r = feedRows(d).find(x => norm(x.Product || x.product) === norm(product));
  if (!r) return;

  const p = r.Product || r.product;
  const html = `
    <div class="app-card" style="margin-bottom:12px;">
      <div style="font-size:12px; color:var(--text-muted)">Closing Balance</div>
      <div style="font-size:24px; font-weight:750; margin:4px 0">${fmt(inMT(r.Closing_Day_MT, p))} MT</div>
      <div class="cards-grid two-cols" style="margin-top:10px;">
        <div class="app-card item-card">
          <div class="item-left"><div class="item-title">Opening</div></div>
          <div class="item-right"><div class="item-primary-val">${fmt(inMT(r.Opening_Day_MT, p))} MT</div></div>
        </div>
        <div class="app-card item-card">
          <div class="item-left"><div class="item-title">Production</div></div>
          <div class="item-right"><div class="item-primary-val">${fmt(inMT(r.Production_Day_MT, p))} MT</div></div>
        </div>
        <div class="app-card item-card">
          <div class="item-left"><div class="item-title">Dispatch</div></div>
          <div class="item-right"><div class="item-primary-val">${fmt(inMT(r.Dispatch_Day_MT, p))} MT</div></div>
        </div>
        <div class="app-card item-card">
          <div class="item-left"><div class="item-title">Month Output</div></div>
          <div class="item-right"><div class="item-primary-val">${fmt(inMT(r.Production_Month_MT, p))} MT</div></div>
        </div>
      </div>
    </div>
  `;
  showModal(`🌾 ${esc(p)}`, html);
}

function openBagDetails(product) {
  const d = currentReportDate();
  const r = bagRows(d).find(x => norm(x.product) === norm(product));
  if (!r) return;

  const html = `
    <div class="app-card" style="margin-bottom:12px;">
      <div style="font-size:12px; color:var(--text-muted)">Closing PP Bags</div>
      <div style="font-size:24px; font-weight:750; margin:4px 0">${fmt0(r.closing)} Nos</div>
      <div class="cards-grid two-cols" style="margin-top:10px;">
        <div class="app-card item-card">
          <div class="item-left"><div class="item-title">Opening</div></div>
          <div class="item-right"><div class="item-primary-val">${fmt0(r.opening)}</div></div>
        </div>
        <div class="app-card item-card">
          <div class="item-left"><div class="item-title">Received</div></div>
          <div class="item-right"><div class="item-primary-val">${fmt0(r.received)}</div></div>
        </div>
        <div class="app-card item-card">
          <div class="item-left"><div class="item-title">Issued</div></div>
          <div class="item-right"><div class="item-primary-val">${fmt0(r.issue)}</div></div>
        </div>
        <div class="app-card item-card">
          <div class="item-left"><div class="item-title">Damaged</div></div>
          <div class="item-right"><div class="item-primary-val" style="color:var(--accent-rose)">${fmt0(r.damage)}</div></div>
        </div>
      </div>
    </div>
  `;
  showModal(`🛍 ${esc(product)}`, html);
}

function openDateSelector() {
  const dates = availableDates();
  const buttons = (VIEW_DATE ? `<button class="tab-pill active" onclick="setDashboardDate(null)" style="margin-bottom:10px;">Show Latest</button><br>` : '') +
    dates.map(d => `
      <div class="app-card interactive item-card" onclick="setDashboardDate('${jsq(d)}')" style="margin-bottom:6px;">
        <div class="item-left">
          <div class="item-title">📅 ${esc(d)}</div>
          <div class="item-chips"><span>${d === dateOnly(DATA.report_date) ? 'Latest Reported Day' : 'Archived History'}</span></div>
        </div>
        <div class="item-right">
          <span class="status-chip ${VIEW_DATE === d ? 'healthy' : 'ok'}">${VIEW_DATE === d ? 'Selected' : 'View'}</span>
        </div>
      </div>
    `).join("");

  showModal("📅 Select Plant Date", buttons);
}

function setDashboardDate(date) {
  VIEW_DATE = date ? dateOnly(date) : null;
  closeModal();
  renderApp();
  showToast(VIEW_DATE ? `Loaded ${VIEW_DATE}` : "Loaded Latest Dashboard");
}

function showToast(msg) {
  let t = $("appToast");
  if (!t) {
    t = document.createElement("div");
    t.id = "appToast";
    t.style.cssText = "position:fixed; left:50%; bottom:80px; transform:translateX(-50%); background:#0f2b48; border:1px solid #1f5080; color:#fff; padding:10px 18px; border-radius:24px; font-size:12px; font-weight:600; z-index:999; box-shadow:0 6px 20px rgba(0,0,0,0.4); pointer-events:none;";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(window._toastTimeout);
  window._toastTimeout = setTimeout(() => t.style.display = "none", 2200);
}

// Init
window.addEventListener("DOMContentLoaded", () => {
  restoreCache();
  refreshData();
  updateNetworkStatus();

  // Register service worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(console.warn);
  }
});
