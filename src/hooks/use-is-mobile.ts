import { useEffect, useState } from "react";

/** 手机断点:<768px(Tailwind md 以下)。 */
export const MOBILE_MEDIA_QUERY = "(max-width: 767px)";

/** 纯读:给定 window(可为 undefined),返回当前是否命中手机断点。无 window / 无 matchMedia → false。 */
export function readIsMobile(win: Pick<Window, "matchMedia"> | undefined): boolean {
  if (!win || typeof win.matchMedia !== "function") return false;
  return win.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

/** 订阅手机断点变化,实时返回是否手机视口。SSR / 无 window 时返回 false。 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState<boolean>(() =>
    readIsMobile(typeof window !== "undefined" ? window : undefined),
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(MOBILE_MEDIA_QUERY);
    const onChange = () => setMobile(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return mobile;
}
