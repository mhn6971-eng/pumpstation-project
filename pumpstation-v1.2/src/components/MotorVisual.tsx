"use client";

import { MOTOR_BRAND, MOTOR_POWER_KW } from "@/lib/domain";

/**
 * شماتیک فلت ست کوپل‌شده (مطابق تصویر مرجع کارفرما):
 * الکتروموتور خاکستری با فین‌های افقی، جعبه ترمینال و پلاک تگ + کوپلینگ +
 * پمپ آبی با پروانهٔ سفید، خروجی عمودی با فلنج و مکش افقی، روی ریل مشترک.
 * رنگ‌ها از متغیرهای کارت (حالت خاموش/سرویس/زرد/قرمز) می‌آیند.
 */
export default function MotorVisual({ tag, pumpTag, on, hot, smoke }: { tag: string; pumpTag: string; on: boolean; hot: boolean; smoke: boolean }) {
  const id = tag.replace(/[^a-z0-9]/gi, "");
  return (
    <svg viewBox="0 0 360 200" role="img" aria-label={`شماتیک موتور ${tag} و پمپ ${pumpTag} — ${MOTOR_POWER_KW}KW ${MOTOR_BRAND}`}>
      <defs>
        <linearGradient id={`mb-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--m-light)" />
          <stop offset="1" stopColor="var(--m-dark)" />
        </linearGradient>
        <linearGradient id={`pb-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--p-light)" />
          <stop offset="1" stopColor="var(--p-dark)" />
        </linearGradient>
        <filter id={`glow-${id}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
      </defs>

      {/* ریل مشترک + سایه */}
      <ellipse cx="180" cy="182" rx="160" ry="7" fill="#000" opacity="0.14" />
      <rect x="24" y="160" width="312" height="9" rx="3.5" fill="#26313f" />
      {[40, 90, 140, 200, 260, 320].map((x) => (
        <circle key={x} cx={x} cy="164.5" r="1.8" fill="#8fa0b5" />
      ))}
      {on && <ellipse cx="180" cy="170" rx="150" ry="13" fill="var(--glow)" opacity="0.5" filter={`url(#glow-${id})`} />}

      <g className="machine">
        {/* ----- الکتروموتور ----- */}
        <g className="motor-body">
          <rect x="52" y="148" width="28" height="13" rx="2" fill="var(--m-dark)" stroke="var(--m-line)" strokeWidth="0.8" />
          <rect x="140" y="148" width="28" height="13" rx="2" fill="var(--m-dark)" stroke="var(--m-line)" strokeWidth="0.8" />
          {/* درپوش انتهایی + گریل فن */}
          <rect x="28" y="92" width="28" height="56" rx="11" fill="var(--m-dark)" stroke="var(--m-line)" strokeWidth="1.1" />
          <circle cx="42" cy="120" r="9" fill="none" stroke="var(--m-line)" strokeWidth="1.4" />
          <path d="M42 111 v18 M33 120 h18" stroke="var(--m-line)" strokeWidth="1.4" strokeLinecap="round" />
          {/* بدنه اصلی */}
          <rect x="54" y="86" width="122" height="64" rx="10" fill={`url(#mb-${id})`} stroke="var(--m-line)" strokeWidth="1.2" />
          {[98, 108, 118, 128].map((y) => (
            <line key={y} x1="62" y1={y} x2="168" y2={y} stroke="var(--m-line)" strokeWidth="1" opacity="0.35" />
          ))}
          {/* جعبه ترمینال */}
          <rect x="92" y="68" width="42" height="20" rx="3" fill="var(--m-top)" stroke="var(--m-line)" strokeWidth="1" />
          <rect x="100" y="60" width="26" height="9" rx="2.5" fill="var(--m-top)" stroke="var(--m-line)" strokeWidth="1" />
          {/* پلاک موتور: تگ، توان و سازنده؛ مشخصات ثابت از src/lib/domain.ts می‌آیند. */}
          <rect x="93" y="111" width="80" height="38" rx="3" fill="#0f172a" stroke="#020617" strokeWidth="0.8" />
          <text x="133" y="123" textAnchor="middle" fontFamily="monospace" fontSize="9.2" fontWeight="700" fill="#7dd3fc" letterSpacing="0.5">
            {tag}
          </text>
          <text x="133" y="135" textAnchor="middle" fontFamily="monospace" fontSize="8.2" fontWeight="700" fill="#bae6fd">
            {MOTOR_POWER_KW}KW
          </text>
          <text x="133" y="145" textAnchor="middle" fontFamily="sans-serif" fontSize="7.2" fontWeight="700" fill="#e0f2fe">
            {MOTOR_BRAND}
          </text>
          {/* محور خروجی */}
          <rect x="174" y="112" width="10" height="12" rx="1.5" fill="#9aa5b1" />
        </g>

        {/* ----- کوپلینگ ----- */}
        <g className="coupling">
          <rect x="182" y="104" width="26" height="28" rx="7" fill="var(--c-body)" stroke="var(--c-line)" strokeWidth="1" />
          <circle cx="195" cy="118" r="7" fill="#0f2547" />
          <circle cx="195" cy="118" r="2.6" fill="#93c5fd" />
        </g>

        {/* ----- پمپ ----- */}
        <g className="pump">
          <rect x="244" y="148" width="52" height="13" rx="2" fill="var(--p-dark)" stroke="var(--p-line)" strokeWidth="0.8" />
          {/* خروجی عمودی */}
          <rect x="260" y="44" width="20" height="32" rx="2" fill={`url(#pb-${id})`} stroke="var(--p-line)" strokeWidth="1" />
          <rect x="252" y="34" width="36" height="10" rx="2.5" fill="var(--p-light)" stroke="var(--p-line)" strokeWidth="1" />
          <path d="M270 12 l11 14 h-22 Z" fill="#bfdbfe" stroke="var(--p-line)" strokeWidth="1" strokeLinejoin="round" />
          {/* مکش افقی */}
          <rect x="310" y="104" width="20" height="17" rx="2" fill={`url(#pb-${id})`} stroke="var(--p-line)" strokeWidth="1" />
          <rect x="328" y="96" width="10" height="33" rx="2.5" fill="var(--p-light)" stroke="var(--p-line)" strokeWidth="1" />
          {/* حلزونی */}
          <circle cx="270" cy="112" r="44" fill={`url(#pb-${id})`} stroke="var(--p-line)" strokeWidth="1.8" />
          <circle cx="270" cy="112" r="31" fill="#0b1f3a" opacity="0.55" />
          {[15, 60, 105, 150, 195, 240, 285, 330].map((a) => (
            <circle key={a} cx={270 + 38 * Math.cos((a * Math.PI) / 180)} cy={112 + 38 * Math.sin((a * Math.PI) / 180)} r="2" fill="#dbeafe" opacity="0.8" />
          ))}
          {/* پروانه سفید چرخان */}
          <g className="impeller" style={{ transformOrigin: "270px 112px" }}>
            {[0, 120, 240].map((a) => (
              <path key={a} d="M270 112 C 280 106, 284 98, 280 91" fill="none" stroke="#f1f8ff" strokeWidth="6" strokeLinecap="round" transform={`rotate(${a} 270 112)`} />
            ))}
            <circle cx="270" cy="112" r="6.5" fill="#e0f2fe" stroke="var(--p-line)" strokeWidth="1" />
          </g>
          <circle className="glow-ring" cx="270" cy="112" r="54" fill="none" stroke="var(--glow)" strokeWidth="3.5" filter={`url(#glow-${id})`} />
          {/* پلاک تگ پمپ */}
          <rect x="243" y="139" width="54" height="17" rx="3" fill="#0f172a" stroke="#020617" strokeWidth="0.8" />
          <text x="270" y="151.5" textAnchor="middle" fontFamily="monospace" fontSize="10.5" fontWeight="700" fill="#7dd3fc" letterSpacing="0.5">
            {pumpTag}
          </text>
        </g>

        {/* امواج حرارت */}
        <g className="heat-waves" opacity={hot ? 1 : 0}>
          <path className="heat-wave" d="M100 50 q7-11 14 0 t14 0" fill="none" stroke="#ef4444" strokeWidth="2.4" strokeLinecap="round" />
          <path className="heat-wave" d="M124 44 q6-9 12 0 t12 0" fill="none" stroke="#f97316" strokeWidth="2.2" strokeLinecap="round" />
          <path className="heat-wave" d="M78 44 q6-9 12 0 t12 0" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
        </g>
        {/* دود */}
        <g className="smoke-group" opacity={smoke ? 1 : 0}>
          <circle className="smoke-puff" cx="150" cy="52" r="7" fill="#64748b" />
          <circle className="smoke-puff" cx="136" cy="48" r="6" fill="#94a3b8" />
          <circle className="smoke-puff" cx="162" cy="46" r="5" fill="#475569" />
        </g>
      </g>
    </svg>
  );
}
