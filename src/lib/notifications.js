import { supabase } from './supabase'

export async function runDailyNotificationChecks(company_id) {
  if (!company_id) return;
  const today = new Date();
  
  // 1. Check contracts (bookings ending in 7, 3, 1 days)
  const daysToCheck = [7, 3, 1];
  for (const days of daysToCheck) {
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + days);
    const dateStr = targetDate.toISOString().split('T')[0];
    
    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, unit_id, customers(full_name), units(unit_number)')
      .eq('company_id', company_id)
      .eq('status', 'checked_in')
      .eq('check_out_date', dateStr);
      
    if (bookings && bookings.length > 0) {
      for (const b of bookings) {
        const evType = `contract_ending_${days}`;
        // check if notification already exists
        const { data: existing } = await supabase
          .from('notifications')
          .select('id')
          .eq('booking_id', b.id)
          .eq('event_type', evType)
          .single();
          
        if (!existing) {
          await supabase.from('notifications').insert({
            company_id,
            target_role: 'manager',
            channel: 'in_app',
            event_type: evType,
            title: `عقد إيجار ينتهي بعد ${days} يوم`,
            body: `عقد إيجار الوحدة ${b.units?.unit_number} للمستأجر ${b.customers?.full_name} سينتهي في ${dateStr}.`,
            booking_id: b.id,
            unit_id: b.unit_id
          });
        }
      }
    }
  }

  // 2. Check employee visa/iqama expiry (in 30, 15, 7 days)
  const visaDays = [30, 15, 7, 3, 1];
  for (const days of visaDays) {
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + days);
    const dateStr = targetDate.toISOString().split('T')[0];
    
    const { data: staff } = await supabase
      .from('profiles')
      .select('id, full_name, iqama_expiry')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .eq('iqama_expiry', dateStr);
      
    if (staff && staff.length > 0) {
      for (const p of staff) {
        const evType = `iqama_expiring_${days}`;
        const { data: existing } = await supabase
          .from('notifications')
          .select('id')
          .eq('user_id', p.id)
          .eq('event_type', evType)
          .single();
          
        if (!existing) {
          await supabase.from('notifications').insert({
            company_id,
            target_role: 'manager',
            channel: 'in_app',
            event_type: evType,
            title: `انتهاء إقامة موظف بعد ${days} يوم`,
            body: `إقامة/تأشيرة الموظف ${p.full_name} ستنتهي بتاريخ ${dateStr}. يرجى اتخاذ الإجراءات اللازمة.`,
            user_id: p.id
          });
        }
      }
    }
  }
}
