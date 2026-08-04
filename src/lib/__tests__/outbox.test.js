import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * اختبارات انحدار — آلية Outbox/Retry لإشعارات البريد.
 * تتحقق من:
 *  1) تسجيل كل إشعار في الصندوق قبل محاولة الإرسال (لا يضيع إشعار عند الفشل).
 *  2) إعادة المحاولة تلقائياً عبر drainOutbox حتى ينجح الإرسال.
 *  3) إضافة بُرد إدارة المنصة الثلاثة إلى كل إشعار دائماً.
 */

// ---- قاعدة بيانات وهمية تحاكي دوال الصندوق في Postgres ----
const db = { rows: [], seq: 0 };
let failTimes = 0;
let invokeCalls = [];

const fakeSupabase = {
  functions: {
    invoke: vi.fn(async (fn, { body }) => {
      invokeCalls.push({ fn, body });
      if (failTimes > 0) {
        failTimes -= 1;
        return { data: null, error: { message: "smtp_unreachable" } };
      }
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
        attempts: 0,
        max_attempts: 6,
        next_attempt_at: new Date(0).toISOString(),
      });
      return { data: id, error: null };
    }
    if (name === "outbox_mark") {
      const row = db.rows.find((r) => r.id === args.p_id);
      if (!row) return { data: null, error: null };
      row.attempts += 1;
      if (args.p_ok) {
        row.status = "sent";
        row.last_error = null;
      } else {
        row.last_error = args.p_error;
        row.status = row.attempts >= row.max_attempts ? "dead" : "failed";
      }
      return { data: row, error: null };
    }
    if (name === "outbox_due") {
      return {
        data: db.rows.filter((r) => r.status === "pending" || r.status === "failed"),
        error: null,
      };
    }
    return { data: null, error: null };
  }),
};

vi.mock("../supabase", () => ({ supabase: fakeSupabase }));

const { sendWithOutbox, drainOutbox, PLATFORM_NOTIFY_EMAILS } = await import("../outbox");

beforeEach(() => {
  db.rows = [];
  db.seq = 0;
  failTimes = 0;
  invokeCalls = [];
});

describe("PLATFORM_NOTIFY_EMAILS", () => {
  it("يشمل بُرد إدارة المنصة الثلاثة", () => {
    expect(PLATFORM_NOTIFY_EMAILS).toEqual([
      "shadyabdelwahab99@gmail.com",
      "shadyabdelwahabksa@gmail.com",
      "sh.abdelwahab@nes-sa.com",
    ]);
  });
});

describe("sendWithOutbox", () => {
  it("يرسل بنجاح ويضيف بُرد الإدارة مع بريد المستخدم بدون تكرار", async () => {
    const res = await sendWithOutbox("new_signup", ["  Client@Example.COM ", "", null], {
      company_name: "منشأة",
    });
    expect(res.sent).toBe(true);
    const to = invokeCalls[0].body.recipients;
    expect(to).toContain("client@example.com");
    for (const e of PLATFORM_NOTIFY_EMAILS) expect(to).toContain(e);
    expect(new Set(to).size).toBe(to.length);
    expect(db.rows[0].status).toBe("sent");
    // كل بيانات الإشعار تُمرَّر كاملة
    expect(invokeCalls[0].body.company_name).toBe("منشأة");
    expect(invokeCalls[0].body.kind).toBe("new_signup");
  });

  it("لا يفقد الإشعار عند فشل الإرسال — يبقى محفوظاً بحالة failed", async () => {
    failTimes = 1;
    const res = await sendWithOutbox("referral_reward_request", ["emp@x.com"], { request_no: "R-1" });
    expect(res.sent).toBe(false);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].status).toBe("failed");
    expect(db.rows[0].attempts).toBe(1);
    expect(db.rows[0].last_error).toContain("smtp_unreachable");
  });
});

describe("drainOutbox — إعادة المحاولة التلقائية", () => {
  it("يعيد إرسال الإشعار المتعثر حتى ينجح دون فقد البيانات", async () => {
    failTimes = 2;
    await sendWithOutbox("referral_status_update", ["ref@x.com"], { request_no: "R-9" });
    expect(db.rows[0].status).toBe("failed");

    // المحاولة الثانية تفشل أيضاً — الإشعار يبقى مستحقاً
    let r = await drainOutbox(10);
    expect(r.processed).toBe(1);
    expect(r.sent).toBe(0);
    expect(db.rows[0].status).toBe("failed");

    // المحاولة الثالثة تنجح
    r = await drainOutbox(10);
    expect(r.sent).toBe(1);
    expect(db.rows[0].status).toBe("sent");

    const last = invokeCalls.at(-1).body;
    expect(last.request_no).toBe("R-9");
    expect(last.retry_attempt).toBe(3);
    for (const e of PLATFORM_NOTIFY_EMAILS) expect(last.recipients).toContain(e);
  });

  it("يتوقف عند الحد الأقصى للمحاولات ويوسم الإشعار dead دون حذفه", async () => {
    failTimes = 99;
    await sendWithOutbox("new_signup", ["a@b.com"], {});
    for (let i = 0; i < 8; i += 1) await drainOutbox(10);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].status).toBe("dead");
    expect(db.rows[0].attempts).toBe(6);
  });

  it("لا يرمي خطأ عندما لا توجد إشعارات مستحقة", async () => {
    await expect(drainOutbox(5)).resolves.toEqual({ processed: 0, sent: 0 });
  });
});
