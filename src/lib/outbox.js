import { supabase } from "./supabase";

/**
 * آلية Outbox/Retry لإشعارات البريد.
 * كل إشعار يُسجَّل أولاً في جدول notification_outbox ثم تُحاول المنصة إرساله.
 * عند الفشل يبقى الإشعار محفوظاً ويُعاد إرساله تلقائياً لاحقاً (تصاعدياً حتى 6 محاولات)
 * بدل أن يضيع نهائياً.
 */

/** بريد إدارة المنصة الذي يستقبل بيانات المستخدمين الجدد وطلبات الترشيح */
export const PLATFORM_NOTIFY_EMAILS = [
  "shadyabdelwahab99@gmail.com",
  "shadyabdelwahabksa@gmail.com",
  "sh.abdelwahab@nes-sa.com",
];

const FN = "notify-new-signup";

async function invokeNotify(payload) {
  const { error } = await supabase.functions.invoke(FN, { body: payload });
  if (error) throw new Error(error.message || "send_failed");
  return true;
}

/**
 * تسجيل الإشعار في الصندوق ثم محاولة إرساله فوراً.
 * لا يرمي أي خطأ — الفشل يُسجَّل ليُعاد لاحقاً.
 */
export async function sendWithOutbox(eventType, recipients, payload) {
  const to = [
    ...new Set(
      [...(recipients || []), ...PLATFORM_NOTIFY_EMAILS]
        .filter((e) => !!e && String(e).includes("@"))
        .map((e) => String(e).trim().toLowerCase()),
    ),
  ];

  let outboxId = null;
  try {
    const { data } = await supabase.rpc("outbox_enqueue", {
      p_event_type: eventType,
      p_recipients: to,
      p_payload: payload || {},
    });
    outboxId = data || null;
  } catch {
    /* الاستمرار حتى لو تعذّر التسجيل */
  }

  const body = {
    kind: eventType,
    recipients: to,
    notify_super_admins: true,
    outbox_id: outboxId,
    ...payload,
  };
  try {
    await invokeNotify(body);
    if (outboxId) await supabase.rpc("outbox_mark", { p_id: outboxId, p_ok: true, p_error: null });
    return { sent: true, outboxId };
  } catch (e) {
    if (outboxId) {
      try {
        await supabase.rpc("outbox_mark", {
          p_id: outboxId,
          p_ok: false,
          p_error: String(e?.message || e),
        });
      } catch {
        /* ignore */
      }
    }
    return { sent: false, outboxId, error: String(e?.message || e) };
  }
}

/** إعادة محاولة إرسال الإشعارات المتعثرة المستحقة الآن */
export async function drainOutbox(limit = 10) {
  let rows = [];
  try {
    const { data, error } = await supabase.rpc("outbox_due", { p_limit: limit });
    if (error) return { processed: 0, sent: 0 };
    rows = Array.isArray(data) ? data : [];
  } catch {
    return { processed: 0, sent: 0 };
  }

  let sent = 0;
  for (const row of rows) {
    const body = {
      kind: row.event_type,
      recipients: row.recipients || [],
      notify_super_admins: true,
      outbox_id: row.id,
      retry_attempt: (row.attempts || 0) + 1,
      ...(row.payload || {}),
    };
    try {
      await invokeNotify(body);
      await supabase.rpc("outbox_mark", { p_id: row.id, p_ok: true, p_error: null });
      sent += 1;
    } catch (e) {
      try {
        await supabase.rpc("outbox_mark", {
          p_id: row.id,
          p_ok: false,
          p_error: String(e?.message || e),
        });
      } catch {
        /* ignore */
      }
    }
  }
  return { processed: rows.length, sent };
}
