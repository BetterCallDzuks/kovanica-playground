import { describe, expect, it } from "vitest";
import { CHAIN_IDS, KOVANICA_COIN_TYPE } from "kovanica-sdk";
import * as ed from "@noble/ed25519";
import {
  buildTokenTransferCall,
  buildVaultCreateCall,
  deriveAccountsFromMnemonic,
  formatAddressForChain,
  generateMnemonic,
  hexToBytes,
  runGoldenVectorSelfTest,
  signAndSerializeTransaction,
  validateMnemonic,
  type UnsignedTx,
} from "../src/wallet-interop";

describe("Ecosystem HD Wallet & Wasmi Contract Interoperability (PRO-53, PRO-48)", () => {
  const goldenMnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const goldenPubkey =
    "862f70cfafc9b581699f8d67598eac699cbc92bdfc940e95ed7ee1e8d8100e7e";
  const goldenCanonicalAddr =
    "kvncschhpna0ex6cz6vl34n4nr4vdxwtey4alj2qa90d0ms73kqspel0nuhe8dag";
  const goldenTestnetAddr =
    "tkncschhpna0ex6cz6vl34n4nr4vdxwtey4alj2qa90d0ms73kqspel0nuhe8dag";

  describe("Mnemonic Generation & Multi-Account Derivation", () => {
    it("generates and validates 24-word BIP-39 mnemonic", () => {
      const phrase = generateMnemonic(256);
      expect(validateMnemonic(phrase)).toBe(true);
      expect(phrase.trim().split(/\s+/).length).toBe(24);
    });

    it("derives Account #0 matching the official golden test vector for coin type 3007", () => {
      expect(KOVANICA_COIN_TYPE).toBe(3007);
      const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.MAINNET);
      const acc0 = accounts[0];

      expect(acc0.accountIndex).toBe(0);
      expect(acc0.path).toBe("m/44'/3007'/0'/0'/0'");
      expect(acc0.publicKeyHex).toBe(goldenPubkey);
      expect(acc0.mainnetAddress).toBe(goldenCanonicalAddr);
      expect(acc0.testnetAddress).toBe(goldenTestnetAddr);
      expect(acc0.address).toBe(goldenCanonicalAddr);
    });

    it("derives Account #1 with path m/44'/3007'/1'/0'/0' and distinct keys", () => {
      const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
      const acc0 = accounts[0];
      const acc1 = accounts[1];

      expect(acc1.accountIndex).toBe(1);
      expect(acc1.path).toBe("m/44'/3007'/1'/0'/0'");
      expect(acc1.publicKeyHex).not.toBe(acc0.publicKeyHex);
      expect(acc1.address).toBe(acc1.testnetAddress);
      expect(acc1.testnetAddress.startsWith("tknc")).toBe(true);
      expect(acc1.mainnetAddress.startsWith("kvnc")).toBe(true);
    });

    it("formats addresses dynamically according to chain ID", () => {
      expect(formatAddressForChain(goldenCanonicalAddr, CHAIN_IDS.MAINNET)).toBe(goldenCanonicalAddr);
      expect(formatAddressForChain(goldenCanonicalAddr, CHAIN_IDS.TESTNET)).toBe(goldenTestnetAddr);
      expect(formatAddressForChain(goldenTestnetAddr, CHAIN_IDS.MAINNET)).toBe(goldenCanonicalAddr);
    });
  });

  describe("Transaction Signing & Canonical KVNC/tx/v1 Domain Tag", () => {
    it("signs a transfer transaction and validates Ed25519 signature", () => {
      const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
      const sender = accounts[0];
      const recipient = accounts[1];

      const tx: UnsignedTx = {
        sender: sender.publicKey,
        nonce: 42n,
        kind: {
          type: "transfer",
          to: recipient.publicKey,
          amount: 50_000_000n,
        },
        fee: 10_000n,
      };

      const signed = signAndSerializeTransaction(tx, sender.secretKey, CHAIN_IDS.TESTNET);

      expect(signed.sighash.length).toBe(32);
      expect(signed.signature.length).toBe(64);
      expect(ed.verify(signed.signature, signed.sighash, sender.publicKey)).toBe(true);

      // Bincode wire serialization begins with sender (32 bytes) + nonce (8 bytes u64le)
      expect(signed.rawTxHex.startsWith(sender.publicKeyHex)).toBe(true);
      // Transfer wire enum tag is 0u32 (00000000)
      const wireSlice = signed.rawTxHex.slice(64 + 16, 64 + 16 + 8);
      expect(wireSlice).toBe("00000000");
    });
  });

  describe("Wasmi Smart Contract Invocation", () => {
    it("constructs and signs a token_transfer smart contract call (wire tag 6)", () => {
      const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
      const sender = accounts[0];
      const recipient = accounts[1];
      const contract = hexToBytes("44".repeat(32));

      const tokenCall = buildTokenTransferCall(contract, recipient.publicKey, 1_000_000n);
      expect(tokenCall.type).toBe("call");
      expect(tokenCall.method).toBe("token_transfer");

      const tx: UnsignedTx = {
        sender: sender.publicKey,
        nonce: 100n,
        kind: tokenCall,
        fee: 25_000n,
      };

      const signed = signAndSerializeTransaction(tx, sender.secretKey, CHAIN_IDS.TESTNET);
      expect(ed.verify(signed.signature, signed.sighash, sender.publicKey)).toBe(true);

      // Call wire enum tag is 6u32 (06000000)
      const wireSlice = signed.rawTxHex.slice(64 + 16, 64 + 16 + 8);
      expect(wireSlice).toBe("06000000");
    });

    it("constructs and signs a vault_create smart contract call", () => {
      const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
      const sender = accounts[0];
      const beneficiary = accounts[1];
      const contract = hexToBytes("55".repeat(32));

      const vaultCall = buildVaultCreateCall(
        contract,
        beneficiary.publicKey,
        500_000_000n,
        1740000000000n,
      );
      expect(vaultCall.method).toBe("vault_create");

      const tx: UnsignedTx = {
        sender: sender.publicKey,
        nonce: 101n,
        kind: vaultCall,
        fee: 30_000n,
      };

      const signed = signAndSerializeTransaction(tx, sender.secretKey, CHAIN_IDS.TESTNET);
      expect(ed.verify(signed.signature, signed.sighash, sender.publicKey)).toBe(true);
      expect(signed.rawTxBytes.length).toBeGreaterThan(150);
    });

    it("passes all steps in runGoldenVectorSelfTest()", () => {
      const result = runGoldenVectorSelfTest();
      expect(result.ok).toBe(true);
      expect(result.steps.length).toBeGreaterThanOrEqual(6);
      for (const step of result.steps) {
        expect(step.passed).toBe(true);
      }
    });
  });
});
