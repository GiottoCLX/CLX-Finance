import { sb } from './supabase.js';

// --------- Utilities ---------
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const fmtCHF = (n) => (n==null||isNaN(n)) ? '0.00' : Number(n).toLocaleString('de-CH', {minimumFractionDigits:2, maximumFractionDigits:2});
const fmtDate = (iso) => iso ? new Date(iso).toISOString().slice(0,10) : '';
const monthKey = (d) => {
  const dt = (typeof d === 'string') ? new Date(d) : d;
  return dt.toISOString().slice(0,7); // YYYY-MM
};

function toast(msg, ms=1800){
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), ms);
}

// Simple state caches
const cache = {
  clients: [],
  projects: [],
  incomeCategories: [],
  expenseCategories: [],
  projectMap: new Map(),
  clientMap: new Map(),
};

async function loadCatalogs() {
  const [clRes, prRes, icRes, ecRes] = await Promise.all([
    sb.from('clients').select('*').order('name', {ascending: true}),
    sb.from('projects').select('*').order('created_at', {ascending: false}).limit(1000),
    sb.from('income_categories').select('*').order('name', {ascending: true}),
    sb.from('expense_categories').select('*').order('name', {ascending: true}),
  ]);
  if (clRes.error) console.error(clRes.error);
  if (prRes.error) console.error(prRes.error);
  if (icRes.error) console.error(icRes.error);
  if (ecRes.error) console.error(ecRes.error);

  cache.clients = clRes.data || [];
  cache.projects = prRes.data || [];
  cache.incomeCategories = icRes.data || [];
  cache.expenseCategories = ecRes.data || [];
  cache.projectMap = new Map(cache.projects.map(p=>[p.id, p.name]));
  cache.clientMap = new Map(cache.clients.map(c=>[c.id, c.name]));

  // populate selects
  const fill = (sel, list, value='id', label='name', emptyOption=true) => {
    const el = $(sel);
    if (!el) return;
    el.innerHTML = emptyOption ? '<option value="">–</option>' : '';
    list.forEach(it => {
      const opt = document.createElement('option');
      opt.value = it[value];
      opt.textContent = it[label];
      el.appendChild(opt);
    });
  };

  fill('#income-project', cache.projects);
  fill('#income-client', cache.clients);
  fill('#income-category', cache.incomeCategories, 'id', 'name', false);

  fill('#expense-project', cache.projects);
  fill('#expense-category', cache.expenseCategories, 'id', 'name', false);

  fill('#project-client', cache.clients);

  fill('#doc-client', cache.clients, 'id', 'name', false);
  fill('#doc-project', cache.projects);
}

// --------- Router ---------
function setupRouter(){
  $$('.nav-link').forEach(btn=>{
    btn.addEventListener('click', () => {
      $$('.nav-link').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.target;
      $$('.view').forEach(v=>v.classList.remove('active'));
      $('#'+target).classList.add('active');
      $('#page-title').textContent = btn.textContent;
      if (target==='dashboard') initDashboard();
      if (target==='incomes') loadIncomes();
      if (target==='expenses') loadExpenses();
      if (target==='projects') loadProjectsTable();
      if (target==='clients') loadClientsTable();
      if (target==='documents') loadDocumentsTable();
    });
  });
}

// --------- Dashboard ---------
let chart;
async function initDashboard(){
  // KPIs (current month)
  const now = new Date();
  const key = monthKey(now);

  // read v_monthly_overview (12 months this year)
  const mRes = await sb.from('v_monthly_overview').select('*');
  if (mRes.error) { console.error(mRes.error); return; }
  const months = mRes.data;

// ... months ist das Array aus v_monthly_overview (12 Monate des aktuellen Jahres)


// ➜ NEU: Jahr (YTD)
const ytdIncome  = months.reduce((s,m)=> s + Number(m.income_chf || 0), 0);
const ytdExpense = months.reduce((s,m)=> s + Number(m.expense_chf || 0), 0);
const ytdProfit  = ytdIncome - ytdExpense;

$('#kpi-year-income').textContent  = fmtCHF(ytdIncome);
$('#kpi-year-profit').textContent  = fmtCHF(ytdProfit);


  const cur = months.find(m => m.month_key === key);
  const inc = cur ? Number(cur.income_chf) : 0;
  const exp = cur ? Number(cur.expense_chf) : 0;

  $('#kpi-month-income').textContent = fmtCHF(inc);
  $('#kpi-month-expenses').textContent = fmtCHF(exp);
  $('#kpi-month-profit').textContent = fmtCHF(inc-exp);

  // Chart
  const labels = months.map(m=>m.month_key);
  const incomeData = months.map(m=>Number(m.income_chf));
  const expenseData = months.map(m=>Number(m.expense_chf));

  const ctx = $('#incomeExpenseChart');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Einnahmen', data: incomeData },
        { label: 'Ausgaben', data: expenseData },
      ]
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true } }
    }
  });

  // Calendar
  initCalendar();
}

