// src/lib/offlineManager.js
// إدارة التخزين المؤقت للبيانات العملياتية والمزامنة التلقائية عند إعادة الاتصال

const CACHE_PREFIX = 'almazen_op_cache_';
const OFFLINE_QUEUE_KEY = 'almazen_offline_queue';

/**
 * حفظ البيانات العملياتية محلياً (مثل العملاء، الوحدات، الحجوزات)
 */
export function saveOperationalCache(key, data) {
  try {
    const payload = {
      timestamp: Date.now(),
      data
    };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(payload));
  } catch (err) {
    console.warn('⚡ تعذّر حفظ البيانات العملياتية محلياً:', err);
  }
}

/**
 * جلب البيانات العملياتية المخزنة محلياً عند انقطاع الاتصال
 */
export function getOperationalCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed.data || null;
  } catch (err) {
    console.warn('⚡ تعذّر قراءة التخزين المؤقت:', err);
    return null;
  }
}

/**
 * الحصول على تاريخ آخر تحديث مخزن محلياً
 */
export function getOperationalCacheTime(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed.timestamp ? new Date(parsed.timestamp) : null;
  } catch (_) {
    return null;
  }
}

/**
 * إضافة عملية تعديل عملياتية إلى طابور الانتظار للتزامن عند إعادة الاتصال
 */
export function queueOfflineMutation(table, action, payload, recordId = null) {
  try {
    const queue = getOfflineQueue();
    const item = {
      id: 'mut_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      table,
      action, // 'insert' | 'update' | 'upsert' | 'delete'
      payload,
      recordId,
      created_at: new Date().toISOString()
    };
    queue.push(item);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    
    // محاولة إشعار ServiceWorker للبدء بمزامنة الخلفية
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'QUEUE_MUTATION', item });
    }
    return item;
  } catch (err) {
    console.error('⚡ تعذّر إضافة التعديل إلى طابور المزامنة:', err);
    return null;
  }
}

/**
 * جلب طابور العمليات المعلّقة
 */
export function getOfflineQueue() {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

/**
 * مسح طابور العمليات المعلّقة
 */
export function clearOfflineQueue() {
  try {
    localStorage.removeItem(OFFLINE_QUEUE_KEY);
  } catch (_) {}
}

/**
 * إجراء المزامنة التلقائية للعمليات المعلّقة مع Supabase عند استعادة الاتصال
 */
export async function syncOfflineQueue(supabase) {
  const queue = getOfflineQueue();
  if (!queue.length) return { syncedCount: 0, errors: [] };

  let syncedCount = 0;
  const errors = [];
  const remainingQueue = [];

  for (const item of queue) {
    try {
      if (item.action === 'insert') {
        const { error } = await supabase.from(item.table).insert(item.payload);
        if (error) throw error;
      } else if (item.action === 'update') {
        let query = supabase.from(item.table).update(item.payload);
        if (item.recordId) {
          query = query.eq('id', item.recordId);
        }
        const { error } = await query;
        if (error) throw error;
      } else if (item.action === 'delete') {
        const { error } = await supabase.from(item.table).delete().eq('id', item.recordId);
        if (error) throw error;
      }
      syncedCount++;
    } catch (err) {
      console.error(`⚡ خطأ في مزامنة عملية أوفلاين (${item.table}):`, err);
      errors.push({ item, error: err.message });
      remainingQueue.push(item); // احتفظ بالعملية لإعادة المحاولة لاحقاً
    }
  }

  // تحديث الطابور بالعمليات التي فشلت فقط
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remainingQueue));

  return { syncedCount, errors };
}
