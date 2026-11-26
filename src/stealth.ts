/**
 * KVP-103 / RFC-003 — Client-Side Dual-Key Stealth Addresses on Ed25519.
 *
 * Cryptographically identical to `kovanica-web/src/lib/protocol/stealth.ts`:
 * - Meta-address: `st:kvnc:<64-hex-scanPub>:<64-hex-spendPub>`
 * - Shared secret: `S = r·V = v·R` (Ed25519 point encoding, 32 bytes)
 * - Tweak: `t = reduceModL(BLAKE3("KVNC/stealth/tweak/v1" || S))`
 * - View tag: `BLAKE3("KVNC/stealth/tag/v1" || S)[0..2]` (4 lowercase hex chars)
 * - One-time pubkey: `P = B + t·G`, encoded as canonical `kvnc…dag`
 * - One-time spend scalar: `p = (b + t) mod L`, signs RFC 8032 Ed25519 sighashes
 */
import * as ed from "@noble/ed25519";
import { blake3 } from "@noble/hashes/blake3.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { ADDRESS_PREFIX, decodeAddress, encodeAddress } from "kovanica-sdk";

// Ensure @noble/ed25519 has synchronous SHA-512 configured in both browser & Node.
if (!ed.hashes.sha512) {
  ed.hashes.sha512 = sha512;
}

export const ED25519_L = (1n << 252n) + 27742317777372353535851937790883648493n;

const DOMAIN_TWEAK = new TextEncoder().encode("KVNC/stealth/tweak/v1");
const DOMAIN_TAG = new TextEncoder().encode("KVNC/stealth/tag/v1");
const DOMAIN_NONCE = new TextEncoder().encode("KVNC/stealth/nonce/v1");
const DOMAIN_SCAN_KEY = new TextEncoder().encode("KVNC/stealth/scan/v1");
const DOMAIN_SPEND_KEY = new TextEncoder().encode("KVNC/stealth/spend/v1");

export type StealthKeypair = {
  scanPrivkeyHex: string;
  scanPubkeyHex: string;
  spendPrivkeyHex: string;
  spendPubkeyHex: string;
  metaAddress: string;
};

export type StealthMetaAddress = {
  scanPubkeyHex: string;
  spendPubkeyHex: string;
  metaAddress: string;
};

export type StealthOnetime = {
  /** Canonical `kvnc…dag` one-time L1 address. */
  address: string;
  /** 64-char hex Ed25519 public key of the one-time L1 address. */
  addressHex: string;
  /** 64-char hex ephemeral public key `R = r·G` published by the sender. */
  ephemeralPubkeyHex: string;
  /** 4-char hex (2-byte) fast-filter view tag. */
  viewTag: string;
};

export type StealthAnnouncementInput = {
  ephemeralPubkeyHex: string;
  viewTag?: string;
  stealthAddress?: string;
  stealthAddressHex?: string;
};

export type StealthScanMatch =
  | { matched: true; address: string; addressHex: string; viewTag: string }
  | { matched: false; reason: string };

export type RecoveredOnetimeSpendKey = {
  oneTimeScalarHex: string;
  address: string;
  addressHex: string;
  viewTag: string;
};

// --- Low-level byte & scalar helpers ------------------------------------------

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, "");
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error("Invalid hex string");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToBigintLE(bytes: Uint8Array): bigint {
  let acc = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    acc = (acc << 8n) | BigInt(bytes[i]!);
  }
  return acc;
}

function bigintToBytes32LE(n: bigint): Uint8Array {
  let v = ((n % ED25519_L) + ED25519_L) % ED25519_L;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function reduceScalarModL(bytes: Uint8Array): bigint {
  const s = bytesToBigintLE(bytes) % ED25519_L;
  return s === 0n ? 1n : s;
}

export function parseScalarHex(hex: string, label: string): bigint {
  const clean = hex.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`${label} must be 64 hex characters (32 bytes)`);
  }
  const s = bytesToBigintLE(hexToBytes(clean)) % ED25519_L;
  if (s === 0n) {
    throw new Error(`${label} scalar cannot be zero`);
  }
  return s;
}