async function initCalendar(){
  const calendarEl = document.getElementById('calendar');
  calendarEl.innerHTML = ''; // reset

  // Events laden
  const evRes = await sb.from('events').select('*').order('start_at', {ascending:true}).limit(500);
  if (evRes.error) { console.error(evRes.error); return; }

  // Helper für ISO → FullCalendar braucht ISO-Strings
  const toISO = (d) => (typeof d === 'string') ? d : new Date(d).toISOString();

  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    height: 420,
    selectable: true,          // ⬅️ Range mit Maus ziehen
    selectMirror: true,
    editable: true,            // ⬅️ Drag/Drop & Resize aktiv
    dayMaxEvents: true,
    plugins: [ FullCalendar.DayGrid, FullCalendar.TimeGrid, FullCalendar.Interaction ],
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay'
    },

    // vorhandene Events
    events: (evRes.data || []).map(e => ({
      id: e.id,
      title: e.title,
      start: e.start_at,
      end: e.end_at || undefined
    })),

    // Klick auf einen einzelnen Tag -> schnelles Einfügen 1h
    dateClick: async (info) => {
      const title = prompt('Event-Titel?');
      if (!title) return;
      const start = new Date(info.dateStr);
      const end = new Date(start.getTime() + 60*60*1000);
      const ins = await sb.from('events').insert({
        title,
        start_at: toISO(start),
        end_at: toISO(end)
      }).select().single();
      if (ins.error) { console.error(ins.error); alert('Event konnte nicht gespeichert werden'); return; }
      calendar.addEvent({
        id: ins.data.id, title, start: ins.data.start_at, end: ins.data.end_at
      });
    },

    // Drag/Drop (verschieben)
    eventDrop: async (info) => {
      const up = await sb.from('events')
        .update({ start_at: toISO(info.event.start), end_at: info.event.end ? toISO(info.event.end) : null })
        .eq('id', info.event.id);
      if (up.error) { console.error(up.error); alert('Update fehlgeschlagen'); info.revert(); }
    },

    // Resize (Dauer ändern)
    eventResize: async (info) => {
      const up = await sb.from('events')
        .update({ start_at: toISO(info.event.start), end_at: info.event.end ? toISO(info.event.end) : null })
        .eq('id', info.event.id);
      if (up.error) { console.error(up.error); alert('Update fehlgeschlagen'); info.revert(); }
    },

    // Klick auf Event: Umbenennen oder Löschen
    eventClick: async (info) => {
      const choice = prompt('Titel ändern oder "DEL" eingeben zum Löschen:', info.event.title);
      if (choice === null) return; // Abbruch
      if (choice.trim().toUpperCase() === 'DEL') {
        const del = await sb.from('events').delete().eq('id', info.event.id);
        if (del.error) { console.error(del.error); alert('Löschen fehlgeschlagen'); return; }
        info.event.remove();
        return;
      }
      if (choice.trim() !== info.event.title) {
        const up = await sb.from('events').update({ title: choice.trim() }).eq('id', info.event.id);
        if (up.error) { console.error(up.error); alert('Update fehlgeschlagen'); return; }
        info.event.setProp('title', choice.trim());
      }
    },

    // Range-Selektion (z. B. Woche ziehen)
    select: async (selectionInfo) => {
      const title = prompt('Event-Titel (Range)?');
      if (!title) { return calendar.unselect(); }
      const ins = await sb.from('events').insert({
        title,
        start_at: toISO(selectionInfo.start),
        end_at: selectionInfo.end ? toISO(selectionInfo.end) : null
      }).select().single();
      if (ins.error) { console.error(ins.error); alert('Event konnte nicht gespeichert werden'); return; }
      calendar.addEvent({ id: ins.data.id, title, start: ins.data.start_at, end: ins.data.end_at });
      calendar.unselect();
    }
  });

  calendar.render();
}


