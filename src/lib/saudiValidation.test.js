import { describe, it, expect } from 'vitest'
import { validateSaudiId, validateCR, validateSaudiPhone, normalizeSaudiPhone, toDigits } from './saudiValidation'

/*
  العيّنات أدناه ليست مخترعة: الأرقام «الحقيقية» مأخوذة من عملاء فعليين
  في قاعدة بيانات المشروع (id_type = national_id/iqama)، والأرقام
  «المرفوضة» مأخوذة من الصفوف نفسها التي تبيّن أنها بيانات مُدخلة يدوياً
  للاختبار. هكذا يقيس الاختبار الخوارزمية على واقع النظام لا على افتراض.
*/
describe('الهوية الوطنية والإقامة', () => {
  it.each(['2239223692', '2274939731', '2542993197'])('يقبل رقماً حقيقياً: %s', (v) => {
    expect(validateSaudiId(v).ok).toBe(true)
  })

  it.each(['2506915555', '2506919988'])('يرفض رقماً فاشل البصمة: %s', (v) => {
    const r = validateSaudiId(v)
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/غير صحيح/)
  })

  it('يرفض 2222222222 رغم اجتيازه البصمة وبدئه بـ 2', () => {
    // مقيس لا مفترض: هذا الرقم يجتاز بصمة لُوهن فعلاً ويبدأ بـ 2، فلا
    // يوقفه إلا رفض الأنماط الوهمية. (0000000000 يجتاز البصمة أيضاً
    // لكن يوقفه شرط الرقم الأول قبل أن تصل النوبة لهذه القاعدة.)
    const r = validateSaudiId('2222222222')
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/وهمي/)
  })

  it('يرفض 0000000000 (لا يبدأ بـ 1 أو 2)', () => {
    expect(validateSaudiId('0000000000').ok).toBe(false)
  })

  it('يرفض ما لا يبدأ بـ 1 أو 2', () => {
    expect(validateSaudiId('3239223692').ok).toBe(false)
  })

  it('يرفض ما ليس عشرة أرقام', () => {
    expect(validateSaudiId('223922369').ok).toBe(false)
    expect(validateSaudiId('22392236921').ok).toBe(false)
  })

  it('يميّز المواطن عن المقيم', () => {
    expect(validateSaudiId('2274939731').kind).toBe('iqama')
  })

  it('يتجاهل المسافات والفواصل والأرقام الهندية', () => {
    expect(validateSaudiId(' 2239-2236 92 ').ok).toBe(true)
    expect(validateSaudiId('٢٢٣٩٢٢٣٦٩٢').ok).toBe(true)
  })
})

describe('السجل التجاري', () => {
  it('يقبل عشرة أرقام', () => expect(validateCR('4030123456').ok).toBe(true))
  it('يرفض الطول الخاطئ', () => expect(validateCR('40301234').ok).toBe(false))
  it('يرفض النمط الوهمي', () => expect(validateCR('1111111111').ok).toBe(false))
})

describe('الجوال السعودي', () => {
  it.each([
    ['0512345678', '966512345678'],
    ['512345678', '966512345678'],
    ['966512345678', '966512345678'],
    ['00966512345678', '966512345678'],
    ['+966 51 234 5678', '966512345678'],
  ])('يطبّع %s إلى %s', (input, want) => {
    expect(normalizeSaudiPhone(input)).toBe(want)
    expect(validateSaudiPhone(input).ok).toBe(true)
  })

  it('يرفض ما ليس سعودياً أو ناقص الطول', () => {
    expect(validateSaudiPhone('0412345678').ok).toBe(false)
    expect(validateSaudiPhone('05123456').ok).toBe(false)
  })

  it('يعيد صيغة E.164', () => {
    expect(validateSaudiPhone('0512345678').e164).toBe('+966512345678')
  })
})

describe('toDigits', () => {
  it('يحوّل الأرقام الهندية', () => expect(toDigits('٠٥١٢')).toBe('0512'))
})