function parseValidPoint(hex: string, label: string): ed.Point {
  const clean = hex.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error(`${label} must be a 64-char hex Ed25519 public key`);
  }
  const pt = ed.Point.fromHex(clean);
  if (pt.is0() || pt.isSmallOrder()) {
    throw new Error(`${label} is an invalid or small-order curve point`);
  }
  return pt;
}

function randomScalar(): bigint {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const rnd = ed.etc.randomBytes(64);
    const s = bytesToBigintLE(rnd) % ED25519_L;
    if (s !== 0n) return s;
  }
  throw new Error("Failed to sample non-zero Ed25519 scalar");
}

function sharedSecretTweakAndTag(sharedPointBytes: Uint8Array): { tweak: bigint; viewTag: string } {
  const tweakDigest = blake3(concatBytes([DOMAIN_TWEAK, sharedPointBytes]));
  const tagDigest = blake3(concatBytes([DOMAIN_TAG, sharedPointBytes]));
  return {
    tweak: reduceScalarModL(tweakDigest),
    viewTag: bytesToHex(tagDigest.subarray(0, 2)),
  };
}

function parseAddressToHex(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed.replace(/^0x/i, "").toLowerCase();
  }
  try {
    return bytesToHex(decodeAddress(trimmed));
  } catch {
    return null;
  }
}

// --- Meta-Address & Keypair Helpers -------------------------------------------

export function formatStealthMetaAddress(scanPubkeyHex: string, spendPubkeyHex: string): string {
  const scan = parseValidPoint(scanPubkeyHex, "Scan pubkey").toHex();
  const spend = parseValidPoint(spendPubkeyHex, "Spend pubkey").toHex();
  return `st:kvnc:${scan}:${spend}`;
}

export function parseStealthMetaAddress(metaAddress: string): StealthMetaAddress {
  const trimmed = metaAddress.trim();
  const match = /^st:kvnc:([0-9a-fA-F]{64}):([0-9a-fA-F]{64})$/.exec(trimmed);
  if (!match) {
    throw new Error("Invalid stealth meta-address: expected st:kvnc:<64-hex-scan>:<64-hex-spend>");
  }
  const scanPubkeyHex = parseValidPoint(match[1]!, "Scan pubkey").toHex();
  const spendPubkeyHex = parseValidPoint(match[2]!, "Spend pubkey").toHex();
  return {
    scanPubkeyHex,
    spendPubkeyHex,
    metaAddress: `st:kvnc:${scanPubkeyHex}:${spendPubkeyHex}`,
  };
}

/** Generate a fresh random KVP-103 dual-key stealth keypair locally in the browser. */
export function generateStealthKeypair(): StealthKeypair {
  const scanScalar = randomScalar();
  const spendScalar = randomScalar();
  const scanPubkeyHex = ed.Point.BASE.multiply(scanScalar).toHex();
  const spendPubkeyHex = ed.Point.BASE.multiply(spendScalar).toHex();
  return {
    scanPrivkeyHex: bytesToHex(bigintToBytes32LE(scanScalar)),
    scanPubkeyHex,
    spendPrivkeyHex: bytesToHex(bigintToBytes32LE(spendScalar)),
    spendPubkeyHex,
    metaAddress: `st:kvnc:${scanPubkeyHex}:${spendPubkeyHex}`,
  };
}

/** Import an existing dual-key (scan/view + spend) stealth keypair from 64-hex scalars. */
export function importStealthKeypair(
  scanPrivkeyHex: string,
  spendPrivkeyHex: string,
): StealthKeypair {
  const scanScalar = parseScalarHex(scanPrivkeyHex, "Scan private key");
  const spendScalar = parseScalarHex(spendPrivkeyHex, "Spend private key");
  const scanPubkeyHex = ed.Point.BASE.multiply(scanScalar).toHex();
  const spendPubkeyHex = ed.Point.BASE.multiply(spendScalar).toHex();
  return {
    scanPrivkeyHex: bytesToHex(bigintToBytes32LE(scanScalar)),
    scanPubkeyHex,
    spendPrivkeyHex: bytesToHex(bigintToBytes32LE(spendScalar)),
    spendPubkeyHex,
    metaAddress: `st:kvnc:${scanPubkeyHex}:${spendPubkeyHex}`,
  };
}