// --------- Einnahmen ---------
async function loadIncomes(){
  const res = await sb.from('incomes').select('*').order('tx_date',{ascending:false}).limit(300);
  if (res.error) { console.error(res.error); return; }
  const tbody = $('#income-table tbody');
  tbody.innerHTML = '';
  for (const r of res.data){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtDate(r.tx_date)}</td>
      <td>${cache.projectMap.get(r.project_id) || ''}</td>
      <td>${cache.clientMap.get(r.client_id) || ''}</td>
      <td>${(cache.incomeCategories.find(c=>c.id===r.category_id)?.name) || ''}</td>
      <td class="num">${fmtCHF(r.amount_chf)}</td>
      <td>${r.status}</td>
      <td class="action"><button class="icon-btn" data-del="${r.id}">Löschen</button></td>
    `;
    tbody.appendChild(tr);
  }
  // delete handlers
  $$('#income-table [data-del]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = Number(btn.dataset.del);
      if (!confirm('Einnahme wirklich löschen?')) return;
      const del = await sb.from('incomes').delete().eq('id', id);
      if (del.error) { console.error(del.error); toast('Fehler beim Löschen'); return; }
      toast('Gelöscht');
      loadIncomes();
      initDashboard();
    });
  });
}

$('#income-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    tx_date: fd.get('tx_date'),
    project_id: fd.get('project_id') || null,
    client_id: fd.get('client_id') || null,
    category_id: Number(fd.get('category_id')),
    amount_chf: Number(fd.get('amount_chf')),
    status: fd.get('status'),
    description: fd.get('description') || null,
  };
  const ins = await sb.from('incomes').insert(payload);
  if (ins.error) { console.error(ins.error); toast('Fehler beim Speichern'); return; }
  e.target.reset();
  toast('Einnahme gespeichert');
  loadIncomes();
  initDashboard();
});

// --------- Ausgaben ---------
async function loadExpenses(){
  const res = await sb.from('expenses').select('*').order('tx_date',{ascending:false}).limit(300);
  if (res.error) { console.error(res.error); return; }
  const tbody = $('#expense-table tbody');
  tbody.innerHTML = '';
  for (const r of res.data){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtDate(r.tx_date)}</td>
      <td>${cache.projectMap.get(r.project_id) || ''}</td>
      <td>${r.vendor||''}</td>
      <td>${(cache.expenseCategories.find(c=>c.id===r.category_id)?.name) || ''}</td>
      <td class="num">${fmtCHF(r.amount_chf)}</td>
      <td class="action"><button class="icon-btn" data-del="${r.id}">Löschen</button></td>
    `;
    tbody.appendChild(tr);
  }
  $$('#expense-table [data-del]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = Number(btn.dataset.del);
      if (!confirm('Ausgabe wirklich löschen?')) return;
      const del = await sb.from('expenses').delete().eq('id', id);
      if (del.error) { console.error(del.error); toast('Fehler beim Löschen'); return; }
      toast('Gelöscht');
      loadExpenses();
      initDashboard();
    });
  });
}

$('#expense-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    tx_date: fd.get('tx_date'),
    project_id: fd.get('project_id') || null,
    vendor: fd.get('vendor') || null,
    category_id: Number(fd.get('category_id')),
    amount_chf: Number(fd.get('amount_chf')),
    description: fd.get('description') || null,
  };
  const ins = await sb.from('expenses').insert(payload);
  if (ins.error) { console.error(ins.error); toast('Fehler beim Speichern'); return; }
  e.target.reset();
  toast('Ausgabe gespeichert');
  loadExpenses();
  initDashboard();
});

