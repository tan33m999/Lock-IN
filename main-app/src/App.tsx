import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Phone,
  MessageSquare,
  MessageCircle,
  MapPin,
  Calculator,
  FileText,
  Calendar,
  Camera,
  Clock,
  Music,
  Mail,
  Globe,
  Wallet,
  BookOpen,
  Plus,
  Check,
  Lock,
  Unlock,
  Download,
  Smartphone,
  ShieldCheck,
  X,
  Trash2,
  ChevronRight,
  Grid,
  Users,
  Pencil,
  Search,
  AlertCircle,
  BellOff,
  Layers,
  Play,
  AlertTriangle,
  RefreshCw,
  Eye,
  Sparkles,
  Zap,
  Copy,
  KeyRound,
} from 'lucide-react';
import {
  AllowedAppItem,
  AppIconKey,
  DayOfWeek,
  TimeBlock,
  UnlockDurationOption,
  WhitelistedContact,
} from './types/raft';
import {
  verifyOfflineUnlockCode,
  generateNextRequestId,
  generateGuardianUnlockToken,
  normalizeToAsciiDigits,
} from './utils/offlineCrypto';

declare global {
  interface Window {
    __IS_RAFT_APK__?: boolean;
    __IS_GUARDIAN_APK__?: boolean;
    __RAFT_MAIN_ONLY__?: boolean;
    __RAFT_GUARDIAN_ONLY__?: boolean;
    onAndroidResume?: () => void;
    onAndroidBackPressed?: () => boolean;
    onNativeEmergencyBreakEnded?: () => void;
    onNativeScheduledBlockStarted?: () => void;
    AndroidBridge?: {
      copyToClipboard?: (text: string) => void;
      getInstalledApps?: () => string;
      launchApp?: (packageName: string) => boolean;
      dialPhone?: (phone: string) => void;
      sendSms?: (phone: string) => void;
      setFocusLockState?: (locked: boolean, allowedPackagesCsv: string, blockLabel: string) => void;
      syncScheduleAndLockConfig?: (
        timeBlocksJson: string,
        allowedPackagesCsv: string,
        overriddenBlockId: string,
        manualEndTimeMs: number,
        unlockEndTimeMs: number
      ) => void;
      syncScheduleAndLockConfigStr?: (
        timeBlocksJson: string,
        allowedPackagesCsv: string,
        overriddenBlockId: string,
        manualEndTimeMsStr: string,
        unlockEndTimeMsStr: string
      ) => void;
      startEmergencyBreak?: (durationSeconds: number, allowedPackagesCsv: string) => void;
      startGuardianUnlock?: (durationSeconds: number, allowedPackagesCsv: string) => void;
      cancelEmergencyBreak?: () => void;
      notifySessionEvent?: (eventType: string, title: string, message: string) => void;
      requestAdminPermission?: () => boolean;
      isAdminGranted?: () => boolean;
      requestOverlayPermission?: () => boolean;
      isOverlayGranted?: () => boolean;
      requestDndPermission?: () => boolean;
      isDndGranted?: () => boolean;
      requestAccessibilityPermission?: () => boolean;
      isAccessibilityGranted?: () => boolean;
      requestBatteryPermission?: () => void;
      isBatteryGranted?: () => boolean;
    };
  }
}

function safeParseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Plays synthesized offline audio chimes (Warning Alert & Happy Celebration Melody)
 * using Web Audio API so it works 100% offline on every device.
 */
function playOfflineSoundEffect(type: 'warning' | 'happy') {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (type === 'warning') {
      // Two-pulse attention warning tone (A4 -> F4 -> A4)
      const notes = [
        { freq: 587.33, start: 0, dur: 0.14 },
        { freq: 440.0, start: 0.18, dur: 0.14 },
        { freq: 587.33, start: 0.36, dur: 0.22 },
      ];
      notes.forEach((n) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(n.freq, ctx.currentTime + n.start);
        gain.gain.setValueAtTime(0.25, ctx.currentTime + n.start);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + n.start + n.dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + n.start);
        osc.stop(ctx.currentTime + n.start + n.dur);
      });
    } else {
      // Happy Moment Celebration Arpeggio (C5 -> E5 -> G5 -> C6 major fanfare!)
      const notes = [
        { freq: 523.25, start: 0, dur: 0.16 },
        { freq: 659.25, start: 0.15, dur: 0.16 },
        { freq: 783.99, start: 0.3, dur: 0.18 },
        { freq: 1046.5, start: 0.46, dur: 0.45 },
      ];
      notes.forEach((n) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(n.freq, ctx.currentTime + n.start);
        gain.gain.setValueAtTime(0.3, ctx.currentTime + n.start);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + n.start + n.dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + n.start);
        osc.stop(ctx.currentTime + n.start + n.dur);
      });
    }
  } catch {
    // ignore audio errors
  }
}

function triggerSessionNotificationAndSound(
  eventType: 'warning' | 'happy',
  title: string,
  message: string
) {
  playOfflineSoundEffect(eventType);
  try {
    if (window.AndroidBridge?.notifySessionEvent) {
      window.AndroidBridge.notifySessionEvent(eventType, title, message);
      return;
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body: message });
    }
  } catch {
    // ignore
  }
}

// Infer recognizable icon category from Android app name and package name
function inferAppIconKey(name: string, packageName: string): AppIconKey {
  const n = (name || '').toLowerCase();
  const p = (packageName || '').toLowerCase();
  if (
    p.includes('whatsapp') ||
    n.includes('whatsapp')
  ) {
    return 'whatsapp';
  }
  if (
    p.includes('dialer') ||
    p.includes('telecom') ||
    p.includes('incallui') ||
    n === 'phone' ||
    n.includes('dialer') ||
    n.includes('call') ||
    p.includes('contacts') ||
    n.includes('contacts')
  ) {
    return 'phone';
  }
  if (
    p.includes('messaging') ||
    p.includes('mms') ||
    p.includes('telegram') ||
    p.includes('orca') ||
    p.includes('messenger') ||
    n.includes('message') ||
    n.includes('sms') ||
    n.includes('telegram') ||
    n.includes('messenger')
  ) {
    return 'messages';
  }
  if (p.includes('calculator') || p.includes('calc') || n.includes('calculator') || n.includes('calc')) {
    return 'calculator';
  }
  if (
    p.includes('maps') ||
    p.includes('navigation') ||
    p.includes('uber') ||
    p.includes('pathao') ||
    n.includes('maps') ||
    n.includes('uber') ||
    n.includes('pathao')
  ) {
    return 'maps';
  }
  if (
    p.includes('calendar') ||
    n.includes('calendar')
  ) {
    return 'calendar';
  }
  if (
    p.includes('camera') ||
    p.includes('gallery') ||
    p.includes('photos') ||
    p.includes('camscanner') ||
    n.includes('camera') ||
    n.includes('gallery') ||
    n.includes('photos')
  ) {
    return 'camera';
  }
  if (
    p.includes('deskclock') ||
    p.includes('clock') ||
    p.includes('alarm') ||
    n.includes('clock') ||
    n.includes('alarm')
  ) {
    return 'clock';
  }
  if (
    p.includes('music') ||
    p.includes('spotify') ||
    p.includes('youtube') ||
    p.includes('audio') ||
    p.includes('player') ||
    n.includes('music') ||
    n.includes('spotify') ||
    n.includes('youtube')
  ) {
    return 'music';
  }
  if (
    p.includes('.gm') ||
    p.includes('mail') ||
    p.includes('outlook') ||
    n.includes('gmail') ||
    n.includes('mail') ||
    n.includes('email')
  ) {
    return 'mail';
  }
  if (
    p.includes('chrome') ||
    p.includes('browser') ||
    p.includes('firefox') ||
    p.includes('opera') ||
    p.includes('brave') ||
    n.includes('chrome') ||
    n.includes('browser') ||
    n.includes('internet')
  ) {
    return 'globe';
  }
  if (
    p.includes('bkash') ||
    p.includes('nagad') ||
    p.includes('rocket') ||
    p.includes('wallet') ||
    p.includes('bank') ||
    p.includes('pay') ||
    p.includes('daraz') ||
    n.includes('bkash') ||
    n.includes('nagad') ||
    n.includes('rocket') ||
    n.includes('wallet') ||
    n.includes('bank')
  ) {
    return 'wallet';
  }
  if (
    p.includes('quran') ||
    p.includes('hadith') ||
    p.includes('ihadis') ||
    p.includes('book') ||
    p.includes('classroom') ||
    p.includes('duolingo') ||
    p.includes('dictionary') ||
    n.includes('quran') ||
    n.includes('hadith') ||
    n.includes('book') ||
    n.includes('dictionary')
  ) {
    return 'book';
  }
  if (
    p.includes('keep') ||
    p.includes('note') ||
    p.includes('notion') ||
    p.includes('docs') ||
    p.includes('files') ||
    p.includes('documents') ||
    n.includes('note') ||
    n.includes('files') ||
    n.includes('file manager')
  ) {
    return 'notes';
  }
  return 'custom';
}

// Essential 4 system defaults used ONLY as a fallback when previewing in a desktop/mobile web browser
// On a real Android phone, window.AndroidBridge.getInstalledApps() completely replaces this with ONLY the phone's real installed apps!
const INSTALLED_DEVICE_APPS: AllowedAppItem[] = [
  { id: 'app-phone', name: 'Phone', packageName: 'com.google.android.dialer', iconKey: 'phone', launchUrl: 'tel:' },
  { id: 'app-sms', name: 'Messages', packageName: 'com.google.android.apps.messaging', iconKey: 'messages', launchUrl: 'sms:' },
  { id: 'app-whatsapp', name: 'WhatsApp', packageName: 'com.whatsapp', iconKey: 'whatsapp', launchUrl: 'https://wa.me/' },
  { id: 'app-calc', name: 'Calculator', packageName: 'com.google.android.calculator', iconKey: 'calculator' },
];

const ALL_DAYS: { key: DayOfWeek; short: string }[] = [
  { key: 'Sun', short: 'S' },
  { key: 'Mon', short: 'M' },
  { key: 'Tue', short: 'T' },
  { key: 'Wed', short: 'W' },
  { key: 'Thu', short: 'T' },
  { key: 'Fri', short: 'F' },
  { key: 'Sat', short: 'S' },
];

const DAY_INDEX_TO_KEY: DayOfWeek[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DEFAULT_ALLOWED_IDS = ['app-phone', 'app-sms', 'app-whatsapp', 'app-calc'];

const FOCUS_TIMER_PRESETS: { minutes: number; labelBn: string; labelEn: string }[] = [
  { minutes: 15, labelBn: '১৫ মিনিট', labelEn: '15m Focus Lock' },
  { minutes: 30, labelBn: '৩০ মিনিট', labelEn: '30m Focus Lock' },
  { minutes: 45, labelBn: '৪৫ মিনিট', labelEn: '45m Focus Lock' },
  { minutes: 60, labelBn: '১ ঘণ্টা', labelEn: '1h Focus Lock' },
  { minutes: 90, labelBn: '১.৫ ঘণ্টা', labelEn: '1.5h Focus Lock' },
  { minutes: 120, labelBn: '২ ঘণ্টা', labelEn: '2h Focus Lock' },
  { minutes: 180, labelBn: '৩ ঘণ্টা', labelEn: '3h Focus Lock' },
  { minutes: 240, labelBn: '৪ ঘণ্টা', labelEn: '4h Focus Lock' },
  { minutes: 360, labelBn: '৬ ঘণ্টা', labelEn: '6h Focus Lock' },
  { minutes: 480, labelBn: '৮ ঘণ্টা', labelEn: '8h Focus Lock' },
];

// Clean Production State: No demo time blocks or fake contacts
const DEFAULT_BLOCKS: TimeBlock[] = [];

const DEFAULT_CONTACTS: WhitelistedContact[] = [];

const EMERGENCY_VERIFICATION_TEXT = 'EMERGENCY 5 MIN';
const MIN_FOCUS_SECONDS_FOR_EMERGENCY = 30 * 60; // At least 30 minutes focus required for Emergency Break

interface ActiveScheduleStatus {
  block: TimeBlock;
  remainingSeconds: number;
  totalDurationSeconds: number;
}

interface UpcomingScheduleWarning {
  block: TimeBlock;
  startsInSeconds: number;
}

function checkTimeBlockRunningNow(block: TimeBlock, now: Date): ActiveScheduleStatus | null {
  if (!block.enabled) return null;

  const [startH, startM] = block.startTime.split(':').map(Number);
  const [endH, endM] = block.endTime.split(':').map(Number);
  if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) return null;

  const startTotalSec = startH * 3600 + startM * 60;
  const endTotalSec = endH * 3600 + endM * 60;
  const nowTotalSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

  const todayKey = DAY_INDEX_TO_KEY[now.getDay()];
  const yesterdayKey = DAY_INDEX_TO_KEY[(now.getDay() + 6) % 7];
  const activeDays = block.days?.length ? block.days : DAY_INDEX_TO_KEY;

  if (startTotalSec < endTotalSec) {
    const totalDurationSeconds = endTotalSec - startTotalSec;
    if (activeDays.includes(todayKey) && nowTotalSec >= startTotalSec && nowTotalSec < endTotalSec) {
      return {
        block,
        remainingSeconds: endTotalSec - nowTotalSec,
        totalDurationSeconds,
      };
    }
    return null;
  }

  if (startTotalSec > endTotalSec) {
    const totalDurationSeconds = 86400 - startTotalSec + endTotalSec;
    if (activeDays.includes(todayKey) && nowTotalSec >= startTotalSec) {
      return {
        block,
        remainingSeconds: 86400 - nowTotalSec + endTotalSec,
        totalDurationSeconds,
      };
    }
    if (activeDays.includes(yesterdayKey) && nowTotalSec < endTotalSec) {
      return {
        block,
        remainingSeconds: endTotalSec - nowTotalSec,
        totalDurationSeconds,
      };
    }
    return null;
  }

  if (activeDays.includes(todayKey)) {
    return {
      block,
      remainingSeconds: 86400 - nowTotalSec,
      totalDurationSeconds: 86400,
    };
  }

  return null;
}

function checkTimeBlockStartingSoon(block: TimeBlock, now: Date): UpcomingScheduleWarning | null {
  if (!block.enabled) return null;
  const [startH, startM] = block.startTime.split(':').map(Number);
  if (isNaN(startH) || isNaN(startM)) return null;

  const todayKey = DAY_INDEX_TO_KEY[now.getDay()];
  const activeDays = block.days?.length ? block.days : DAY_INDEX_TO_KEY;
  if (!activeDays.includes(todayKey)) return null;

  const startTotalSec = startH * 3600 + startM * 60;
  const nowTotalSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const diff = startTotalSec - nowTotalSec;
  if (diff > 0 && diff <= 300) {
    return { block, startsInSeconds: diff };
  }
  return null;
}

/**
 * Formats a 24-hour "HH:mm" time string into 12-hour "hh:mm AM/PM" format.
 */
