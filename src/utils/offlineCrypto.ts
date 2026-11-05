import { UnlockDurationOption } from '../types/raft';

/**
 * Pure offline, deterministic SHA-256 & HMAC-SHA256 implementation.
 * Works 100% air-gapped without internet, servers, or external dependencies.
 */
const K: number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function utf8ToBytes(str: string): number[] {
  const utf8: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let charcode = str.charCodeAt(i);
    if (charcode < 0x80) utf8.push(charcode);
    else if (charcode < 0x800) {
      utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
    } else {
      i++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      utf8.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    }
  }
  return utf8;
}

export function sha256Bytes(msgBytes: number[]): number[] {
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const bitLength = msgBytes.length * 8;
  const bytes = [...msgBytes, 0x80];
  while ((bytes.length * 8) % 512 !== 448) {
    bytes.push(0x00);
  }

  // Append 64-bit length big-endian
  const highBits = Math.floor(bitLength / 0x100000000);
  const lowBits = bitLength >>> 0;
  bytes.push(
    (highBits >>> 24) & 0xff,
    (highBits >>> 16) & 0xff,
    (highBits >>> 8) & 0xff,
    highBits & 0xff,
    (lowBits >>> 24) & 0xff,
    (lowBits >>> 16) & 0xff,
    (lowBits >>> 8) & 0xff,
    lowBits & 0xff
  );

  const w = new Array<number>(64);
  for (let chunkStart = 0; chunkStart < bytes.length; chunkStart += 64) {
    for (let i = 0; i < 16; i++) {
      const j = chunkStart + i * 4;
      w[i] =
        ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const digest: number[] = [];
  for (const word of [h0, h1, h2, h3, h4, h5, h6, h7]) {
    digest.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
  }
  return digest;
}

export function hmacSha256Hex(secretKey: string, message: string): string {
  const blockSize = 64;
  let keyBytes = utf8ToBytes(secretKey.trim().toUpperCase());
  if (keyBytes.length > blockSize) {
    keyBytes = sha256Bytes(keyBytes);
  }
  while (keyBytes.length < blockSize) {
    keyBytes.push(0x00);
  }

  const oKeyPad = keyBytes.map((b) => b ^ 0x5c);
  const iKeyPad = keyBytes.map((b) => b ^ 0x36);

  const msgBytes = utf8ToBytes(message.trim());
  const innerHash = sha256Bytes([...iKeyPad, ...msgBytes]);
  const outerHash = sha256Bytes([...oKeyPad, ...innerHash]);

  return outerHash
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export interface GeneratedUnlockToken {
  fullCode: string;        // e.g. "60-7F3A92"
  durationCode: UnlockDurationOption;
  signature6: string;      // e.g. "7F3A92"
  fullHmacHex: string;     // Full 64-char SHA256 hex for visual proof
  payloadString: string;   // e.g. "4921:60"
  durationLabelBn: string;
}

export const DURATION_LABELS: Record<number, { labelBn: string; labelEn: string; minutes: number }> = {
  1: { labelBn: '১ মিনিট (1 Min)', labelEn: '1 Minute', minutes: 1 },
  2: { labelBn: '২ মিনিট (2 Min)', labelEn: '2 Minutes', minutes: 2 },
  3: { labelBn: '৩ মিনিট (3 Min)', labelEn: '3 Minutes', minutes: 3 },
  5: { labelBn: '৫ মিনিট (5 Min)', labelEn: '5 Minutes', minutes: 5 },
  10: { labelBn: '১০ মিনিট (10 Min)', labelEn: '10 Minutes', minutes: 10 },
  15: { labelBn: '১৫ মিনিট (15 Min)', labelEn: '15 Minutes', minutes: 15 },
  20: { labelBn: '২০ মিনিট (20 Min)', labelEn: '20 Minutes', minutes: 20 },
  25: { labelBn: '২৫ মিনিট (25 Min)', labelEn: '25 Minutes', minutes: 25 },
  30: { labelBn: '৩০ মিনিট (30 Min)', labelEn: '30 Minutes', minutes: 30 },
  40: { labelBn: '৪০ মিনিট (40 Min)', labelEn: '40 Minutes', minutes: 40 },
  45: { labelBn: '৪৫ মিনিট (45 Min)', labelEn: '45 Minutes', minutes: 45 },
  50: { labelBn: '৫০ মিনিট (50 Min)', labelEn: '50 Minutes', minutes: 50 },
  60: { labelBn: '১ ঘণ্টা (60 Min)', labelEn: '1 Hour (60m)', minutes: 60 },
  75: { labelBn: '১ ঘণ্টা ১৫ মিনিট (75 Min)', labelEn: '75 Minutes', minutes: 75 },
  90: { labelBn: '১.৫ ঘণ্টা (90 Min)', labelEn: '1.5 Hours (90m)', minutes: 90 },
  120: { labelBn: '২ ঘণ্টা (120 Min)', labelEn: '2 Hours (120m)', minutes: 120 },
  150: { labelBn: '২.৫ ঘণ্টা (150 Min)', labelEn: '2.5 Hours (150m)', minutes: 150 },
  180: { labelBn: '৩ ঘণ্টা (180 Min)', labelEn: '3 Hours (180m)', minutes: 180 },
  240: { labelBn: '৪ ঘণ্টা (240 Min)', labelEn: '4 Hours (240m)', minutes: 240 },
  999: { labelBn: 'পুরো সেশন আনলক (Full Override)', labelEn: 'Full Block Override', minutes: 999 },
};

/**
 * Converts Bengali digits (০-৯) to ASCII digits (0-9) and strips invisible characters
 */
export function normalizeToAsciiDigits(input: string): string {
  const bnDigits = '০১২৩৪৫৬৭৮৯';
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const bnIdx = bnDigits.indexOf(ch);
    if (bnIdx !== -1) {
      out += String(bnIdx);
    } else {
      out += ch;
    }
  }
  return out.replace(/[\u200B-\u200F\uFEFF]/g, '');
}

export function getDurationLabelBn(duration: number): string {
  if (DURATION_LABELS[duration]) {
    return DURATION_LABELS[duration].labelBn;
  }
  if (duration === 999) {
    return 'পুরো সেশন আনলক (Full Override)';
  }
  const safeMin = Math.max(1, Math.min(1440, Math.floor(Number(duration) || 15)));
  if (safeMin >= 60 && safeMin % 60 === 0) {
    const hrs = safeMin / 60;
    return `${hrs} ঘণ্টা (${safeMin} Min)`;
  }
  if (safeMin > 60) {
    const hrs = Math.floor(safeMin / 60);
    const rem = safeMin % 60;
    return `${hrs} ঘণ্টা ${rem} মিনিট (${safeMin} Min)`;
  }
  return `${safeMin} মিনিট (${safeMin} Min)`;
}

/**
 * Generates an offline duration-encoded one-time unlock token.
 * Format: "[Duration]-[6CharHash]", e.g. "5-A1B2C3", "10-7F3A92", "45-9B2C11"
 */
export function generateGuardianUnlockToken(
  secretKey: string,
  requestId: string,
  duration: UnlockDurationOption
): GeneratedUnlockToken {
  const rawDur = Number(normalizeToAsciiDigits(String(duration)));
  const safeDuration =
    rawDur === 999
      ? 999
      : Math.max(1, Math.min(1440, Math.floor(!isNaN(rawDur) && rawDur >= 1 ? rawDur : 60)));
  const cleanReq =
    normalizeToAsciiDigits(String(requestId || ''))
      .replace(/[^0-9]/g, '')
      .slice(0, 4) || '0000';
  const cleanSecret = (secretKey || 'KEY-8841-RAFT').trim().toUpperCase();
  const payloadString = `${cleanReq}:${safeDuration}`;
  const fullHmacHex = hmacSha256Hex(cleanSecret, payloadString);
  const signature6 = fullHmacHex.slice(0, 6);
  const fullCode = `${safeDuration}-${signature6}`;

  return {
    fullCode,
    durationCode: safeDuration,
    signature6,
    fullHmacHex,
    payloadString,
    durationLabelBn: getDurationLabelBn(safeDuration),
  };
}

export interface VerificationResult {
  valid: boolean;
  durationMinutes?: number;
  durationLabelBn?: string;
  reasonBn: string;
  isTamperedDuration?: boolean;
  isReplayedCode?: boolean;
}

/**
 * Verifies an offline unlock token on the user's air-gapped device.
 * Supports ALL short & long durations (1m, 5m, 10m, 15m, 20m, 30m, 45m, 60m, 120m, custom 1-1440m, and 999).
 * Handles Bengali digits, spaces, custom dashes, and 5-6 char hex signatures cleanly.
 */
export function verifyOfflineUnlockCode(
  inputCode: string,
  secretKey: string,
  currentRequestId: string,
  burnedRequestIds: string[],
  burnedCodes: string[]
): VerificationResult {
  const asciiInput = normalizeToAsciiDigits(inputCode || '')
    .trim()
    .toUpperCase()
    .replace(/[\u2010-\u2015\u2212_:\/]+/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '-');

  if (!asciiInput) {
    return {
      valid: false,
      reasonBn: 'আনলক কোডটি লিখুন (যেমন: 10-7F3A92 বা 60-7F3A92)।',
    };
  }

  // Extract [duration]-[hexSignature]
  const match = asciiInput.match(/^(\d{1,4})-([0-9A-F]{5,64})$/);
  if (!match) {
    return {
      valid: false,
      reasonBn: 'কোডের ফরম্যাট সঠিক নয়। সঠিক ফরম্যাট: [মিনিট]-[হ্যাশ কোড], যেমন: 10-7F3A92',
    };
  }

  const durationStr = match[1];
  const providedSig = match[2].slice(0, 6); // Support 5 or 6 char prefix
  const parsedDuration = parseInt(durationStr, 10);

  const isValidCustomOrPreset =
    !isNaN(parsedDuration) &&
    Number.isInteger(parsedDuration) &&
    ((parsedDuration >= 1 && parsedDuration <= 1440) || parsedDuration === 999);

  if (!isValidCustomOrPreset || providedSig.length < 5) {
    return {
      valid: false,
      reasonBn: 'সময়সীমা ১ থেকে ১৪৪০ মিনিটের মধ্যে হতে হবে (যেমন: 5, 10, 15, 30, 60)।',
    };
  }

  const canonicalCode = `${parsedDuration}-${providedSig}`;
  if (burnedCodes.includes(canonicalCode) || burnedCodes.includes(asciiInput)) {
    return {
      valid: false,
      isReplayedCode: true,
      reasonBn:
        'এই কোডটি ইতিপূর্বে একবার ব্যবহার করা হয়েছে! একটি কোড একবারের বেশি কাজ করবে না।',
    };
  }

  // Check if matches current Request ID + claimed duration
  const expectedForClaimed = generateGuardianUnlockToken(
    secretKey,
    currentRequestId,
    parsedDuration
  );

  const isSignatureMatch =
    providedSig.length === 6
      ? expectedForClaimed.signature6 === providedSig
      : expectedForClaimed.signature6.startsWith(providedSig);

  if (isSignatureMatch) {
    const labelBn = getDurationLabelBn(parsedDuration);
    return {
      valid: true,
      durationMinutes: parsedDuration,
      durationLabelBn: labelBn,
      reasonBn: `ভেরিফিকেশন সফল! গার্ডিয়ান অনুমোদিত ${labelBn} এর জন্য আনলক হয়েছে।`,
    };
  }

  // Check if the user tried to tamper with the duration prefix!
  const commonCheckDurations = [
    1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 45, 50, 60, 75, 90, 120, 150, 180, 240, 300, 360, 999,
  ];
  for (const actualDur of commonCheckDurations) {
    if (actualDur !== parsedDuration) {
      const checkOther = generateGuardianUnlockToken(secretKey, currentRequestId, actualDur);
      const otherMatch =
        providedSig.length === 6
          ? checkOther.signature6 === providedSig
          : checkOther.signature6.startsWith(providedSig);
      if (otherMatch) {
        return {
          valid: false,
          isTamperedDuration: true,
          reasonBn: `মেয়াদ পরিবর্তনের চেষ্টা ধরা পড়েছে! গার্ডিয়ান ${getDurationLabelBn(actualDur)}-এর জন্য কোড দিয়েছেন, কিন্তু আপনি ${parsedDuration} মিনিট লিখেছেন।`,
        };
      }
    }
  }

  // Check if the signature belongs to an older burned Request ID
  for (const oldReq of burnedRequestIds) {
    for (const dur of [parsedDuration, ...commonCheckDurations]) {
      const oldToken = generateGuardianUnlockToken(secretKey, oldReq, dur);
      const oldMatch =
        providedSig.length === 6
          ? oldToken.signature6 === providedSig
          : oldToken.signature6.startsWith(providedSig);
      if (oldMatch) {
        return {
          valid: false,
          isReplayedCode: true,
          reasonBn: `পুরনো Request ID (#${oldReq})-এর কোড ব্যবহারের চেষ্টা করা হয়েছে! বর্তমান Request ID হলো #${currentRequestId}।`,
        };
      }
    }
  }

  return {
    valid: false,
    reasonBn: `হ্যাশ মেলেনি! নিশ্চিত করুন গার্ডিয়ান বর্তমান Request ID (#${currentRequestId}) এবং একই সিক্রেট কোড ব্যবহার করেছেন।`,
  };
}

/**
 * Generates a fresh 4-digit non-repeating Request ID (Challenge Nonce)
 */
export function generateNextRequestId(currentId: string, burnedIds: string[]): string {
  const usedSet = new Set([currentId, ...burnedIds]);
  for (let attempt = 0; attempt < 200; attempt++) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000));
    if (!usedSet.has(candidate)) {
      return candidate;
    }
  }
  return String(((Number(currentId) || 4000) + 137) % 9000 + 1000);
}
