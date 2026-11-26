/**
 * KVP-103 / RFC-003 — Client-Side Dual-Key Stealth Addresses on Ed25519.
 *
 * Re-exports the canonical KVP-103 stealth primitives directly from `kovanica-sdk`
 * (v0.10.0+) and provides thin playground-specific UI/verification helpers
 * (`parseScalarHex`, `importStealthKeypair`, `verifyStealthSignature`).
 */
import * as ed from "@noble/ed25519";
import {
  type StealthAnnouncementMatch,
  type StealthKeypair,
  type StealthSpendKey,
  bytesToHex,
  formatStealthMetaAddress,
  hexToBytes,
  verifyEd25519,
} from "kovanica-sdk";

export {
  STEALTH_DOMAIN_NONCE,
  STEALTH_DOMAIN_SCAN_KEY,
  STEALTH_DOMAIN_SPEND_KEY,
  STEALTH_DOMAIN_TAG,
  STEALTH_DOMAIN_TWEAK,
  STEALTH_META_ADDRESS_PREFIX,
  type DeriveOnetimeAddressOptions,
  type DeriveOnetimeSpendKeyParams,
  type ScanStealthAnnouncementsParams,
  type StealthAnnouncementInput,
  type StealthAnnouncementMatch,
  type StealthKeypair,
  type StealthMatchedAnnouncement,
  type StealthMetaAddress,
  type StealthOnetime,
  type StealthSignature,
  type StealthSpendKey,
  createStealthMeta,
  deriveOnetimeAddress,
  deriveOnetimeSpendKey,
  deriveStealthKeypairFromMnemonic,
  formatStealthMetaAddress,
  generateStealthKeypair,
  isValidStealthMetaAddress,
  matchStealthAnnouncement,
  parseStealthMetaAddress,
  scanStealthAnnouncements,
  signSighashWithStealthScalar,
} from "kovanica-sdk";

export type StealthScanMatch = StealthAnnouncementMatch;
export type RecoveredOnetimeSpendKey = StealthSpendKey;

export const ED25519_L = (1n << 252n) + 27742317777372353535851937790883648493n;

// --- Thin Playground-Specific UI & Verification Helpers -----------------------

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

/** Parse and validate a 64-hex (32-byte) non-zero Ed25519 scalar for UI input overrides. */
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
    metaAddress: formatStealthMetaAddress(scanPubkeyHex, spendPubkeyHex),
  };
}

/** Verify a hex-encoded KVP-103 stealth signature against standard RFC 8032 Ed25519 via `kovanica-sdk`. */
export function verifyStealthSignature(
  signatureHex: string,
  sighashHex: string,
  publicKeyHex: string,
): boolean {
  try {
    const cleanSig = signatureHex.trim().replace(/^0x/i, "");
    const cleanMsg = sighashHex.trim().replace(/^0x/i, "");
    const cleanPub = publicKeyHex.trim().replace(/^0x/i, "");
    if (
      !/^[0-9a-fA-F]{128}$/.test(cleanSig) ||
      !/^[0-9a-fA-F]{64}$/.test(cleanPub) ||
      cleanMsg.length === 0 ||
      cleanMsg.length % 2 !== 0 ||
      !/^[0-9a-fA-F]+$/.test(cleanMsg)
    ) {
      return false;
    }
    return verifyEd25519(hexToBytes(cleanSig), hexToBytes(cleanMsg), hexToBytes(cleanPub));
  } catch {
    return false;
  }
}
