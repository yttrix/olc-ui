// Camera-shaped mark: the tunnel rides inside a video call.
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ filter: "drop-shadow(0 0 14px hsl(184 44% 61% / 0.35))" }}>
      <defs>
        <linearGradient id="olc-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7fd3d8" />
          <stop offset="1" stopColor="#5aa9c9" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#olc-logo)" />
      <path d="M8 11.5h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19v-6A1.5 1.5 0 0 1 8 11.5z" fill="#0f1319" />
      <path d="M21.5 14.5l4-2.5v8l-4-2.5z" fill="#0f1319" />
    </svg>
  );
}
