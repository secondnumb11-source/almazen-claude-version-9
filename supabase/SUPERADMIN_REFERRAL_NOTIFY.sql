-- =====================================================================
--  إشعار السوبر أدمن داخل النظام عند استلام طلب إحالة
-- ---------------------------------------------------------------------
--  الحالة قبل: referral_rewards عليه تريجر تدقيق فقط، ولا إشعار لأي
--  سوبر أدمن. الطلب يصل إلى pending_admin ويبقى بلا تنبيه حتى يفتح
--  أحدهم صفحة إدارة الإحالات صدفةً.
--
--  العلاج: تريجر AFTER INSERT يُنشئ إشعاراً داخل النظام لكل حساب
--  سوبر أدمن في منشأته (App.jsx يقرأ notifications بـ company_id).
--
--  ملاحظة: قائمة السوبر أدمن ثابتة عمداً بقرار المستخدم — لا تُضاف
--  حسابات جديدة، والاعتماد على super_admin_emails() القائمة.
-- =====================================================================

create or replace function public.fn_notify_super_admins_on_reward()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_title text;
  v_body  text;
  v_what  text;
begin
  -- طلبات المنشأة المُرشَّحة تُنشأ تلقائياً؛ ننبّه عليها أيضاً لأنها تحتاج اعتماداً
  v_what := case
              when new.kind = 'cash'  then coalesce(new.cash_amount,0)::text || ' ريال نقداً'
              else coalesce(new.months,0)::text || ' أشهر تمديد اشتراك'
            end;

  v_title := '🎁 طلب مكافأة إحالة بانتظار الاعتماد';
  v_body  := coalesce(new.beneficiary_name, 'مستفيد')
             || ' — ' || v_what
             || case when new.tier = 'milestone' then ' (مكافأة إنجاز 3 اشتراكات)' else '' end
             || case when new.beneficiary = 'referred' then ' — للمنشأة المُرشَّحة' else ' — للمُحيل' end
             || coalesce(' | رقم الطلب: ' || new.request_no, '');

  -- إشعار داخل النظام لكل سوبر أدمن في منشأته
  insert into public.notifications (company_id, user_id, channel, event_type, title, body)
  select p.company_id, p.id, 'in_app', 'referral_reward_request', v_title, v_body
    from public.profiles p
    join auth.users u on u.id = p.id
   where lower(u.email) = any (public.super_admin_emails())
     and p.company_id is not null;

  return new;
exception when others then
  -- الإشعار لا يجوز أن يُفشل إنشاء الطلب نفسه
  return new;
end $function$;

drop trigger if exists trg_notify_super_admins_on_reward on public.referral_rewards;
create trigger trg_notify_super_admins_on_reward
  after insert on public.referral_rewards
  for each row execute function public.fn_notify_super_admins_on_reward();