/**
 * Deterministically derive KVP-103 stealth keys from a wallet mnemonic so
 * users can recover their stealth identity from their 12/24-word backup phrase.
 */
export function deriveStealthKeypairFromMnemonic(mnemonic: string): StealthKeypair {
  const norm = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
  if (norm.split(" ").filter(Boolean).length < 12) {
    throw new Error("Mnemonic must contain at least 12 words");
  }
  const phraseBytes = new TextEncoder().encode(norm);
  const scanScalar = reduceScalarModL(blake3(concatBytes([DOMAIN_SCAN_KEY, phraseBytes])));
  const spendScalar = reduceScalarModL(blake3(concatBytes([DOMAIN_SPEND_KEY, phraseBytes])));
  const scanPubkeyHex = ed.Point.BASE.multiply(scanScalar).toHex();
  const spendPubkeyHex = ed.Point.BASE.multiply(spendScalar).toHex();
  return {
    scanPrivkeyHex: bytesToHex(bigintToBytes32LE(scanScalar)),
    scanPubkeyHex,
    spendPrivkeyHex: bytesToHex(bigintToBytes32LE(spendScalar)),
    spendPubkeyHex,
    metaAddress: `st:kvnc:${scanPubkeyHex}:${spendPubkeyHex}`,
  };
}

// --- Sender: One-Time Stealth Address Derivation ------------------------------

/**
 * Derive a fresh, unlinkable one-time L1 address (`kvnc…dag`) for a recipient's
 * `st:kvnc:<scanPub>:<spendPub>` meta-address. Runs 100% client-side.
 */
export function deriveOnetimeAddress(
  metaAddress: string,
  ephemeralScalarOverride?: bigint,
): StealthOnetime {
  const { scanPubkeyHex, spendPubkeyHex } = parseStealthMetaAddress(metaAddress);
  const V = parseValidPoint(scanPubkeyHex, "Scan pubkey");
  const B = parseValidPoint(spendPubkeyHex, "Spend pubkey");

  const r = ephemeralScalarOverride ?? randomScalar();
  if (r <= 0n || r >= ED25519_L) {
    throw new Error("Ephemeral scalar must be in [1, L - 1]");
  }
  const R = ed.Point.BASE.multiply(r);
  const shared = V.multiply(r).toBytes();
  const { tweak, viewTag } = sharedSecretTweakAndTag(shared);

  const P = B.add(ed.Point.BASE.multiply(tweak));
  const pubBytes = P.toBytes();
  return {
    address: encodeAddress(pubBytes, ADDRESS_PREFIX),
    addressHex: bytesToHex(pubBytes),
    ephemeralPubkeyHex: R.toHex(),
    viewTag,
  };
}

// --- Recipient: Client-Side ECDH Scanning -------------------------------------

/**
 * Test a single public announcement `(R, viewTag, stealthAddress)` locally using
 * ONLY `(scanPrivkeyHex, spendPubkeyHex)`. Never requires the spend private key.
 */
