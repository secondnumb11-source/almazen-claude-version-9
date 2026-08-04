/**
 * BranchesManager — نقطة الدخول التاريخية لإدارة الفروع.
 * أُعيد بناء الشاشة بالكامل داخل BranchManagementSystem (نظام واحد موحّد:
 * الفروع + المستخدمون + الإسناد + تفعيل الميزة)، ويبقى هذا الملف غلافاً
 * محافظاً على نفس مسار الاستيراد والتصدير الافتراضي حتى لا ينكسر أي استخدام حالي.
 */
import BranchManagementSystem from './branches/BranchManagementSystem'

export default function BranchesManager() {
  return <BranchManagementSystem />
}
