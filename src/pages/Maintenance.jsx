import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../AuthContext';
import { SAR, today, uploadFile, openStoredDocument } from '../lib/helpers';
import { syncExpenseToAccounting } from '../lib/accountingSync';
import { useBranches } from '../BranchContext';

export default function Maintenance() {
  const { profile, company, toast } = useAuth();
  const { scopeQuery, activeBranch } = useBranches();
  const [tickets, setTickets] = useState([]);
  const [units, setUnits] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showSplitForm, setShowSplitForm] = useState(false);
  const [splitForm, setSplitForm] = useState({
    request_type: 'elec_bill',
    description: '',
    bill_number: '',
    total_cost: '',
    selected_units: []
  });
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [form, setForm] = useState({
    unit_id: '',
    request_type: 'maintenance', // 'cleaning', 'maintenance', 'elec_bill', 'water_bill', 'other_bill'
    description: '',
    bill_number: '',
    status: 'open', // 'open', 'in_progress', 'done'
    cost: '',
    assigned_to: '',
    auto_expense: true,
    update_unit_status: true
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    const cid = profile?.company_id || company?.id;

    try {
      // 1. Fetch Units
      let unitsQuery = scopeQuery(supabase
        .from('units')
        .select('id, unit_number, category, status, daily_price'));

      if (cid) {
        unitsQuery = unitsQuery.eq('company_id', cid);
      }

      let { data: unitsData, error: uErr } = await unitsQuery.order('unit_number', { ascending: true });
      if (uErr) throw uErr;
      setUnits(unitsData || []);

      // 2. Fetch Employees
      let empQuery = supabase.from('profiles').select('id, full_name, role');
      if (cid) {
        empQuery = empQuery.eq('company_id', cid);
      }
      let { data: empData } = await empQuery;
      if (!empData || empData.length === 0) {
        const { data: fallbackEmp } = await supabase.from('profiles').select('id, full_name, role');
        if (fallbackEmp) empData = fallbackEmp;
      }
      setEmployees(empData || []);

      // 3. Fetch Maintenance Tickets
      let ticketQuery = scopeQuery(supabase
        .from('maintenance_requests')
        .select('*, units(id, unit_number, category), assigned:assigned_to(full_name)'))
        .order('opened_at', { ascending: false });

      if (cid) {
        ticketQuery = ticketQuery.eq('company_id', cid);
      }

      let { data: ticketsData, error: tErr } = await ticketQuery;
      if (tErr) {
        let simpleQuery = scopeQuery(supabase.from('maintenance_requests').select('*')).order('opened_at', { ascending: false });
        if (cid) simpleQuery = simpleQuery.eq('company_id', cid);
        const { data: simpleData } = await simpleQuery;
        ticketsData = simpleData;
      }
      setTickets(ticketsData || []);
    } catch (err) {
      console.error('Error loading maintenance data:', err);
      toast('حدث خطأ أثناء تحميل بيانات الصيانة', true);
    } finally {
      setLoading(false);
    }
  }, [profile, company, toast, scopeQuery, activeBranch]);

  useEffect(() => {
    loadData();

    // Auto-detect unit_id from URL parameter (e.g. from unit card or QR code scan)
    const params = new URLSearchParams(window.location.search);
    const scannedUnitId = params.get('unit_id');
    if (scannedUnitId) {
      setForm(f => ({ ...f, unit_id: scannedUnitId }));
      setShowForm(true);
      toast('📱 تم تحديد الوحدة تلقائياً لطلب الصيانة');
    }

    // Real-time subscription for maintenance tickets
    const cid = profile?.company_id || company?.id;
    if (cid) {
      const sub = supabase.channel('maintenance_changes_' + cid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'maintenance_requests', filter: `company_id=eq.${cid}` }, () => {
          loadData();
        })
        .subscribe();

      return () => supabase.removeChannel(sub);
    }
  }, [loadData, profile, company, toast]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.unit_id || !form.description.trim()) {
      return toast('يرجى اختيار الوحدة وإدخال وصف العطل/الخدمة', true);
    }
    const isBill = ['elec_bill', 'water_bill', 'other_bill'].includes(form.request_type);
    if (isBill && !form.bill_number.trim()) {
      return toast('يرجى إدخال رقم الفاتورة المدفوعة', true);
    }

    setBusy(true);
    const cid = profile?.company_id || company?.id;
    const costNum = form.cost ? Number(form.cost) : 0;
    const shouldPostExpense = form.auto_expense && costNum > 0;
    
    let baseDesc = form.description.trim();
    if (isBill) baseDesc += ` (رقم الفاتورة: ${form.bill_number.trim()})`;
    const finalDesc = shouldPostExpense ? `${baseDesc} (تم الفوترة)` : baseDesc;

    let invoiceUrl = null;
    if (file) {
      try {
        invoiceUrl = await uploadFile(supabase, 'documents', cid, file);
      } catch (err) {
        console.warn('Upload fallback to data URL:', err);
        invoiceUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
      }
    }

    const { error } = await supabase.from('maintenance_requests').insert({
      company_id: cid,
      unit_id: form.unit_id,
      request_type: form.request_type,
      description: finalDesc,
      status: form.status,
      cost: costNum,
      photos: invoiceUrl ? [invoiceUrl] : [],
      assigned_to: form.assigned_to || null,
      opened_by: profile?.id || null
    });

    if (error) {
      toast('حدث خطأ أثناء حفظ الطلب: ' + error.message, true);
      setBusy(false);
      return;
    }

    // Update unit status if checked
    if (form.update_unit_status && !isBill) {
      const newStatus = form.request_type === 'cleaning' ? 'cleaning' : 'maintenance';
      await supabase.from('units').update({ status: newStatus }).eq('id', form.unit_id);
    }

    // Auto expense posting to Accounting
    if (shouldPostExpense) {
      const unitObj = units.find(u => u.id === form.unit_id);
      const unitLabel = unitObj ? ` - وحدة ${unitObj.unit_number || unitObj.id.slice(0,6)}` : '';
      let expenseCategory = 'maintenance';
      let expenseLabel = 'صيانة';
      if (form.request_type === 'elec_bill') { expenseCategory = 'elec_bill'; expenseLabel = 'فاتورة كهرباء'; }
      if (form.request_type === 'water_bill') { expenseCategory = 'water_bill'; expenseLabel = 'فاتورة مياه'; }
      if (form.request_type === 'other_bill') { expenseCategory = 'other_bill'; expenseLabel = 'فاتورة أخرى'; }
      
      const { data: expenseRow, error: expenseError } = await supabase.from('expenses').insert({
        company_id: cid,
        unit_id: form.unit_id,
        category: expenseCategory,
        amount: costNum,
        description: `تكلفة ${expenseLabel}: ${baseDesc}${unitLabel}`,
        expense_date: today(),
        invoice_url: invoiceUrl,
        created_by: profile?.id || null
      }).select('id').single();
      if (expenseError) throw expenseError

      // Synchronize to Chart of Accounts
      try {
        await syncExpenseToAccounting(supabase, {
          companyId: cid,
          expenseId: expenseRow.id,
          unitId: form.unit_id,
          category: expenseCategory,
          amount: costNum,
          description: `تكلفة ${expenseLabel}: ${baseDesc}${unitLabel}`,
          paymentMethod: 'bank_transfer'
        });
      } catch (syncErr) {
        console.warn('Accounting sync failed:', syncErr);
      }
    }

    // Notifications
    await supabase.from('notifications').insert({
      company_id: cid,
      target_role: 'manager',
      channel: 'in_app',
      event_type: 'maintenance_request',
      title: isBill ? 'فاتورة وحدة جديدة' : 'طلب صيانة جديد',
      body: `${isBill ? 'فاتورة' : 'طلب صيانة'} للوحدة: ${baseDesc}`,
      unit_id: form.unit_id
    });

    toast(shouldPostExpense ? '✓ تم حفظ الطلب وترحيل التكلفة والمستند للحسابات' : '✓ تم الحفظ بنجاح');
    setShowForm(false);
    setForm({ unit_id: '', request_type: 'maintenance', description: '', bill_number: '', status: 'open', cost: '', assigned_to: '', auto_expense: true, update_unit_status: true });
    setFile(null);
    setBusy(false);
    loadData();
  };

  const handleSplitSubmit = async (e) => {
    e.preventDefault();
    if (splitForm.selected_units.length === 0) {
      return toast('يرجى اختيار الوحدات المراد توزيع الفاتورة عليها', true);
    }
    const costNum = Number(splitForm.total_cost);
    if (isNaN(costNum) || costNum <= 0) {
      return toast('يرجى إدخال إجمالي مبلغ الفاتورة بشكل صحيح', true);
    }
    if (!splitForm.bill_number.trim()) {
      return toast('يرجى إدخال رقم الفاتورة المشتركة', true);
    }
    
    setBusy(true);
    const cid = profile?.company_id || company?.id;
    
    let invoiceUrl = null;
    if (file) {
      try {
        invoiceUrl = await uploadFile(supabase, 'documents', cid, file);
      } catch (err) {
        invoiceUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
      }
    }

    const unitCount = splitForm.selected_units.length;
    const amountPerUnit = costNum / unitCount;

    let expenseCategory = 'other_bill';
    let expenseLabel = 'فاتورة مقسمة';
    if (splitForm.request_type === 'elec_bill') { expenseCategory = 'elec_bill'; expenseLabel = 'فاتورة كهرباء مقسمة'; }
    if (splitForm.request_type === 'water_bill') { expenseCategory = 'water_bill'; expenseLabel = 'فاتورة مياه مقسمة'; }

    const baseDesc = splitForm.description.trim() ? splitForm.description.trim() : expenseLabel;
    const fullDesc = `${baseDesc} (فاتورة مجمعة رقم: ${splitForm.bill_number.trim()} - تم توزيعها على ${unitCount} وحدات)`;

    for (const uId of splitForm.selected_units) {
      const uObj = units.find(u => u.id === uId) || {};
      const unitLabel = uObj ? ` - وحدة ${uObj.unit_number || uId.slice(0,6)}` : '';
      
      // 1. Insert Maintenance Request
      await supabase.from('maintenance_requests').insert({
        company_id: cid,
        unit_id: uId,
        request_type: splitForm.request_type,
        description: fullDesc,
        status: 'done', // automatically closed since it's just a bill
        cost: amountPerUnit,
        photos: invoiceUrl ? [invoiceUrl] : [],
        opened_by: profile?.id || null
      });

      // 2. Insert Expense
      const { data: expenseRow, error: expenseError } = await supabase.from('expenses').insert({
        company_id: cid,
        unit_id: uId,
        category: expenseCategory,
        amount: amountPerUnit,
        description: `توزيع ${expenseLabel}: ${fullDesc}${unitLabel}`,
        expense_date: today(),
        invoice_url: invoiceUrl,
        created_by: profile?.id || null
      }).select('id').single();
      if (expenseError) throw expenseError

      // Synchronize to Chart of Accounts
      try {
        await syncExpenseToAccounting(supabase, {
          companyId: cid,
          expenseId: expenseRow.id,
          unitId: uId,
          category: expenseCategory,
          amount: amountPerUnit,
          description: `توزيع ${expenseLabel}: ${fullDesc}${unitLabel}`,
          paymentMethod: 'bank_transfer'
        });
      } catch (syncErr) {
        console.warn('Accounting sync failed:', syncErr);
      }
    }

    toast(`✓ تم توزيع الفاتورة المجمعة بقيمة ${SAR(costNum)} على ${unitCount} وحدات وترحيلها للحسابات`);
    setShowSplitForm(false);
    setSplitForm({ request_type: 'elec_bill', description: '', bill_number: '', total_cost: '', selected_units: [] });
    setFile(null);
    setBusy(false);
    loadData();
  };

  const handleAttachDocToTicket = async (ticketId, selectedFile) => {
    if (!selectedFile) return;
    const cid = profile?.company_id || company?.id;
    setBusy(true);
    try {
      let uploadedUrl = null;
      try {
        uploadedUrl = await uploadFile(supabase, 'documents', cid, selectedFile);
      } catch (err) {
        uploadedUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(selectedFile);
        });
      }

      const { error } = await supabase
        .from('maintenance_requests')
        .update({
          photos: [uploadedUrl]
        })
        .eq('id', ticketId);

      if (error) throw error;

      // Also update any corresponding expense if billed
      const ticket = tickets.find(t => t.id === ticketId);
      if (ticket && ticket.cost > 0) {
        const cleanDesc = ticket.description.replace(/\(تم الفوترة\)/g, '').trim();
        await supabase
          .from('expenses')
          .update({ invoice_url: uploadedUrl })
          .eq('company_id', cid)
          .eq('unit_id', ticket.unit_id)
          .eq('category', 'maintenance');
      }

      toast('✓ تم رفع وإرفاق مستند الفاتورة بنجاح وتحويله للحسابات');
      loadData();
    } catch (err) {
      toast('خطأ في رفع المستند: ' + err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (ticket, newStatus) => {
    const updates = { status: newStatus };
    if (newStatus === 'done') updates.closed_at = new Date().toISOString();

    const { error } = await supabase
      .from('maintenance_requests')
      .update(updates)
      .eq('id', ticket.id);

    if (error) {
      toast('خطأ أثناء التحديث: ' + error.message, true);
      return;
    }

    if (newStatus === 'done' && ticket.unit_id) {
      const unitObj = units.find(u => u.id === ticket.unit_id);
      if (unitObj && (unitObj.status === 'maintenance' || unitObj.status === 'cleaning')) {
        await supabase.from('units').update({ status: 'available' }).eq('id', ticket.unit_id);
        toast('✓ تم تحديث التذكرة وتحويل الوحدة إلى (متاحة)');
      } else {
        toast('تم تحديث حالة التذكرة إلى مكتملة');
      }
    } else {
      toast('تم تحديث حالة التذكرة بنجاح');
    }

    loadData();
  };

  const deleteTicket = async (id) => {
    if (!confirm('هل أنت متأكد من حذف تذكرة الصيانة؟')) return;
    const { error } = await supabase.from('maintenance_requests').delete().eq('id', id);
    if (!error) {
      toast('تم الحذف بنجاح');
      loadData();
    } else {
      toast('خطأ أثناء الحذف: ' + error.message, true);
    }
  };

  const convertToInvoice = async (ticket) => {
    if (!ticket.cost || ticket.cost <= 0) return toast('لا يمكن تحويل تذكرة بدون تكلفة إلى فاتورة', true);
    if (!confirm(`هل أنت متأكد من تحويل تذكرة الصيانة بتكلفة ${SAR(ticket.cost)} إلى فاتورة (مصروفات) بالحسابات؟`)) return;

    setBusy(true);
    const cid = profile?.company_id || company?.id || ticket.company_id;
    const unitObj = units.find(u => u.id === ticket.unit_id);
    const unitLabel = unitObj ? ` - وحدة ${unitObj.unit_number || unitObj.id.slice(0,6)}` : (ticket.units ? ` - وحدة ${ticket.units.unit_number}` : '');
    const invUrl = ticket.invoice_url || (Array.isArray(ticket.photos) && ticket.photos[0]) || null;

    const { data: expenseRow, error } = await supabase.from('expenses').insert({
      company_id: cid,
      unit_id: ticket.unit_id,
      category: 'maintenance',
      amount: Number(ticket.cost),
      description: `تكلفة صيانة: ${ticket.description}${unitLabel}`,
      expense_date: today(),
      invoice_url: invUrl,
      created_by: profile?.id || null
    }).select('id').single();

    if (!error) {
      try {
        await syncExpenseToAccounting(supabase, {
          companyId: cid,
          expenseId: expenseRow.id,
          unitId: ticket.unit_id,
          category: 'maintenance',
          amount: Number(ticket.cost),
          description: `تكلفة صيانة: ${ticket.description}${unitLabel}`,
          paymentMethod: 'bank_transfer'
        });
      } catch (syncErr) {
        console.warn('Accounting sync failed:', syncErr);
      }

      toast('✓ تم إنشاء فاتورة المصروفات وربط مستند الفاتورة بمركز الحسابات بنجاح');
      const updatedDesc = ticket.description.includes('(تم الفوترة)') ? ticket.description : `${ticket.description} (تم الفوترة)`;
      await supabase.from('maintenance_requests').update({ description: updatedDesc }).eq('id', ticket.id);
      loadData();
    } else {
      toast('خطأ أثناء تحويل التذكرة لفاتورة: ' + error.message, true);
    }
    setBusy(false);
  };

  const STATUS_COLORS = { open: 'var(--blue)', in_progress: 'var(--warn)', done: 'var(--green)' };
  const STATUS_LABELS = { open: 'مفتوحة', in_progress: 'قيد التنفيذ', done: 'مكتملة' };
  const TYPE_LABELS = { maintenance: 'صيانة عطل', cleaning: 'نظافة وتجهيز', elec_bill: 'فاتورة كهرباء', water_bill: 'فاتورة مياه', other_bill: 'فواتير أخرى' };

  // Filtered tickets logic
  const filteredTickets = tickets.filter(t => {
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (filterType !== 'all' && t.request_type !== filterType) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const unitNum = (t.units?.unit_number || '').toString().toLowerCase();
      const desc = (t.description || '').toLowerCase();
      const tech = (t.assigned?.full_name || '').toLowerCase();
      return unitNum.includes(q) || desc.includes(q) || tech.includes(q);
    }
    return true;
  });

  if (loading && tickets.length === 0) return <div className="panel" style={{ textAlign: 'center', padding: 40 }}>جاري تحميل لوحة الصيانة الفورية والوحدات المرتبطة...</div>;

  return (
    <div className="panel animate-fade">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            🔧 لوحة المتابعة الفورية للصيانة والخدمات والفواتير
            <span className="live-indicator" style={{ display: 'inline-flex', width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 8px var(--green)' }} title="متصل بالزمن الفعلي"></span>
          </h3>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0' }}>
            ربط مباشر مع جميع الوحدات السكنية، تتبع أعطال الصيانة، الفواتير، والفوترة التلقائية بالحسابات.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={loadData} title="تحديث البيانات">
            🔄 تحديث
          </button>
          <button className="btn btn-outline" onClick={() => { setShowSplitForm(!showSplitForm); setShowForm(false); }}>
            {showSplitForm ? 'إلغاء توزيع المصروفات' : '+ توزيع فاتورة مجمعة'}
          </button>
          <button className="btn btn-gold" onClick={() => { setShowForm(!showForm); setShowSplitForm(false); }}>
            {showForm ? 'إلغاء' : '+ تذكرة / فاتورة جديدة'}
          </button>
        </div>
      </div>

      {/* Overview Metric Cards */}
      <div className="grid3" style={{ marginBottom: 20 }}>
        <div className="card" style={{ padding: 15, background: 'var(--blue-soft)', borderRight: '4px solid var(--blue)' }}>
          <h4 style={{ margin: 0, color: 'var(--blue)', fontSize: 13 }}>تذاكر مفتوحة</h4>
          <h2 style={{ margin: '8px 0 0', fontSize: 24 }}>{tickets.filter(t => t.status === 'open').length}</h2>
        </div>
        <div className="card" style={{ padding: 15, background: 'var(--warn-soft)', borderRight: '4px solid var(--warn)' }}>
          <h4 style={{ margin: 0, color: 'var(--warn)', fontSize: 13 }}>قيد التنفيذ</h4>
          <h2 style={{ margin: '8px 0 0', fontSize: 24 }}>{tickets.filter(t => t.status === 'in_progress').length}</h2>
        </div>
        <div className="card" style={{ padding: 15, background: 'var(--green-soft)', borderRight: '4px solid var(--green)' }}>
          <h4 style={{ margin: 0, color: 'var(--green)', fontSize: 13 }}>مكتملة</h4>
          <h2 style={{ margin: '8px 0 0', fontSize: 24 }}>{tickets.filter(t => t.status === 'done').length}</h2>
        </div>
      </div>

      {/* Form: New Maintenance Ticket */}
      {showForm && (
        <form className="card animate-fade" onSubmit={handleSubmit} style={{ marginBottom: 24, padding: 20, border: '1.5px solid var(--gold)' }}>
          <h4 style={{ margin: '0 0 16px', color: 'var(--gold-l)', display: 'flex', alignItems: 'center', gap: 8 }}>
            📝 إنشاء تذكرة صيانة أو إرفاق فاتورة وحدة جديدة
          </h4>

          <div className="grid">
            <div className="fld">
              <label>اختر الوحدة السكنية المرتبطة * ({units.length} وحدة متبقية)</label>
              <select
                value={form.unit_id}
                onChange={e => setForm({ ...form, unit_id: e.target.value })}
                required
                style={{ fontWeight: 'bold' }}
              >
                <option value="">
                  {units.length === 0 ? '-- جارٍ تحميل الوحدات أو لا توجد وحدات --' : '-- اختر الوحدة السكنية --'}
                </option>
                {units.map(u => (
                  <option key={u.id} value={u.id}>
                    وحدة {u.unit_number || u.id.slice(0, 8)} {u.category ? `(${u.category})` : ''} {u.status ? `[${u.status === 'occupied' ? 'مسكونة' : u.status === 'maintenance' ? 'صيانة' : u.status === 'cleaning' ? 'تنظيف' : 'متاحة'}]` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="fld">
              <label>نوع الطلب *</label>
              <select value={form.request_type} onChange={e => setForm({ ...form, request_type: e.target.value })} required>
                <option value="maintenance">صيانة عطل</option>
                <option value="cleaning">نظافة وتجهيز</option>
                <option value="elec_bill">فاتورة كهرباء</option>
                <option value="water_bill">فاتورة مياه</option>
                <option value="other_bill">فواتير أخرى</option>
              </select>
            </div>
          </div>

          {['elec_bill', 'water_bill', 'other_bill'].includes(form.request_type) && (
            <div className="fld">
              <label>رقم الفاتورة المدفوعة *</label>
              <input
                type="text"
                value={form.bill_number}
                onChange={e => setForm({ ...form, bill_number: e.target.value })}
                placeholder="أدخل رقم الفاتورة أو الحساب"
                required
              />
            </div>
          )}

          <div className="fld">
            <label>التفاصيل ووصف العطل / الخدمة المطلوبة / ملاحظات الفاتورة *</label>
            <textarea
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              rows="3"
              placeholder="مثال: تسريب مياه بالحمام، فاتورة كهرباء لشهر مايو، تنظيف شامل..."
              required
            ></textarea>
          </div>

          <div className="grid">
            <div className="fld">
              <label>التكلفة المتوقعة/الفعلية (ر.س)</label>
              <input
                type="number"
                value={form.cost}
                onChange={e => setForm({ ...form, cost: e.target.value })}
                placeholder="0.00"
                min="0"
                step="any"
              />
            </div>
            <div className="fld">
              <label>الفني أو الموظف المسؤول</label>
              <select value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })}>
                <option value="">-- غير معين --</option>
                {employees.map(e => (
                  <option key={e.id} value={e.id}>{e.full_name} ({e.role || 'فني'})</option>
                ))}
              </select>
            </div>
          </div>

          <div className="fld" style={{ marginTop: 12 }}>
            <label style={{ fontWeight: 'bold' }}>📄 إرفاق صورة/مستند الفاتورة أو الإيصال (سيتم إرسالها تلقائياً للحسابات)</label>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={e => setFile(e.target.files?.[0] || null)}
              style={{ fontSize: 13, padding: '8px', border: '1px dashed var(--border)', borderRadius: 8, background: 'var(--bg-soft)', width: '100%' }}
            />
            {file && (
              <div style={{ fontSize: 12, color: 'var(--green)', marginTop: 4, fontWeight: 'bold' }}>
                ✓ ملف محدد: {file.name} ({(file.size / 1024).toFixed(1)} كيلوبايت)
              </div>
            )}
          </div>

          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.update_unit_status}
                onChange={e => setForm({ ...form, update_unit_status: e.target.checked })}
              />
              ⚙️ تغيير حالة الوحدة فوراً إلى ({form.request_type === 'cleaning' ? 'تنظيف' : 'تحت الصيانة'})
            </label>

            {Number(form.cost) > 0 && (
              <div style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid #10B981', padding: '10px 14px', borderRadius: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: 0, fontSize: 13, color: '#10B981', fontWeight: 'bold' }}>
                  <input
                    type="checkbox"
                    checked={form.auto_expense}
                    onChange={e => setForm({ ...form, auto_expense: e.target.checked })}
                  />
                  🧾 ترحيل التكلفة تلقائياً إلى قيد المصروفات والحسابات فور الحفظ
                </label>
              </div>
            )}
          </div>

          <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
            <button type="submit" className="btn btn-green" disabled={busy}>
              {busy ? 'جاري الحفظ...' : '💾 حفظ تذكرة الصيانة'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
              إلغاء
            </button>
          </div>
        </form>
      )}

      {showSplitForm && (
        <form className="card animate-fade" onSubmit={handleSplitSubmit} style={{ marginBottom: 24, padding: 20, border: '1.5px solid var(--blue)' }}>
          <h4 style={{ margin: '0 0 16px', color: 'var(--blue)', display: 'flex', alignItems: 'center', gap: 8 }}>
            📊 توزيع مصروفات فاتورة مجمعة على الوحدات (توزيع آلي)
          </h4>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: -8, marginBottom: 16 }}>
            سيتم تقسيم قيمة الفاتورة بالتساوي على الوحدات المحددة، وسيتم ترحيل قيد المصروفات وإنشاء تذكرة مغلقة لكل وحدة تلقائياً.
          </p>

          <div className="grid">
            <div className="fld">
              <label>نوع الفاتورة *</label>
              <select value={splitForm.request_type} onChange={e => setSplitForm({ ...splitForm, request_type: e.target.value })} required>
                <option value="elec_bill">فاتورة كهرباء مجمعة</option>
                <option value="water_bill">فاتورة مياه مجمعة</option>
                <option value="other_bill">فاتورة أخرى مجمعة</option>
              </select>
            </div>
            <div className="fld">
              <label>إجمالي قيمة الفاتورة (ر.س) *</label>
              <input
                type="number"
                value={splitForm.total_cost}
                onChange={e => setSplitForm({ ...splitForm, total_cost: e.target.value })}
                placeholder="0.00"
                min="0.01"
                step="any"
                required
              />
            </div>
          </div>

          <div className="grid">
            <div className="fld">
              <label>رقم الفاتورة المشتركة *</label>
              <input
                type="text"
                value={splitForm.bill_number}
                onChange={e => setSplitForm({ ...splitForm, bill_number: e.target.value })}
                placeholder="رقم الفاتورة للرجوع إليها"
                required
              />
            </div>
            <div className="fld">
              <label>ملاحظات (اختياري)</label>
              <input
                type="text"
                value={splitForm.description}
                onChange={e => setSplitForm({ ...splitForm, description: e.target.value })}
                placeholder="مثال: فاتورة كهرباء المجمع لشهر يوليو"
              />
            </div>
          </div>

          <div className="fld" style={{ marginTop: 12 }}>
            <label>اختر الوحدات المستفيدة (المشاركة في هذه الفاتورة) *</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12, border: '1px solid var(--border-color)', borderRadius: 8, background: 'rgba(0,0,0,0.02)' }}>
              {units.map(u => {
                const isSelected = splitForm.selected_units.includes(u.id);
                return (
                  <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', background: isSelected ? 'var(--blue-soft)' : 'var(--card-bg)', border: isSelected ? '1px solid var(--blue)' : '1px solid var(--border-color)', borderRadius: 20, cursor: 'pointer', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={e => {
                        const newSelection = e.target.checked 
                          ? [...splitForm.selected_units, u.id]
                          : splitForm.selected_units.filter(id => id !== u.id);
                        setSplitForm({ ...splitForm, selected_units: newSelection });
                      }}
                      style={{ margin: 0 }}
                    />
                    وحدة {u.unit_number}
                  </label>
                );
              })}
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSplitForm({ ...splitForm, selected_units: units.map(u => u.id) })}>تحديد الكل</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSplitForm({ ...splitForm, selected_units: [] })}>إلغاء التحديد</button>
            </div>
          </div>
          
          <div className="fld" style={{ marginTop: 12 }}>
            <label style={{ fontWeight: 'bold' }}>📄 إرفاق صورة/مستند الفاتورة الأصلية المشتركة (اختياري)</label>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={e => setFile(e.target.files?.[0] || null)}
            />
          </div>

          <div style={{ marginTop: 18, display: 'flex', gap: 10, alignItems: 'center' }}>
            <button type="submit" className="btn btn-blue" disabled={busy}>
              {busy ? 'جاري التوزيع والترحيل...' : '⚙️ توزيع الفاتورة واعتمادها في الحسابات'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setShowSplitForm(false)}>
              إلغاء
            </button>
            
            {splitForm.selected_units.length > 0 && Number(splitForm.total_cost) > 0 && (
              <div style={{ fontSize: 13, color: 'var(--muted)', marginRight: 'auto' }}>
                نصيب الوحدة الواحدة: <span style={{ fontWeight: 'bold', color: 'var(--fg)' }}>{SAR(Number(splitForm.total_cost) / splitForm.selected_units.length)}</span>
              </div>
            )}
          </div>
        </form>
      )}

      {/* Filter and Search Bar */}
      <div className="card" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 'bold' }}>الحالة:</span>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="btn-sm" style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
            <option value="all">الكل ({tickets.length})</option>
            <option value="open">مفتوحة</option>
            <option value="in_progress">قيد التنفيذ</option>
            <option value="done">مكتملة</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 'bold' }}>النوع:</span>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="btn-sm" style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
            <option value="all">الكل</option>
            <option value="maintenance">صيانة عطل</option>
            <option value="cleaning">نظافة وتجهيز</option>
            <option value="elec_bill">فاتورة كهرباء</option>
            <option value="water_bill">فاتورة مياه</option>
            <option value="other_bill">فواتير أخرى</option>
          </select>
        </div>

        <div style={{ flex: 1, minWidth: 200 }}>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="🔍 بحث برقم الوحدة، وصف العطل، أو اسم الفني..."
            style={{ width: '100%', padding: '6px 12px', fontSize: 13 }}
          />
        </div>
      </div>

      {/* Tickets Table */}
      {filteredTickets.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', background: 'var(--bg)', borderRadius: 12 }}>
          {tickets.length === 0 ? 'لا توجد تذاكر صيانة مسجلة حالياً.' : 'لا توجد نتائج تطابق خيارات البحث والتصفية.'}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 110 }}>التاريخ</th>
                <th style={{ width: 140 }}>الوحدة السكنية</th>
                <th style={{ width: 140 }}>النوع / الفني</th>
                <th>التفاصيل والملاحظات</th>
                <th style={{ width: 140 }}>التكلفة / الفوترة</th>
                <th style={{ width: 100 }}>الحالة</th>
                <th style={{ width: 140 }}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredTickets.map(t => {
                const isBilled = t.description?.includes('(تم الفوترة)');
                const unitObj = t.units || units.find(u => u.id === t.unit_id);
                const unitName = unitObj ? `وحدة ${unitObj.unit_number || unitObj.name || ''}` : `وحدة (معرف: ${t.unit_id?.slice(0, 6)})`;
                const docUrl = t.invoice_url || (Array.isArray(t.photos) && t.photos[0]) || null;

                return (
                  <tr key={t.id}>
                    <td dir="ltr" style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {t.opened_at ? new Date(t.opened_at).toLocaleDateString('en-GB') : '—'}
                    </td>
                    <td>
                      <b style={{ color: 'var(--gold-l)', fontSize: 14 }}>{unitName}</b>
                      {unitObj?.category && <div style={{ fontSize: 11, opacity: 0.7 }}>{unitObj.category}</div>}
                    </td>
                    <td>
                      <div style={{ fontWeight: 'bold', fontSize: 13 }}>{TYPE_LABELS[t.request_type] || t.request_type}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                        👤 {t.assigned?.full_name || 'غير معين'}
                      </div>
                    </td>
                    <td style={{ fontSize: 13 }}>
                      <div>{t.description}</div>
                      {docUrl ? (
                        <button
                          type="button"
                          onClick={() => openStoredDocument(supabase, docUrl, {
                            onError: message => toast(message, true),
                            context: { area: 'maintenance', ticket_id: t.id, document_kind: 'invoice' },
                          })}
                          className="btn btn-ghost btn-sm"
                          style={{ padding: '2px 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, border: '1px solid var(--border)', color: 'var(--blue)' }}
                        >
                          📄 عرض مستند الفاتورة
                        </button>
                      ) : (
                        <label
                          className="btn btn-ghost btn-sm"
                          style={{ padding: '2px 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, border: '1px dashed var(--border)', cursor: 'pointer', color: 'var(--gold)' }}
                        >
                          📎 رفع مستند الفاتورة
                          <input
                            type="file"
                            accept="image/*,.pdf"
                            style={{ display: 'none' }}
                            onChange={e => e.target.files?.[0] && handleAttachDocToTicket(t.id, e.target.files[0])}
                          />
                        </label>
                      )}
                    </td>
                    <td>
                      <div className="money" style={{ fontWeight: 'bold', fontSize: 14 }}>{SAR(t.cost || 0)}</div>
                      {t.cost > 0 && !isBilled && (
                        <button
                          className="btn btn-gold btn-sm"
                          onClick={() => convertToInvoice(t)}
                          style={{ padding: '3px 8px', fontSize: 11, marginTop: 4, width: '100%' }}
                        >
                          🧾 تحويل للحسابات
                        </button>
                      )}
                      {isBilled && (
                        <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 'bold', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                          ✓ مفوترة بالحسابات
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="chip" style={{ background: 'var(--soft)', color: STATUS_COLORS[t.status], fontWeight: 'bold', fontSize: 12 }}>
                        {STATUS_LABELS[t.status] || t.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <select
                          className="btn-sm"
                          value={t.status}
                          onChange={e => updateStatus(t, e.target.value)}
                          style={{ padding: '3px 6px', fontSize: 11, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)' }}
                        >
                          <option value="open">مفتوحة</option>
                          <option value="in_progress">تنفيذ</option>
                          <option value="done">مكتملة</option>
                        </select>
                        <button
                          className="btn-icon"
                          onClick={() => deleteTicket(t.id)}
                          title="حذف التذكرة"
                          style={{ color: 'var(--danger)', fontSize: 14 }}
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
