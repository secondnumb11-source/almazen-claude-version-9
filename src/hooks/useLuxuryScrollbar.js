import { useCallback, useEffect, useRef, useState } from "react";

/**
 * مسطرة التمرير الفاخرة — بديل كامل لشريط تمرير المتصفح.
 *
 * لماذا مسطرة مخصّصة بدل تنسيق شريط النظام؟
 * منذ Chromium 121 يتجاهل المتصفح قواعد `::-webkit-scrollbar` كلها إذا
 * كان `scrollbar-width` أو `scrollbar-color` معرّفاً على نفس العنصر، ويرسم
 * شريط النظام الافتراضي. والخاصيتان المعياريتان لا تدعمان سوى لونين
 * مسطّحين و thin/auto — لا تدرّج ولا استدارة ولا توهج ولا اختفاء تدريجي.
 * لذلك نخفي شريط النظام تماماً (CSS) ونرسم هذه المسطرة فنملك تصميمها كاملاً.
 *
 * تُرجع هندسة الإبهام وحالة الظهور ومقابض السحب.
 */
export function useLuxuryScrollbar(navRef, { hideDelay = 1100, minThumb = 30 } = {}) {
  const [geo, setGeo] = useState({ scrollable: false, viewport: 0, thumbTop: 0, thumbHeight: 0, scrollTop: 0 });
  const [awake, setAwake] = useState(false); // يستيقظ أثناء التمرير ثم يخفت
  const [dragging, setDragging] = useState(false);
  const hideTimer = useRef(null);
  const dragState = useRef(null);

  const measure = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const { scrollHeight, clientHeight, scrollTop } = nav;
    const scrollable = scrollHeight - clientHeight > 1;
    if (!scrollable) {
      setGeo({ scrollable: false, viewport: clientHeight, thumbTop: 0, thumbHeight: 0, scrollTop });
      return;
    }
    // المسار يترك هامشاً علوياً وسفلياً حتى لا يلامس الإبهام حواف اللوحة.
    const inset = 10;
    const track = Math.max(0, clientHeight - inset * 2);
    const thumbHeight = Math.max(minThumb, Math.round((clientHeight / scrollHeight) * track));
    const progress = scrollTop / (scrollHeight - clientHeight);
    const thumbTop = inset + Math.round(progress * (track - thumbHeight));
    setGeo({ scrollable: true, viewport: clientHeight, thumbTop, thumbHeight, scrollTop });
  }, [navRef, minThumb]);

  const wake = useCallback(() => {
    setAwake(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setAwake(false), hideDelay);
  }, [hideDelay]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    measure();

    const onScroll = () => {
      measure();
      wake();
    };
    nav.addEventListener("scroll", onScroll, { passive: true });

    // يعيد القياس عند تغيّر ارتفاع اللوحة أو عدد عناصر القائمة
    const ro = new ResizeObserver(measure);
    ro.observe(nav);
    if (nav.firstElementChild) ro.observe(nav.firstElementChild);

    const mo = new MutationObserver(measure);
    mo.observe(nav, { childList: true, subtree: true });

    window.addEventListener("resize", measure);
    return () => {
      nav.removeEventListener("scroll", onScroll);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", measure);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [navRef, measure, wake]);

  /* ---------------- السحب المباشر للإبهام ---------------- */
  const onThumbPointerDown = useCallback(
    (e) => {
      const nav = navRef.current;
      if (!nav) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      dragState.current = { startY: e.clientY, startScroll: nav.scrollTop };
      setDragging(true);
      wake();
    },
    [navRef, wake],
  );

  const onThumbPointerMove = useCallback(
    (e) => {
      const nav = navRef.current;
      const st = dragState.current;
      if (!nav || !st) return;
      const inset = 10;
      const track = Math.max(1, nav.clientHeight - inset * 2);
      const thumbHeight = Math.max(minThumb, (nav.clientHeight / nav.scrollHeight) * track);
      const runway = Math.max(1, track - thumbHeight);
      const delta = e.clientY - st.startY;
      // مسافة السحب على المسار تُترجم إلى مسافة تمرير في المحتوى
      nav.scrollTop = st.startScroll + (delta / runway) * (nav.scrollHeight - nav.clientHeight);
      wake();
    },
    [navRef, minThumb, wake],
  );

  const endDrag = useCallback(
    (e) => {
      if (!dragState.current) return;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      dragState.current = null;
      setDragging(false);
      wake();
    },
    [wake],
  );

  /** النقر على المسار ينقل العرض إلى الموضع المقابل مباشرة. */
  const onTrackPointerDown = useCallback(
    (e) => {
      const nav = navRef.current;
      if (!nav || dragState.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      nav.scrollTo({ top: ratio * (nav.scrollHeight - nav.clientHeight), behavior: "smooth" });
      wake();
    },
    [navRef, wake],
  );

  return { geo, awake, dragging, onThumbPointerDown, onThumbPointerMove, endDrag, onTrackPointerDown };
}
