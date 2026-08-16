import Link from "next/link";

export default function Logo({
  size = 40,
  withText = true,
}: {
  size?: number;
  withText?: boolean;
}) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Logo V Shop"
      >
        {/* Pita biru */}
        <path
          d="M12 6 L24 14 L36 6 L33 20 L24 12 L15 20 Z"
          fill="#2563EB"
          stroke="#1D4ED8"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {/* Tas belanja oranye */}
        <path
          d="M14 18 H34 V40 C34 41.1 33.1 42 32 42 H16 C14.9 42 14 41.1 14 40 Z"
          fill="#F97316"
        />
        <path
          d="M18 18 V14 C18 10.7 20.7 8 24 8 C27.3 8 30 10.7 30 14 V18"
          stroke="#F97316"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        {/* Tag diskon merah */}
        <g transform="translate(26 26)">
          <rect x="0" y="2" width="14" height="12" rx="2" fill="#EF4444" />
          <path d="M0 2 L6 8 L14 2" fill="none" stroke="#B91C1C" strokeWidth="1.5" />
          <text
            x="7"
            y="11.5"
            textAnchor="middle"
            fontSize="8.5"
            fontWeight="bold"
            fill="#fff"
            fontFamily="sans-serif"
          >
            %
          </text>
        </g>
      </svg>
      {withText && (
        <span className="leading-tight">
          <span className="block text-lg font-extrabold tracking-tight text-gray-900">
            V<span className="text-brand-600">SHOP</span>
          </span>
          <span className="block text-[10px] font-medium text-gray-500">
            Diskon UMKM di sekitarmu
          </span>
        </span>
      )}
    </Link>
  );
}
