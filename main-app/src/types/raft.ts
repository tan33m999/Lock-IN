export type DayOfWeek = 'Sun' | 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat';

export type UnlockDurationOption = number;

export type AppIconKey =
  | 'phone'
  | 'messages'
  | 'whatsapp'
  | 'maps'
  | 'calculator'
  | 'notes'
  | 'calendar'
  | 'camera'
  | 'clock'
  | 'music'
  | 'mail'
  | 'globe'
  | 'wallet'
  | 'book'
  | 'custom';

export interface AllowedAppItem {
  id: string;
  name: string;
  packageName: string;
  iconKey: AppIconKey;
  launchUrl?: string;
  isCustom?: boolean;
}

export interface TimeBlock {
  id: string;
  label: string;
  labelBn: string;
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
  days: DayOfWeek[];
  enabled: boolean;
  allowedUtilities?: {
    calls: boolean;
    sms: boolean;
    whatsapp: boolean;
  };
  emergencyUsedCount: number; // 0 or 1
  emergencyActiveUntil: number | null;
}

export interface WhitelistedContact {
  id: string;
  name: string;
  relation: string;
  phone: string;
  isGuardian?: boolean;
  allowCall: boolean;
  allowSms: boolean;
  allowWhatsApp: boolean;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  category: 'BLOCK_INTERCEPT' | 'EMERGENCY_5M' | 'GUARDIAN_UNLOCK' | 'TAMPER_ATTEMPT' | 'BOOT_PERSIST';
  title: string;
  detail: string;
  severity: 'info' | 'warning' | 'critical' | 'verified';
}
