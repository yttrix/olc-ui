// Typed client for the panel JSON API (<base>api/).

export type Support = "works" | "unstable" | "broken";

export interface Meta {
  providers: string[];
  transports: string[];
  matrix: Record<string, Record<string, Support>>;
  recommended_transport: Record<string, string>;
  option_keys: Record<string, string[]>;
  jitsi_instances: string[];
  default_dns: string;
}

export interface Proxy {
  addr: string;
  port: number;
  user?: string;
  pass?: string;
}

export interface Endpoint {
  provider: string;
  transport: string;
  room: string;
  key: string;
  dns?: string;
  provider_token?: string;
  options?: Record<string, string>;
  proxy?: Proxy | null;
}

export interface Peer {
  session: string;
  device: string;
  since: number;
}

export interface Runtime {
  status: "running" | "restarting" | "stopped";
  reason?: string;
  pid?: number;
  started_at?: number;
  restarts: number;
  last_error?: string;
  peers: Peer[];
  down: number;
  up: number;
  rate_down: number;
  rate_up: number;
  conns: number;
  rtt_ms?: number;
  memory_bytes?: number;
}

export interface Location {
  id: number;
  client_id: number;
  name: string;
  enabled: boolean;
  endpoint: Endpoint;
  created_at: number;
  uri: string;
  runtime: Runtime;
}

export type ClientStatus = "active" | "disabled" | "expired" | "traffic_exceeded";

export interface Client {
  id: number;
  name: string;
  note: string;
  enabled: boolean;
  speed_mbps: number;
  traffic_limit: number;
  used_bytes: number;
  expires_at: string;
  refresh: string;
  sub_token: string;
  created_at: number;
  max_conns: number;
  max_devices: number;
  last_online: number;
  devices: number;
  status: ClientStatus;
  sub_url: string;
  locations: Location[];
}

export interface DayTraffic {
  day: string;
  down: number;
  up: number;
}

export interface Overview {
  name: string;
  version: string;
  uptime: number;
  stats: Record<string, number>;
  totals: Record<string, number>;
  traffic: DayTraffic[];
  memory: { heap: number; sys: number; goroutines: number };
}

export interface Settings {
  panel_name: string;
  public_host: string;
  sub_refresh: string;
  jitsi_instance: string;
  base_path?: string;
  version?: string;
  user?: string;
}

export interface AuditEntry {
  ts: number;
  action: string;
  detail: string;
}

export interface LogLine {
  ts: number;
  line: string;
}

export interface Device {
  hwid: string;
  user_agent: string;
  ip: string;
  first_seen: number;
  last_seen: number;
  blocked: boolean;
}

export interface TLSStatus {
  mode: string;
  host?: string;
  issuer?: string;
  not_after?: number;
  last_error?: string;
}

export interface ClientInput {
  max_conns: number;
  max_devices: number;
  name: string;
  note: string;
  enabled: boolean;
  speed_mbps: number;
  traffic_limit: number;
  expires_at: string;
  refresh: string;
  locations?: LocationInput[];
}

export interface LocationInput {
  name: string;
  enabled: boolean;
  endpoint: Endpoint;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// The SPA lives at <base>, the API at <base>api/.
const apiBase = window.location.pathname.replace(/[^/]*$/, "") + "api/";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiBase + path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? { "X-OLC": "1" } : { "Content-Type": "application/json", "X-OLC": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event("olc:unauthorized"));
    throw new ApiError(res.status, data?.error ?? res.statusText);
  }
  return data as T;
}

export const api = {
  me: () => call<{ authenticated: boolean; user?: string }>("GET", "me"),
  login: (user: string, pass: string) => call("POST", "login", { user, pass }),
  logout: () => call("POST", "logout", {}),
  password: (old: string, user: string, next: string) => call("POST", "password", { old, user, new: next }),
  meta: () => call<Meta>("GET", "meta"),
  overview: () => call<Overview>("GET", "overview"),
  settings: () => call<Settings>("GET", "settings"),
  saveSettings: (s: Settings) =>
    call<Settings>("PUT", "settings", {
      panel_name: s.panel_name,
      public_host: s.public_host,
      sub_refresh: s.sub_refresh,
      jitsi_instance: s.jitsi_instance,
    }),
  audit: () => call<AuditEntry[]>("GET", "audit"),
  clients: () => call<Client[]>("GET", "clients"),
  createClient: (c: ClientInput) => call<Client>("POST", "clients", c),
  updateClient: (id: number, c: ClientInput) => call<Client>("PUT", `clients/${id}`, c),
  deleteClient: (id: number) => call("DELETE", `clients/${id}`),
  resetUsage: (id: number) => call("POST", `clients/${id}/reset-usage`, {}),
  rotateSub: (id: number) => call<{ sub_url: string }>("POST", `clients/${id}/rotate-sub`, {}),
  clientTraffic: (id: number, days = 30) => call<DayTraffic[]>("GET", `clients/${id}/traffic?days=${days}`),
  createLocation: (clientId: number, l: LocationInput) => call("POST", `clients/${clientId}/locations`, l),
  updateLocation: (id: number, l: LocationInput) => call("PUT", `locations/${id}`, l),
  deleteLocation: (id: number) => call("DELETE", `locations/${id}`),
  restartLocation: (id: number) => call("POST", `locations/${id}/restart`, {}),
  rotateKey: (id: number) => call("POST", `locations/${id}/rotate-key`, {}),
  newRoom: (id: number) => call("POST", `locations/${id}/new-room`, {}),
  logs: (id: number) => call<LogLine[]>("GET", `locations/${id}/logs`),
  devices: (id: number) => call<Device[]>("GET", `clients/${id}/devices`),
  deviceAction: (id: number, hwid: string, action: "block" | "unblock" | "delete") =>
    call("POST", `clients/${id}/devices`, { hwid, action }),
  system: () => call<{ version: string; tls: TLSStatus | null }>("GET", "system"),
  backupURL: () => apiBase + "backup",
  restore: async (file: File) => {
    const body = new FormData();
    body.append("backup", file);
    const res = await fetch(apiBase + "restore", { method: "POST", body, headers: { "X-OLC": "1" }, credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText);
    return data as { clients: number; locations: number };
  },
};
