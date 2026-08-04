/**
 * مصدر واحد لسعر الاشتراك السنوي.
 * القيمة الرسمية تُقرأ من جدول public.subscription_plans (كود 'annual')
 * مع قيمة احتياطية ثابتة حتى لا تنكسر الواجهة عند تعذّر الاتصال.
 */
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export const ANNUAL_PRICE_FALLBACK = 3000
export const ANNUAL_CURRENCY = 'ر.س'

export const formatPrice = (n) => Number(n || 0).toLocaleString('en-US')

export async function fetchAnnualPlan() {
  try {
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('code,name,price,currency,period_months')
      .eq('code', 'annual')
      .maybeSingle()
    if (error || !data) return null
    return data
  } catch {
    return null
  }
}

/** سعر الاشتراك السنوي مع تحديث تلقائي من قاعدة البيانات */
export function useAnnualPrice() {
  const [price, setPrice] = useState(ANNUAL_PRICE_FALLBACK)
  useEffect(() => {
    let cancelled = false
    fetchAnnualPlan().then(p => {
      if (!cancelled && p?.price != null) setPrice(Number(p.price))
    })
    return () => { cancelled = true }
  }, [])
  return price
}
