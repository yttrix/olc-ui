// Camera-shaped mark: the tunnel rides inside a video call.
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path d="M8 11.5h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19v-6A1.5 1.5 0 0 1 8 11.5z" className="fill-primary-foreground" />
      <path d="M21.5 14.5l4-2.5v8l-4-2.5z" className="fill-primary-foreground" />
    </svg>
  );
}