function formatTime12Hour(time24: string): string {
  if (!time24 || !time24.includes(':')) return time24;
  const [hStr, mStr] = time24.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return time24;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

function parse24To12Parts(time24: string): { hour12: number; minute: number; period: 'AM' | 'PM' } {
  const [hStr, mStr] = (time24 || '08:00').split(':');
  const h = Math.max(0, Math.min(23, parseInt(hStr, 10) || 0));
  const m = Math.max(0, Math.min(59, parseInt(mStr, 10) || 0));
  return {
    hour12: h % 12 || 12,
    minute: m,
    period: h >= 12 ? 'PM' : 'AM',
  };
}

function parts12To24(hour12: number, minute: number, period: 'AM' | 'PM'): string {
  const safeH12 = Math.max(1, Math.min(12, Math.floor(hour12) || 12));
  const safeMin = Math.max(0, Math.min(59, Math.floor(minute) || 0));
  let h24 = safeH12 % 12;
  if (period === 'PM') h24 += 12;
  return `${String(h24).padStart(2, '0')}:${String(safeMin).padStart(2, '0')}`;
}

function timeToMinutesSinceMidnight(time24: string): number {
  if (!time24 || !time24.includes(':')) return 0;
  const [hStr, mStr] = time24.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return 0;
  return h * 60 + m;
}

/**
 * Automatically arranges TimeBlocks in chronological order (12:00 AM -> 11:59 PM).
 */
function sortTimeBlocksChronologically(blocks: TimeBlock[]): TimeBlock[] {
  return [...blocks].sort((a, b) => {
    const startDiff = timeToMinutesSinceMidnight(a.startTime) - timeToMinutesSinceMidnight(b.startTime);
    if (startDiff !== 0) return startDiff;
    const endDiff = timeToMinutesSinceMidnight(a.endTime) - timeToMinutesSinceMidnight(b.endTime);
    if (endDiff !== 0) return endDiff;
    return a.id.localeCompare(b.id);
  });
}

interface PendingFocusConfirm {
  type: 'instant' | 'toggle_block';
  durationMinutes?: number;
  label: string;
  blockId?: string;
}

interface PendingSessionPasscodeAction {
  action: 'disable' | 'delete' | 'edit' | 'unlock_secret';
  block?: TimeBlock;
}

export default function App() {
  const isGuardianApk = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(window.__IS_GUARDIAN_APK__ || window.__RAFT_GUARDIAN_ONLY__);
  }, []);

  const isRunningInApk = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(
      window.__IS_RAFT_APK__ ||
        window.__RAFT_MAIN_ONLY__ ||
        window.__IS_GUARDIAN_APK__ ||
        window.__RAFT_GUARDIAN_ONLY__ ||
        window.AndroidBridge ||
        window.location.protocol === 'file:'
    );
  }, []);

  // In LOCK-IN-Guardian.apk, always stay in Guardian mode.
  // In LOCK-IN.apk (Main App), always start in Main Lock mode.
  const [isGuardianMode, setIsGuardianMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && (window.__IS_GUARDIAN_APK__ || window.__RAFT_GUARDIAN_ONLY__)) {
      return true;
    }
    if (
      typeof window !== 'undefined' &&
      (window.__IS_RAFT_APK__ || window.__RAFT_MAIN_ONLY__ || window.AndroidBridge)
    ) {
      return false;
    }
    return false;
  });

  const [activeTab, setActiveTab] = useState<'lock' | 'schedule' | 'apps' | 'setup' | 'apk'>('lock');
  const [use24Hour, setUse24Hour] = useState<boolean>(false);
  const [now, setNow] = useState<Date>(new Date());

  // Happy Moment Celebration Modal when Focus Session completes!
  const [completedSessionTitle, setCompletedSessionTitle] = useState<string | null>(null);
  const lastWarnedBlockRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isRunningInApk && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) {
          reg.unregister();
        }
      });
    }
  }, [isRunningInApk]);

  // 4-Step Beginning Setup Wizard (Only for main LOCK IN app, never for Guardian APK)
  const [showOnboardingModal, setShowOnboardingModal] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.__IS_GUARDIAN_APK__) return false;
    const done = localStorage.getItem('raft_prod_v1_onboarded') === 'true';
    if (!done && typeof window !== 'undefined' && (window.__IS_RAFT_APK__ || window.AndroidBridge)) {
      return true;
    }
    return false;
  });
  const [onboardingStep, setOnboardingStep] = useState<1 | 2 | 3 | 4>(1);

  const [permAdmin, setPermAdmin] = useState<boolean>(() => {
    if (window.AndroidBridge?.isAdminGranted) {
      try {
        return Boolean(window.AndroidBridge.isAdminGranted());
      } catch {
        // ignore
      }
    }
    return localStorage.getItem('raft_prod_v1_perm_admin') === 'true';
  });

  const [permDnd, setPermDnd] = useState<boolean>(() => {
    if (window.AndroidBridge?.isDndGranted) {
      try {
        return Boolean(window.AndroidBridge.isDndGranted());
      } catch {
        // ignore
      }
    }
    return localStorage.getItem('raft_prod_v1_perm_dnd') === 'true';
  });

  const [permAccessibility, setPermAccessibility] = useState<boolean>(() => {
    if (window.AndroidBridge?.isAccessibilityGranted) {
      try {
        return Boolean(window.AndroidBridge.isAccessibilityGranted());
      } catch {
        // ignore
      }
    }
    return localStorage.getItem('raft_prod_v1_perm_acc') === 'true';
  });

  const [permOverlay, setPermOverlay] = useState<boolean>(() => {
    if (window.AndroidBridge?.isOverlayGranted) {
      try {
        return Boolean(window.AndroidBridge.isOverlayGranted());
      } catch {
        // ignore
      }
    }
    return localStorage.getItem('raft_prod_v1_perm_overlay') === 'true';
  });

  const [permBattery, setPermBattery] = useState<boolean>(() => {
    if (window.AndroidBridge?.isBatteryGranted) {
      try {
        return Boolean(window.AndroidBridge.isBatteryGranted());
      } catch {
        // ignore
      }
    }
    return localStorage.getItem('raft_prod_v1_perm_battery') === 'true';
  });

  const refreshNativePermissions = () => {
    try {
      if (window.AndroidBridge?.isAdminGranted) {
        setPermAdmin(Boolean(window.AndroidBridge.isAdminGranted()));
      }
      if (window.AndroidBridge?.isDndGranted) {
        setPermDnd(Boolean(window.AndroidBridge.isDndGranted()));
      }
      if (window.AndroidBridge?.isAccessibilityGranted) {
        setPermAccessibility(Boolean(window.AndroidBridge.isAccessibilityGranted()));
      }
      if (window.AndroidBridge?.isOverlayGranted) {
        setPermOverlay(Boolean(window.AndroidBridge.isOverlayGranted()));
      }
      if (window.AndroidBridge?.isBatteryGranted) {
        setPermBattery(Boolean(window.AndroidBridge.isBatteryGranted()));
      }
    } catch {
      // ignore
    }
  };

  // Pre-Focus Warning / Confirmation Modal State
  const [pendingFocusConfirm, setPendingFocusConfirm] = useState<PendingFocusConfirm | null>(null);

  // Manual instant Focus session countdown (Wall-Clock Timestamp + remaining seconds + total duration & session ID)
  const [manualFocusUntilMs, setManualFocusUntilMs] = useState<number | null>(() => {
    const savedUntil = localStorage.getItem('raft_prod_v1_manual_until');
    if (savedUntil) {
      const target = Number(savedUntil);
      return !isNaN(target) && target > Date.now() ? target : null;
    }
    return null;
  });
  const [manualFocusSecLeft, setManualFocusSecLeft] = useState<number | null>(() => {
    const savedUntil = localStorage.getItem('raft_prod_v1_manual_until');
    if (savedUntil) {
      const diff = Math.ceil((Number(savedUntil) - Date.now()) / 1000);
      return !isNaN(diff) && diff > 0 ? diff : null;
    }
    return null;
  });
  const [manualTotalDurationSec, setManualTotalDurationSec] = useState<number>(() => {
    return Number(localStorage.getItem('raft_prod_v1_manual_total_sec') || '0');
  });
  const [manualSessionId, setManualSessionId] = useState<string>(() => {
    return localStorage.getItem('raft_prod_v1_manual_session_id') || 'init';
  });
  const [manualFocusLabel, setManualFocusLabel] = useState<string>(() => {
    return localStorage.getItem('raft_prod_v1_manual_label') || 'Focus Lock';
  });

  // Device Installed Apps (Purges old random catalog and loads ONLY real installed apps on Android)
  const [deviceApps, setDeviceApps] = useState<AllowedAppItem[]>(() => {
    try {
      localStorage.removeItem('raft_prod_v1_device_apps');
    } catch {
      // ignore
    }
    const saved = safeParseJson<AllowedAppItem[] | null>(
      localStorage.getItem('raft_prod_v3_device_apps'),
      null
    );
    if (Array.isArray(saved) && saved.length > 0) {
      return saved.map((app) => ({
        ...app,
        iconKey: app.iconKey && app.iconKey !== 'custom' ? app.iconKey : inferAppIconKey(app.name, app.packageName),
      }));
    }
    return INSTALLED_DEVICE_APPS;
  });

  // 4 Selected Allowed App IDs
  const [selectedAppIds, setSelectedAppIds] = useState<string[]>(() => {
    return safeParseJson(localStorage.getItem('raft_prod_v1_allowed_ids'), DEFAULT_ALLOWED_IDS);
  });

  const refreshNativeInstalledApps = () => {
    try {
      if (window.AndroidBridge?.getInstalledApps) {
        const rawJson = window.AndroidBridge.getInstalledApps();
        const parsed: { id?: string; name: string; pkg?: string; packageName?: string }[] =
          JSON.parse(rawJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const seenPkgs = new Set<string>();
          const realApps: AllowedAppItem[] = [];

          for (const item of parsed) {
            const pkg = (item.packageName || item.pkg || '').trim();
            const name = (item.name || '').trim();
            if (!pkg || !name) continue;
            // Exclude our own lock/guardian packages from the selectable apps list
            if (pkg === 'com.raft.focuslock' || pkg === 'com.raft.guardian') continue;
            if (seenPkgs.has(pkg)) continue;
            seenPkgs.add(pkg);

            const iconKey = inferAppIconKey(name, pkg);
            let launchUrl: string | undefined;
            if (iconKey === 'phone') launchUrl = 'tel:';
            else if (iconKey === 'messages' && !pkg.includes('telegram')) launchUrl = 'sms:';
            else if (iconKey === 'whatsapp') launchUrl = 'https://wa.me/';

            realApps.push({
              id: `pkg-${pkg}`,
              name,
              packageName: pkg,
              iconKey,
              launchUrl,
            });
          }

          realApps.sort((a, b) => a.name.localeCompare(b.name));

          if (realApps.length > 0) {
            setDeviceApps((prev) => {
              // Keep ONLY user-created custom apps that aren't already in realApps
              const customUserApps = prev.filter(
                (p) => p.isCustom && !seenPkgs.has(p.packageName)
              );
              return [...customUserApps, ...realApps];
            });

            // Reconcile selectedAppIds so default fallback IDs ('app-phone', 'app-sms', etc.)
            // automatically map to the user's real installed Phone, Messages, WhatsApp, Calculator apps
            setSelectedAppIds((prevSelected) => {
              const allIds = new Set(realApps.map((a) => a.id));
              const findBestMatch = (legacyId: string): string | null => {
                if (allIds.has(legacyId)) return legacyId;
                const byPkg = realApps.find(
                  (a) => a.packageName === legacyId || `pkg-${a.packageName}` === legacyId
                );
                if (byPkg) return byPkg.id;

                if (legacyId === 'app-phone') {
                  const dialer = realApps.find(
                    (a) =>
                      a.iconKey === 'phone' ||
                      a.packageName.toLowerCase().includes('dialer') ||
                      a.packageName.toLowerCase().includes('contacts') ||
                      a.name.toLowerCase() === 'phone'
                  );
                  return dialer ? dialer.id : null;
                }
                if (legacyId === 'app-sms') {
                  const sms = realApps.find(
                    (a) =>
                      a.packageName.toLowerCase().includes('messaging') ||
                      a.packageName.toLowerCase().includes('mms') ||
                      a.name.toLowerCase().includes('message')
                  );
                  return sms ? sms.id : null;
                }
                if (legacyId === 'app-whatsapp') {
                  const wa = realApps.find((a) =>
                    a.packageName.toLowerCase().includes('whatsapp')
                  );
                  return wa ? wa.id : null;
                }
                if (legacyId === 'app-calc') {
                  const calc = realApps.find(
                    (a) =>
                      a.iconKey === 'calculator' ||
                      a.packageName.toLowerCase().includes('calc')
                  );
                  return calc ? calc.id : null;
                }
                return null;
              };

              const mapped: string[] = [];
              for (const id of prevSelected) {
                const matched = findBestMatch(id);
                if (matched && !mapped.includes(matched)) {
                  mapped.push(matched);
                } else if (id.startsWith('app-') && id !== 'app-phone' && id !== 'app-sms' && id !== 'app-whatsapp' && id !== 'app-calc') {
                  // Preserve user-added custom app ID
                  if (!mapped.includes(id)) mapped.push(id);
                }
              }

              // If fewer than 4 matched and user had default selections, fill up to 4 with preferred essentials or top apps
              if (mapped.length === 0) {
                const fallbackDefaults = ['app-phone', 'app-sms', 'app-whatsapp', 'app-calc']
                  .map(findBestMatch)
                  .filter((x): x is string => Boolean(x));
                for (const d of fallbackDefaults) {
                  if (!mapped.includes(d) && mapped.length < 4) mapped.push(d);
                }
                for (const app of realApps) {
                  if (mapped.length >= 4) break;
                  if (!mapped.includes(app.id)) mapped.push(app.id);
                }
              }

              return mapped.slice(0, 4);
            });
          }
        }
      }
    } catch {
      // Fallback to current list if bridge unavailable
    }
  };

  useEffect(() => {
    refreshNativeInstalledApps();
  }, []);

  // Time Blocks (Clean empty default in production, automatically sorted chronologically)
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>(() => {
    const loaded = safeParseJson(localStorage.getItem('raft_prod_v1_blocks'), DEFAULT_BLOCKS);
    return sortTimeBlocksChronologically(Array.isArray(loaded) ? loaded : DEFAULT_BLOCKS);
  });

  const sortedTimeBlocks = useMemo(() => {
    return sortTimeBlocksChronologically(timeBlocks);
  }, [timeBlocks]);

  // Emergency Contacts (Clean empty default in production)
  const [contacts, setContacts] = useState<WhitelistedContact[]>(() => {
    return safeParseJson(localStorage.getItem('raft_prod_v1_contacts'), DEFAULT_CONTACTS);
  });

  // Per-Session 1x 5-Minute Emergency State + Wall-Clock Timestamp + Verification Text Challenge
  const [usedEmergencySessionId, setUsedEmergencySessionId] = useState<string | null>(() => {
    return localStorage.getItem('raft_prod_v1_used_emg_session_id') || null;
  });
  const [emergencyUntilMs, setEmergencyUntilMs] = useState<number | null>(() => {
    const saved = localStorage.getItem('raft_prod_v1_emg_until');
    if (saved) {
      const target = Number(saved);
      return !isNaN(target) && target > Date.now() ? target : null;
    }
    return null;
  });
  const [emergencySecLeft, setEmergencySecLeft] = useState<number | null>(() => {
    const saved = localStorage.getItem('raft_prod_v1_emg_until');
    if (saved) {
      const diff = Math.ceil((Number(saved) - Date.now()) / 1000);
      return !isNaN(diff) && diff > 0 ? diff : null;
    }
    return null;
  });
  const [showEmergencyModal, setShowEmergencyModal] = useState<boolean>(false);
  const [emergencyVerifyInput, setEmergencyVerifyInput] = useState<string>('');
  const [emergencyVerifyError, setEmergencyVerifyError] = useState<string | null>(null);

  // Offline Guardian Code State + Wall-Clock Guardian Unlock Timestamp (Priority over all sessions!)
  const [sharedSecret, setSharedSecret] = useState<string>(() => {
    return localStorage.getItem('raft_prod_v1_secret_key') || 'KEY-8841-RAFT';
  });
  const [requestId, setRequestId] = useState<string>(() => {
    return localStorage.getItem('raft_prod_v1_req_id') || '4921';
  });

  // Companion Guardian App (Parent-Friendly UI & Interactive First-Time Setup Tutorial) State
  const [guardianReqIdInput, setGuardianReqIdInput] = useState<string>(() => {
    return localStorage.getItem('raft_prod_v1_req_id') || '4921';
  });
  const [guardianDuration, setGuardianDuration] = useState<UnlockDurationOption>(60);
  const [isCustomDurationMode, setIsCustomDurationMode] = useState<boolean>(false);
  const [customDurationMinutes, setCustomDurationMinutes] = useState<string>('45');
  const [copiedCodeFeedback, setCopiedCodeFeedback] = useState<boolean>(false);
  const [copiedSecretFeedback, setCopiedSecretFeedback] = useState<boolean>(false);
  const [isDownloadingGuardianApk, setIsDownloadingGuardianApk] = useState<boolean>(false);
  const [showGuardianTutorial, setShowGuardianTutorial] = useState<boolean>(() => {
    return localStorage.getItem('raft_guardian_v1_onboarded') !== 'true';
  });
  const [guardianTutorialStep, setGuardianTutorialStep] = useState<1 | 2 | 3>(1);
  const [showGuardianSecretEditor, setShowGuardianSecretEditor] = useState<boolean>(false);

  const finishGuardianTutorial = () => {
    try {
      localStorage.setItem('raft_guardian_v1_onboarded', 'true');
    } catch {
      // ignore
    }
    setShowGuardianTutorial(false);
    setShowGuardianSecretEditor(false);
  };

  const [burnedReqIds, setBurnedReqIds] = useState<string[]>(() => {
    return safeParseJson(localStorage.getItem('raft_prod_v1_burned_reqs'), []);
  });
  const [burnedCodes, setBurnedCodes] = useState<string[]>(() => {
    return safeParseJson(localStorage.getItem('raft_prod_v1_burned_codes'), []);
  });

  const requestIdRef = useRef<string>(requestId);
  const burnedReqIdsRef = useRef<string[]>(burnedReqIds);
  useEffect(() => {
    requestIdRef.current = requestId;
  }, [requestId]);
  useEffect(() => {
    burnedReqIdsRef.current = burnedReqIds;
  }, [burnedReqIds]);

  // Burn current Request ID and rotate to a brand-new 4-digit Request ID immediately
  // (Prevents taking a code during Emergency/Guardian Break and using it after the break ends!)
  const rotateChallengeRequestId = () => {
    const curReq = requestIdRef.current;
    const curBurned = burnedReqIdsRef.current;
    const updatedBurned = curBurned.includes(curReq) ? curBurned : [...curBurned, curReq];
    const nextId = generateNextRequestId(curReq, updatedBurned);
    requestIdRef.current = nextId;
    burnedReqIdsRef.current = updatedBurned;
    setBurnedReqIds(updatedBurned);
    setRequestId(nextId);
    try {
      localStorage.setItem('raft_prod_v1_req_id', nextId);
      localStorage.setItem('raft_prod_v1_burned_reqs', JSON.stringify(updatedBurned));
    } catch {
      // ignore
    }
  };
  const [showUnlockModal, setShowUnlockModal] = useState<boolean>(false);
  const [unlockInput, setUnlockInput] = useState<string>('');
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [pendingPasscodeAction, setPendingPasscodeAction] =
    useState<PendingSessionPasscodeAction | null>(null);
  const [sessionPasscodeInput, setSessionPasscodeInput] = useState<string>('');
  const [sessionPasscodeError, setSessionPasscodeError] = useState<string | null>(null);
  const [scheduleGuardNotice, setScheduleGuardNotice] = useState<string | null>(null);
  const [isSecretKeyUnlocked, setIsSecretKeyUnlocked] = useState<boolean>(false);
  const [guardianUnlockUntilMs, setGuardianUnlockUntilMs] = useState<number | null>(() => {
    const saved = localStorage.getItem('raft_prod_v1_guardian_until');
    if (saved) {
      const target = Number(saved);
      return !isNaN(target) && target > Date.now() ? target : null;
    }
    return null;
  });
  const [guardianUnlockSecLeft, setGuardianUnlockSecLeft] = useState<number | null>(() => {
    const saved = localStorage.getItem('raft_prod_v1_guardian_until');
    if (saved) {
      const diff = Math.ceil((Number(saved) - Date.now()) / 1000);
      return !isNaN(diff) && diff > 0 ? diff : null;
    }
    return null;
  });
  const [overriddenBlockId, setOverriddenBlockId] = useState<string | null>(() => {
    return localStorage.getItem('raft_prod_v1_overridden_block') || null;
  });

  // Add Contact Modal
  const [showAddContactModal, setShowAddContactModal] = useState<boolean>(false);
  const [contactName, setContactName] = useState<string>('');
  const [contactRelation, setContactRelation] = useState<string>('');
  const [contactPhone, setContactPhone] = useState<string>('');

  // Add / Edit Time Block Modal
  const [showBlockModal, setShowBlockModal] = useState<boolean>(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [blockTitle, setBlockTitle] = useState<string>('');
  const [blockStart, setBlockStart] = useState<string>('22:00');
  const [blockEnd, setBlockEnd] = useState<string>('06:30');
  const [blockDays, setBlockDays] = useState<DayOfWeek[]>([
    'Sun',
    'Mon',
    'Tue',
    'Wed',
    'Thu',
    'Fri',
    'Sat',
  ]);

  // Installed Apps Drawer Modal
  const [showInstalledAppsModal, setShowInstalledAppsModal] = useState<boolean>(false);
  const [appSearchQuery, setAppSearchQuery] = useState<string>('');
  const [showManualAppForm, setShowManualAppForm] = useState<boolean>(false);
  const [manualAppName, setManualAppName] = useState<string>('');

  // Focus Timer Presets & Custom Duration Modal
  const [showFocusTimerModal, setShowFocusTimerModal] = useState<boolean>(false);
  const [selectedFocusPresetMin, setSelectedFocusPresetMin] = useState<number>(60);
  const [isCustomFocusMode, setIsCustomFocusMode] = useState<boolean>(false);
  const [customFocusHours, setCustomFocusHours] = useState<string>('1');
  const [customFocusMinutes, setCustomFocusMinutes] = useState<string>('30');
  const [customFocusSessionTitle, setCustomFocusSessionTitle] = useState<string>('');

  // Contact Quick Action Sheet
  const [selectedContactForAction, setSelectedContactForAction] =
    useState<WhitelistedContact | null>(null);

  // Active Allowed App Sheet
  const [activeMiniApp, setActiveMiniApp] = useState<AllowedAppItem | null>(null);
  const [noteText, setNoteText] = useState<string>(() => {
    return localStorage.getItem('raft_prod_v1_quick_note') || '';
  });
  const [calcExpr, setCalcExpr] = useState<string>('');

  // APK Download state
  const [isDownloadingApk, setIsDownloadingApk] = useState<boolean>(false);
  const [apkStatusMsg, setApkStatusMsg] = useState<string | null>(null);

  // Clock ticker (1s)
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Persist state offline cleanly
  useEffect(() => {
    try {
      localStorage.setItem('raft_prod_v1_secret_key', sharedSecret);
      localStorage.setItem('raft_prod_v1_perm_admin', String(permAdmin));
      localStorage.setItem('raft_prod_v1_perm_dnd', String(permDnd));
      localStorage.setItem('raft_prod_v1_perm_acc', String(permAccessibility));
      localStorage.setItem('raft_prod_v1_perm_overlay', String(permOverlay));
      localStorage.setItem('raft_prod_v1_perm_battery', String(permBattery));
      localStorage.setItem('raft_prod_v3_device_apps', JSON.stringify(deviceApps));
      localStorage.setItem('raft_prod_v1_allowed_ids', JSON.stringify(selectedAppIds));
      localStorage.setItem('raft_prod_v1_blocks', JSON.stringify(timeBlocks));
      localStorage.setItem('raft_prod_v1_contacts', JSON.stringify(contacts));
      if (usedEmergencySessionId) {
        localStorage.setItem('raft_prod_v1_used_emg_session_id', usedEmergencySessionId);
      } else {
        localStorage.removeItem('raft_prod_v1_used_emg_session_id');
      }
      if (overriddenBlockId) {
        localStorage.setItem('raft_prod_v1_overridden_block', overriddenBlockId);
      } else {
        localStorage.removeItem('raft_prod_v1_overridden_block');
      }
      localStorage.setItem('raft_prod_v1_req_id', requestId);
      localStorage.setItem('raft_prod_v1_burned_reqs', JSON.stringify(burnedReqIds));
      localStorage.setItem('raft_prod_v1_burned_codes', JSON.stringify(burnedCodes));
      localStorage.setItem('raft_prod_v1_quick_note', noteText);
    } catch {
      // ignore storage quota errors
    }
  }, [
    sharedSecret,
    permAdmin,
    permDnd,
    permAccessibility,
    permOverlay,
    permBattery,
    deviceApps,
    selectedAppIds,
    timeBlocks,
    contacts,
    usedEmergencySessionId,
    overriddenBlockId,
    requestId,
    burnedReqIds,
    burnedCodes,
    noteText,
  ]);

  // Unified Wall-Clock Emergency Break, Guardian Timed Unlock & Manual Focus Session Synchronization
  // Guarantees:
  // 1. Works 100% on real Wall-Clock time even when the phone screen is turned OFF!
  // 2. Rotates Challenge Request ID the exact instant an Emergency Break or Guardian Code Break ends!
  useEffect(() => {
    const syncUnlockTimers = () => {
      const nowMs = Date.now();

      // 1. Sync Emergency 5m Break
      if (emergencyUntilMs !== null) {
        const diffEmg = Math.ceil((emergencyUntilMs - nowMs) / 1000);
        if (diffEmg <= 0) {
          setEmergencyUntilMs(null);
          setEmergencySecLeft(null);
          localStorage.removeItem('raft_prod_v1_emg_until');
          // Immediately burn the old Request ID and rotate to a brand-new Request ID!
          rotateChallengeRequestId();
          setShowUnlockModal(false);
          setUnlockInput('');
          setUnlockError(null);
          setShowInstalledAppsModal(false);
          setPendingPasscodeAction(null);
          triggerSessionNotificationAndSound(
            'warning',
            '⚠️ ইমার্জেন্সি ব্রেক শেষ হয়েছে!',
            '৫ মিনিটের ইমার্জেন্সি ব্রেক শেষ। নতুন সিকিউরিটি কোড জেনারেট হয়েছে এবং ফোকাস লক আবার চালু হয়েছে!'
          );
        } else {
          setEmergencySecLeft(diffEmg);
        }
      } else {
        setEmergencySecLeft(null);
      }

      // 2. Sync Guardian Timed Unlock (5m / 15m / 30m / 1h / custom etc.)
      if (guardianUnlockUntilMs !== null) {
        const diffGuard = Math.ceil((guardianUnlockUntilMs - nowMs) / 1000);
        if (diffGuard <= 0) {
          setGuardianUnlockUntilMs(null);
          setGuardianUnlockSecLeft(null);
          localStorage.removeItem('raft_prod_v1_guardian_until');
          // Immediately burn the old Request ID and rotate to a brand-new Request ID!
          rotateChallengeRequestId();
          setShowUnlockModal(false);
          setUnlockInput('');
          setUnlockError(null);
          setShowInstalledAppsModal(false);
          setPendingPasscodeAction(null);
          triggerSessionNotificationAndSound(
            'warning',
            '⚠️ আনলক সময় শেষ হয়েছে!',
            'গার্ডিয়ান কোড আনলকের সময় শেষ। নতুন সিকিউরিটি কোড জেনারেট হয়েছে এবং ফোকাস সেশন আবার চালু হয়েছে!'
          );
        } else {
          setGuardianUnlockSecLeft(diffGuard);
        }
      } else {
        setGuardianUnlockSecLeft(null);
      }

      // 3. Sync Manual Focus Timer (30m / 1h etc.) using real Wall-Clock time so screen-off never pauses it!
      if (manualFocusUntilMs !== null) {
        const diffManual = Math.ceil((manualFocusUntilMs - nowMs) / 1000);
        if (diffManual <= 0) {
          setManualFocusUntilMs(null);
          setManualFocusSecLeft(null);
          localStorage.removeItem('raft_prod_v1_manual_until');
          rotateChallengeRequestId();
          triggerSessionNotificationAndSound(
            'happy',
            '🎉 অভিনন্দন! ফোকাস সেশন সম্পন্ন হয়েছে!',
            `${manualFocusLabel} সফলভাবে শেষ হয়েছে। আপনার ফোন এখন আনলক!`
          );
          setCompletedSessionTitle(manualFocusLabel);
        } else {
          setManualFocusSecLeft(diffManual);
        }
      } else {
        setManualFocusSecLeft(null);
      }
    };

    syncUnlockTimers();
    const id = setInterval(syncUnlockTimers, 500);

    const handleVisibilityOrFocus = () => {
      setNow(new Date());
      syncUnlockTimers();
    };
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    window.onAndroidResume = () => {
      setNow(new Date());
      syncUnlockTimers();
      refreshNativePermissions();
    };
    window.onNativeEmergencyBreakEnded = () => {
      setEmergencyUntilMs(null);
      setEmergencySecLeft(null);
      setGuardianUnlockUntilMs(null);
      setGuardianUnlockSecLeft(null);
      localStorage.removeItem('raft_prod_v1_emg_until');
      localStorage.removeItem('raft_prod_v1_guardian_until');
      // Rotate Request ID immediately when native break ends!
      rotateChallengeRequestId();
      setShowUnlockModal(false);
      setUnlockInput('');
      setUnlockError(null);
      setShowInstalledAppsModal(false);
      setPendingPasscodeAction(null);
      setNow(new Date());
      syncUnlockTimers();
    };
    window.onNativeScheduledBlockStarted = () => {
      rotateChallengeRequestId();
      setNow(new Date());
      syncUnlockTimers();
    };

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [emergencyUntilMs, guardianUnlockUntilMs, manualFocusUntilMs, manualFocusLabel]);

  // Ensure Android hardware Back button always closes open sheets/modals cleanly so user never gets stuck
  useEffect(() => {
    window.onAndroidBackPressed = () => {
      if (selectedContactForAction) {
        setSelectedContactForAction(null);
        return true;
      }
      if (activeMiniApp) {
        setActiveMiniApp(null);
        return true;
      }
      if (showEmergencyModal) {
        setShowEmergencyModal(false);
        return true;
      }
      if (showUnlockModal) {
        setShowUnlockModal(false);
        return true;
      }
      if (showAddContactModal) {
        setShowAddContactModal(false);
        return true;
      }
      if (showBlockModal) {
        setShowBlockModal(false);
        return true;
      }
      if (showInstalledAppsModal) {
        setShowInstalledAppsModal(false);
        return true;
      }
      if (pendingPasscodeAction) {
        setPendingPasscodeAction(null);
        setSessionPasscodeError(null);
        return true;
      }
      if (pendingFocusConfirm) {
        setPendingFocusConfirm(null);
        return true;
      }
      if (completedSessionTitle) {
        setCompletedSessionTitle(null);
        return true;
      }
      return false;
    };
  }, [
    selectedContactForAction,
    activeMiniApp,
    showEmergencyModal,
    showUnlockModal,
    showAddContactModal,
    showBlockModal,
    showInstalledAppsModal,
    pendingPasscodeAction,
    pendingFocusConfirm,
    completedSessionTitle,
  ]);

  // Clear overriddenBlockId automatically once that specific block is no longer in its active time window
  useEffect(() => {
    if (!overriddenBlockId) return;
    const targetBlock = timeBlocks.find((b) => b.id === overriddenBlockId);
    if (!targetBlock || !checkTimeBlockRunningNow(targetBlock, now)) {
      setOverriddenBlockId(null);
      localStorage.removeItem('raft_prod_v1_overridden_block');
    }
  }, [overriddenBlockId, timeBlocks, now]);

  // Conflict-Free Scheduled Time Block Detection (Picks longest remaining active block if multiple blocks overlap!)
  const activeScheduledStatus = useMemo<ActiveScheduleStatus | null>(() => {
    const runningMatches: ActiveScheduleStatus[] = [];
    for (const block of timeBlocks) {
      const status = checkTimeBlockRunningNow(block, now);
      if (status) {
        if (overriddenBlockId === block.id) continue;
        runningMatches.push(status);
      }
    }
    if (runningMatches.length === 0) return null;
    runningMatches.sort((a, b) => b.remainingSeconds - a.remainingSeconds);
    return runningMatches[0];
  }, [timeBlocks, now, overriddenBlockId]);

  // Trigger Happy Moment when a Scheduled Time Block finishes (remainingSeconds === 1)!
  useEffect(() => {
    if (activeScheduledStatus && activeScheduledStatus.remainingSeconds === 1) {
      const title = activeScheduledStatus.block.labelBn || activeScheduledStatus.block.label;
      setTimeout(() => {
        triggerSessionNotificationAndSound(
          'happy',
          '🎉 অভিনন্দন! ফোকাস সেশন সম্পন্ন হয়েছে!',
          `"${title}" ফোকাস টাইম সফলভাবে শেষ হয়েছে! দারুণ কাজ করেছেন।`
        );
        setCompletedSessionTitle(title);
      }, 1100);
    }
  }, [activeScheduledStatus]);

  const upcomingWarning = useMemo<UpcomingScheduleWarning | null>(() => {
    if (activeScheduledStatus) return null;
    for (const block of timeBlocks) {
      const warn = checkTimeBlockStartingSoon(block, now);
      if (warn) return warn;
    }
    return null;
  }, [timeBlocks, now, activeScheduledStatus]);

  // Fire Pre-Session Warning Notification + Alert Sound when a Scheduled Block is about to start!
  useEffect(() => {
    if (!upcomingWarning) return;
    const warnKey = `${upcomingWarning.block.id}-${now.toDateString()}`;
    if (lastWarnedBlockRef.current !== warnKey) {
      lastWarnedBlockRef.current = warnKey;
      const mins = Math.ceil(upcomingWarning.startsInSeconds / 60);
      triggerSessionNotificationAndSound(
        'warning',
        '⚠️ ফোকাস সেশন শুরু হতে যাচ্ছে!',
        `"${upcomingWarning.block.labelBn}" আর ${mins} মিনিটের মধ্যে শুরু হবে। প্রয়োজনীয় কাজ শেষ করে নিন।`
      );
    }
  }, [upcomingWarning, now]);

  const allowedApps = useMemo(
    () =>
      selectedAppIds
        .map((id) =>
          deviceApps.find(
            (a) => a.id === id || a.packageName === id || `pkg-${a.packageName}` === id
          )
        )
        .filter((a): a is AllowedAppItem => Boolean(a))
        .slice(0, 4),
    [selectedAppIds, deviceApps]
  );

  const filteredInstalledApps = useMemo(
    () =>
      deviceApps.filter((a) => {
        const q = appSearchQuery.trim().toLowerCase();
        if (!q) return true;
        return (
          a.name.toLowerCase().includes(q) || a.packageName.toLowerCase().includes(q)
        );
      }),
    [deviceApps, appSearchQuery]
  );

  // PRIORITY RULE: If Emergency Break or Guardian Timed Unlock is active, Unlock ALWAYS wins!
  // When the Unlock timer reaches 0, any active Scheduled Time Block or Manual Focus immediately activates!
  const isTemporarilyPaused =
    (emergencySecLeft !== null && emergencySecLeft > 0) ||
    (guardianUnlockSecLeft !== null && guardianUnlockSecLeft > 0);

  const rawFocusActive =
    Boolean(activeScheduledStatus) ||
    Boolean(manualFocusSecLeft !== null && manualFocusSecLeft > 0);

  const isFocusOverlayLocked = rawFocusActive && !isTemporarilyPaused;

  const activeFocusRemainingSec = activeScheduledStatus
    ? activeScheduledStatus.remainingSeconds
    : manualFocusSecLeft || 0;

  const activeSessionTotalDurationSec = activeScheduledStatus
    ? activeScheduledStatus.totalDurationSeconds
    : manualTotalDurationSec;

  // Unique Session Identifier so EVERY new session gets 1 fresh Emergency Break!
  const currentSessionId = useMemo<string | null>(() => {
    if (activeScheduledStatus) {
      return `sched-${activeScheduledStatus.block.id}-${now.toDateString()}`;
    }
    if (manualFocusSecLeft !== null && manualFocusSecLeft > 0) {
      return `manual-${manualSessionId}`;
    }
    return null;
  }, [activeScheduledStatus, manualFocusSecLeft, manualSessionId, now]);

  // Rotate Request ID whenever a new session becomes active!
  const lastRotatedSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentSessionId && lastRotatedSessionRef.current !== currentSessionId) {
      lastRotatedSessionRef.current = currentSessionId;
      rotateChallengeRequestId();
    }
  }, [currentSessionId]);

  // Has the 1x emergency break already been used in THIS specific session?
  const emergencyUsedInSession = Boolean(
    currentSessionId && usedEmergencySessionId === currentSessionId
  );

  // Emergency Break is ONLY available when the Focus session is at least 30 minutes (1800s)
  // AND there is more than 5 minutes (300s) of focus time remaining!
  const isEmergencyEligibleByDuration =
    activeSessionTotalDurationSec >= MIN_FOCUS_SECONDS_FOR_EMERGENCY &&
    activeFocusRemainingSec > 300;

  const canUseEmergencyBreak = !emergencyUsedInSession && isEmergencyEligibleByDuration;

  const activeFocusTitle = activeScheduledStatus
    ? activeScheduledStatus.block.labelBn || activeScheduledStatus.block.label
    : manualFocusLabel;

  // Sync Focus Lock state + Full TimeBlock Schedule + Unlock Window with Native Android Bridge
  // so Native Android AccessibilityService can INSTANTLY launch RAFT the exact second a Time Block starts
  // even when the user is inside another app!
  useEffect(() => {
    const allowedPkgsCsv = allowedApps.map((a) => a.packageName).join(',');
    const activeUnlockEndMs = isTemporarilyPaused
      ? Math.max(emergencyUntilMs || 0, guardianUnlockUntilMs || 0)
      : 0;
    const savedManualEndMs = Number(localStorage.getItem('raft_prod_v1_manual_until') || '0');
    const computedManualEndMs =
      manualFocusUntilMs !== null && manualFocusUntilMs > Date.now()
        ? Math.round(manualFocusUntilMs)
        : !isNaN(savedManualEndMs) && savedManualEndMs > Date.now()
        ? Math.round(savedManualEndMs)
        : 0;

    try {
      if (window.AndroidBridge?.syncScheduleAndLockConfigStr) {
        window.AndroidBridge.syncScheduleAndLockConfigStr(
          JSON.stringify(timeBlocks),
          allowedPkgsCsv,
          overriddenBlockId || '',
          String(computedManualEndMs),
          String(Math.round(activeUnlockEndMs))
        );
      } else if (window.AndroidBridge?.syncScheduleAndLockConfig) {
        window.AndroidBridge.syncScheduleAndLockConfig(
          JSON.stringify(timeBlocks),
          allowedPkgsCsv,
          overriddenBlockId || '',
          computedManualEndMs,
          Math.round(activeUnlockEndMs)
        );
      }
    } catch {
      // ignore schedule sync errors
    }

    try {
      if (window.AndroidBridge?.setFocusLockState) {
        window.AndroidBridge.setFocusLockState(
          isFocusOverlayLocked,
          allowedPkgsCsv,
          activeFocusTitle
        );
      }
    } catch {
      // ignore lock state errors
    }
  }, [
    isFocusOverlayLocked,
    isTemporarilyPaused,
    allowedApps,
    activeFocusTitle,
    timeBlocks,
    overriddenBlockId,
    emergencyUntilMs,
    guardianUnlockUntilMs,
    manualFocusUntilMs,
    manualFocusSecLeft,
  ]);

  // Format Clock
  const rawHours = now.getHours();
  const displayHours = use24Hour
    ? String(rawHours).padStart(2, '0')
    : String(rawHours % 12 || 12).padStart(2, '0');
  const displayMinutes = String(now.getMinutes()).padStart(2, '0');
  const displaySeconds = String(now.getSeconds()).padStart(2, '0');
  const dayName = now.toLocaleDateString('en-US', { weekday: 'short' });
  const monthDay = now.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });

  const formatDurationCountdown = (sec: number) => {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(
        s
      ).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Request Focus Activation with Warning Modal + Warning Sound/Notification first!
  const requestFocusWithWarning = (durationMinutes: number, label = 'Focus Lock') => {
    triggerSessionNotificationAndSound(
      'warning',
      '⚠️ ফোকাস সেশন শুরু হতে যাচ্ছে!',
      `"${label}" চালু করার আগে নিশ্চিত করুন। চালু হলে নির্ধারিত সময়ের আগে লক বন্ধ হবে না।`
    );
    setPendingFocusConfirm({
      type: 'instant',
      durationMinutes,
      label,
    });
  };

  // Actually start Focus Lock after user confirms Warning Modal (Resets Emergency to 1/1 for new session!)
  const handleConfirmStartFocus = () => {
    if (!pendingFocusConfirm) return;
    const newSessId = String(Date.now());
    rotateChallengeRequestId();
    if (pendingFocusConfirm.type === 'instant' && pendingFocusConfirm.durationMinutes) {
      const totalSec = pendingFocusConfirm.durationMinutes * 60;
      const endMs = Date.now() + totalSec * 1000;
      setManualFocusLabel(pendingFocusConfirm.label);
      setManualFocusUntilMs(endMs);
      setManualFocusSecLeft(totalSec);
      setManualTotalDurationSec(totalSec);
      setManualSessionId(newSessId);
      setUsedEmergencySessionId(null);
      setOverriddenBlockId(null);
      setEmergencyUntilMs(null);
      setEmergencySecLeft(null);
      setGuardianUnlockUntilMs(null);
      setGuardianUnlockSecLeft(null);
      localStorage.removeItem('raft_prod_v1_emg_until');
      localStorage.removeItem('raft_prod_v1_guardian_until');
      localStorage.removeItem('raft_prod_v1_used_emg_session_id');
      localStorage.setItem('raft_prod_v1_manual_until', String(endMs));
      localStorage.setItem('raft_prod_v1_manual_total_sec', String(totalSec));
      localStorage.setItem('raft_prod_v1_manual_session_id', newSessId);
      localStorage.setItem('raft_prod_v1_manual_label', pendingFocusConfirm.label);
      try {
        window.AndroidBridge?.cancelEmergencyBreak?.();
      } catch {
        // ignore
      }
      setActiveTab('lock');
    } else if (pendingFocusConfirm.type === 'toggle_block' && pendingFocusConfirm.blockId) {
      const targetId = pendingFocusConfirm.blockId;
      setOverriddenBlockId(null);
      setUsedEmergencySessionId(null);
      setEmergencyUntilMs(null);
      setEmergencySecLeft(null);
      localStorage.removeItem('raft_prod_v1_emg_until');
      localStorage.removeItem('raft_prod_v1_used_emg_session_id');
      try {
        window.AndroidBridge?.cancelEmergencyBreak?.();
      } catch {
        // ignore
      }
      setTimeBlocks((prev) =>
        prev.map((b) => (b.id === targetId ? { ...b, enabled: true } : b))
      );
    }
    setPendingFocusConfirm(null);
  };

  const isAppsModificationLocked =
    rawFocusActive ||
    (emergencySecLeft !== null && emergencySecLeft > 0) ||
    (guardianUnlockSecLeft !== null && guardianUnlockSecLeft > 0);

  // Toggle selection of up to 4 Allowed Apps from Installed Apps
  // Strictly blocked during any active Focus Session or Emergency/Guardian Break!
  const handleToggleAllowedApp = (id: string) => {
    if (isAppsModificationLocked) {
      setShowInstalledAppsModal(false);
      playOfflineSoundEffect('warning');
      const msg = '⛔ চলমান ফোকাস সেশন বা ইমার্জেন্সি ব্রেক চলাকালীন অনুমোদিত অ্যাপস পরিবর্তন করা সম্পূর্ণ নিষিদ্ধ!';
      setScheduleGuardNotice(msg);
      setTimeout(() => {
        setScheduleGuardNotice((prev) => (prev === msg ? null : prev));
      }, 4500);
      return;
    }
    const targetApp = deviceApps.find(
      (a) => a.id === id || a.packageName === id || `pkg-${a.packageName}` === id
    );
    const matchingIds = new Set<string>([id]);
    if (targetApp) {
      matchingIds.add(targetApp.id);
      matchingIds.add(targetApp.packageName);
      matchingIds.add(`pkg-${targetApp.packageName}`);
    }

    const isAlreadySelected = selectedAppIds.some((item) => matchingIds.has(item));
    if (isAlreadySelected) {
      if (selectedAppIds.length <= 1) return;
      setSelectedAppIds((prev) => prev.filter((item) => !matchingIds.has(item)));
    } else {
      if (selectedAppIds.length >= 4) {
        setSelectedAppIds((prev) => [...prev.slice(0, 3), id]);
      } else {
        setSelectedAppIds((prev) => [...prev, id]);
      }
    }
  };

  // Launch an Allowed App
  const handleLaunchAllowedApp = (app: AllowedAppItem) => {
    // 1. Try launching through native Android bridge
    if (window.AndroidBridge?.launchApp) {
      try {
        const launched = window.AndroidBridge.launchApp(app.packageName);
        if (launched) return;
        // WhatsApp Business fallback if main package is not installed
        if (app.packageName === 'com.whatsapp' || app.id === 'app-whatsapp') {
          const w4b = window.AndroidBridge.launchApp('com.whatsapp.w4b');
          if (w4b) return;
        }
      } catch {
        // fallback
      }
    }

    // 2. Built-in offline mini-apps (Notes and Calculator)
    if (app.iconKey === 'notes' || app.iconKey === 'calculator') {
      setActiveMiniApp(app);
      return;
    }

    // 3. Web preview / browser fallback with launchUrl
    if (app.launchUrl) {
      try {
        window.location.href = app.launchUrl;
        return;
      } catch {
        // ignore
      }
    }

    // 4. Fallback modal
    setActiveMiniApp(app);
  };

  // Safe Emergency Contact Call & SMS Handlers (Prevents WebView navigation errors)
  const handleCallContact = (phone: string) => {
    const cleanPhone = phone.trim();
    if (!cleanPhone) return;
    setSelectedContactForAction(null);
    if (window.AndroidBridge?.dialPhone) {
      try {
        window.AndroidBridge.dialPhone(cleanPhone);
        return;
      } catch {
        // fallback
      }
    }
    window.location.href = `tel:${cleanPhone}`;
  };

  const handleSmsContact = (phone: string) => {
    const cleanPhone = phone.trim();
    if (!cleanPhone) return;
    setSelectedContactForAction(null);
    if (window.AndroidBridge?.sendSms) {
      try {
        window.AndroidBridge.sendSms(cleanPhone);
        return;
      } catch {
        // fallback
      }
    }
    window.location.href = `sms:${cleanPhone}`;
  };

  const isEmergencyBreakRunningNow = emergencySecLeft !== null && emergencySecLeft > 0;

  const triggerEmergencyBlockNotice = (msg: string) => {
    playOfflineSoundEffect('warning');
    setScheduleGuardNotice(msg);
    setTimeout(() => {
      setScheduleGuardNotice((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  // Open Modal to Add New Time Block
  const openCreateBlockModal = () => {
    const curH = String(now.getHours()).padStart(2, '0');
    const curM = String(now.getMinutes()).padStart(2, '0');
    const endH = String((now.getHours() + 1) % 24).padStart(2, '0');
    setEditingBlockId(null);
    setBlockTitle('');
    setBlockStart(`${curH}:${curM}`);
    setBlockEnd(`${endH}:${curM}`);
    setBlockDays(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    setShowBlockModal(true);
  };

  // Internal helper to open Edit Modal after passcode verification
  const openEditBlockModalDirect = (block: TimeBlock) => {
    setEditingBlockId(block.id);
    setBlockTitle(block.labelBn || block.label);
    setBlockStart(block.startTime);
    setBlockEnd(block.endTime);
    setBlockDays(
      block.days?.length ? block.days : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    );
    setShowBlockModal(true);
  };

  // Request turning off, editing, or deleting a session:
  // 1. Strictly blocked during Emergency Mode!
  // 2. Requires Passcode (Guardian Code) before turning off, editing, or deleting!
  const requestSessionProtectedAction = (
    action: 'disable' | 'delete' | 'edit',
    block: TimeBlock
  ) => {
    if (isEmergencyBreakRunningNow) {
      triggerEmergencyBlockNotice(
        '⛔ ইমার্জেন্সি মোড চলাকালীন কোনো সেশন অফ, এডিট বা ডিলিট করা সম্পূর্ণ নিষিদ্ধ!'
      );
      return;
    }

    // If block is already Off (disabled) and user just wants to edit its time before turning it On, still protect disable/delete/enabled-edit with passcode
    setSessionPasscodeInput('');
    setSessionPasscodeError(null);
    setPendingPasscodeAction({ action, block });
  };

  const handleVerifySessionPasscodeAction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingPasscodeAction) return;

    if (isEmergencyBreakRunningNow) {
      setPendingPasscodeAction(null);
      triggerEmergencyBlockNotice(
        '⛔ ইমার্জেন্সি মোড চলাকালীন কোনো সেশন অফ, এডিট বা ডিলিট করা সম্পূর্ণ নিষিদ্ধ!'
      );
      return;
    }

    const res = verifyOfflineUnlockCode(
      sessionPasscodeInput,
      sharedSecret,
      requestId,
      burnedReqIds,
      burnedCodes
    );

    if (!res.valid) {
      setSessionPasscodeError(res.reasonBn);
      return;
    }

    // Burn the one-time passcode and rotate Request ID
    const cleaned = sessionPasscodeInput.trim().toUpperCase();
    const nextId = generateNextRequestId(requestId, burnedReqIds);
    setBurnedCodes((prev) => [...prev, cleaned]);
    setBurnedReqIds((prev) => [...prev, requestId]);
    setRequestId(nextId);

    const { action, block } = pendingPasscodeAction;
    setPendingPasscodeAction(null);
    setSessionPasscodeInput('');
    setSessionPasscodeError(null);

    if (action === 'unlock_secret') {
      setIsSecretKeyUnlocked(true);
      return;
    }

    if (!block) return;

    if (action === 'disable') {
      if (overriddenBlockId === block.id) {
        setOverriddenBlockId(null);
        localStorage.removeItem('raft_prod_v1_overridden_block');
      }
      setTimeBlocks((prev) =>
        sortTimeBlocksChronologically(
          prev.map((b) => (b.id === block.id ? { ...b, enabled: false } : b))
        )
      );
    } else if (action === 'delete') {
      if (overriddenBlockId === block.id) {
        setOverriddenBlockId(null);
        localStorage.removeItem('raft_prod_v1_overridden_block');
      }
      setTimeBlocks((prev) =>
        sortTimeBlocksChronologically(prev.filter((b) => b.id !== block.id))
      );
    } else if (action === 'edit') {
      openEditBlockModalDirect(block);
    }
  };

  // Save Time Block (Automatically arranges all sessions chronologically!)
  const handleSaveBlock = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = blockTitle.trim() || 'Focus Block';
    const candidateBlock: TimeBlock = {
      id: editingBlockId || `blk-${Date.now()}`,
      label: cleanTitle,
      labelBn: cleanTitle,
      startTime: blockStart,
      endTime: blockEnd,
      days: blockDays,
      enabled: true,
      emergencyUsedCount: 0,
      emergencyActiveUntil: null,
    };

    const wouldRunRightNow = Boolean(checkTimeBlockRunningNow(candidateBlock, now));
    const formattedRange12h = `${formatTime12Hour(blockStart)} – ${formatTime12Hour(blockEnd)}`;

    if (editingBlockId) {
      if (overriddenBlockId === editingBlockId) {
        setOverriddenBlockId(null);
        localStorage.removeItem('raft_prod_v1_overridden_block');
      }
      setTimeBlocks((prev) =>
        sortTimeBlocksChronologically(
          prev.map((b) =>
            b.id === editingBlockId
              ? {
                  ...b,
                  label: cleanTitle,
                  labelBn: cleanTitle,
                  startTime: blockStart,
                  endTime: blockEnd,
                  days: blockDays,
                  enabled: wouldRunRightNow ? false : true,
                }
              : b
          )
        )
      );
      if (wouldRunRightNow) {
        triggerSessionNotificationAndSound(
          'warning',
          '⚠️ ফোকাস সেশন শুরু হতে যাচ্ছে!',
          `"${cleanTitle}" এখনই চালু হতে যাচ্ছে।`
        );
        setPendingFocusConfirm({
          type: 'toggle_block',
          blockId: editingBlockId,
          label: `${cleanTitle} (${formattedRange12h})`,
        });
      }
    } else {
      const created: TimeBlock = {
        ...candidateBlock,
        enabled: !wouldRunRightNow,
      };
      setTimeBlocks((prev) => sortTimeBlocksChronologically([created, ...prev]));
      if (wouldRunRightNow) {
        triggerSessionNotificationAndSound(
          'warning',
          '⚠️ ফোকাস সেশন শুরু হতে যাচ্ছে!',
          `"${cleanTitle}" এখনই চালু হতে যাচ্ছে।`
        );
        setPendingFocusConfirm({
          type: 'toggle_block',
          blockId: created.id,
          label: `${cleanTitle} (${formattedRange12h})`,
        });
      }
    }
    setShowBlockModal(false);
    setEditingBlockId(null);
  };

  const toggleDayInModal = (day: DayOfWeek) => {
    setBlockDays((prev) =>
      prev.includes(day)
        ? prev.length > 1
          ? prev.filter((d) => d !== day)
          : prev
        : [...prev, day]
    );
  };

  // Add an unlisted app into Installed Apps & select it
  const handleAddManualApp = (e: React.FormEvent) => {
    e.preventDefault();
    if (isAppsModificationLocked) {
      setShowInstalledAppsModal(false);
      triggerEmergencyBlockNotice(
        '⛔ চলমান ফোকাস সেশন বা ইমার্জেন্সি ব্রেক চলাকালীন নতুন অ্যাপ যুক্ত বা পরিবর্তন করা সম্পূর্ণ নিষিদ্ধ!'
      );
      return;
    }
    const trimmed = manualAppName.trim();
    if (!trimmed) return;
    const pkgSlug = `com.app.${trimmed.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const newApp: AllowedAppItem = {
      id: `app-${Date.now()}`,
      name: trimmed,
      packageName: pkgSlug,
      iconKey: inferAppIconKey(trimmed, pkgSlug),
      isCustom: true,
    };
    setDeviceApps((prev) => [newApp, ...prev]);
    setSelectedAppIds((prev) =>
      prev.length < 4 ? [...prev, newApp.id] : [...prev.slice(0, 3), newApp.id]
    );
    setManualAppName('');
    setShowManualAppForm(false);
  };

  // Add Emergency Contact
  const handleAddContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactName.trim() || !contactPhone.trim()) return;
    const newContact: WhitelistedContact = {
      id: `ct-${Date.now()}`,
      name: contactName.trim(),
      relation: contactRelation.trim() || 'Emergency',
      phone: contactPhone.trim(),
      allowCall: true,
      allowSms: true,
      allowWhatsApp: true,
    };
    setContacts((prev) => [...prev, newContact]);
    setContactName('');
    setContactRelation('');
    setContactPhone('');
    setShowAddContactModal(false);
  };

  // Start 1x 5-Minute Emergency Use (Requires >=30m Focus Session + Mandatory Verification Text)
  const handleStart5MinEmergency = (e: React.FormEvent) => {
    e.preventDefault();
    if (emergencyUsedInSession) {
      setEmergencyVerifyError('এই ফোকাস সেশনে আপনার ১টি ইমার্জেন্সি ব্রেক ইতোমধ্যে ব্যবহার করা হয়েছে (0/1)।');
      return;
    }
    if (!isEmergencyEligibleByDuration) {
      setEmergencyVerifyError('ইমার্জেন্সি ব্রেক নিতে হলে ফোকাস সেশন কমপক্ষে ৩০ মিনিটের হতে হবে এবং অন্তত ৫ মিনিটের বেশি সময় বাকি থাকতে হবে।');
      return;
    }

    if (emergencyVerifyInput.trim().toUpperCase() !== EMERGENCY_VERIFICATION_TEXT) {
      setEmergencyVerifyError(
        `ভেরিফিকেশন মেলেনি! অনুগ্রহ করে বক্সে "${EMERGENCY_VERIFICATION_TEXT}" নির্ভুলভাবে লিখুন।`
      );
      return;
    }

    const endMs = Date.now() + 300 * 1000;
    if (currentSessionId) {
      setUsedEmergencySessionId(currentSessionId);
      localStorage.setItem('raft_prod_v1_used_emg_session_id', currentSessionId);
    }
    // Burn the pre-break Request ID immediately (and it will rotate again as soon as the 5m break ends!)
    rotateChallengeRequestId();
    setShowInstalledAppsModal(false);

    setEmergencyUntilMs(endMs);
    setEmergencySecLeft(300);
    localStorage.setItem('raft_prod_v1_emg_until', String(endMs));

    try {
      const allowedPkgsCsv = allowedApps.map((a) => a.packageName).join(',');
      window.AndroidBridge?.startEmergencyBreak?.(300, allowedPkgsCsv);
    } catch {
      // ignore
    }

    setEmergencyVerifyInput('');
    setEmergencyVerifyError(null);
    setShowEmergencyModal(false);
  };

  // Verify Offline Guardian Code (Supports Timed Unlock Priority & Full Session Override)
  const handleVerifyUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    const res = verifyOfflineUnlockCode(
      unlockInput,
      sharedSecret,
      requestId,
      burnedReqIds,
      burnedCodes
    );

    if (res.valid && res.durationMinutes) {
      const cleaned = unlockInput.trim().toUpperCase();
      setBurnedCodes((prev) => [...prev, cleaned]);
      // Burn current Request ID and rotate immediately (and when timed unlock ends, it rotates again!)
      rotateChallengeRequestId();
      setShowInstalledAppsModal(false);

      const allowedPkgsCsv = allowedApps.map((a) => a.packageName).join(',');

      if (res.durationMinutes === 999) {
        setManualFocusUntilMs(null);
        setManualFocusSecLeft(null);
        localStorage.removeItem('raft_prod_v1_manual_until');
        if (activeScheduledStatus) {
          setOverriddenBlockId(activeScheduledStatus.block.id);
          localStorage.setItem('raft_prod_v1_overridden_block', activeScheduledStatus.block.id);
        }
        setGuardianUnlockUntilMs(null);
        setGuardianUnlockSecLeft(null);
        localStorage.removeItem('raft_prod_v1_guardian_until');
        try {
          window.AndroidBridge?.setFocusLockState?.(false, allowedPkgsCsv, '');
        } catch {
          // ignore
        }
      } else {
        const durationSec = res.durationMinutes * 60;
        const endMs = Date.now() + durationSec * 1000;
        setGuardianUnlockUntilMs(endMs);
        setGuardianUnlockSecLeft(durationSec);
        localStorage.setItem('raft_prod_v1_guardian_until', String(endMs));
        try {
          if (window.AndroidBridge?.startGuardianUnlock) {
            window.AndroidBridge.startGuardianUnlock(durationSec, allowedPkgsCsv);
          } else {
            window.AndroidBridge?.startEmergencyBreak?.(durationSec, allowedPkgsCsv);
          }
        } catch {
          // ignore
        }
      }
      setUnlockInput('');
      setUnlockError(null);
      setShowUnlockModal(false);
    } else {
      setUnlockError(res.reasonBn);
    }
  };

  // Request Native Permissions
  const handleGrantAdminPermission = () => {
    try {
      if (window.AndroidBridge?.requestAdminPermission) {
        window.AndroidBridge.requestAdminPermission();
      }
    } catch {
      // fallback
    }
    setPermAdmin(true);
  };

  const handleGrantDndPermission = () => {
    try {
      if (window.AndroidBridge?.requestDndPermission) {
        window.AndroidBridge.requestDndPermission();
      }
    } catch {
      // fallback
    }
    setPermDnd(true);
  };

  const handleGrantAccessibilityPermission = () => {
    try {
      if (window.AndroidBridge?.requestAccessibilityPermission) {
        window.AndroidBridge.requestAccessibilityPermission();
      }
    } catch {
      // fallback
    }
    setPermAccessibility(true);
  };

  const handleGrantOverlayPermission = () => {
    try {
      if (window.AndroidBridge?.requestOverlayPermission) {
        window.AndroidBridge.requestOverlayPermission();
      }
    } catch {
      // fallback
    }
    setPermOverlay(true);
  };

  const handleGrantBatteryPermission = () => {
    try {
      if (window.AndroidBridge?.requestBatteryPermission) {
        window.AndroidBridge.requestBatteryPermission();
      }
    } catch {
      // fallback
    }
    setPermBattery(true);
  };

  const finishOnboardingSetup = () => {
    localStorage.setItem('raft_prod_v1_onboarded', 'true');
    setShowOnboardingModal(false);
    setActiveTab('lock');
  };

  // Universal Clipboard Copy (Works in Android WebView APK, Mobile Browsers & Desktop iFrame)
  const copyTextToClipboard = (text: string, kind: 'code' | 'secret' = 'code') => {
    if (!text) return;
    try {
      if (window.AndroidBridge?.copyToClipboard) {
        window.AndroidBridge.copyToClipboard(text);
      }
    } catch {
      // ignore bridge error
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
    } catch {
      // ignore
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch {
      // ignore
    }

    if (kind === 'code') {
      setCopiedCodeFeedback(true);
      setTimeout(() => setCopiedCodeFeedback(false), 2200);
    } else {
      setCopiedSecretFeedback(true);
      setTimeout(() => setCopiedSecretFeedback(false), 2200);
    }
  };

  const generatedGuardianToken = useMemo(() => {
    return generateGuardianUnlockToken(sharedSecret, guardianReqIdInput, guardianDuration);
  }, [sharedSecret, guardianReqIdInput, guardianDuration]);

  // Verified Binary APK Download (Main LOCK IN App)
  const handleDownloadVerifiedApk = async () => {
    setIsDownloadingApk(true);
    setApkStatusMsg(null);
    try {
      const res = await fetch(`/LOCK-IN.apk?v=${Date.now()}`, {
        cache: 'no-store',
      });
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes.length < 1000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
        throw new Error('Invalid APK binary stream');
      }
      const blob = new Blob([buf], {
        type: 'application/vnd.android.package-archive',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'LOCK-IN.apk';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setApkStatusMsg('LOCK-IN.apk ডাউনলোড সম্পন্ন হয়েছে! এবার আপনার ফোনে ইনস্টল করুন।');
    } catch {
      window.location.href = `/LOCK-IN.apk?v=${Date.now()}`;
    } finally {
      setIsDownloadingApk(false);
    }
  };

  // Verified Binary APK Download (Companion Guardian App)
  const handleDownloadGuardianApk = async () => {
    setIsDownloadingGuardianApk(true);
    setApkStatusMsg(null);
    try {
      const res = await fetch(`/LOCK-IN-Guardian.apk?v=${Date.now()}`, {
        cache: 'no-store',
      });
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      if (bytes.length < 1000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
        throw new Error('Invalid Guardian APK binary stream');
      }
      const blob = new Blob([buf], {
        type: 'application/vnd.android.package-archive',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'LOCK-IN-Guardian.apk';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setApkStatusMsg('LOCK-IN-Guardian.apk ডাউনলোড সম্পন্ন হয়েছে! গার্ডিয়ানের ফোনে ইনস্টল করুন।');
    } catch {
      window.location.href = `/LOCK-IN-Guardian.apk?v=${Date.now()}`;
    } finally {
      setIsDownloadingGuardianApk(false);
    }
  };

  const renderAppIcon = (
    iconKey: AppIconKey,
    className = 'w-5 h-5',
    app?: AllowedAppItem
  ) => {
    const resolvedKey =
      iconKey && iconKey !== 'custom'
        ? iconKey
        : app
        ? inferAppIconKey(app.name, app.packageName)
        : iconKey;

    const pkg = (app?.packageName || '').toLowerCase();
    const name = (app?.name || '').toLowerCase();

    // Brand SVG icons for major Android apps
    if (resolvedKey === 'whatsapp' || pkg.includes('whatsapp')) {
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={`${className} text-emerald-500`}>
          <path d="M12.031 2c-5.508 0-9.987 4.479-9.987 9.988 0 1.763.459 3.479 1.332 4.992L2 22l5.143-1.349c1.464.8 3.111 1.224 4.888 1.224 5.508 0 9.987-4.479 9.987-9.987 0-5.509-4.479-9.888-9.987-9.888zm5.829 14.129c-.246.693-1.425 1.326-1.976 1.408-.506.075-1.15.107-1.855-.117-.428-.136-.979-.318-1.685-.623-2.968-1.281-4.906-4.27-5.054-4.468-.148-.198-1.206-1.605-1.206-3.061 0-1.456.763-2.172 1.035-2.469.272-.297.594-.371.792-.371.198 0 .396.002.569.01.183.009.428-.07.668.509.248.594.842 2.055.916 2.203.074.149.124.322.025.52-.099.198-.149.322-.297.495-.148.173-.312.387-.445.52-.149.148-.303.309-.13.606.173.297.769 1.269 1.651 2.055 1.135 1.011 2.091 1.325 2.388 1.473.297.149.47.124.643-.074.173-.198.742-.866.94-1.163.198-.297.396-.248.668-.149.272.099 1.732.817 2.029.965.297.149.495.223.569.347.075.124.075.718-.171 1.411z" />
        </svg>
      );
    }

    if (pkg.includes('youtube') || name.includes('youtube')) {
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={`${className} text-red-500`}>
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      );
    }

    if (pkg.includes('facebook.katana') || name === 'facebook') {
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={`${className} text-blue-600`}>
          <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z" />
        </svg>
      );
    }

    if (pkg.includes('telegram') || name.includes('telegram')) {
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={`${className} text-sky-500`}>
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
      );
    }

    switch (resolvedKey) {
      case 'phone':
        return <Phone className={`${className} text-emerald-500`} />;
      case 'messages':
        return <MessageSquare className={`${className} text-blue-500`} />;
      case 'maps':
        return <MapPin className={`${className} text-amber-500`} />;
      case 'calculator':
        return <Calculator className={`${className} text-orange-500`} />;
      case 'notes':
        return <FileText className={`${className} text-yellow-500`} />;
      case 'calendar':
        return <Calendar className={`${className} text-rose-500`} />;
      case 'camera':
        return <Camera className={`${className} text-purple-500`} />;
      case 'clock':
        return <Clock className={`${className} text-cyan-500`} />;
      case 'music':
        return <Music className={`${className} text-pink-500`} />;
      case 'mail':
        return <Mail className={`${className} text-red-500`} />;
      case 'globe':
        return <Globe className={`${className} text-indigo-500`} />;
      case 'wallet':
        return <Wallet className={`${className} text-fuchsia-500`} />;
      case 'book':
        return <BookOpen className={`${className} text-teal-500`} />;
      default: {
        if (app && app.name) {
          const palette = [
            'bg-emerald-500 text-white',
            'bg-blue-500 text-white',
            'bg-violet-500 text-white',
            'bg-amber-500 text-white',
            'bg-rose-500 text-white',
            'bg-cyan-600 text-white',
            'bg-indigo-500 text-white',
            'bg-teal-600 text-white',
          ];
          let hash = 0;
          const seed = app.packageName || app.name;
          for (let i = 0; i < seed.length; i++) {
            hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
          }
          const colorCls = palette[hash % palette.length];
          const firstChar = Array.from(app.name.trim())[0]?.toUpperCase() || 'A';
          return (
            <span
              className={`w-6 h-6 rounded-lg ${colorCls} inline-flex items-center justify-center text-[11px] font-bold shadow-xs shrink-0`}
            >
              {firstChar}
            </span>
          );
        }
        return <Grid className={className} />;
      }
    }
  };

  const allPermissionsGranted =
    permAdmin && permDnd && permAccessibility && permOverlay && permBattery;

  return (
    <div
      className={`min-h-screen flex flex-col justify-between md:py-8 md:px-6 transition-colors duration-300 ${
        !isGuardianMode && isFocusOverlayLocked
          ? 'bg-black text-white'
          : 'bg-[#ECECEE] text-[#0A0A0A]'
      }`}
    >
      <div
        className={`w-full max-w-[430px] mx-auto md:rounded-[44px] min-h-screen md:min-h-[840px] flex flex-col justify-between relative overflow-hidden transition-colors duration-300 ${
          !isGuardianMode && isFocusOverlayLocked
            ? 'bg-black text-white md:border-[6px] md:border-neutral-900'
            : 'bg-[#F7F7F8] text-[#0A0A0A] md:shadow-[0_24px_70px_rgba(0,0,0,0.08)] md:border-[6px] md:border-white'
        }`}
      >
        {/* ====================================================================
            COMPANION GUARDIAN APP (LOCK IN GUARDIAN)
            Parent-Friendly (মা-বাবার জন্য সহজ) Interface:
            - Interactive 3-Step First-Time Setup Tutorial (explains while setting up)
            - Large, clear numbered steps (১ -> ২ -> ৩) with zero technical jargon
            - Protected/collapsed Secret Key so parents don't accidentally change it
           ==================================================================== */}
        {isGuardianMode ? (
          <div className="flex-1 flex flex-col justify-between px-6 py-6 bg-[#F7F7F8] text-[#0A0A0A]">
            <div className="space-y-4">
              {/* Top Header */}
              <header className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-[#0A0A0A] text-white flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-base font-display font-bold tracking-tight text-[#0A0A0A]">
                      গার্ডিয়ান অ্যাপ
                    </div>
                    <div className="text-xs text-neutral-500">
                      আনলক কোড তৈরি করুন
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setGuardianTutorialStep(1);
                      setShowGuardianTutorial(true);
                    }}
                    className="px-3.5 h-10 rounded-full bg-white border border-black/12 text-xs font-semibold text-[#0A0A0A] hover:bg-neutral-100 transition-colors cursor-pointer"
                  >
                    কীভাবে কাজ করে?
                  </button>

                  {!isGuardianApk && (
                    <button
                      type="button"
                      onClick={() => setIsGuardianMode(false)}
                      className="px-3.5 h-10 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                    >
                      LOCK IN →
                    </button>
                  )}
                </div>
              </header>

              {showGuardianTutorial ? (
                /* ============================================================
                   INTERACTIVE 3-STEP FIRST-TIME SETUP TUTORIAL (মা-বাবার জন্য)
                   Short, simple explanation while actually setting up!
                   ============================================================ */
                <div className="p-6 rounded-[30px] bg-white border border-black/8 shadow-sm space-y-5">
                  {/* Step Progress Bar */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-neutral-500">
                      <span>সহজ সেটআপ গাইড</span>
                      <span>ধাপ {guardianTutorialStep} / ৩</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[1, 2, 3].map((s) => (
                        <div
                          key={s}
                          className={`h-2 rounded-full transition-colors ${
                            s <= guardianTutorialStep ? 'bg-[#0A0A0A]' : 'bg-neutral-200'
                          }`}
                        />
                      ))}
                    </div>
                  </div>

                  {guardianTutorialStep === 1 && (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <div className="text-sm font-semibold text-neutral-500">
                          ধাপ ১ (শুধু প্রথমবার)
                        </div>
                        <h2 className="text-xl font-bold text-[#0A0A0A] leading-snug">
                          ১. সিক্রেট কোড মিলিয়ে নিন
                        </h2>
                        <p className="text-sm text-neutral-600 leading-relaxed">
                          <strong>LOCK IN</strong> অ্যাপে যে গার্ডিয়ান কোডটি দেওয়া আছে, নিচের বক্সে ঠিক সেই একই কোডটি রাখুন। (ডিফল্ট কোড থাকলে কিছু বদলাতে হবে না)।
                        </p>
                      </div>

                      <div className="p-4 rounded-2xl bg-[#F4F4F5] space-y-2">
                        <label className="text-xs font-semibold text-neutral-600 block">
                          গার্ডিয়ান সিক্রেট কোড:
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={sharedSecret}
                            onChange={(e) => setSharedSecret(e.target.value.toUpperCase())}
                            placeholder="KEY-8841-RAFT"
                            className="flex-1 h-13 px-4 rounded-xl bg-white text-base font-mono font-bold tracking-wider text-[#0A0A0A] uppercase focus:outline-none focus:ring-2 focus:ring-black"
                          />
                          <button
                            type="button"
                            onClick={() => copyTextToClipboard(sharedSecret, 'secret')}
                            className="h-13 px-4 rounded-xl bg-[#0A0A0A] text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer"
                          >
                            {copiedSecretFeedback ? (
                              <>
                                <Check className="w-4 h-4 text-emerald-400" />
                                <span>কপি হয়েছে</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-4 h-4" />
                                <span>কপি</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setGuardianTutorialStep(2)}
                        className="w-full h-13 rounded-2xl bg-[#0A0A0A] text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
                      >
                        <span>এটি ঠিক আছে, পরবর্তী ধাপ</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {guardianTutorialStep === 2 && (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <div className="text-sm font-semibold text-neutral-500">
                          ধাপ ২ (যখন ফোন আনলক করতে চাইবে)
                        </div>
                        <h2 className="text-xl font-bold text-[#0A0A0A] leading-snug">
                          ২. ৪ সংখ্যার নাম্বার ও সময় দিন
                        </h2>
                        <p className="text-sm text-neutral-600 leading-relaxed">
                          লক থাকা ফোনের স্ক্রিনে যে <strong>৪ সংখ্যার নাম্বারটি</strong> দেখাচ্ছে তা এখানে লিখুন এবং কত সময়ের জন্য আনলক করবেন তা বাটনে চাপ দিয়ে বেছে নিন।
                        </p>
                      </div>

                      {/* Interactive Try Box in Step 2 */}
                      <div className="p-4 rounded-2xl bg-[#F4F4F5] space-y-3">
                        <div>
                          <label className="text-xs font-semibold text-neutral-600 block mb-1.5">
                            এখানে ৪ সংখ্যার নাম্বার লিখে দেখুন:
                          </label>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-mono font-bold text-neutral-400">
                              #
                            </span>
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={4}
                              value={guardianReqIdInput}
                              onChange={(e) => {
                                const clean = normalizeToAsciiDigits(e.target.value)
                                  .replace(/[^0-9]/g, '')
                                  .slice(0, 4);
                                setGuardianReqIdInput(clean);
                              }}
                              placeholder="4921"
                              className="w-full h-14 pl-10 pr-4 rounded-xl bg-white text-2xl font-mono font-bold tracking-widest text-[#0A0A0A] focus:outline-none focus:ring-2 focus:ring-black"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-neutral-600 block mb-1.5">
                            সময় বেছে নিন:
                          </label>
                          <div className="grid grid-cols-3 gap-2">
                            {(
                              [
                                { val: 10, label: '১০ মিনিট' },
                                { val: 30, label: '৩০ মিনিট' },
                                { val: 60, label: '১ ঘণ্টা' },
                              ] as { val: UnlockDurationOption; label: string }[]
                            ).map((opt) => (
                              <button
                                key={opt.val}
                                type="button"
                                onClick={() => {
                                  setIsCustomDurationMode(false);
                                  setGuardianDuration(opt.val);
                                }}
                                className={`h-11 rounded-xl text-sm font-bold transition-colors cursor-pointer ${
                                  guardianDuration === opt.val
                                    ? 'bg-[#0A0A0A] text-white'
                                    : 'bg-white text-[#0A0A0A]'
                                }`}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => setGuardianTutorialStep(1)}
                          className="px-5 h-13 rounded-2xl bg-[#F4F4F5] text-sm font-bold text-[#0A0A0A] cursor-pointer"
                        >
                          পেছনে
                        </button>
                        <button
                          type="button"
                          onClick={() => setGuardianTutorialStep(3)}
                          className="flex-1 h-13 rounded-2xl bg-[#0A0A0A] text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <span>পরবর্তী ধাপ</span>
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  {guardianTutorialStep === 3 && (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <div className="text-sm font-semibold text-neutral-500">
                          ধাপ ৩ (শেষ ধাপ)
                        </div>
                        <h2 className="text-xl font-bold text-[#0A0A0A] leading-snug">
                          ৩. কোডটি কপি করুন বা মুখে বলুন
                        </h2>
                        <p className="text-sm text-neutral-600 leading-relaxed">
                          নিচের কালো বক্সে বড় করে <strong>আনলক কোড</strong> তৈরি হয়ে যাবে। কালো বক্সে চাপ দিলেই কোডটি কপি হয়ে যাবে—তখন মেসেজে পাঠিয়ে দিন অথবা মুখে বলে দিন।
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => copyTextToClipboard(generatedGuardianToken.fullCode, 'code')}
                        className="w-full p-5 rounded-2xl bg-[#0A0A0A] text-white text-left space-y-2 cursor-pointer active:scale-[0.99]"
                      >
                        <div className="flex items-center justify-between text-xs text-neutral-300">
                          <span>তৈরি হওয়া আনলক কোড:</span>
                          <span className="font-bold text-emerald-400">
                            {copiedCodeFeedback ? '✓ কপি হয়েছে!' : 'চাপ দিয়ে কপি করুন'}
                          </span>
                        </div>
                        <div className="text-3xl font-mono font-bold tracking-widest text-white">
                          {generatedGuardianToken.fullCode}
                        </div>
                      </button>

                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => setGuardianTutorialStep(2)}
                          className="px-5 h-13 rounded-2xl bg-[#F4F4F5] text-sm font-bold text-[#0A0A0A] cursor-pointer"
                        >
                          পেছনে
                        </button>
                        <button
                          type="button"
                          onClick={finishGuardianTutorial}
                          className="flex-1 h-13 rounded-2xl bg-[#0A0A0A] text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <Check className="w-4 h-4" />
                          <span>বুঝেছি, অ্যাপ শুরু করুন</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* ============================================================
                   MAIN PARENT-FRIENDLY GUARDIAN SCREEN (১ -> ২ -> ৩ সহজ ধাপ)
                   ============================================================ */
                <div className="space-y-4">
                  {/* Compact Saved Secret Key Bar (Prevents accidental edits by parents) */}
                  <div className="px-4 py-3 rounded-2xl bg-white border border-black/8 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <KeyRound className="w-4 h-4 text-neutral-600 shrink-0" />
                      <div className="text-xs text-neutral-600 truncate">
                        সিক্রেট কোড: <strong className="font-mono text-[#0A0A0A]">{sharedSecret}</strong>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowGuardianSecretEditor((prev) => !prev)}
                      className="text-xs font-semibold text-neutral-700 underline underline-offset-2 shrink-0 cursor-pointer"
                    >
                      {showGuardianSecretEditor ? 'বন্ধ করুন' : 'পরিবর্তন করুন'}
                    </button>
                  </div>

                  {showGuardianSecretEditor && (
                    <div className="p-4 rounded-[24px] bg-white border border-black/10 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-neutral-700">
                          LOCK IN অ্যাপের সাথে মেলানো সিক্রেট কোড:
                        </span>
                        <button
                          type="button"
                          onClick={() => copyTextToClipboard(sharedSecret, 'secret')}
                          className="px-3 py-1 rounded-xl bg-[#F4F4F5] text-xs font-semibold text-[#0A0A0A] flex items-center gap-1 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>{copiedSecretFeedback ? 'কপি হয়েছে' : 'কপি'}</span>
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={sharedSecret}
                          onChange={(e) => setSharedSecret(e.target.value.toUpperCase())}
                          placeholder="KEY-8841-RAFT"
                          className="flex-1 h-12 px-4 rounded-xl bg-[#F4F4F5] text-base font-mono font-bold tracking-wider text-[#0A0A0A] uppercase focus:outline-none focus:ring-2 focus:ring-black"
                        />
                        <button
                          type="button"
                          onClick={() => setShowGuardianSecretEditor(false)}
                          className="h-12 px-4 rounded-xl bg-[#0A0A0A] text-white text-xs font-bold cursor-pointer"
                        >
                          সেভ
                        </button>
                      </div>
                    </div>
                  )}

                  {/* STEP 1: ENTER 4-DIGIT NUMBER */}
                  <div className="p-5 rounded-[28px] bg-white border border-black/8 space-y-3 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-base font-bold text-[#0A0A0A]">
                          ধাপ ১: ৪ সংখ্যার নাম্বারটি লিখুন
                        </h2>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          লক থাকা ফোনের স্ক্রিনে যে ৪ সংখ্যার Request ID দেখাচ্ছে তা লিখুন
                        </p>
                      </div>
                      {guardianReqIdInput.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setGuardianReqIdInput('')}
                          className="px-3 py-1.5 rounded-xl bg-[#F4F4F5] text-xs font-semibold text-neutral-700 hover:bg-neutral-200 cursor-pointer shrink-0"
                        >
                          মুছুন
                        </button>
                      )}
                    </div>

                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-mono font-bold text-neutral-400">
                        #
                      </span>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={4}
                        value={guardianReqIdInput}
                        onChange={(e) => {
                          const clean = normalizeToAsciiDigits(e.target.value)
                            .replace(/[^0-9]/g, '')
                            .slice(0, 4);
                          setGuardianReqIdInput(clean);
                          if (clean.length === 4) {
                            const tok = generateGuardianUnlockToken(
                              sharedSecret,
                              clean,
                              guardianDuration
                            );
                            copyTextToClipboard(tok.fullCode, 'code');
                          }
                        }}
                        placeholder="4921"
                        className="w-full h-15 pl-11 pr-4 rounded-2xl bg-[#F4F4F5] text-2xl font-mono font-bold tracking-[0.25em] text-[#0A0A0A] focus:outline-none focus:ring-2 focus:ring-black"
                      />
                    </div>
                  </div>

                  {/* STEP 2: SELECT TIME DURATION */}
                  <div className="p-5 rounded-[28px] bg-white border border-black/8 space-y-3 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-base font-bold text-[#0A0A0A]">
                          ধাপ ২: কত সময়ের জন্য আনলক দেবেন?
                        </h2>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          নিচের যেকোনো একটি সময়ের বাটনে চাপ দিন
                        </p>
                      </div>
                      <span className="text-xs font-bold text-[#0A0A0A]">
                        {generatedGuardianToken.durationLabelBn}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { val: 5, label: '৫ মিনিট' },
                          { val: 10, label: '১০ মিনিট' },
                          { val: 15, label: '১৫ মিনিট' },
                          { val: 20, label: '২০ মিনিট' },
                          { val: 30, label: '৩০ মিনিট' },
                          { val: 45, label: '৪৫ মিনিট' },
                          { val: 60, label: '১ ঘণ্টা' },
                          { val: 120, label: '২ ঘণ্টা' },
                          { val: 999, label: 'পুরো সেশন' },
                        ] as { val: UnlockDurationOption; label: string }[]
                      ).map((opt) => {
                        const active = !isCustomDurationMode && guardianDuration === opt.val;
                        return (
                          <button
                            key={opt.val}
                            type="button"
                            onClick={() => {
                              setIsCustomDurationMode(false);
                              setGuardianDuration(opt.val);
                              const tok = generateGuardianUnlockToken(
                                sharedSecret,
                                guardianReqIdInput,
                                opt.val
                              );
                              copyTextToClipboard(tok.fullCode, 'code');
                            }}
                            className={`h-12 px-2 rounded-2xl text-sm font-bold transition-all cursor-pointer ${
                              active
                                ? 'bg-[#0A0A0A] text-white shadow-sm'
                                : 'bg-[#F4F4F5] text-neutral-700 hover:text-black'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Custom Time Input Box */}
                    <div className="pt-1">
                      {!isCustomDurationMode ? (
                        <button
                          type="button"
                          onClick={() => {
                            setIsCustomDurationMode(true);
                            const parsed = Math.max(
                              1,
                              Math.min(
                                1440,
                                Math.floor(
                                  Number(normalizeToAsciiDigits(customDurationMinutes)) || 25
                                )
                              )
                            );
                            setGuardianDuration(parsed);
                          }}
                          className="w-full h-11 px-4 rounded-2xl bg-[#F4F4F5] hover:bg-neutral-200/80 text-xs font-bold text-[#0A0A0A] flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <Clock className="w-4 h-4" />
                          <span>+ অন্য যেকোনো কাস্টম মিনিট লিখুন</span>
                        </button>
                      ) : (
                        <div className="p-4 rounded-2xl bg-[#F4F4F5] border border-black/10 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-[#0A0A0A]">
                              কত মিনিট সময় দেবেন লিখুন:
                            </span>
                            <button
                              type="button"
                              onClick={() => setIsCustomDurationMode(false)}
                              className="text-xs text-neutral-600 hover:text-black underline cursor-pointer"
                            >
                              তালিকায় ফিরুন
                            </button>
                          </div>

                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={customDurationMinutes}
                              onChange={(e) => {
                                const raw = normalizeToAsciiDigits(e.target.value)
                                  .replace(/[^0-9]/g, '')
                                  .slice(0, 4);
                                setCustomDurationMinutes(raw);
                                if (raw.length > 0) {
                                  const num = Math.max(
                                    1,
                                    Math.min(1440, Math.floor(Number(raw) || 1))
                                  );
                                  setGuardianDuration(num);
                                }
                              }}
                              placeholder="যেমন: 25"
                              className="flex-1 h-12 px-4 rounded-xl bg-white text-lg font-mono font-bold text-[#0A0A0A] focus:outline-none focus:ring-2 focus:ring-black"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const num = Math.max(
                                  1,
                                  Math.min(
                                    1440,
                                    Math.floor(
                                      Number(normalizeToAsciiDigits(customDurationMinutes)) || 10
                                    )
                                  )
                                );
                                setCustomDurationMinutes(String(num));
                                setGuardianDuration(num);
                                const tok = generateGuardianUnlockToken(
                                  sharedSecret,
                                  guardianReqIdInput,
                                  num
                                );
                                copyTextToClipboard(tok.fullCode, 'code');
                              }}
                              className="h-12 px-4 rounded-xl bg-[#0A0A0A] text-white text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer active:scale-95 transition-transform"
                            >
                              <Copy className="w-4 h-4" />
                              <span>কপি কোড</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* STEP 3: BIG CLEAR UNLOCK CODE CARD */}
                  <div className="p-5 rounded-[28px] bg-[#0A0A0A] text-white space-y-3.5 shadow-md">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold text-white">
                          ধাপ ৩: এই আনলক কোডটি ব্যবহার করুন
                        </div>
                        <div className="text-xs text-neutral-400 mt-0.5">
                          নাম্বার #{guardianReqIdInput.replace(/[^0-9]/g, '').padStart(4, '0').slice(0, 4)} · {generatedGuardianToken.durationLabelBn}-এর জন্য কোড
                        </div>
                      </div>
                    </div>

                    <div
                      onClick={() => copyTextToClipboard(generatedGuardianToken.fullCode, 'code')}
                      className="p-4 rounded-2xl bg-white/10 border border-white/15 text-center cursor-pointer active:scale-[0.99] transition-transform"
                    >
                      <div className="text-3xl sm:text-4xl font-mono font-bold tracking-[0.18em] text-white select-all">
                        {generatedGuardianToken.fullCode}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => copyTextToClipboard(generatedGuardianToken.fullCode, 'code')}
                      className={`w-full h-13 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer active:scale-[0.99] ${
                        copiedCodeFeedback
                          ? 'bg-emerald-400 text-[#0A0A0A]'
                          : 'bg-white text-[#0A0A0A] hover:bg-neutral-100'
                      }`}
                    >
                      {copiedCodeFeedback ? (
                        <>
                          <Check className="w-5 h-5" />
                          <span>কোড কপি হয়েছে! এখন মেসেজে পাঠিয়ে দিন</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          <span>এখানে চাপ দিয়ে কোডটি কপি করুন</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Section: Only shown in Web Preview to download Guardian APK */}
            {!isRunningInApk ? (
              <div className="pt-4 space-y-2">
                <button
                  type="button"
                  disabled={isDownloadingGuardianApk}
                  onClick={handleDownloadGuardianApk}
                  className="w-full h-12 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold flex items-center justify-center gap-2 hover:opacity-95 transition-opacity cursor-pointer shadow-sm"
                >
                  <Download className="w-4 h-4" />
                  <span>
                    {isDownloadingGuardianApk
                      ? 'Downloading LOCK-IN-Guardian.apk...'
                      : 'Download Guardian APK (LOCK-IN-Guardian.apk)'}
                  </span>
                </button>
                {apkStatusMsg && (
                  <div className="text-[11px] text-emerald-700 text-center font-medium">
                    {apkStatusMsg}
                  </div>
                )}
              </div>
            ) : (
              <div className="pt-2 text-center text-xs text-neutral-500">
                কোডটি কপি করে মেসেজে পাঠান অথবা মুখে বলে দিন
              </div>
            )}
          </div>
        ) : isFocusOverlayLocked ? (
          <div className="flex-1 flex flex-col justify-between px-7 py-7 bg-black text-white select-none">
            {/* Top Status & Remaining Time Box */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#141416] border border-white/10 text-white text-xs font-semibold">
                  <Lock className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{activeFocusTitle}</span>
                </div>

                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#141416] border border-white/10 text-[11px] font-medium text-neutral-300">
                  <BellOff className="w-3.5 h-3.5 text-neutral-400" />
                  <span>DND Active</span>
                </div>
              </div>

              {/* Prominent Remaining Countdown Card */}
              <div className="p-4 rounded-[24px] bg-[#111113] border border-white/10 flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-neutral-400">ফোকাস শেষ হতে বাকি</div>
                  <div className="text-xs font-medium text-neutral-300 mt-0.5">
                    {activeScheduledStatus
                      ? `${formatTime12Hour(activeScheduledStatus.block.startTime)} – ${formatTime12Hour(activeScheduledStatus.block.endTime)}`
                      : 'পাওয়ার সেভিং ফোকাস লক চালু আছে'}
                  </div>
                </div>
                <div className="text-2xl font-mono font-bold tracking-tight tabular-nums text-white">
                  {formatDurationCountdown(activeFocusRemainingSec)}
                </div>
              </div>
            </div>

            {/* Big Power-Saving White Clock on Pure Black */}
            <div className="py-2 flex items-baseline justify-between">
              <div className="text-[86px] leading-[0.88] font-display font-semibold tracking-tighter text-white tabular-nums">
                <div>{displayHours}</div>
                <div>{displayMinutes}</div>
              </div>

              <div className="text-right space-y-2.5">
                <div className="text-lg font-medium text-neutral-300 leading-snug">
                  <div>{dayName},</div>
                  <div>{monthDay}</div>
                </div>
                <div className="text-2xl font-display font-semibold text-neutral-500 tabular-nums">
                  {displaySeconds}
                </div>
              </div>
            </div>

            {/* ONLY the 4 Allowed Apps (Dark Power-Saving Tiles) */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-neutral-500">
                ব্যবহারযোগ্য অ্যাপস ({allowedApps.length})
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {allowedApps.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => handleLaunchAllowedApp(app)}
                    style={{ touchAction: 'manipulation' }}
                    className="p-4 rounded-[24px] bg-[#111113] active:bg-[#1E1E22] border border-white/10 text-white flex items-center justify-between cursor-pointer select-none touch-manipulation active:scale-[0.98] transition-transform text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0 pointer-events-none">
                      <div className="w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center shrink-0">
                        {renderAppIcon(app.iconKey, 'w-4 h-4', app)}
                      </div>
                      <span className="text-sm font-medium truncate">{app.name}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Emergency Contacts (Dark Power-Saving Rows) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-neutral-500">
                  ইমার্জেন্সি কন্টাক্ট ({contacts.length})
                </span>
              </div>

              {contacts.length === 0 ? (
                <div className="p-3.5 rounded-[22px] bg-[#111113] border border-white/10 text-xs text-neutral-500 text-center">
                  কোনো ইমার্জেন্সি কন্টাক্ট যুক্ত করা হয়নি
                </div>
              ) : (
                <div className="space-y-2 max-h-[165px] overflow-y-auto pr-0.5">
                  {contacts.map((contact) => (
                    <div
                      key={contact.id}
                      onClick={() => setSelectedContactForAction(contact)}
                      className="p-3.5 rounded-[22px] bg-[#111113] border border-white/10 flex items-center justify-between gap-3 cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center font-semibold text-xs shrink-0">
                          {contact.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white truncate">
                            {contact.name}
                          </div>
                          <div className="text-xs text-neutral-400 truncate">
                            {contact.relation} · {contact.phone}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSmsContact(contact.phone);
                          }}
                          className="w-9 h-9 rounded-full bg-white/15 text-white flex items-center justify-center shrink-0 cursor-pointer"
                          title="Send SMS"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCallContact(contact.phone);
                          }}
                          className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center shrink-0 cursor-pointer"
                          title="Call now"
                        >
                          <Phone className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Emergency Unlock Row at Bottom */}
            <div className="pt-2 space-y-1.5">
              {!isEmergencyEligibleByDuration && !emergencyUsedInSession && (
                <div className="text-[11px] text-center text-neutral-500">
                  ইমার্জেন্সি ব্রেক শুধুমাত্র কমপক্ষে ৩০ মিনিটের ফোকাস সেশনে পাওয়া যাবে
                </div>
              )}
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={!canUseEmergencyBreak}
                  onClick={() => {
                    if (!canUseEmergencyBreak) return;
                    setEmergencyVerifyInput('');
                    setEmergencyVerifyError(null);
                    setShowEmergencyModal(true);
                  }}
                  className={`py-3.5 px-4 rounded-[22px] text-xs font-medium flex items-center justify-between transition-all ${
                    !canUseEmergencyBreak
                      ? 'bg-[#0C0C0E] border border-white/5 text-neutral-600 cursor-not-allowed'
                      : 'bg-[#111113] border border-white/10 text-neutral-200 cursor-pointer'
                  }`}
                >
                  <span>5m Emergency</span>
                  <span className="font-mono text-[11px] text-neutral-500">
                    {emergencyUsedInSession
                      ? '0/1'
                      : !isEmergencyEligibleByDuration
                      ? '≥30m'
                      : '1/1'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowUnlockModal(true)}
                  className="py-3.5 px-4 rounded-[22px] bg-[#111113] border border-white/10 text-xs font-medium text-neutral-200 flex items-center justify-between cursor-pointer"
                >
                  <span>Guardian Code</span>
                  <span className="font-mono text-[11px] text-neutral-500">#{requestId}</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* ====================================================================
             NORMAL APP MODE (Clean White Minimal Dashboard when Unlocked)
             ==================================================================== */
          <>
            {/* Top Minimal Header Bar */}
            <header className="px-7 pt-7 pb-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveTab('lock')}
                  className="px-3.5 h-10 rounded-full bg-[#0A0A0A] text-white flex items-center gap-2 shadow-sm cursor-pointer active:scale-95 transition-transform"
                  title="LOCK IN Status"
                >
                  <Unlock className="w-3.5 h-3.5" />
                  <span className="text-xs font-display font-bold tracking-wider">LOCK IN</span>
                </button>
                {!isRunningInApk && (
                  <button
                    type="button"
                    onClick={() => setIsGuardianMode(true)}
                    className="px-3 h-10 rounded-full bg-white border border-black/10 text-[#0A0A0A] text-xs font-semibold flex items-center gap-1.5 hover:bg-neutral-100 cursor-pointer"
                    title="Open Guardian App"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Guardian</span>
                  </button>
                )}
              </div>

              {activeTab === 'lock' ? (
                <div className="flex items-center bg-white rounded-full p-1 shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-black/5">
                  <button
                    type="button"
                    onClick={() => setUse24Hour(false)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                      !use24Hour ? 'bg-[#0A0A0A] text-white' : 'text-neutral-500 hover:text-black'
                    }`}
                  >
                    12h
                  </button>
                  <button
                    type="button"
                    onClick={() => setUse24Hour(true)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                      use24Hour ? 'bg-[#0A0A0A] text-white' : 'text-neutral-500 hover:text-black'
                    }`}
                  >
                    24h
                  </button>
                </div>
              ) : (
                <div className="text-sm font-semibold tracking-tight text-neutral-800">
                  {activeTab === 'schedule'
                    ? 'Time Blocks'
                    : activeTab === 'apps'
                    ? 'Allowed Apps'
                    : activeTab === 'setup'
                    ? 'Permissions & Setup'
                    : 'Download APK'}
                </div>
              )}

              {activeTab === 'schedule' ? (
                <button
                  type="button"
                  onClick={openCreateBlockModal}
                  className="w-10 h-10 rounded-full bg-white text-[#0A0A0A] flex items-center justify-center shadow-sm border border-black/5 cursor-pointer"
                  title="Add New Time Block"
                >
                  <Plus className="w-5 h-5" />
                </button>
              ) : activeTab === 'apps' ? (
                <button
                  type="button"
                  onClick={() => {
                    refreshNativeInstalledApps();
                    setAppSearchQuery('');
                    setShowInstalledAppsModal(true);
                  }}
                  className="w-10 h-10 rounded-full bg-white text-[#0A0A0A] flex items-center justify-center shadow-sm border border-black/5 cursor-pointer"
                  title="Select from Installed Apps"
                >
                  <Plus className="w-5 h-5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAddContactModal(true)}
                  className="w-10 h-10 rounded-full bg-white text-[#0A0A0A] flex items-center justify-center shadow-sm border border-black/5 cursor-pointer"
                  title="Add Emergency Contact"
                >
                  <Plus className="w-5 h-5" />
                </button>
              )}
            </header>

            {/* Advance Warning Banner when a Scheduled Time Block is starting within 5 minutes */}
            {upcomingWarning && (
              <div className="mx-7 mt-1 p-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-[#0A0A0A] flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    সতর্কবার্তা: <strong>{upcomingWarning.block.labelBn}</strong> ফোকাস লক চালু হতে{' '}
                    <strong className="font-mono">
                      {formatDurationCountdown(upcomingWarning.startsInSeconds)}
                    </strong>{' '}
                    বাকি!
                  </span>
                </div>
              </div>
            )}

            {/* Active Temporary Pause Banner (Unlock Takes Priority over Overlapping Sessions!) */}
            {isTemporarilyPaused && (
              <div className="mx-7 mt-1 px-4 py-3 rounded-2xl bg-[#0A0A0A] text-white flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold">
                    <Clock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>
                      {emergencySecLeft
                        ? `Emergency 5m: ${formatDurationCountdown(emergencySecLeft)}`
                        : `Guardian Unlock: ${formatDurationCountdown(guardianUnlockSecLeft || 0)}`}
                    </span>
                  </div>
                  {rawFocusActive && (
                    <div className="text-[11px] text-neutral-400 mt-0.5 truncate">
                      {emergencySecLeft
                        ? `🔒 ইমার্জেন্সি মোডে "${activeFocusTitle}" অফ করা সম্পূর্ণ নিষিদ্ধ`
                        : `আনলক শেষ হলে "${activeFocusTitle}" স্বয়ংক্রিয়ভাবে চালু হবে`}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEmergencyUntilMs(null);
                    setEmergencySecLeft(null);
                    setGuardianUnlockUntilMs(null);
                    setGuardianUnlockSecLeft(null);
                    localStorage.removeItem('raft_prod_v1_emg_until');
                    localStorage.removeItem('raft_prod_v1_guardian_until');
                    rotateChallengeRequestId();
                    setShowUnlockModal(false);
                    setUnlockInput('');
                    setUnlockError(null);
                    setShowInstalledAppsModal(false);
                    try {
                      window.AndroidBridge?.cancelEmergencyBreak?.();
                    } catch {
                      // ignore
                    }
                  }}
                  className="text-[11px] underline text-neutral-300 hover:text-white shrink-0 cursor-pointer"
                >
                  Resume Lock
                </button>
              </div>
            )}

            {/* SCROLLABLE BODY AREA */}
            <main className="flex-1 overflow-y-auto px-7 py-4 space-y-6">
              {activeTab === 'lock' && (
                <>
                  {/* Big Typographic Clock */}
                  <div className="pt-1 pb-2 flex items-baseline justify-between">
                    <div>
                      <div className="text-[84px] leading-[0.88] font-display font-semibold tracking-tighter text-[#0A0A0A] tabular-nums select-none">
                        <div>{displayHours}</div>
                        <div>{displayMinutes}</div>
                      </div>
                    </div>

                    <div className="text-right space-y-3">
                      <div className="text-lg font-medium text-neutral-800 leading-snug">
                        <div>{dayName},</div>
                        <div>{monthDay}</div>
                      </div>

                      <div className="text-2xl font-display font-semibold text-neutral-400 tabular-nums">
                        {displaySeconds}
                      </div>

                      <button
                        type="button"
                        onClick={() => setActiveTab('schedule')}
                        className="text-xs text-neutral-500 hover:text-black cursor-pointer"
                      >
                        {timeBlocks.filter((b) => b.enabled).length} Time Blocks Active
                      </button>
                    </div>
                  </div>

                  {/* Quick Start Focus Bar OR Active Session Protected Card during Break */}
                  {rawFocusActive ? (
                    <div className="p-4 rounded-[24px] bg-[#0A0A0A] text-white flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                          <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="truncate">চলমান সেশন: {activeFocusTitle}</span>
                        </div>
                        <div className="text-[11px] text-neutral-400 mt-0.5">
                          {isEmergencyBreakRunningNow
                            ? 'ইমার্জেন্সি ব্রেক চলাকালীন সেশন ও অ্যাপস পরিবর্তন সম্পূর্ণ লকড'
                            : `বাকি সময়: ${formatDurationCountdown(activeFocusRemainingSec)}`}
                        </div>
                      </div>
                      <span className="px-3 py-1.5 rounded-full bg-white/15 text-white text-[11px] font-mono font-semibold shrink-0">
                        {formatDurationCountdown(activeFocusRemainingSec)}
                      </span>
                    </div>
                  ) : (
                    <div className="p-4 rounded-[26px] bg-white border border-black/6 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="pl-0.5">
                          <div className="text-xs font-semibold text-[#0A0A0A]">
                            Start Power-Saving Focus Lock
                          </div>
                          <div className="text-[11px] text-neutral-400">
                            প্রিসেট অথবা নিজের পছন্দমতো কাস্টম সময়ের জন্য লক করুন
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setIsCustomFocusMode(false);
                            setSelectedFocusPresetMin(60);
                            setShowFocusTimerModal(true);
                          }}
                          className="px-3.5 py-2 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer active:scale-95 transition-transform"
                        >
                          <Clock className="w-3.5 h-3.5" />
                          <span>Presets & Custom</span>
                        </button>
                      </div>

                      {/* Quick Preset Pills + Custom Duration Trigger */}
                      <div className="grid grid-cols-5 gap-1.5">
                        {[
                          { min: 15, text: '15m' },
                          { min: 30, text: '30m' },
                          { min: 60, text: '1h' },
                          { min: 120, text: '2h' },
                        ].map((preset) => (
                          <button
                            key={preset.min}
                            type="button"
                            onClick={() =>
                              requestFocusWithWarning(preset.min, `${preset.text} Focus Lock`)
                            }
                            className="py-2 rounded-2xl bg-[#F4F4F5] hover:bg-neutral-200/80 active:bg-neutral-300 text-xs font-semibold text-[#0A0A0A] flex items-center justify-center cursor-pointer transition-colors"
                          >
                            {preset.text}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            setIsCustomFocusMode(true);
                            setShowFocusTimerModal(true);
                          }}
                          className="py-2 rounded-2xl bg-neutral-900 text-white text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer active:scale-95 transition-transform"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Custom</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {scheduleGuardNotice && (
                    <div className="p-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-[#0A0A0A] text-xs font-medium flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>{scheduleGuardNotice}</span>
                    </div>
                  )}

                  {/* 4 Allowed Apps Grid */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-neutral-400">
                        Allowed Apps ({allowedApps.length}/4)
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (isAppsModificationLocked) {
                            triggerEmergencyBlockNotice(
                              '⛔ চলমান ফোকাস সেশন বা ইমার্জেন্সি ব্রেক চলাকালীন অনুমোদিত অ্যাপস পরিবর্তন করা সম্পূর্ণ নিষিদ্ধ!'
                            );
                            return;
                          }
                          refreshNativeInstalledApps();
                          setAppSearchQuery('');
                          setShowInstalledAppsModal(true);
                        }}
                        className={`text-xs font-medium flex items-center gap-1 cursor-pointer ${
                          isAppsModificationLocked
                            ? 'text-neutral-400'
                            : 'text-neutral-800 hover:text-black'
                        }`}
                      >
                        {isAppsModificationLocked ? (
                          <>
                            <Lock className="w-3.5 h-3.5" />
                            <span>অ্যাপ পরিবর্তন লকড</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-3.5 h-3.5" />
                            <span>Select Apps</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      {allowedApps.map((app, index) => {
                        const isPrimaryCard = index === 0;
                        return (
                          <button
                            key={app.id}
                            type="button"
                            onClick={() => handleLaunchAllowedApp(app)}
                            style={{ touchAction: 'manipulation' }}
                            className={`p-4 rounded-[24px] flex items-center justify-between cursor-pointer select-none touch-manipulation active:scale-[0.98] transition-transform text-left ${
                              isPrimaryCard
                                ? 'bg-[#0A0A0A] text-white shadow-sm'
                                : 'bg-white text-[#0A0A0A] border border-black/5 active:bg-neutral-100'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0 pointer-events-none">
                              <div
                                className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                                  isPrimaryCard
                                    ? 'bg-white/15 text-white'
                                    : 'bg-[#F4F4F5] text-[#0A0A0A]'
                                }`}
                              >
                                {renderAppIcon(app.iconKey, 'w-4 h-4', app)}
                              </div>
                              <span className="text-sm font-medium truncate">{app.name}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Emergency Contacts Section */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-neutral-400">
                        Emergency Contacts
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowAddContactModal(true)}
                        className="text-xs font-medium text-neutral-800 hover:text-black flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add contact</span>
                      </button>
                    </div>

                    {contacts.length === 0 ? (
                      <div className="p-4 rounded-[22px] bg-white border border-black/5 text-center space-y-2">
                        <p className="text-xs text-neutral-400">
                          কোনো ইমার্জেন্সি কন্টাক্ট যুক্ত করা নেই
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowAddContactModal(true)}
                          className="px-4 py-2 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>জরুরি নাম্বার যুক্ত করুন</span>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {contacts.map((contact) => (
                          <div
                            key={contact.id}
                            onClick={() => setSelectedContactForAction(contact)}
                            className="p-3.5 rounded-[22px] bg-white border border-black/5 hover:border-black/15 flex items-center justify-between gap-3 cursor-pointer transition-all active:scale-[0.99]"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-full bg-[#F4F4F5] text-[#0A0A0A] flex items-center justify-center font-semibold text-xs shrink-0">
                                {contact.name.slice(0, 1).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-[#0A0A0A] truncate">
                                  {contact.name}
                                </div>
                                <div className="text-xs text-neutral-400 truncate">
                                  {contact.relation} · {contact.phone}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSmsContact(contact.phone);
                                }}
                                className="w-9 h-9 rounded-full bg-[#F4F4F5] text-[#0A0A0A] flex items-center justify-center hover:opacity-90 transition-opacity cursor-pointer"
                                title="Send SMS"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCallContact(contact.phone);
                                }}
                                className="w-9 h-9 rounded-full bg-[#0A0A0A] text-white flex items-center justify-center hover:opacity-90 transition-opacity cursor-pointer"
                                title="Call now"
                              >
                                <Phone className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* VIEW 2: TIME BLOCKS */}
              {activeTab === 'schedule' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h1 className="text-2xl font-display font-semibold tracking-tight text-[#0A0A0A]">
                        Time Blocks
                      </h1>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        অটো-অ্যারেঞ্জড · ১২ ঘণ্টা (AM/PM) ফরম্যাট · পাসকোড সুরক্ষিত
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={openCreateBlockModal}
                      className="px-3.5 py-2 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>New Block</span>
                    </button>
                  </div>

                  {isEmergencyBreakRunningNow && (
                    <div className="p-3.5 rounded-2xl bg-red-500/10 border border-red-500/25 text-red-700 text-xs flex items-center gap-2.5">
                      <Lock className="w-4 h-4 shrink-0 text-red-600" />
                      <span>
                        <strong>ইমার্জেন্সি মোড চালু আছে:</strong> ইমার্জেন্সি ব্রেক চলাকালীন কোনো সেশন অফ, এডিট বা ডিলিট করা সম্পূর্ণ রোধ করা হয়েছে।
                      </span>
                    </div>
                  )}

                  {scheduleGuardNotice && (
                    <div className="p-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-[#0A0A0A] text-xs font-medium flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>{scheduleGuardNotice}</span>
                    </div>
                  )}

                  {sortedTimeBlocks.length === 0 && (
                    <div className="p-6 rounded-[28px] bg-white border border-black/6 text-center space-y-2">
                      <div className="text-sm font-semibold text-[#0A0A0A]">
                        কোনো টাইম ব্লক সেট করা নেই
                      </div>
                      <p className="text-xs text-neutral-400">
                        নির্দিষ্ট সময়ে ফোন অটোমেটিক ফোকাস লক করতে নিচের বাটনে ট্যাপ করে নতুন টাইম ব্লক তৈরি করুন।
                      </p>
                    </div>
                  )}

                  <div className="space-y-3">
                    {sortedTimeBlocks.map((block, index) => {
                      const enabled = block.enabled;
                      return (
                        <div
                          key={block.id}
                          onClick={() => requestSessionProtectedAction('edit', block)}
                          className={`p-5 rounded-[28px] transition-all cursor-pointer select-none ${
                            enabled
                              ? 'bg-[#0A0A0A] text-white shadow-sm'
                              : 'bg-white text-[#0A0A0A] border border-black/6'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold ${
                                    enabled
                                      ? 'bg-white/15 text-white'
                                      : 'bg-[#F4F4F5] text-neutral-600'
                                  }`}
                                >
                                  #{index + 1}
                                </span>
                                <span className="text-xs text-neutral-400 flex items-center gap-1">
                                  {enabled ? (
                                    <>
                                      <Lock className="w-3 h-3 text-emerald-400" />
                                      <span>Scheduled (On)</span>
                                    </>
                                  ) : (
                                    <span>Off</span>
                                  )}
                                </span>
                                <span className="text-neutral-500">·</span>
                                <span
                                  className={`text-xs flex items-center gap-1 underline underline-offset-2 ${
                                    enabled ? 'text-neutral-300' : 'text-neutral-500'
                                  }`}
                                >
                                  <Pencil className="w-3 h-3" />
                                  <span>Edit time</span>
                                </span>
                              </div>
                              <div className="text-base font-semibold">{block.labelBn}</div>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  requestFocusWithWarning(60, block.labelBn || block.label);
                                }}
                                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer ${
                                  enabled
                                    ? 'bg-white/15 text-white hover:bg-white/25'
                                    : 'bg-[#F4F4F5] text-[#0A0A0A]'
                                }`}
                              >
                                Start Now
                              </button>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (enabled) {
                                    // Prevent turning off any active or planned session without Passcode (and block completely in Emergency mode)
                                    requestSessionProtectedAction('disable', block);
                                    return;
                                  }
                                  const candidate = { ...block, enabled: true };
                                  if (checkTimeBlockRunningNow(candidate, now)) {
                                    triggerSessionNotificationAndSound(
                                      'warning',
                                      '⚠️ ফোকাস সেশন শুরু হতে যাচ্ছে!',
                                      `"${block.labelBn}" এখনই চালু হতে যাচ্ছে।`
                                    );
                                    setPendingFocusConfirm({
                                      type: 'toggle_block',
                                      blockId: block.id,
                                      label: `${block.labelBn} (${formatTime12Hour(block.startTime)} – ${formatTime12Hour(block.endTime)})`,
                                    });
                                    return;
                                  }
                                  setOverriddenBlockId(null);
                                  setTimeBlocks((prev) =>
                                    sortTimeBlocksChronologically(
                                      prev.map((b) =>
                                        b.id === block.id ? { ...b, enabled: true } : b
                                      )
                                    )
                                  );
                                }}
                                title={
                                  enabled
                                    ? isEmergencyBreakRunningNow
                                      ? 'ইমার্জেন্সি মোডে সেশন অফ করা নিষিদ্ধ'
                                      : 'সেশন অফ করতে পাসকোড প্রয়োজন'
                                    : 'সেশন অন করুন'
                                }
                                className={`w-12 h-7 rounded-full p-1 transition-colors flex items-center cursor-pointer shrink-0 ${
                                  enabled
                                    ? 'bg-white justify-end'
                                    : 'bg-neutral-200 justify-start'
                                }`}
                              >
                                <span
                                  className={`w-5 h-5 rounded-full flex items-center justify-center ${
                                    enabled ? 'bg-[#0A0A0A] text-white' : 'bg-white shadow-sm'
                                  }`}
                                >
                                  {enabled && <Lock className="w-2.5 h-2.5" />}
                                </span>
                              </button>
                            </div>
                          </div>

                          <div className="mt-4 pt-3 border-t border-current/10 flex items-baseline justify-between gap-2">
                            <div className="text-xl sm:text-2xl font-display font-semibold tracking-tight tabular-nums">
                              {formatTime12Hour(block.startTime)} – {formatTime12Hour(block.endTime)}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[11px] opacity-60">
                                {block.days?.length === 7
                                  ? 'Every day'
                                  : block.days?.join(', ')}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  requestSessionProtectedAction('delete', block);
                                }}
                                className="p-1.5 rounded-full opacity-60 hover:opacity-100 cursor-pointer"
                                title="Delete block (Passcode required)"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={openCreateBlockModal}
                    className="w-full py-4 rounded-[24px] bg-white border border-black/6 text-xs font-semibold text-[#0A0A0A] flex items-center justify-center gap-2 hover:border-black/20 transition-all cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add New Time Block</span>
                  </button>
                </div>
              )}

              {/* VIEW 3: SELECT ANY 4 APPS & CONTACTS */}
              {activeTab === 'apps' && (
                <div className="space-y-6">
                  {isAppsModificationLocked && (
                    <div className="p-3.5 rounded-2xl bg-red-500/10 border border-red-500/25 text-red-700 text-xs flex items-center gap-2.5">
                      <Lock className="w-4 h-4 shrink-0 text-red-600" />
                      <span>
                        <strong>সেশন চলমান আছে:</strong> ফোকাস সেশন বা ইমার্জেন্সি ব্রেক চলাকালীন অনুমোদিত অ্যাপস পরিবর্তন করা সম্পূর্ণ রোধ করা হয়েছে।
                      </span>
                    </div>
                  )}

                  {scheduleGuardNotice && (
                    <div className="p-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-[#0A0A0A] text-xs font-medium flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>{scheduleGuardNotice}</span>
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <h2 className="text-xl font-display font-semibold tracking-tight text-[#0A0A0A]">
                        Allowed Apps ({selectedAppIds.length}/4)
                      </h2>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        ফোকাস লক চলাকালীন শুধুমাত্র এই ৪টি অ্যাপ ব্যবহার করা যাবে (ডুয়াল হোয়াটসঅ্যাপ সাপোর্টেড)
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      {allowedApps.map((app) => (
                        <div
                          key={app.id}
                          onClick={() => handleToggleAllowedApp(app.id)}
                          className="p-3.5 rounded-[22px] bg-[#0A0A0A] text-white flex items-center justify-between cursor-pointer"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-white/15 text-white flex items-center justify-center shrink-0">
                              {renderAppIcon(app.iconKey, 'w-4 h-4')}
                            </div>
                            <span className="text-xs font-medium truncate">{app.name}</span>
                          </div>
                          {isAppsModificationLocked ? (
                            <Lock className="w-4 h-4 shrink-0 text-neutral-400" />
                          ) : (
                            <Check className="w-4 h-4 shrink-0" />
                          )}
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (isAppsModificationLocked) {
                          triggerEmergencyBlockNotice(
                            '⛔ চলমান ফোকাস সেশন বা ইমার্জেন্সি ব্রেক চলাকালীন অনুমোদিত অ্যাপস পরিবর্তন করা সম্পূর্ণ নিষিদ্ধ!'
                          );
                          return;
                        }
                        refreshNativeInstalledApps();
                        setAppSearchQuery('');
                        setShowInstalledAppsModal(true);
                      }}
                      className={`w-full py-3.5 px-4 rounded-[22px] text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        isAppsModificationLocked
                          ? 'bg-[#F4F4F5] text-neutral-400 border border-black/5'
                          : 'bg-white border border-black/10 hover:border-black text-[#0A0A0A]'
                      }`}
                    >
                      {isAppsModificationLocked ? (
                        <>
                          <Lock className="w-4 h-4" />
                          <span>সেশন চলাকালীন অ্যাপ পরিবর্তন লকড</span>
                        </>
                      ) : (
                        <>
                          <Grid className="w-4 h-4" />
                          <span>Browse All Installed Apps ({deviceApps.length} Apps)</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="space-y-3 pt-2 border-t border-black/5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-base font-semibold text-[#0A0A0A]">
                          Emergency Contacts
                        </h3>
                        <p className="text-xs text-neutral-400">
                          ফোকাস লক চলাকালীন কল করার জন্য ইমার্জেন্সি কন্টাক্ট
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowAddContactModal(true)}
                        className="w-8 h-8 rounded-full bg-[#0A0A0A] text-white flex items-center justify-center cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="space-y-2">
                      {contacts.map((c) => (
                        <div
                          key={c.id}
                          className="p-3.5 rounded-[22px] bg-white border border-black/5 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[#0A0A0A] truncate">
                              {c.name}
                            </div>
                            <div className="text-[11px] text-neutral-400 font-mono truncate">
                              {c.relation} · {c.phone}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleCallContact(c.phone)}
                              className="p-2 rounded-full bg-[#F4F4F5] text-[#0A0A0A] hover:bg-black hover:text-white transition-colors cursor-pointer"
                            >
                              <Phone className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setContacts((prev) => prev.filter((item) => item.id !== c.id))
                              }
                              className="p-2 rounded-full text-neutral-400 hover:text-red-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* VIEW 4: PERMISSIONS & SETUP */}
              {activeTab === 'setup' && (
                <div className="space-y-4">
                  <div>
                    <h1 className="text-2xl font-display font-semibold tracking-tight text-[#0A0A0A]">
                      Permissions & Protection
                    </h1>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      ফোর্স-স্টপ রোধ, অটো DND এবং স্ট্রিক্ট লকের জন্য এই ৪টি পারমিশন অন রাখুন
                    </p>
                  </div>

                  <div className="space-y-2.5">
                    <button
                      type="button"
                      onClick={handleGrantAccessibilityPermission}
                      className={`w-full p-4 rounded-[24px] flex items-center justify-between text-left transition-all cursor-pointer ${
                        permAccessibility
                          ? 'bg-[#0A0A0A] text-white'
                          : 'bg-white text-[#0A0A0A] border border-black/8'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 pr-2">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                            permAccessibility
                              ? 'bg-white/15 text-white'
                              : 'bg-[#F4F4F5] text-[#0A0A0A]'
                          }`}
                        >
                          <Eye className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold">
                            ১. স্ট্রিক্ট অ্যাপ ব্লকার ও অ্যান্টি ফোর্স-স্টপ
                          </div>
                          <div
                            className={`text-xs mt-0.5 ${
                              permAccessibility ? 'text-neutral-300' : 'text-neutral-400'
                            }`}
                          >
                            এলাউড অ্যাপ থেকে বের হলেই সাথে সাথে লকে ফিরিয়ে আনে এবং Force Stop/Clear Data ব্লক করে
                          </div>
                        </div>
                      </div>
                      <div
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 ${
                          permAccessibility
                            ? 'bg-white text-[#0A0A0A]'
                            : 'bg-[#F4F4F5] text-[#0A0A0A]'
                        }`}
                      >
                        {permAccessibility ? 'Active ✓' : 'Enable'}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={handleGrantAdminPermission}
                      className={`w-full p-4 rounded-[24px] flex items-center justify-between text-left transition-all cursor-pointer ${
                        permAdmin
                          ? 'bg-[#0A0A0A] text-white'
                          : 'bg-white text-[#0A0A0A] border border-black/8'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 pr-2">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                            permAdmin ? 'bg-white/15 text-white' : 'bg-[#F4F4F5] text-[#0A0A0A]'
                          }`}
                        >
                          <ShieldCheck className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold">২. অ্যাডমিন এক্সেস (Device Admin)</div>
                          <div
                            className={`text-xs mt-0.5 ${
                              permAdmin ? 'text-neutral-300' : 'text-neutral-400'
                            }`}
                          >
                            অ্যাপ আনইনস্টল হওয়া সম্পূর্ণ প্রতিরোধ করে
                          </div>
                        </div>
                      </div>
                      <div
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 ${
                          permAdmin ? 'bg-white text-[#0A0A0A]' : 'bg-[#F4F4F5] text-[#0A0A0A]'
                        }`}
                      >
                        {permAdmin ? 'Granted ✓' : 'Allow'}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={handleGrantDndPermission}
                      className={`w-full p-4 rounded-[24px] flex items-center justify-between text-left transition-all cursor-pointer ${
                        permDnd
                          ? 'bg-[#0A0A0A] text-white'
                          : 'bg-white text-[#0A0A0A] border border-black/8'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 pr-2">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                            permDnd ? 'bg-white/15 text-white' : 'bg-[#F4F4F5] text-[#0A0A0A]'
                          }`}
                        >
                          <BellOff className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold">
                            ৩. অটো ডু নট ডিস্টার্ব (Auto DND)
                          </div>
                          <div
                            className={`text-xs mt-0.5 ${
                              permDnd ? 'text-neutral-300' : 'text-neutral-400'
                            }`}
                          >
                            ফোকাস চলাকালীন সব নোটিফিকেশন অটোমেটিক অফ করে রাখে
                          </div>
                        </div>
                      </div>
                      <div
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 ${
                          permDnd ? 'bg-white text-[#0A0A0A]' : 'bg-[#F4F4F5] text-[#0A0A0A]'
                        }`}
                      >
                        {permDnd ? 'Granted ✓' : 'Allow'}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={handleGrantOverlayPermission}
                      className={`w-full p-4 rounded-[24px] flex items-center justify-between text-left transition-all cursor-pointer ${
                        permOverlay
                          ? 'bg-[#0A0A0A] text-white'
                          : 'bg-white text-[#0A0A0A] border border-black/8'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 pr-2">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                            permOverlay ? 'bg-white/15 text-white' : 'bg-[#F4F4F5] text-[#0A0A0A]'
                          }`}
                        >
                          <Layers className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold">
                            ৪. ওভারলে পারমিশন (Appear on Top)
                          </div>
                          <div
                            className={`text-xs mt-0.5 ${
                              permOverlay ? 'text-neutral-300' : 'text-neutral-400'
                            }`}
                          >
                            পুরো মোবাইলের ওপর ফুল-স্ক্রিন লক ওভারলে দেখায়
                          </div>
                        </div>
                      </div>
                      <div
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 ${
                          permOverlay ? 'bg-white text-[#0A0A0A]' : 'bg-[#F4F4F5] text-[#0A0A0A]'
                        }`}
                      >
                        {permOverlay ? 'Granted ✓' : 'Allow'}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={handleGrantBatteryPermission}
                      className={`w-full p-4 rounded-[24px] flex items-center justify-between text-left transition-all cursor-pointer ${
                        permBattery
                          ? 'bg-[#0A0A0A] text-white'
                          : 'bg-white text-[#0A0A0A] border border-black/8'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 pr-2">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                            permBattery ? 'bg-white/15 text-white' : 'bg-[#F4F4F5] text-[#0A0A0A]'
                          }`}
                        >
                          <Zap className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold">
                            ৫. ব্যাটারি অপ্টিমাইজেশন ও রিস্টার্ট অটো-স্টার্ট
                          </div>
                          <div
                            className={`text-xs mt-0.5 ${
                              permBattery ? 'text-neutral-300' : 'text-neutral-400'
                            }`}
                          >
                            ফোন রিস্টার্টের পরেও স্বয়ংক্রিয়ভাবে চালু রাখে এবং ব্যাকগ্রাউন্ডে বন্ধ হতে দেয় না
                          </div>
                        </div>
                      </div>
                      <div
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 ${
                          permBattery ? 'bg-white text-[#0A0A0A]' : 'bg-[#F4F4F5] text-[#0A0A0A]'
                        }`}
                      >
                        {permBattery ? 'Granted ✓' : 'Allow'}
                      </div>
                    </button>
                  </div>

                  {/* Guardian Secret Key Configuration in LOCK IN Setup */}
                  {(() => {
                    const isSecretKeyLocked =
                      !isSecretKeyUnlocked &&
                      (rawFocusActive ||
                        isEmergencyBreakRunningNow ||
                        timeBlocks.some((b) => b.enabled));
                    return (
                      <div className="p-4 rounded-[24px] bg-white border border-black/8 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <KeyRound className="w-4 h-4 text-[#0A0A0A]" />
                            <span className="text-xs font-semibold text-[#0A0A0A]">
                              গার্ডিয়ান কোড (Guardian Secret Key)
                            </span>
                          </div>
                          {isSecretKeyLocked ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (isEmergencyBreakRunningNow) {
                                  triggerEmergencyBlockNotice(
                                    '⛔ ইমার্জেন্সি মোড চলাকালীন গার্ডিয়ান সিক্রেট কোড পরিবর্তন করা নিষিদ্ধ!'
                                  );
                                  return;
                                }
                                setSessionPasscodeInput('');
                                setSessionPasscodeError(null);
                                setPendingPasscodeAction({ action: 'unlock_secret' });
                              }}
                              className="px-2.5 py-1 rounded-full bg-[#0A0A0A] text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <Lock className="w-3 h-3" />
                              <span>আনলক করতে পাসকোড দিন</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => copyTextToClipboard(sharedSecret, 'secret')}
                              className="px-2.5 py-1 rounded-full bg-[#F4F4F5] text-[11px] font-semibold text-[#0A0A0A] flex items-center gap-1 cursor-pointer"
                            >
                              <Copy className="w-3 h-3" />
                              <span>{copiedSecretFeedback ? 'কপি হয়েছে' : 'Copy'}</span>
                            </button>
                          )}
                        </div>
                        {isSecretKeyLocked ? (
                          <div className="w-full h-11 px-3.5 rounded-2xl bg-[#F4F4F5] flex items-center justify-between text-xs font-mono text-neutral-500">
                            <span>•••••••••••• (সেশন চলাকালীন লকড)</span>
                            <Lock className="w-3.5 h-3.5 text-neutral-400" />
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={sharedSecret}
                            onChange={(e) => setSharedSecret(e.target.value.toUpperCase())}
                            placeholder="KEY-8841-RAFT"
                            className="w-full h-11 px-3.5 rounded-2xl bg-[#F4F4F5] text-xs font-mono font-bold tracking-wider text-[#0A0A0A] uppercase focus:outline-none"
                          />
                        )}
                      </div>
                    );
                  })()}

                  <button
                    type="button"
                    onClick={() => {
                      if (isEmergencyBreakRunningNow) {
                        triggerEmergencyBlockNotice(
                          '⛔ ইমার্জেন্সি মোড চলাকালীন সেটআপ উইজার্ড খোলা যাবে না!'
                        );
                        return;
                      }
                      setOnboardingStep(1);
                      setShowOnboardingModal(true);
                    }}
                    className="w-full py-4 rounded-[24px] bg-white border border-black/8 text-xs font-semibold text-[#0A0A0A] flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>Open Beginning Setup Wizard (4 Steps)</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* VIEW 5: DIRECT APK DOWNLOAD (HIDDEN INSIDE ANDROID APK!) */}
              {!isRunningInApk && activeTab === 'apk' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h1 className="text-2xl font-display font-semibold tracking-tight text-[#0A0A0A]">
                        Download APK
                      </h1>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        LOCK IN & Companion Guardian APK
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsGuardianMode(true)}
                      className="px-3.5 py-2 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold cursor-pointer"
                    >
                      Guardian App দেখুন →
                    </button>
                  </div>

                  {/* Companion Guardian APK Card */}
                  <div className="p-6 rounded-[28px] bg-[#0A0A0A] text-white space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-neutral-400">
                        Companion Guardian App
                      </span>
                      <KeyRound className="w-4 h-4 text-neutral-300" />
                    </div>

                    <div>
                      <div className="text-xl font-semibold">
                        LOCK IN Guardian (LOCK-IN-Guardian.apk)
                      </div>
                      <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                        আলাদা গার্ডিয়ান অ্যাপ: শুধুমাত্র গার্ডিয়ান কোড এবং আনলক কোড জেনারেটর রয়েছে, যেখানে কোডে ট্যাপ করার সাথে সাথে অটোমেটিক কপি হয়।
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={isDownloadingGuardianApk}
                      onClick={handleDownloadGuardianApk}
                      className="w-full py-4 rounded-full bg-white text-[#0A0A0A] text-xs font-semibold flex items-center justify-center gap-2 hover:bg-neutral-100 transition-colors cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>
                        {isDownloadingGuardianApk
                          ? 'Downloading LOCK-IN-Guardian.apk...'
                          : 'Download LOCK-IN-Guardian.apk'}
                      </span>
                    </button>
                  </div>

                  {/* Main LOCK IN APK Card */}
                  <div className="p-6 rounded-[28px] bg-white border border-black/8 text-[#0A0A0A] space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-neutral-400">
                        Main Focus Lock App
                      </span>
                      <Smartphone className="w-4 h-4 text-neutral-500" />
                    </div>

                    <div>
                      <div className="text-xl font-semibold">LOCK IN (LOCK-IN.apk)</div>
                      <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
                        সম্পূর্ণ প্রোডাকশন ভার্সন: ফোকাস চলাকালীন অটোমেটিক Do Not Disturb (DND) চালু করে নোটিফিকেশন অফ রাখে, ফোন রিস্টার্টের পরেও অটো-স্টার্ট হয়, ব্যাটারি অপ্টিমাইজেশন সাপোর্ট করে এবং ইমার্জেন্সি কন্টাক্টে শুধুমাত্র কল ও SMS অপশন রাখে।
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={isDownloadingApk}
                      onClick={handleDownloadVerifiedApk}
                      className="w-full py-4 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold flex items-center justify-center gap-2 hover:opacity-95 transition-opacity cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>
                        {isDownloadingApk
                          ? 'Downloading Verified APK...'
                          : 'Download LOCK-IN.apk'}
                      </span>
                    </button>

                    {apkStatusMsg && (
                      <div className="p-3 rounded-2xl bg-[#F4F4F5] text-xs text-emerald-700 text-center">
                        {apkStatusMsg}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </main>

            {/* BOTTOM NAVIGATION BAR */}
            <nav className="py-5 px-7 flex items-center justify-center gap-3 bg-gradient-to-t from-[#F7F7F8] via-[#F7F7F8] to-transparent">
              <button
                type="button"
                onClick={() => setActiveTab('lock')}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  activeTab === 'lock'
                    ? 'bg-[#0A0A0A] text-white shadow-md scale-105'
                    : 'bg-white text-neutral-500 border border-black/5 hover:text-black'
                }`}
                title="Lock Screen"
              >
                <Clock className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('schedule')}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  activeTab === 'schedule'
                    ? 'bg-[#0A0A0A] text-white shadow-md scale-105'
                    : 'bg-white text-neutral-500 border border-black/5 hover:text-black'
                }`}
                title="Time Blocks"
              >
                <Calendar className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('apps')}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  activeTab === 'apps'
                    ? 'bg-[#0A0A0A] text-white shadow-md scale-105'
                    : 'bg-white text-neutral-500 border border-black/5 hover:text-black'
                }`}
                title="4 Allowed Apps & Contacts"
              >
                <Users className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('setup')}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  activeTab === 'setup'
                    ? 'bg-[#0A0A0A] text-white shadow-md scale-105'
                    : 'bg-white text-neutral-500 border border-black/5 hover:text-black'
                }`}
                title="Permissions & Setup"
              >
                <ShieldCheck className="w-5 h-5" />
              </button>

              {!isRunningInApk && (
                <button
                  type="button"
                  onClick={() => setActiveTab('apk')}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                    activeTab === 'apk'
                      ? 'bg-[#0A0A0A] text-white shadow-md scale-105'
                      : 'bg-white text-neutral-500 border border-black/5 hover:text-black'
                  }`}
                  title="Download APK"
                >
                  <Download className="w-5 h-5" />
                </button>
              )}
            </nav>
          </>
        )}

        {/* ====================================================================
            HAPPY MOMENT SESSION COMPLETE CELEBRATION MODAL
           ==================================================================== */}
        {completedSessionTitle && (
          <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-5">
            <div className="w-full max-w-[380px] bg-white text-[#0A0A0A] rounded-[32px] p-6 text-center space-y-4 shadow-2xl">
              <div className="w-14 h-14 rounded-full bg-[#0A0A0A] text-white flex items-center justify-center mx-auto">
                <Sparkles className="w-7 h-7" />
              </div>

              <div className="space-y-1">
                <h3 className="text-xl font-display font-semibold">
                  অভিনন্দন! সেশন সম্পন্ন হয়েছে 🎉
                </h3>
                <p className="text-xs text-neutral-500 leading-relaxed">
                  আপনি সফলভাবে <strong>{completedSessionTitle}</strong> ফোকাস সেশন শেষ করেছেন। আপনার ফোন এখন সম্পূর্ণ আনলক!
                </p>
              </div>

              <button
                type="button"
                onClick={() => setCompletedSessionTitle(null)}
                className="w-full h-12 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold cursor-pointer"
              >
                দারুণ! (Continue)
              </button>
            </div>
          </div>
        )}

        {/* ====================================================================
            BEGINNING 4-STEP SETUP WIZARD MODAL
           ==================================================================== */}
        {showOnboardingModal && (
          <div className="fixed inset-0 z-50 bg-[#F7F7F8] text-[#0A0A0A] flex flex-col justify-between max-w-[430px] mx-auto p-7 overflow-y-auto">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-full bg-[#0A0A0A] text-white flex items-center justify-center">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <span className="text-sm font-semibold tracking-tight">LOCK IN সেটআপ</span>
                </div>
                <span className="text-xs font-mono text-neutral-400">
                  ধাপ {onboardingStep} / 4
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map((step) => (
                  <div
                    key={step}
                    className={`h-1.5 rounded-full transition-colors ${
                      onboardingStep >= step ? 'bg-[#0A0A0A]' : 'bg-neutral-200'
                    }`}
                  />
                ))}
              </div>
            </div>

            {onboardingStep === 1 && (
              <div className="flex-1 py-4 space-y-4 flex flex-col justify-center">
                <div className="space-y-1">
                  <h1 className="text-2xl font-display font-semibold tracking-tight text-[#0A0A0A]">
                    সিস্টেম পারমিশন সেটআপ
                  </h1>
                  <p className="text-xs text-neutral-500 leading-relaxed">
                    ফোর্স-স্টপ রোধ, অটো DND এবং এলাউড অ্যাপ থেকে বের হলেই আবার লকে ফিরিয়ে আনতে এই পারমিশনগুলো অন করুন:
                  </p>
                </div>

                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={handleGrantAccessibilityPermission}
                    className={`w-full p-3.5 rounded-[22px] flex items-center justify-between text-left transition-all cursor-pointer ${
                      permAccessibility
                        ? 'bg-[#0A0A0A] text-white'
                        : 'bg-white text-[#0A0A0A] border border-black/8'
                    }`}
                  >
                    <div className="flex items-center gap-3 pr-2">
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                          permAccessibility
                            ? 'bg-white/15 text-white'
                            : 'bg-[#F4F4F5] text-[#0A0A0A]'
                        }`}
                      >
                        <Eye className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold">
                          ১. স্ট্রিক্ট অ্যাপ লক ও Force-Stop রোধ (Accessibility)
                        </div>
                        <div
                          className={`text-[11px] mt-0.5 ${
                            permAccessibility ? 'text-neutral-300' : 'text-neutral-400'
                          }`}
                        >
                          অন্য অ্যাপে যাওয়া এবং Force Stop/Clear Data সম্পূর্ণ ব্লক করে
                        </div>
                      </div>
                    </div>
                    <div
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ${
                        permAccessibility
                          ? 'bg-white text-[#0A0A0A]'
                          : 'bg-[#F4F4F5] text-[#0A0A0A]'
                      }`}
                    >
                      {permAccessibility ? 'On ✓' : 'Allow'}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={handleGrantAdminPermission}
                    className={`w-full p-3.5 rounded-[22px] flex items-center justify-between text-left transition-all cursor-pointer ${
                      permAdmin
                        ? 'bg-[#0A0A0A] text-white'
                        : 'bg-white text-[#0A0A0A] border border-black/8'
                    }`}
                  >
                    <div className="flex items-center gap-3 pr-2">
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                          permAdmin ? 'bg-white/15 text-white' : 'bg-[#F4F4F5] text-[#0A0A0A]'
                        }`}
                      >
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold">২. অ্যাডমিন এক্সেস (Device Admin)</div>
                        <div
                          className={`text-[11px] mt-0.5 ${
                            permAdmin ? 'text-neutral-300' : 'text-neutral-400'
                          }`}
                        >
                          অ্যাপ আনইনস্টল করা প্রতিরোধ করে
                        </div>
                      </div>
                    </div>
                    <div
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ${
                        permAdmin ? 'bg-white text-[#0A0A0A]' : 'bg-[#F4F4F5] text-[#0A0A0A]'
                      }`}
                    >
                      {permAdmin ? 'On ✓' : 'Allow'}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={handleGrantDndPermission}
                    className={`w-full p-3.5 rounded-[22px] flex items-center justify-between text-left transition-all cursor-pointer ${
                      permDnd
                        ? 'bg-[#0A0A0A] text-white'
                        : 'bg-white text-[#0A0A0A] border border-black/8'
                    }`}
                  >
                    <div className="flex items-center gap-3 pr-2">
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                          permDnd ? 'bg-white/15 text-white' : 'bg-[#F4F4F5] text-[#0A0A0A]'
                        }`}
                      >
                        <BellOff className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold">
                          ৩. অটো ডু নট ডিস্টার্ব (Auto DND / Silence)
                        </div>
                        <div
                          className={`text-[11px] mt-0.5 ${
                            permDnd ? 'text-neutral-300' : 'text-neutral-400'
                          }`}
                        >
                          ফোকাস চলাকালীন সব নোটিফিকেশন অটোমেটিক অফ করে দেয়
                        </div>
                      </div>
                    </div>
                    <div
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ${
                        permDnd ? 'bg-white text-[#0A0A0A]' : 'bg-[#F4F4F5] text-[#0A0A0A]'
                      }`}
                    >
                      {permDnd ? 'On ✓' : 'Allow'}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={handleGrantOverlayPermission}
                    className={`w-full p-3.5 rounded-[22px] flex items-center justify-between text-left transition-all cursor-pointer ${
                      permOverlay
                        ? 'bg-[#0A0A0A] text-white'
                        : 'bg-white text-[#0A0A0A] border border-black/8'
                    }`}
                  >
                    <div className="flex items-center gap-3 pr-2">
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                          permOverlay ? 'bg-white/15 text-white' : 'bg-[#F4F4F5] text-[#0A0A0A]'
                        }`}
                      >
                        <Layers className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold">৪. ওভারলে পারমিশন (Appear on Top)</div>
                        <div
                          className={`text-[11px] mt-0.5 ${
                            permOverlay ? 'text-neutral-300' : 'text-neutral-400'
                          }`}
                        >
                          ফোকাস টাইমে পুরো মোবাইলের ওপর কালো পাওয়ার-সেভিং লক দেখায়
                        </div>
                      </div>
                    </div>
                    <div
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ${
                        permOverlay ? 'bg-white text-[#0A0A0A]' : 'bg-[#F4F4F5] text-[#0A0A0A]'
                      }`}
                    >
                      {permOverlay ? 'On ✓' : 'Allow'}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={handleGrantBatteryPermission}
                    className={`w-full p-3.5 rounded-[22px] flex items-center justify-between text-left transition-all cursor-pointer ${
                      permBattery
                        ? 'bg-[#0A0A0A] text-white'
                        : 'bg-white text-[#0A0A0A] border border-black/8'
                    }`}
                  >
                    <div className="flex items-center gap-3 pr-2">
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                          permBattery ? 'bg-white/15 text-white' : 'bg-[#F4F4F5] text-[#0A0A0A]'
                        }`}
                      >
                        <Zap className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold">
                          ৫. ব্যাটারি অপ্টিমাইজেশন ও রিস্টার্ট অটো-স্টার্ট
                        </div>
                        <div
                          className={`text-[11px] mt-0.5 ${
                            permBattery ? 'text-neutral-300' : 'text-neutral-400'
                          }`}
                        >
                          রিস্টার্টের পরেও অটো চালু রাখে এবং ব্যাকগ্রাউন্ডে বন্ধ হতে দেয় না
                        </div>
                      </div>
                    </div>
                    <div
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ${
                        permBattery ? 'bg-white text-[#0A0A0A]' : 'bg-[#F4F4F5] text-[#0A0A0A]'
                      }`}
                    >
                      {permBattery ? 'On ✓' : 'Allow'}
                    </div>
                  </button>
                </div>
              </div>
            )}

            {onboardingStep === 2 && (
              <div className="flex-1 py-4 flex flex-col min-h-0 space-y-3.5">
                <div>
                  <h1 className="text-2xl font-display font-semibold tracking-tight text-[#0A0A0A]">
                    ৪টি অনুমোদিত অ্যাপ সিলেক্ট করুন
                  </h1>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    ফোকাস লক চলাকালীন শুধুমাত্র এই ৪টি অ্যাপ ব্যবহার করা যাবে ({selectedAppIds.length}/4):
                  </p>
                </div>

                <div className="relative shrink-0">
                  <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={appSearchQuery}
                    onChange={(e) => setAppSearchQuery(e.target.value)}
                    placeholder="Search installed apps..."
                    className="w-full h-11 pl-10 pr-4 rounded-2xl bg-white border border-black/6 text-xs text-[#0A0A0A] focus:outline-none"
                  />
                </div>

                <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-2 max-h-[380px] pr-1">
                  {filteredInstalledApps.map((app) => {
                    const isSelected = selectedAppIds.includes(app.id);
                    return (
                      <button
                        key={app.id}
                        type="button"
                        onClick={() => handleToggleAllowedApp(app.id)}
                        className={`p-3 rounded-2xl flex items-center justify-between transition-all cursor-pointer text-left ${
                          isSelected
                            ? 'bg-[#0A0A0A] text-white'
                            : 'bg-white text-[#0A0A0A] border border-black/5'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                              isSelected ? 'bg-white/15 text-white' : 'bg-[#F4F4F5] text-[#0A0A0A]'
                            }`}
                          >
                            {renderAppIcon(app.iconKey, 'w-4 h-4')}
                          </div>
                          <span className="text-xs font-semibold truncate">{app.name}</span>
                        </div>
                        {isSelected && <Check className="w-4 h-4 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {onboardingStep === 3 && (
              <div className="flex-1 py-4 flex flex-col min-h-0 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-2xl font-display font-semibold tracking-tight text-[#0A0A0A]">
                      ইমার্জেন্সি কন্টাক্ট যুক্ত করুন
                    </h1>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      ফোকাস লক চলাকালীন যাদের সাথে জরুরি যোগাযোগ বা কল করতে পারবেন:
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAddContactModal(true)}
                    className="px-3.5 py-2 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2.5 max-h-[380px] pr-1">
                  {contacts.map((c) => (
                    <div
                      key={c.id}
                      className="p-4 rounded-[22px] bg-white border border-black/6 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-[#F4F4F5] text-[#0A0A0A] flex items-center justify-center font-semibold text-xs shrink-0">
                          {c.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#0A0A0A] truncate">
                            {c.name}
                          </div>
                          <div className="text-[11px] text-neutral-400 font-mono truncate">
                            {c.relation} · {c.phone}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setContacts((prev) => prev.filter((item) => item.id !== c.id))
                        }
                        className="p-2 rounded-full text-neutral-400 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() => setShowAddContactModal(true)}
                    className="w-full py-3.5 rounded-[22px] bg-white border border-dashed border-black/20 text-xs font-semibold text-[#0A0A0A] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>নতুন ইমার্জেন্সি কন্টাক্ট অ্যাড করুন</span>
                  </button>
                </div>
              </div>
            )}

            {onboardingStep === 4 && (
              <div className="flex-1 py-4 flex flex-col min-h-0 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-2xl font-display font-semibold tracking-tight text-[#0A0A0A]">
                      টাইম ব্লক সেট করুন
                    </h1>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      অটো-অ্যারেঞ্জড · ১২ ঘণ্টা ফরম্যাট (AM/PM) · পাসকোড সুরক্ষিত
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openCreateBlockModal}
                    className="px-3.5 py-2 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>

                {scheduleGuardNotice && (
                  <div className="p-3 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-[#0A0A0A] text-xs font-medium flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>{scheduleGuardNotice}</span>
                  </div>
                )}

                <div className="flex-1 overflow-y-auto space-y-2.5 max-h-[380px] pr-1">
                  {sortedTimeBlocks.map((block, index) => (
                    <div
                      key={block.id}
                      onClick={() => requestSessionProtectedAction('edit', block)}
                      className={`p-4 rounded-[24px] cursor-pointer transition-all ${
                        block.enabled
                          ? 'bg-[#0A0A0A] text-white'
                          : 'bg-white text-[#0A0A0A] border border-black/6'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-semibold ${
                                block.enabled
                                  ? 'bg-white/15 text-white'
                                  : 'bg-[#F4F4F5] text-neutral-600'
                              }`}
                            >
                              #{index + 1}
                            </span>
                            <div className="text-sm font-semibold">{block.labelBn}</div>
                          </div>
                          <div className="text-lg font-display font-semibold tabular-nums mt-0.5">
                            {formatTime12Hour(block.startTime)} – {formatTime12Hour(block.endTime)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs underline opacity-75">Edit</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (block.enabled) {
                                requestSessionProtectedAction('disable', block);
                                return;
                              }
                              setTimeBlocks((prev) =>
                                sortTimeBlocksChronologically(
                                  prev.map((b) =>
                                    b.id === block.id ? { ...b, enabled: true } : b
                                  )
                                )
                              );
                            }}
                            className={`w-11 h-6 rounded-full p-0.5 flex items-center cursor-pointer ${
                              block.enabled ? 'bg-white justify-end' : 'bg-neutral-200 justify-start'
                            }`}
                          >
                            <span
                              className={`w-5 h-5 rounded-full flex items-center justify-center ${
                                block.enabled ? 'bg-[#0A0A0A] text-white' : 'bg-white'
                              }`}
                            >
                              {block.enabled && <Lock className="w-2.5 h-2.5" />}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={openCreateBlockModal}
                    className="w-full py-3.5 rounded-[22px] bg-white border border-dashed border-black/20 text-xs font-semibold text-[#0A0A0A] flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>নতুন ফোকাস টাইম ব্লক তৈরি করুন</span>
                  </button>
                </div>
              </div>
            )}

            <div className="pt-2 space-y-2">
              <div className="flex items-center gap-2.5">
                {onboardingStep > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setOnboardingStep((prev) =>
                        prev === 4 ? 3 : prev === 3 ? 2 : 1
                      )
                    }
                    className="px-5 h-12 rounded-full bg-white border border-black/10 text-xs font-semibold text-[#0A0A0A] cursor-pointer"
                  >
                    Back
                  </button>
                )}

                {onboardingStep === 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      refreshNativeInstalledApps();
                      setOnboardingStep(2);
                    }}
                    className="flex-1 h-12 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold cursor-pointer"
                  >
                    {allPermissionsGranted ? 'পরবর্তী ধাপ (অ্যাপ সিলেক্ট)' : 'পরবর্তী ধাপ ->'}
                  </button>
                )}

                {onboardingStep === 2 && (
                  <button
                    type="button"
                    onClick={() => setOnboardingStep(3)}
                    className="flex-1 h-12 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold cursor-pointer"
                  >
                    পরবর্তী ধাপ (ইমার্জেন্সি কন্টাক্ট)
                  </button>
                )}

                {onboardingStep === 3 && (
                  <button
                    type="button"
                    onClick={() => setOnboardingStep(4)}
                    className="flex-1 h-12 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold cursor-pointer"
                  >
                    পরবর্তী ধাপ (টাইম ব্লক)
                  </button>
                )}

                {onboardingStep === 4 && (
                  <button
                    type="button"
                    onClick={finishOnboardingSetup}
                    className="flex-1 h-12 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold cursor-pointer"
                  >
                    সেটআপ সম্পন্ন করুন (Unlock App)
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between px-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    if (onboardingStep < 4) {
                      setOnboardingStep((prev) => (prev + 1) as 1 | 2 | 3 | 4);
                    } else {
                      finishOnboardingSetup();
                    }
                  }}
                  className="text-xs text-neutral-500 hover:text-black underline cursor-pointer"
                >
                  পরে অ্যাড করুন (এই ধাপটি স্কিপ করুন)
                </button>

                <button
                  type="button"
                  onClick={finishOnboardingSetup}
                  className="text-xs text-neutral-400 hover:text-black cursor-pointer"
                >
                  সরাসরি অ্যাপে যান →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ====================================================================
            PRE-FOCUS WARNING & CONFIRMATION MODAL
           ==================================================================== */}
        {pendingFocusConfirm && (
          <div className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-5">
            <div className="w-full max-w-[390px] bg-white text-[#0A0A0A] rounded-[32px] p-6 space-y-4 shadow-2xl">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-[#0A0A0A] text-white flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-[#0A0A0A]">
                    ফোকাস লক সতর্কবার্তা!
                  </h3>
                  <p className="text-xs text-neutral-400">
                    {pendingFocusConfirm.label}
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-[#F4F4F5] space-y-2 text-xs text-neutral-700 leading-relaxed">
                <p>
                  আপনি কি নিশ্চিতভাবে এখন <strong>Focus Lock</strong> চালু করতে চান?
                </p>
                <ul className="space-y-1 text-[11px] text-neutral-500 list-disc pl-4">
                  <li>কালো পাওয়ার-সেভিং ফোকাস ওভারলে স্ক্রিন চালু হবে।</li>
                  <li>ফোনে অটোমেটিক <strong>Do Not Disturb (DND)</strong> চালু হয়ে নোটিফিকেশন বন্ধ থাকবে।</li>
                  <li>শুধুমাত্র আপনার ৪টি অনুমোদিত অ্যাপ ও ইমার্জেন্সি কন্টাক্ট কাজ করবে।</li>
                </ul>
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setPendingFocusConfirm(null)}
                  className="h-12 rounded-full bg-[#F4F4F5] text-[#0A0A0A] text-xs font-semibold cursor-pointer"
                >
                  বাতিল করুন (Cancel)
                </button>
                <button
                  type="button"
                  onClick={handleConfirmStartFocus}
                  className="h-12 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold cursor-pointer"
                >
                  হ্যাঁ, চালু করুন
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
            OTHER MODALS & BOTTOM SHEETS
           ========================================================= */}

        {/* 1. INSTALLED DEVICE APPS DRAWER */}
        {showInstalledAppsModal && (
          <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px] flex items-end justify-center p-3">
            <div className="w-full max-w-[410px] bg-white text-[#0A0A0A] rounded-[32px] p-5 space-y-4 shadow-xl max-h-[82vh] flex flex-col">
              <div className="flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-base font-semibold text-[#0A0A0A]">
                    ফোনে থাকা অ্যাপস ({selectedAppIds.length}/4 সিলেক্টেড)
                  </h3>
                  <p className="text-xs text-neutral-400">
                    শুধু আপনার ফোনে ইনস্টল থাকা অ্যাপগুলো এখানে দেখানো হচ্ছে ({deviceApps.length}টি অ্যাপ)
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => refreshNativeInstalledApps()}
                    title="Refresh installed apps"
                    className="w-8 h-8 rounded-full bg-[#F4F4F5] hover:bg-neutral-200 flex items-center justify-center text-neutral-600 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowInstalledAppsModal(false)}
                    className="w-8 h-8 rounded-full bg-[#F4F4F5] flex items-center justify-center text-neutral-500 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="relative shrink-0">
                <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={appSearchQuery}
                  onChange={(e) => setAppSearchQuery(e.target.value)}
                  placeholder="আপনার ফোনের অ্যাপ খুঁজুন (যেমন: Phone, WhatsApp)..."
                  className="w-full h-11 pl-10 pr-4 rounded-2xl bg-[#F4F4F5] text-xs text-[#0A0A0A] placeholder:text-neutral-400 focus:outline-none"
                />
              </div>

              <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-2 pr-1">
                {filteredInstalledApps.map((app) => {
                  const isSelected =
                    selectedAppIds.includes(app.id) ||
                    selectedAppIds.includes(app.packageName) ||
                    selectedAppIds.includes(`pkg-${app.packageName}`);
                  return (
                    <button
                      key={app.id}
                      type="button"
                      onClick={() => handleToggleAllowedApp(app.id)}
                      className={`p-3 rounded-2xl flex items-center justify-between transition-all cursor-pointer text-left ${
                        isSelected
                          ? 'bg-[#0A0A0A] text-white'
                          : 'bg-[#F4F4F5] text-[#0A0A0A] hover:bg-neutral-200/70'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            isSelected
                              ? 'bg-white/15 text-white'
                              : 'bg-white text-[#0A0A0A] shadow-2xs'
                          }`}
                        >
                          {renderAppIcon(app.iconKey, 'w-4 h-4', app)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">{app.name}</div>
                          <div
                            className={`text-[10px] truncate ${
                              isSelected ? 'text-neutral-300' : 'text-neutral-400'
                            }`}
                          >
                            {app.isCustom ? 'Custom App' : 'ফোনে ইনস্টল করা'}
                          </div>
                        </div>
                      </div>
                      {isSelected && <Check className="w-4 h-4 shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {!showManualAppForm ? (
                <div className="flex items-center justify-between pt-2 border-t border-black/5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowManualAppForm(true)}
                    className="text-xs text-neutral-500 hover:text-black underline cursor-pointer"
                  >
                    + অন্য কোনো অ্যাপ ম্যানুয়ালি যুক্ত করুন
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowInstalledAppsModal(false)}
                    className="px-5 py-2.5 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold cursor-pointer"
                  >
                    Done ({selectedAppIds.length}/4)
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={handleAddManualApp}
                  className="pt-2 border-t border-black/5 flex gap-2 shrink-0"
                >
                  <input
                    type="text"
                    required
                    value={manualAppName}
                    onChange={(e) => setManualAppName(e.target.value)}
                    placeholder="Type App Name..."
                    className="flex-1 h-10 px-3.5 rounded-xl bg-[#F4F4F5] text-xs text-[#0A0A0A] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="px-4 h-10 rounded-xl bg-[#0A0A0A] text-white text-xs font-semibold cursor-pointer"
                  >
                    Add
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        {/* 2. 1x 5-MINUTE EMERGENCY USE WITH MANDATORY TEXT VERIFICATION */}
        {showEmergencyModal && (
          <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[2px] flex items-end justify-center p-4">
            <form
              onSubmit={handleStart5MinEmergency}
              className="w-full max-w-[410px] bg-white text-[#0A0A0A] rounded-[32px] p-6 space-y-4 shadow-xl"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-[#0A0A0A]">
                    5-Minute Emergency Verification
                  </h3>
                  <p className="text-xs text-neutral-400">
                    শুধুমাত্র ১ বারের জন্য ৫ মিনিট আনলক হবে (1/1 Left)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowEmergencyModal(false)}
                  className="w-8 h-8 rounded-full bg-[#F4F4F5] flex items-center justify-center text-neutral-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-[#F4F4F5] space-y-1.5">
                <div className="text-[11px] text-neutral-500">
                  ইমার্জেন্সি চালু করতে নিচের ভেরিফিকেশন টেক্সটটি হুবহু নিচে টাইপ করুন:
                </div>
                <div className="text-base font-mono font-bold tracking-wider text-[#0A0A0A] select-none">
                  {EMERGENCY_VERIFICATION_TEXT}
                </div>
              </div>

              <input
                type="text"
                required
                value={emergencyVerifyInput}
                onChange={(e) => {
                  setEmergencyVerifyInput(e.target.value);
                  setEmergencyVerifyError(null);
                }}
                onPaste={(e) => e.preventDefault()}
                placeholder={`Type "${EMERGENCY_VERIFICATION_TEXT}" here...`}
                className="w-full h-12 px-4 rounded-2xl bg-[#F4F4F5] text-sm font-mono font-semibold text-[#0A0A0A] uppercase placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-black"
              />

              {emergencyVerifyError && (
                <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 p-3 rounded-xl">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{emergencyVerifyError}</span>
                </div>
              )}

              <button
                type="submit"
                className={`w-full h-12 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                  emergencyVerifyInput.trim().toUpperCase() === EMERGENCY_VERIFICATION_TEXT
                    ? 'bg-[#0A0A0A] text-white'
                    : 'bg-neutral-200 text-neutral-500'
                }`}
              >
                Verify & Start 5 Minutes
              </button>
            </form>
          </div>
        )}

        {/* 3. Add Emergency Contact Modal */}
        {showAddContactModal && (
          <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[2px] flex items-end justify-center p-4">
            <form
              onSubmit={handleAddContact}
              className="w-full max-w-[410px] bg-white text-[#0A0A0A] rounded-[32px] p-6 space-y-4 shadow-xl"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-[#0A0A0A]">
                  New Emergency Contact
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddContactModal(false)}
                  className="w-8 h-8 rounded-full bg-[#F4F4F5] flex items-center justify-center text-neutral-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-2.5">
                <input
                  type="text"
                  required
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="নাম লিখুন"
                  className="w-full h-12 px-4 rounded-2xl bg-[#F4F4F5] text-sm text-[#0A0A0A] placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-black"
                />
                <input
                  type="tel"
                  required
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="মোবাইল নাম্বার লিখুন"
                  className="w-full h-12 px-4 rounded-2xl bg-[#F4F4F5] text-sm font-mono text-[#0A0A0A] placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-black"
                />
                <input
                  type="text"
                  value={contactRelation}
                  onChange={(e) => setContactRelation(e.target.value)}
                  placeholder="সম্পর্ক (যেমন: পরিবার / অভিভাবক)"
                  className="w-full h-12 px-4 rounded-2xl bg-[#F4F4F5] text-sm text-[#0A0A0A] placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>

              <button
                type="submit"
                className="w-full h-12 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold cursor-pointer"
              >
                Save Contact
              </button>
            </form>
          </div>
        )}

        {/* 4. Contact Quick Action Sheet (ONLY Phone Call & SMS — No WhatsApp!) */}
        {selectedContactForAction && (
          <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[2px] flex items-end justify-center p-4">
            <div className="w-full max-w-[410px] bg-white text-[#0A0A0A] rounded-[32px] p-6 space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-[#0A0A0A]">
                    {selectedContactForAction.name}
                  </h3>
                  <p className="text-xs font-mono text-neutral-400">
                    {selectedContactForAction.relation} · {selectedContactForAction.phone}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedContactForAction(null)}
                  className="w-8 h-8 rounded-full bg-[#F4F4F5] flex items-center justify-center text-neutral-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleCallContact(selectedContactForAction.phone)}
                  className="p-4 rounded-2xl bg-[#0A0A0A] text-white flex flex-col items-center gap-2 text-xs font-semibold cursor-pointer active:scale-[0.98] transition-transform"
                >
                  <Phone className="w-5 h-5" />
                  <span>ফোন কল (Call)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSmsContact(selectedContactForAction.phone)}
                  className="p-4 rounded-2xl bg-[#F4F4F5] text-[#0A0A0A] border border-black/10 flex flex-col items-center gap-2 text-xs font-semibold cursor-pointer active:scale-[0.98] transition-transform"
                >
                  <MessageSquare className="w-5 h-5" />
                  <span>মেসেজ (SMS)</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setSelectedContactForAction(null)}
                className="w-full h-11 rounded-full bg-[#F4F4F5] text-[#0A0A0A] text-xs font-semibold cursor-pointer"
              >
                অ্যাপে ফিরে যান (Back to LOCK IN)
              </button>
            </div>
          </div>
        )}

        {/* 5. Add OR Edit Time Block Modal (12-Hour AM/PM Format + Auto Chronological Arrange) */}
        {showBlockModal && (
          <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[2px] flex items-end justify-center p-4">
            <form
              onSubmit={handleSaveBlock}
              className="w-full max-w-[410px] bg-white text-[#0A0A0A] rounded-[32px] p-6 space-y-4 shadow-xl"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-[#0A0A0A]">
                    {editingBlockId ? 'Edit Time Block (12h Format)' : 'New Time Block (12h Format)'}
                  </h3>
                  <p className="text-[11px] text-neutral-400">
                    সেভ করলেই সময় অনুযায়ী অটোমেটিক অ্যারেঞ্জ হয়ে যাবে
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBlockModal(false)}
                  className="w-8 h-8 rounded-full bg-[#F4F4F5] flex items-center justify-center text-neutral-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <input
                type="text"
                required
                value={blockTitle}
                onChange={(e) => setBlockTitle(e.target.value)}
                placeholder="সেশনের নাম (যেমন: সকালের পড়াশোনা / অফিস ফোকাস)"
                className="w-full h-12 px-4 rounded-2xl bg-[#F4F4F5] text-sm text-[#0A0A0A] placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-black"
              />

              {(() => {
                const startParts = parse24To12Parts(blockStart);
                const endParts = parse24To12Parts(blockEnd);
                const hours12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
                const minutesList = Array.from({ length: 60 }, (_, i) => i);

                return (
                  <div className="space-y-2.5">
                    {/* Start Time 12h Picker */}
                    <div className="bg-[#F4F4F5] p-3.5 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] text-neutral-500 font-semibold">
                          শুরুর সময় (Start Time · 12h)
                        </label>
                        <span className="text-xs font-mono font-bold text-[#0A0A0A]">
                          {formatTime12Hour(blockStart)}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <select
                          value={startParts.hour12}
                          onChange={(e) =>
                            setBlockStart(
                              parts12To24(
                                Number(e.target.value),
                                startParts.minute,
                                startParts.period
                              )
                            )
                          }
                          className="h-10 px-2.5 rounded-xl bg-white text-sm font-mono font-bold text-[#0A0A0A] focus:outline-none"
                        >
                          {hours12.map((h) => (
                            <option key={h} value={h}>
                              {String(h).padStart(2, '0')} hr
                            </option>
                          ))}
                        </select>

                        <select
                          value={startParts.minute}
                          onChange={(e) =>
                            setBlockStart(
                              parts12To24(
                                startParts.hour12,
                                Number(e.target.value),
                                startParts.period
                              )
                            )
                          }
                          className="h-10 px-2.5 rounded-xl bg-white text-sm font-mono font-bold text-[#0A0A0A] focus:outline-none"
                        >
                          {minutesList.map((m) => (
                            <option key={m} value={m}>
                              :{String(m).padStart(2, '0')} min
                            </option>
                          ))}
                        </select>

                        <div className="grid grid-cols-2 bg-white rounded-xl p-1">
                          {(['AM', 'PM'] as const).map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() =>
                                setBlockStart(
                                  parts12To24(startParts.hour12, startParts.minute, p)
                                )
                              }
                              className={`rounded-lg text-xs font-mono font-bold transition-colors cursor-pointer ${
                                startParts.period === p
                                  ? 'bg-[#0A0A0A] text-white'
                                  : 'text-neutral-500'
                              }`}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* End Time 12h Picker */}
                    <div className="bg-[#F4F4F5] p-3.5 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] text-neutral-500 font-semibold">
                          শেষের সময় (End Time · 12h)
                        </label>
                        <span className="text-xs font-mono font-bold text-[#0A0A0A]">
                          {formatTime12Hour(blockEnd)}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <select
                          value={endParts.hour12}
                          onChange={(e) =>
                            setBlockEnd(
                              parts12To24(
                                Number(e.target.value),
                                endParts.minute,
                                endParts.period
                              )
                            )
                          }
                          className="h-10 px-2.5 rounded-xl bg-white text-sm font-mono font-bold text-[#0A0A0A] focus:outline-none"
                        >
                          {hours12.map((h) => (
                            <option key={h} value={h}>
                              {String(h).padStart(2, '0')} hr
                            </option>
                          ))}
                        </select>

                        <select
                          value={endParts.minute}
                          onChange={(e) =>
                            setBlockEnd(
                              parts12To24(
                                endParts.hour12,
                                Number(e.target.value),
                                endParts.period
                              )
                            )
                          }
                          className="h-10 px-2.5 rounded-xl bg-white text-sm font-mono font-bold text-[#0A0A0A] focus:outline-none"
                        >
                          {minutesList.map((m) => (
                            <option key={m} value={m}>
                              :{String(m).padStart(2, '0')} min
                            </option>
                          ))}
                        </select>

                        <div className="grid grid-cols-2 bg-white rounded-xl p-1">
                          {(['AM', 'PM'] as const).map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() =>
                                setBlockEnd(
                                  parts12To24(endParts.hour12, endParts.minute, p)
                                )
                              }
                              className={`rounded-lg text-xs font-mono font-bold transition-colors cursor-pointer ${
                                endParts.period === p
                                  ? 'bg-[#0A0A0A] text-white'
                                  : 'text-neutral-500'
                              }`}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-1.5">
                <label className="text-[11px] text-neutral-400 font-medium block">
                  Active Days
                </label>
                <div className="grid grid-cols-7 gap-1.5">
                  {ALL_DAYS.map((d) => {
                    const selected = blockDays.includes(d.key);
                    return (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => toggleDayInModal(d.key)}
                        className={`h-9 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
                          selected
                            ? 'bg-[#0A0A0A] text-white'
                            : 'bg-[#F4F4F5] text-neutral-500'
                        }`}
                      >
                        {d.short}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                className="w-full h-12 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold cursor-pointer"
              >
                {editingBlockId ? 'Save & Auto-Arrange' : 'Create & Auto-Arrange Block'}
              </button>
            </form>
          </div>
        )}

        {/* 5b. Passcode Verification Modal for Turning Off / Editing / Deleting Any Session */}
        {pendingPasscodeAction && (
          <div className="fixed inset-0 z-[75] bg-black/60 backdrop-blur-[2px] flex items-end justify-center p-4">
            <form
              onSubmit={handleVerifySessionPasscodeAction}
              className="w-full max-w-[410px] bg-white text-[#0A0A0A] rounded-[32px] p-6 space-y-4 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-full bg-[#0A0A0A] text-white flex items-center justify-center shrink-0">
                    <Lock className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-[#0A0A0A]">
                      {pendingPasscodeAction.action === 'disable'
                        ? 'সেশন অফ করতে পাসকোড দিন'
                        : pendingPasscodeAction.action === 'delete'
                        ? 'সেশন ডিলিট করতে পাসকোড দিন'
                        : pendingPasscodeAction.action === 'edit'
                        ? 'সেশন এডিট করতে পাসকোড দিন'
                        : 'সিক্রেট কোড আনলক পাসকোড'}
                    </h3>
                    <p className="text-xs text-neutral-400">
                      Request ID: <strong className="font-mono text-black">#{requestId}</strong>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPendingPasscodeAction(null);
                    setSessionPasscodeError(null);
                  }}
                  className="w-8 h-8 rounded-full bg-[#F4F4F5] flex items-center justify-center text-neutral-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {pendingPasscodeAction.block && (
                <div className="p-3.5 rounded-2xl bg-[#F4F4F5] flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-[#0A0A0A]">
                      {pendingPasscodeAction.block.labelBn}
                    </div>
                    <div className="text-xs font-mono text-neutral-500 mt-0.5">
                      {formatTime12Hour(pendingPasscodeAction.block.startTime)} –{' '}
                      {formatTime12Hour(pendingPasscodeAction.block.endTime)}
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-[#0A0A0A] text-white text-[10px] font-semibold">
                    Passcode Protected
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  required
                  value={sessionPasscodeInput}
                  onChange={(e) => {
                    setSessionPasscodeInput(normalizeToAsciiDigits(e.target.value).toUpperCase());
                    setSessionPasscodeError(null);
                  }}
                  placeholder="গার্ডিয়ান পাসকোড লিখুন (যেমন: 10-XXXXXX)"
                  className="flex-1 h-12 px-4 rounded-2xl bg-[#F4F4F5] text-sm font-mono font-semibold text-[#0A0A0A] uppercase placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-black"
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      if (navigator.clipboard && navigator.clipboard.readText) {
                        const txt = await navigator.clipboard.readText();
                        if (txt) {
                          setSessionPasscodeInput(
                            normalizeToAsciiDigits(txt.trim()).toUpperCase()
                          );
                          setSessionPasscodeError(null);
                        }
                      }
                    } catch {
                      // ignore
                    }
                  }}
                  className="h-12 px-3.5 rounded-2xl bg-[#F4F4F5] hover:bg-neutral-200 text-xs font-semibold text-[#0A0A0A] shrink-0 cursor-pointer"
                >
                  Paste
                </button>
              </div>

              {sessionPasscodeError && (
                <div className="text-xs text-red-600 bg-red-50 p-3 rounded-xl">
                  {sessionPasscodeError}
                </div>
              )}

              <div className="text-[11px] text-neutral-400 leading-relaxed">
                পরিকল্পিত বা চলমান সেশন শুরু হওয়ার আগে কিংবা চলাকালীন অফ করার জন্য Guardian App থেকে{' '}
                <strong className="font-mono text-neutral-700">#{requestId}</strong> এর যেকোনো পাসকোড ব্যবহার করুন।
              </div>

              <button
                type="submit"
                className="w-full h-12 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold cursor-pointer"
              >
                পাসকোড যাচাই করে নিশ্চিত করুন
              </button>
            </form>
          </div>
        )}

        {/* 6. Offline Guardian Code Unlock Sheet */}
        {showUnlockModal && (
          <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[2px] flex items-end justify-center p-4">
            <form
              onSubmit={handleVerifyUnlock}
              className="w-full max-w-[410px] bg-white text-[#0A0A0A] rounded-[32px] p-6 space-y-4 shadow-xl"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-[#0A0A0A]">
                    Guardian Unlock
                  </h3>
                  <p className="text-xs text-neutral-400">
                    Request ID: <strong className="font-mono text-black">#{requestId}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowUnlockModal(false);
                    setUnlockError(null);
                  }}
                  className="w-8 h-8 rounded-full bg-[#F4F4F5] flex items-center justify-center text-neutral-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={unlockInput}
                  onChange={(e) => {
                    setUnlockInput(normalizeToAsciiDigits(e.target.value).toUpperCase());
                    setUnlockError(null);
                  }}
                  placeholder="যেমন: 10-XXXXXX বা 60-XXXXXX"
                  className="flex-1 h-12 px-4 rounded-2xl bg-[#F4F4F5] text-sm font-mono font-semibold text-[#0A0A0A] uppercase placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-black"
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      if (navigator.clipboard && navigator.clipboard.readText) {
                        const txt = await navigator.clipboard.readText();
                        if (txt) {
                          setUnlockInput(normalizeToAsciiDigits(txt.trim()).toUpperCase());
                          setUnlockError(null);
                        }
                      }
                    } catch {
                      // ignore clipboard read permission error
                    }
                  }}
                  className="h-12 px-3.5 rounded-2xl bg-[#F4F4F5] hover:bg-neutral-200 text-xs font-semibold text-[#0A0A0A] shrink-0 cursor-pointer"
                >
                  Paste
                </button>
              </div>

              {unlockError && (
                <div className="text-xs text-red-600 bg-red-50 p-3 rounded-xl">{unlockError}</div>
              )}

              <div className="text-[11px] text-neutral-400 leading-relaxed">
                ৫ মিনিট, ১০ মিনিট, ১৫ মিনিট বা যেকোনো কাস্টম সময়ের আনলক কোড লিখুন (যেমন: <span className="font-mono text-neutral-600">5-XXXXXX</span>, <span className="font-mono text-neutral-600">10-XXXXXX</span>, <span className="font-mono text-neutral-600">25-XXXXXX</span>)
              </div>

              <button
                type="submit"
                className="w-full h-12 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold cursor-pointer"
              >
                Verify & Unlock
              </button>
            </form>
          </div>
        )}

        {/* 7. Active Allowed App Launcher Sheet */}
        {activeMiniApp && (
          <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-[2px] flex items-end justify-center p-4">
            <div className="w-full max-w-[410px] bg-white text-[#0A0A0A] rounded-[32px] p-6 space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-[#0A0A0A] text-white flex items-center justify-center">
                    {renderAppIcon(activeMiniApp.iconKey, 'w-4 h-4', activeMiniApp)}
                  </div>
                  <h3 className="text-base font-semibold text-[#0A0A0A]">
                    {activeMiniApp.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveMiniApp(null)}
                  className="w-8 h-8 rounded-full bg-[#F4F4F5] flex items-center justify-center text-neutral-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {activeMiniApp.iconKey === 'notes' ? (
                <textarea
                  rows={4}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Write an offline note..."
                  className="w-full p-4 rounded-2xl bg-[#F4F4F5] text-sm text-[#0A0A0A] focus:outline-none"
                />
              ) : activeMiniApp.iconKey === 'calculator' ? (
                <div className="space-y-3">
                  <div className="h-12 px-4 rounded-2xl bg-[#F4F4F5] flex items-center justify-end font-mono text-lg font-semibold">
                    {calcExpr || '0'}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', 'C', '0', '=', '+'].map(
                      (btn) => (
                        <button
                          key={btn}
                          type="button"
                          onClick={() => {
                            if (btn === 'C') setCalcExpr('');
                            else if (btn === '=') {
                              try {
                                const sanitized = calcExpr.replace(/[^0-9+\-*/.]/g, '');
                                const res = Function(`"use strict"; return (${sanitized || 0})`)();
                                setCalcExpr(String(res));
                              } catch {
                                setCalcExpr('Error');
                              }
                            } else {
                              setCalcExpr((prev) => prev + btn);
                            }
                          }}
                          className="h-11 rounded-xl bg-[#F4F4F5] hover:bg-neutral-200 font-mono text-sm font-medium cursor-pointer"
                        >
                          {btn}
                        </button>
                      )
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-neutral-500">
                    {activeMiniApp.name} আপনার ৪টি অনুমোদিত অ্যাপের তালিকায় রয়েছে।
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (window.AndroidBridge?.launchApp) {
                          window.AndroidBridge.launchApp(activeMiniApp.packageName);
                        } else if (activeMiniApp.launchUrl) {
                          window.location.href = activeMiniApp.launchUrl;
                        }
                        setActiveMiniApp(null);
                      }}
                      style={{ touchAction: 'manipulation' }}
                      className="flex-1 h-12 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer touch-manipulation active:scale-[0.98]"
                    >
                      <span>অ্যাপ খুলুন (Open App)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveMiniApp(null)}
                      style={{ touchAction: 'manipulation' }}
                      className="px-5 h-12 rounded-full bg-[#F4F4F5] text-[#0A0A0A] text-xs font-semibold flex items-center justify-center cursor-pointer touch-manipulation active:scale-[0.98]"
                    >
                      <span>বন্ধ করুন</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 8. Focus Timer Presets & Custom Duration Modal */}
        {showFocusTimerModal && (
          <div className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-[2px] flex items-end justify-center p-4">
            <div className="w-full max-w-[410px] bg-white text-[#0A0A0A] rounded-[32px] p-6 space-y-4 shadow-2xl max-h-[86vh] flex flex-col">
              <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-full bg-[#0A0A0A] text-white flex items-center justify-center shrink-0">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-[#0A0A0A]">
                      ফোকাস টাইমার ও কাস্টম লক
                    </h3>
                    <p className="text-xs text-neutral-400">
                      প্রিসেট সিলেক্ট করুন অথবা নিজের পছন্দমতো সময় দিন
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFocusTimerModal(false)}
                  className="w-8 h-8 rounded-full bg-[#F4F4F5] flex items-center justify-center text-neutral-500 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Mode Switcher: Presets vs Custom */}
              <div className="grid grid-cols-2 p-1 rounded-2xl bg-[#F4F4F5] shrink-0">
                <button
                  type="button"
                  onClick={() => setIsCustomFocusMode(false)}
                  className={`py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    !isCustomFocusMode
                      ? 'bg-[#0A0A0A] text-white shadow-xs'
                      : 'text-neutral-500 hover:text-black'
                  }`}
                >
                  প্রিসেট সময় (Presets)
                </button>
                <button
                  type="button"
                  onClick={() => setIsCustomFocusMode(true)}
                  className={`py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isCustomFocusMode
                      ? 'bg-[#0A0A0A] text-white shadow-xs'
                      : 'text-neutral-500 hover:text-black'
                  }`}
                >
                  কাস্টম সময় (Custom)
                </button>
              </div>

              {!isCustomFocusMode ? (
                <div className="space-y-3 overflow-y-auto pr-0.5">
                  <div className="grid grid-cols-2 gap-2">
                    {FOCUS_TIMER_PRESETS.map((preset) => {
                      const isActive = selectedFocusPresetMin === preset.minutes;
                      return (
                        <button
                          key={preset.minutes}
                          type="button"
                          onClick={() => setSelectedFocusPresetMin(preset.minutes)}
                          className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                            isActive
                              ? 'bg-[#0A0A0A] text-white border-[#0A0A0A]'
                              : 'bg-[#F4F4F5] text-[#0A0A0A] border-transparent hover:bg-neutral-200/70'
                          }`}
                        >
                          <div>
                            <div className="text-sm font-bold">{preset.labelBn}</div>
                            <div
                              className={`text-[10px] ${
                                isActive ? 'text-neutral-300' : 'text-neutral-400'
                              }`}
                            >
                              {preset.labelEn}
                            </div>
                          </div>
                          {isActive && <Check className="w-4 h-4 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const chosen =
                        FOCUS_TIMER_PRESETS.find((p) => p.minutes === selectedFocusPresetMin) ||
                        FOCUS_TIMER_PRESETS[3];
                      setShowFocusTimerModal(false);
                      requestFocusWithWarning(chosen.minutes, chosen.labelEn);
                    }}
                    className="w-full h-12 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>
                      {FOCUS_TIMER_PRESETS.find((p) => p.minutes === selectedFocusPresetMin)
                        ?.labelBn || '১ ঘণ্টা'}{' '}
                      ফোকাস লক শুরু করুন
                    </span>
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const hrs = Math.max(
                      0,
                      Math.min(24, parseInt(normalizeToAsciiDigits(customFocusHours) || '0', 10) || 0)
                    );
                    const mins = Math.max(
                      0,
                      Math.min(599, parseInt(normalizeToAsciiDigits(customFocusMinutes) || '0', 10) || 0)
                    );
                    const totalMinutes = Math.max(1, hrs * 60 + mins);
                    const autoLabel =
                      hrs > 0 && mins > 0
                        ? `${hrs}h ${mins}m Focus Lock`
                        : hrs > 0
                        ? `${hrs}h Focus Lock`
                        : `${mins}m Focus Lock`;
                    const finalLabel = customFocusSessionTitle.trim() || autoLabel;
                    setShowFocusTimerModal(false);
                    requestFocusWithWarning(totalMinutes, finalLabel);
                  }}
                  className="space-y-3.5"
                >
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-neutral-500 block">
                      সেশনের নাম (ঐচ্ছিক)
                    </label>
                    <input
                      type="text"
                      value={customFocusSessionTitle}
                      onChange={(e) => setCustomFocusSessionTitle(e.target.value)}
                      placeholder="যেমন: Deep Study, প্রজেক্ট ওয়ার্ক, নামাজ ও বিশ্রাম..."
                      className="w-full h-11 px-4 rounded-2xl bg-[#F4F4F5] text-xs text-[#0A0A0A] placeholder:text-neutral-400 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="p-3.5 rounded-2xl bg-[#F4F4F5] space-y-1.5">
                      <label className="text-[11px] font-semibold text-neutral-500 block">
                        ঘণ্টা (Hours)
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const cur =
                              parseInt(normalizeToAsciiDigits(customFocusHours) || '0', 10) || 0;
                            setCustomFocusHours(String(Math.max(0, cur - 1)));
                          }}
                          className="w-9 h-9 rounded-xl bg-white text-[#0A0A0A] font-bold text-sm flex items-center justify-center cursor-pointer"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min={0}
                          max={24}
                          value={customFocusHours}
                          onChange={(e) => setCustomFocusHours(e.target.value)}
                          className="w-full h-9 rounded-xl bg-white text-center font-mono text-base font-bold text-[#0A0A0A] focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const cur =
                              parseInt(normalizeToAsciiDigits(customFocusHours) || '0', 10) || 0;
                            setCustomFocusHours(String(Math.min(24, cur + 1)));
                          }}
                          className="w-9 h-9 rounded-xl bg-white text-[#0A0A0A] font-bold text-sm flex items-center justify-center cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-[#F4F4F5] space-y-1.5">
                      <label className="text-[11px] font-semibold text-neutral-500 block">
                        মিনিট (Minutes)
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const cur =
                              parseInt(normalizeToAsciiDigits(customFocusMinutes) || '0', 10) || 0;
                            setCustomFocusMinutes(String(Math.max(0, cur - 5)));
                          }}
                          className="w-9 h-9 rounded-xl bg-white text-[#0A0A0A] font-bold text-sm flex items-center justify-center cursor-pointer"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min={0}
                          max={599}
                          value={customFocusMinutes}
                          onChange={(e) => setCustomFocusMinutes(e.target.value)}
                          className="w-full h-9 rounded-xl bg-white text-center font-mono text-base font-bold text-[#0A0A0A] focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const cur =
                              parseInt(normalizeToAsciiDigits(customFocusMinutes) || '0', 10) || 0;
                            setCustomFocusMinutes(String(Math.min(599, cur + 5)));
                          }}
                          className="w-9 h-9 rounded-xl bg-white text-[#0A0A0A] font-bold text-sm flex items-center justify-center cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Quick minute chips inside Custom tab */}
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { h: 0, m: 20, label: '20 মি.' },
                      { h: 0, m: 40, label: '40 মি.' },
                      { h: 0, m: 50, label: '50 মি.' },
                      { h: 1, m: 15, label: '1 ঘ. 15 মি.' },
                      { h: 2, m: 30, label: '2 ঘ. 30 মি.' },
                      { h: 5, m: 0, label: '5 ঘণ্টা' },
                    ].map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => {
                          setCustomFocusHours(String(chip.h));
                          setCustomFocusMinutes(String(chip.m));
                        }}
                        className="px-3 py-1.5 rounded-full bg-[#F4F4F5] hover:bg-neutral-200 text-[11px] font-semibold text-[#0A0A0A] cursor-pointer"
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>

                  {(() => {
                    const hrs = Math.max(
                      0,
                      parseInt(normalizeToAsciiDigits(customFocusHours) || '0', 10) || 0
                    );
                    const mins = Math.max(
                      0,
                      parseInt(normalizeToAsciiDigits(customFocusMinutes) || '0', 10) || 0
                    );
                    const totalMin = Math.max(1, hrs * 60 + mins);
                    const dispH = Math.floor(totalMin / 60);
                    const dispM = totalMin % 60;
                    return (
                      <div className="p-3 rounded-2xl bg-[#F4F4F5] flex items-center justify-between text-xs">
                        <span className="text-neutral-500">মোট ফোকাস লক সময়:</span>
                        <span className="font-mono font-bold text-[#0A0A0A]">
                          {dispH > 0 ? `${dispH} ঘণ্টা ` : ''}
                          {dispM > 0 ? `${dispM} মিনিট ` : ''}({totalMin} min)
                        </span>
                      </div>
                    );
                  })()}

                  <button
                    type="submit"
                    className="w-full h-12 rounded-full bg-[#0A0A0A] text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>কাস্টম সময়ের জন্য লক শুরু করুন</span>
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
