/**
 * Session timeout manager.
 *
 * Two independent timers protect against stale state:
 *   - **Idle timeout**: logs the user out after `IDLE_LIMIT_MS` of inactivity.
 *   - **Absolute timeout**: logs the user out `ABSOLUTE_LIMIT_MS` after login,
 *     regardless of how active they have been. This ensures a fresh re-login
 *     (and thus fresh localStorage state) at predictable intervals.
 *
 * Activity is tracked via mouse / keyboard / touch / scroll / visibility
 * events. The "last activity" timestamp is mirrored to localStorage so that
 * if the user has multiple tabs open, activity in one tab keeps the session
 * alive in all of them.
 *
 * The `storage` event also handles cross-tab logout: when one tab clears
 * `auth_user`, every other tab notices and logs out too.
 */

const IDLE_LIMIT_MS = 60 * 60 * 1000; // 60 minutes of inactivity
const ABSOLUTE_LIMIT_MS = 12 * 60 * 60 * 1000; // 12 hours since login
const CHECK_INTERVAL_MS = 30 * 1000; // poll every 30s

const ACTIVITY_KEY = "auth_last_activity";
const LOGIN_TIME_KEY = "auth_login_time";

const ACTIVITY_EVENTS = [
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
] as const;

export type SessionTimeoutReason = "idle" | "absolute" | "cross-tab";

interface ManagerHandle {
  stop: () => void;
}

let activeHandle: ManagerHandle | null = null;

function now(): number {
  return Date.now();
}

function readNumeric(key: string): number {
  const raw = localStorage.getItem(key);
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Call this at login time to anchor the absolute timeout.
 */
export function markSessionStart(): void {
  try {
    const ts = String(now());
    localStorage.setItem(LOGIN_TIME_KEY, ts);
    localStorage.setItem(ACTIVITY_KEY, ts);
  } catch {
    /* ignore */
  }
}

/**
 * Call this on logout so subsequent loads don't see a stale anchor.
 */
export function clearSessionMarkers(): void {
  try {
    localStorage.removeItem(LOGIN_TIME_KEY);
    localStorage.removeItem(ACTIVITY_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Backfill the session anchor for sessions that pre-date this module —
 * they would otherwise be logged out on the very next idle check.
 */
export function ensureSessionMarkers(): void {
  try {
    if (!localStorage.getItem(LOGIN_TIME_KEY)) {
      localStorage.setItem(LOGIN_TIME_KEY, String(now()));
    }
    if (!localStorage.getItem(ACTIVITY_KEY)) {
      localStorage.setItem(ACTIVITY_KEY, String(now()));
    }
  } catch {
    /* ignore */
  }
}

/**
 * Start watching for inactivity and absolute-timeout. Returns a handle whose
 * `stop()` cleans up every listener. Calling `start` again replaces the
 * existing handle.
 */
export function startSessionTimeout(
  onTimeout: (reason: SessionTimeoutReason) => void,
): ManagerHandle {
  // Replace any previous instance.
  activeHandle?.stop();

  let stopped = false;

  const recordActivity = () => {
    if (stopped) return;
    try {
      localStorage.setItem(ACTIVITY_KEY, String(now()));
    } catch {
      /* ignore */
    }
  };

  const check = () => {
    if (stopped) return;

    // Cross-tab logout — if auth_user has been cleared, this tab should too.
    if (!localStorage.getItem("auth_user")) {
      stopped = true;
      cleanup();
      onTimeout("cross-tab");
      return;
    }

    const last = readNumeric(ACTIVITY_KEY);
    const start = readNumeric(LOGIN_TIME_KEY);
    const t = now();

    if (last && t - last > IDLE_LIMIT_MS) {
      stopped = true;
      cleanup();
      onTimeout("idle");
      return;
    }
    if (start && t - start > ABSOLUTE_LIMIT_MS) {
      stopped = true;
      cleanup();
      onTimeout("absolute");
      return;
    }
  };

  const onStorage = (e: StorageEvent) => {
    // React immediately when another tab logs out.
    if (e.key === "auth_user" && !e.newValue) {
      check();
    }
  };

  const interval = window.setInterval(check, CHECK_INTERVAL_MS);

  for (const evt of ACTIVITY_EVENTS) {
    window.addEventListener(evt, recordActivity, { passive: true });
  }
  window.addEventListener("storage", onStorage);
  // When the tab regains focus, treat it as activity AND immediately check
  // — covers the "laptop opened after lunch" case.
  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      recordActivity();
      check();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  function cleanup() {
    window.clearInterval(interval);
    for (const evt of ACTIVITY_EVENTS) {
      window.removeEventListener(evt, recordActivity);
    }
    window.removeEventListener("storage", onStorage);
    document.removeEventListener("visibilitychange", onVisibility);
    if (activeHandle && activeHandle.stop === handle.stop) {
      activeHandle = null;
    }
  }

  const handle: ManagerHandle = {
    stop: () => {
      stopped = true;
      cleanup();
    },
  };
  activeHandle = handle;

  // Immediately check on start in case the tab was reopened after the
  // absolute window already expired.
  check();

  return handle;
}
