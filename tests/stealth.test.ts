import { describe, expect, it } from "vitest";
import {
  deriveOnetimeAddress,
  deriveOnetimeSpendKey,
  deriveStealthKeypairFromMnemonic,
  formatStealthMetaAddress,
  generateStealthKeypair,
  importStealthKeypair,
  matchStealthAnnouncement,
  parseStealthMetaAddress,
  signSighashWithStealthScalar,
  verifyStealthSignature,
} from "../src/stealth";

const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("KVP-103 Dual-Key Ed25519 Stealth Addresses", () => {
  it("generates a valid dual-key stealth keypair and formats/parses its meta-address", () => {
    const kp = generateStealthKeypair();
    expect(kp.scanPrivkeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(kp.scanPubkeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(kp.spendPrivkeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(kp.spendPubkeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(kp.metaAddress).toBe(`st:kvnc:${kp.scanPubkeyHex}:${kp.spendPubkeyHex}`);

    const parsed = parseStealthMetaAddress(kp.metaAddress);
    expect(parsed).toEqual({
      scanPubkeyHex: kp.scanPubkeyHex,
      spendPubkeyHex: kp.spendPubkeyHex,
      metaAddress: kp.metaAddress,
    });
    expect(formatStealthMetaAddress(kp.scanPubkeyHex, kp.spendPubkeyHex)).toBe(kp.metaAddress);
  });

  it("imports existing dual-key private scalars and reproduces the exact same keypair", () => {
    const kp = generateStealthKeypair();
    const imported = importStealthKeypair(kp.scanPrivkeyHex, kp.spendPrivkeyHex);
    expect(imported).toEqual(kp);
  });

  it("derives deterministic stealth keys from a 12-word mnemonic and rejects short phrases", () => {
    const kp1 = deriveStealthKeypairFromMnemonic(TEST_MNEMONIC);
    const kp2 = deriveStealthKeypairFromMnemonic(`  ${TEST_MNEMONIC.toUpperCase()}  `);
    expect(kp1).toEqual(kp2);
    expect(kp1.scanPubkeyHex).not.toBe(kp1.spendPubkeyHex);
    expect(() => deriveStealthKeypairFromMnemonic("only three words")).toThrow(/at least 12 words/i);
  });

  it("rejects invalid meta-addresses and small-order Ed25519 curve points", () => {
    expect(() => parseStealthMetaAddress("invalid")).toThrow(/Invalid stealth meta-address/i);
    // Identity point in Ed25519 compressed form (01 00 ... 00) is small-order
    const identityPointHex = "01" + "00".repeat(31);
    const valid = generateStealthKeypair();
    expect(() =>
      parseStealthMetaAddress(`st:kvnc:${identityPointHex}:${valid.spendPubkeyHex}`),
    ).toThrow(/small-order/i);
  });

  it("runs full sender -> watch-only scan -> spend key recovery -> RFC 8032 Ed25519 signing flow", () => {
    const recipient = deriveStealthKeypairFromMnemonic(TEST_MNEMONIC);
    const onetime = deriveOnetimeAddress(recipient.metaAddress, 42n);

    expect(onetime.address).toMatch(/^kvnc[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{57}dag$/);
    expect(onetime.addressHex).toMatch(/^[0-9a-f]{64}$/);
    expect(onetime.ephemeralPubkeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(onetime.viewTag).toMatch(/^[0-9a-f]{4}$/);

    // Distinct ephemeral scalars yield distinct unlinkable one-time addresses
    const onetime2 = deriveOnetimeAddress(recipient.metaAddress, 43n);
    expect(onetime2.address).not.toBe(onetime.address);
    expect(onetime2.ephemeralPubkeyHex).not.toBe(onetime.ephemeralPubkeyHex);

    // Watch-only scan uses ONLY scanPrivkeyHex + spendPubkeyHex (no spendPrivkeyHex)
    const match = matchStealthAnnouncement(recipient.scanPrivkeyHex, recipient.spendPubkeyHex, {
      ephemeralPubkeyHex: onetime.ephemeralPubkeyHex,
      viewTag: onetime.viewTag,
      stealthAddress: onetime.address,
    });
    expect(match.matched).toBe(true);
    if (match.matched) {
      expect(match.address).toBe(onetime.address);
      expect(match.addressHex).toBe(onetime.addressHex);
      expect(match.viewTag).toBe(onetime.viewTag);
    }

    // Recover one-time spend scalar p = (b + t) mod L
    const recovered = deriveOnetimeSpendKey({
      scanPrivkeyHex: recipient.scanPrivkeyHex,
      spendPrivkeyHex: recipient.spendPrivkeyHex,
      ephemeralPubkeyHex: onetime.ephemeralPubkeyHex,
    });
    expect(recovered.address).toBe(onetime.address);
    expect(recovered.addressHex).toBe(onetime.addressHex);
    expect(recovered.viewTag).toBe(onetime.viewTag);

    // Sign a 32-byte L1 sighash and verify with standard RFC 8032 Ed25519
    const sighashHex = "ab".repeat(32);
    const { signatureHex, publicKeyHex } = signSighashWithStealthScalar(
      recovered.oneTimeScalarHex,
      sighashHex,
    );
    expect(publicKeyHex).toBe(onetime.addressHex);
    expect(verifyStealthSignature(signatureHex, sighashHex, publicKeyHex)).toBe(true);
    expect(verifyStealthSignature(signatureHex, "cd".repeat(32), publicKeyHex)).toBe(false);
  });

  it("rejects announcements with mismatched view tag, wrong address, wrong view key, or invalid point", () => {
    const alice = generateStealthKeypair();
    const bob = generateStealthKeypair();
    const onetime = deriveOnetimeAddress(alice.metaAddress);

    // Wrong view tag
    const wrongTag = onetime.viewTag === "0000" ? "ffff" : "0000";
    const badTagRes = matchStealthAnnouncement(alice.scanPrivkeyHex, alice.spendPubkeyHex, {
      ephemeralPubkeyHex: onetime.ephemeralPubkeyHex,
      viewTag: wrongTag,
      stealthAddress: onetime.address,
    });
    expect(badTagRes.matched).toBe(false);

    // Wrong recipient view key
    const bobScan = matchStealthAnnouncement(bob.scanPrivkeyHex, bob.spendPubkeyHex, {
      ephemeralPubkeyHex: onetime.ephemeralPubkeyHex,
      viewTag: onetime.viewTag,
      stealthAddress: onetime.address,
    });
    expect(bobScan.matched).toBe(false);

    // Wrong stealth address
    const otherAddr = deriveOnetimeAddress(alice.metaAddress).address;
    const wrongAddrRes = matchStealthAnnouncement(alice.scanPrivkeyHex, alice.spendPubkeyHex, {
      ephemeralPubkeyHex: onetime.ephemeralPubkeyHex,
      viewTag: onetime.viewTag,
      stealthAddress: otherAddr,
    });
    expect(wrongAddrRes.matched).toBe(false);

    // Invalid ephemeral pubkey
    const badEphRes = matchStealthAnnouncement(alice.scanPrivkeyHex, alice.spendPubkeyHex, {
      ephemeralPubkeyHex: "zz".repeat(32),
    });
    expect(badEphRes.matched).toBe(false);
  });
});