export function matchStealthAnnouncement(
  scanPrivkeyHex: string,
  spendPubkeyHex: string,
  announcement: StealthAnnouncementInput,
): StealthScanMatch {
  const v = parseScalarHex(scanPrivkeyHex, "Scan private key");
  const B = parseValidPoint(spendPubkeyHex, "Spend public key");

  let R: ed.Point;
  try {
    R = parseValidPoint(announcement.ephemeralPubkeyHex, "Ephemeral pubkey");
  } catch {
    return { matched: false, reason: "Invalid or small-order ephemeral public key" };
  }

  const shared = R.multiply(v).toBytes();
  const { tweak, viewTag } = sharedSecretTweakAndTag(shared);

  const expectedTag = announcement.viewTag?.trim().toLowerCase();
  if (expectedTag && expectedTag !== viewTag) {
    return {
      matched: false,
      reason: `View tag mismatch (computed ${viewTag}, expected ${expectedTag})`,
    };
  }

  const P = B.add(ed.Point.BASE.multiply(tweak));
  const derivedBytes = P.toBytes();
  const derivedHex = bytesToHex(derivedBytes);

  const providedAddress = announcement.stealthAddressHex?.trim() || announcement.stealthAddress?.trim();
  if (providedAddress) {
    const expectedHex = parseAddressToHex(providedAddress);
    if (!expectedHex) {
      return { matched: false, reason: "Invalid stealth address format" };
    }
    if (expectedHex !== derivedHex) {
      return {
        matched: false,
        reason: "Derived one-time address does not match announcement stealth address",
      };
    }
  }

  return {
    matched: true,
    address: encodeAddress(derivedBytes, ADDRESS_PREFIX),
    addressHex: derivedHex,
    viewTag,
  };
}

// --- Recipient: One-Time Spend Key Derivation & RFC 8032 Scalar Signing -------

/**
 * Derive the one-time Ed25519 spend scalar `p = (b + t) mod L` and verify it
 * corresponds to the expected stealth address.
 */
export function deriveOnetimeSpendKey(params: {
  scanPrivkeyHex: string;
  spendPrivkeyHex: string;
  ephemeralPubkeyHex: string;
}): RecoveredOnetimeSpendKey {
  const v = parseScalarHex(params.scanPrivkeyHex, "Scan private key");
  const b = parseScalarHex(params.spendPrivkeyHex, "Spend private key");
  const R = parseValidPoint(params.ephemeralPubkeyHex, "Ephemeral pubkey");

  const shared = R.multiply(v).toBytes();
  const { tweak, viewTag } = sharedSecretTweakAndTag(shared);

  const p = (b + tweak) % ED25519_L;
  if (p === 0n) {
    throw new Error("Derived one-time scalar is zero");
  }
  const P = ed.Point.BASE.multiply(p);
  const pubBytes = P.toBytes();
  return {
    oneTimeScalarHex: bytesToHex(bigintToBytes32LE(p)),
    address: encodeAddress(pubBytes, ADDRESS_PREFIX),
    addressHex: bytesToHex(pubBytes),
    viewTag,
  };
}

/**
 * Sign a 32-byte L1 transaction sighash hex directly with a derived one-time
 * Ed25519 scalar `p` (RFC 8032 compatible — verifies under standard Ed25519).
 */
export function signSighashWithStealthScalar(
  oneTimeScalarHex: string,
  sighashHex: string,
): { signatureHex: string; publicKeyHex: string } {
  const p = parseScalarHex(oneTimeScalarHex, "One-time spend scalar");
  const msg = hexToBytes(sighashHex);
  const P = ed.Point.BASE.multiply(p);
  const pubBytes = P.toBytes();

  // Deterministic nonce derived from scalar + message (RFC 8032 style)
  const scalarBytes = bigintToBytes32LE(p);
  const noncePrefix = blake3(concatBytes([DOMAIN_NONCE, scalarBytes]));
  const r = reduceScalarModL(sha512(concatBytes([noncePrefix, msg])));
  const R = ed.Point.BASE.multiply(r).toBytes();

  const k = bytesToBigintLE(sha512(concatBytes([R, pubBytes, msg]))) % ED25519_L;
  const s = (r + k * p) % ED25519_L;

  const sig = concatBytes([R, bigintToBytes32LE(s)]);
  return {
    signatureHex: bytesToHex(sig),
    publicKeyHex: bytesToHex(pubBytes),
  };
}

/** Verify a KVP-103 stealth signature against standard RFC 8032 Ed25519 verification. */
export function verifyStealthSignature(
  signatureHex: string,
  sighashHex: string,
  publicKeyHex: string,
): boolean {
  try {
    const sig = hexToBytes(signatureHex);
    const msg = hexToBytes(sighashHex);
    const pub = hexToBytes(publicKeyHex);
    if (sig.length !== 64 || pub.length !== 32) return false;
    return ed.verify(sig, msg, pub);
  } catch {
    return false;
  }
}