// --------- Projekte ---------
async function loadProjectsTable(){
  // use view for financials
  const res = await sb.from('v_projects_financials').select('*').limit(500);
  if (res.error) { console.error(res.error); return; }
  const tbody = $('#project-table tbody');
  tbody.innerHTML = '';
  for (const r of res.data){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.name}</td>
      <td>${cache.clientMap.get(r.client_id) || ''}</td>
      <td>${r.status}</td>
      <td class="num">${fmtCHF(r.income_chf)}</td>
      <td class="num">${fmtCHF(r.expense_chf)}</td>
      <td class="num">${fmtCHF(r.profit_chf)}</td>
      <td class="action"><button class="icon-btn" data-del="${r.id}">Löschen</button></td>
    `;
    tbody.appendChild(tr);
  }
  $$('#project-table [data-del]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.del;
      if (!confirm('Projekt wirklich löschen? (verknüpfte Einträge bleiben bestehen)')) return;
      const del = await sb.from('projects').delete().eq('id', id);
      if (del.error) { console.error(del.error); toast('Fehler beim Löschen'); return; }
      toast('Gelöscht');
      await loadCatalogs();
      loadProjectsTable();
      initDashboard();
    });
  });
}

$('#project-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    name: fd.get('name'),
    client_id: fd.get('client_id') || null,
    start_date: fd.get('start_date') || null,
    end_date: fd.get('end_date') || null,
    status: fd.get('status'),
    budget_chf: fd.get('budget_chf') ? Number(fd.get('budget_chf')) : null,
    notes: fd.get('notes') || null,
  };
  const ins = await sb.from('projects').insert(payload).select().single();
  if (ins.error) { console.error(ins.error); toast('Fehler beim Speichern'); return; }
  e.target.reset();
  toast('Projekt gespeichert');
  await loadCatalogs();
  loadProjectsTable();
  initDashboard();
});

// --------- Kunden ---------
async function loadClientsTable(){
  const res = await sb.from('clients').select('*').order('created_at',{ascending:false}).limit(500);
  if (res.error) { console.error(res.error); return; }
  const tbody = $('#client-table tbody');
  tbody.innerHTML = '';
  for (const c of res.data){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.name}</td>
      <td>${c.email||''}</td>
      <td>${c.phone||''}</td>
      <td class="action"><button class="icon-btn" data-del="${c.id}">Löschen</button></td>
    `;
    tbody.appendChild(tr);
  }
  $$('#client-table [data-del]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.del;
      if (!confirm('Kunde wirklich löschen?')) return;
      const del = await sb.from('clients').delete().eq('id', id);
      if (del.error) { console.error(del.error); toast('Fehler beim Löschen'); return; }
      toast('Gelöscht');
      await loadCatalogs();
      loadClientsTable();
    });
  });
}

$('#client-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    name: fd.get('name'),
    email: fd.get('email') || null,
    phone: fd.get('phone') || null,
    billing_address: fd.get('billing_address') || null,
    vat_number: fd.get('vat_number') || null,
  };
  const ins = await sb.from('clients').insert(payload);
  if (ins.error) { console.error(ins.error); toast('Fehler beim Speichern'); return; }
  e.target.reset();
  toast('Kunde gespeichert');
  await loadCatalogs();
  loadClientsTable();
});

