import { sendWithOutbox } from "./outbox";

/** بناء رابط الترشيح — يفتح مباشرة على صفحة تسجيل عميل جديد مع الكود */
export function referralLink(code) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/?ref=${encodeURIComponent(code)}`;
}

/** قراءة كود الترشيح من الرابط (?ref=CODE) */
export function readRefFromUrl() {
  if (typeof window === "undefined") return "";
  const p = new URLSearchParams(window.location.search);
  return (p.get("ref") || p.get("referral") || "").trim().toUpperCase();
}

export const REWARD_LABEL = (w) => {
  if (w.kind === "cash") return `مكافأة نقدية ${w.cash_amount} ريال`;
  return `تمديد اشتراك ${w.months} ${w.months >= 12 ? "شهراً (سنة كاملة)" : "أشهر"}`;
};

export const STATUS_LABEL = {
  pending_admin: "بانتظار اعتماد الإدارة",
  approved: "معتمد ✓",
  rejected: "مرفوض",
  paid: "تم الصرف ✓",
};

export const REF_STATUS_LABEL = {
  registered: "مسجّل — بانتظار سداد الاشتراك",
  paid: "سدّد الاشتراك ✓",
  cancelled: "ملغي",
};

/**
 * إشعار حسابات السوبر أدمن بالبريد بكل بيانات الطلب — عبر صندوق الصادر (Outbox)
 * حتى يُعاد الإرسال تلقائياً عند الفشل. لا يُعطّل الطلب في جميع الأحوال.
 */
export async function notifySuperAdminsReward(payload) {
  const res = await sendWithOutbox("referral_reward_request", [payload?.employee_email], payload);
  return res.sent;
}

/**
 * خطوات مسار طلب الترشيح / صرف المكافأة — يُرسل بريد للمستخدم عند كل انتقال لخطوة جديدة.
 * كل خطوة لها رقم واسم واضح يظهر في نص البريد وفي سجل صندوق الصادر.
 */
export const REFERRAL_STEPS = {
  referral_registered: { no: 1, of: 4, label: "تم تسجيل المنشأة المُرشَّحة عبر رابط الترشيح" },
  referral_paid: { no: 2, of: 4, label: "سدّدت المنشأة المُرشَّحة اشتراكها — أصبحت المكافأة متاحة" },
  referral_unpaid: { no: 2, of: 4, label: "تم إرجاع حالة سداد المنشأة المُرشَّحة إلى غير مسدَّد" },
  submitted: { no: 3, of: 4, label: "تم استلام طلبك وهو الآن بانتظار اعتماد الإدارة" },
  approve: { no: 4, of: 4, label: "تم اعتماد الطلب وتطبيق المكافأة" },
  reject: { no: 4, of: 4, label: "تم رفض الطلب" },
  mark_paid: { no: 4, of: 4, label: "تم صرف المكافأة النقدية" },
};

/** استخراج بُرد المستخدمين المعنيين بالخطوة من الحمولة */
function stepRecipients(payload) {
  return [
    payload.user_email,
    payload.referrer_email,
    payload.employee_email,
    payload.referred_email,
    payload.contact_email,
  ];
}

/**
 * إشعار المستخدم بالبريد عند انتقال طلب الترشيح أو صرف المكافأة إلى خطوة جديدة.
 * الإرسال يمر إلزامياً عبر صندوق الصادر (Outbox) فيُسجَّل قبل المحاولة ويُعاد تلقائياً عند الفشل.
 */
export async function notifyReferralStepChange(payload) {
  const step = REFERRAL_STEPS[payload?.event] || null;
  const res = await sendWithOutbox("referral_status_update", stepRecipients(payload || {}), {
    changed_at: new Date().toISOString(),
    step_no: step?.no ?? null,
    step_total: step?.of ?? null,
    step_label: step?.label ?? payload?.event_label ?? null,
    ...payload,
    event_label: payload?.event_label || step?.label || null,
  });
  return res.sent;
}

/**
 * إشعار تلقائي بالبريد عند تغيّر حالة طلب الترشيح أو بعد تطبيق التمديد/الصرف النقدي.
 * يُرسل إلى صاحب كود الترشيح (الموظف) وإلى المنشأة المُرشَّحة ونسخة لإدارة المنصة،
 * ويُسجَّل في صندوق الصادر لإعادة المحاولة عند الفشل.
 */
export async function notifyReferralStatusChange(payload) {
  return notifyReferralStepChange(payload);
}

export const REWARD_ACTION_LABEL = {
  approve: "تم اعتماد الطلب وتطبيق المكافأة",
  reject: "تم رفض الطلب",
  mark_paid: "تم صرف المكافأة النقدية",
};

