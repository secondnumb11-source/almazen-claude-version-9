import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * اختبارات انحدار — بريد المستخدم عند انتقال طلب الترشيح / صرف المكافأة إلى خطوة جديدة.
 * تتحقق من:
 *  1) المرور الإلزامي عبر صندوق الصادر (Outbox) قبل أي محاولة إرسال.
 *  2) وصول البريد للمستخدم صاحب الطلب في كل خطوة (وليس للإدارة فقط).
 *  3) تضمين رقم الخطوة واسمها في حمولة البريد.
 */

const db = { rows: [], seq: 0 };
let invokeCalls = [];

const fakeSupabase = {
  functions: {
    invoke: vi.fn(async (fn, { body }) => {
      invokeCalls.push({ fn, body });
      return { data: { ok: true }, error: null };
    }),
  },
  rpc: vi.fn(async (name, args) => {
    if (name === "outbox_enqueue") {
      const id = `ob-${++db.seq}`;
      db.rows.push({
        id,
        event_type: args.p_event_type,
        recipients: args.p_recipients,
        payload: args.p_payload,
        status: "pending",
      });
      return { data: id, error: null };
    }
    if (name === "outbox_mark") {
      const row = db.rows.find((r) => r.id === args.p_id);
      if (row) row.status = args.p_ok ? "sent" : "failed";
      return { data: row || null, error: null };
    }
    return { data: null, error: null };
  }),
};

vi.mock("../supabase", () => ({ supabase: fakeSupabase }));

const { notifyReferralStepChange, REFERRAL_STEPS } = await import("../referral");

beforeEach(() => {
  db.rows = [];
  db.seq = 0;
  invokeCalls = [];
  vi.clearAllMocks();
});

describe("بريد خطوات الترشيح", () => {
  it("يسجّل الإشعار في صندوق الصادر قبل الإرسال ويصل للمستخدم", async () => {
    const sent = await notifyReferralStepChange({
      event: "submitted",
      request_no: "RQ-1",
      user_email: "User@Example.com",
    });

    expect(sent).toBe(true);
    // 1) سُجّل في الصندوق ثم علّم كمُرسل
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].status).toBe("sent");
    expect(db.rows[0].event_type).toBe("referral_status_update");
    // 2) بريد المستخدم مضمّن (بعد التوحيد لحروف صغيرة)
    expect(db.rows[0].recipients).toContain("user@example.com");
    // 3) الإرسال حمل معرّف الصندوق ورقم الخطوة
    expect(invokeCalls).toHaveLength(1);
    expect(invokeCalls[0].body.outbox_id).toBe(db.rows[0].id);
    expect(invokeCalls[0].body.step_no).toBe(REFERRAL_STEPS.submitted.no);
    expect(invokeCalls[0].body.step_label).toBe(REFERRAL_STEPS.submitted.label);
  });

  it("يغطي كل خطوات المسار (ترشيح مسجّل / مسدَّد / اعتماد / رفض / صرف)", async () => {
    const events = [
      "referral_registered",
      "referral_paid",
      "submitted",
      "approve",
      "reject",
      "mark_paid",
    ];
    for (const event of events) {
      await notifyReferralStepChange({ event, user_email: "u@e.com" });
    }
    expect(db.rows).toHaveLength(events.length);
    expect(db.rows.every((r) => r.status === "sent")).toBe(true);
    expect(invokeCalls.map((c) => c.body.step_label)).toEqual(
      events.map((e) => REFERRAL_STEPS[e].label),
    );
  });
});