// --------- Dokumente ---------
function addItemRow(desc='', qty=1, price=0){
  const tbody = $('#doc-items tbody');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="item-desc" placeholder="Beschreibung" value="${desc}"></td>
    <td class="num"><input type="number" class="item-qty" min="0" step="0.001" value="${qty}"></td>
    <td class="num"><input type="number" class="item-price" min="0" step="0.01" value="${price}"></td>
    <td class="num item-total">0.00</td>
    <td class="action"><button class="icon-btn item-del">X</button></td>
  `;
  tbody.appendChild(tr);
  tr.querySelectorAll('input').forEach(inp => inp.addEventListener('input', recomputeTotals));
  tr.querySelector('.item-del').addEventListener('click', ()=>{ tr.remove(); recomputeTotals(); });
  recomputeTotals();
}

function recomputeTotals(){
  let subtotal = 0;
  $$('#doc-items tbody tr').forEach(tr => {
    const qty = Number(tr.querySelector('.item-qty').value || 0);
    const price = Number(tr.querySelector('.item-price').value || 0);
    const total = qty * price;
    tr.querySelector('.item-total').textContent = fmtCHF(total);
    subtotal += total;
  });
  const taxRate = Number($('#document-form [name="tax_rate"]').value || 0);
  const tax = subtotal * taxRate / 100;
  const total = subtotal + tax;
  $('#doc-subtotal').textContent = fmtCHF(subtotal);
  $('#doc-tax').textContent = fmtCHF(tax);
  $('#doc-total').textContent = fmtCHF(total);
}

$('#add-item').addEventListener('click', ()=> addItemRow());

$('#document-form [name="tax_rate"]').addEventListener('input', recomputeTotals);

$('#document-form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  // build document
  const fd = new FormData(e.target);
  const doc = {
    doc_type: fd.get('doc_type'),
    client_id: fd.get('client_id'),
    project_id: fd.get('project_id') || null,
    issue_date: fd.get('issue_date'),
    due_date: fd.get('due_date') || null,
    tax_rate: Number(fd.get('tax_rate') || 0),
    notes: fd.get('notes') || null
  };

  // insert document
  const ins = await sb.from('documents').insert(doc).select().single();
  if (ins.error) { console.error(ins.error); toast('Fehler: Dokument'); return; }
  const docId = ins.data.id;

  // insert items
  const rows = $$('#doc-items tbody tr');
  const items = rows.map((tr, idx)=>{
    const qty = Number(tr.querySelector('.item-qty').value||0);
    const price = Number(tr.querySelector('.item-price').value||0);
    const desc = tr.querySelector('.item-desc').value||'';
    return { document_id: docId, position: idx+1, description: desc, qty, unit_price: price };
  });

  if (items.length){
    const ii = await sb.from('document_items').insert(items);
    if (ii.error) { console.error(ii.error); toast('Fehler: Positionen'); return; }
  }

  toast('Dokument gespeichert');
  e.target.reset();
  $('#doc-items tbody').innerHTML = '';
  addItemRow();
  loadDocumentsTable();
  initDashboard();
});

async function loadDocumentsTable(){
  const res = await sb.from('documents').select('*').order('created_at',{ascending:false}).limit(200);
  if (res.error) { console.error(res.error); return; }
  const tbody = $('#document-table tbody');
  tbody.innerHTML = '';
  for (const d of res.data){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${d.doc_number || '—'}</td>
      <td>${d.doc_type}</td>
      <td>${cache.clientMap.get(d.client_id) || ''}</td>
      <td>${cache.projectMap.get(d.project_id) || ''}</td>
      <td>${d.status}</td>
      <td class="num">${fmtCHF(d.total)}</td>
      <td class="action"><button class="icon-btn" data-del="${d.id}">Löschen</button></td>
    `;
    tbody.appendChild(tr);
  }
  $$('#document-table [data-del]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.dataset.del;
      if (!confirm('Dokument wirklich löschen?')) return;
      const del = await sb.from('documents').delete().eq('id', id);
      if (del.error) { console.error(del.error); toast('Fehler beim Löschen'); return; }
      toast('Gelöscht');
      loadDocumentsTable();
      initDashboard();
    });
  });
}

// --------- Boot ---------
async function boot(){
  setupRouter();
  $('#refreshBtn').addEventListener('click', async ()=>{
    await loadCatalogs();
    await initDashboard();
    ['incomes','expenses','projects','clients','documents'].forEach(id=>{
      if ($('#'+id).classList.contains('active')) {
        const map = {incomes:loadIncomes, expenses:loadExpenses, projects:loadProjectsTable, clients:loadClientsTable, documents:loadDocumentsTable};
        map[id]();
      }
    });
  });

  await loadCatalogs();
  addItemRow(); // seed one row for documents
  initDashboard();
}

boot();

// Mobile sidebar toggle
const sidebar = document.querySelector('.sidebar');
const backdrop = document.getElementById('backdrop');
const toggle = document.getElementById('menuToggle');

function closeSidebar(){ sidebar.classList.remove('open'); backdrop.classList.remove('show'); }
function openSidebar(){ sidebar.classList.add('open'); backdrop.classList.add('show'); }

toggle?.addEventListener('click', ()=>{
  if (sidebar.classList.contains('open')) closeSidebar(); else openSidebar();
});
backdrop?.addEventListener('click', closeSidebar);

// Beim Navigieren auf Mobile Sidebar schließen
document.querySelectorAll('.nav-link').forEach(btn=>{
  btn.addEventListener('click', ()=> { if (window.innerWidth <= 980) closeSidebar(); });
});
