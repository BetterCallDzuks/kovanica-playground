import { describe, expect, it } from "vitest";
import { CHAIN_IDS, KOVANICA_COIN_TYPE } from "kovanica-sdk";
import * as ed from "@noble/ed25519";
import {
  buildEscrowCreateCall,
  buildEscrowCreateCallTx,
  buildHtlcCreateCall,
  buildHtlcCreateCallTx,
  buildNameRegisterCall,
  buildNameRegisterCallTx,
  buildNftMintCall,
  buildNftMintCallTx,
  buildPlaygroundCallCurlSnippet,
  buildPlaygroundCallSdkSnippet,
  buildTokenTransferCall,
  buildVaultCreateCall,
  bytesToHex,
  concat,
  decodeContractLog,
  decodeContractStateHex,
  decodeTransactionReceiptLogs,
  deriveAccountsFromMnemonic,
  deriveContractStorageSlotHex,
  derivePrefixedStorageSlot,
  deriveStorageSlotHex,
  encodeBincodeBytes32Vec,
  encodeBincodeString,
  encodeBincodeStringVec,
  estimateBatchCalls,
  estimateContractCall,
  estimateContractCallBatch,
  fetchAndDecodeContractStorageSlot,
  formatAddressForChain,
  generateMnemonic,
  hexToBytes,
  isStorageSlotEmpty,
  KovanicaDecodeError,
  pollAndDecodeTransactionReceipt,
  runGoldenVectorSelfTest,
  signAndSerializeTransaction,
  u128le,
  u32le,
  u64le,
  validateMnemonic,
  waitForTransactionReceipt,
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

    it("serializes Bincode strings and vectors deterministically", () => {
      const strEnc = encodeBincodeString("alice");
      expect(strEnc.length).toBe(8 + 5);
      // Length prefix is 5 (u64le: 05 00 00 00 00 00 00 00)
      expect(Array.from(strEnc.slice(0, 8))).toEqual([5, 0, 0, 0, 0, 0, 0, 0]);
      expect(new TextDecoder().decode(strEnc.slice(8))).toBe("alice");

      const strVecEnc = encodeBincodeStringVec(["a", "bc"]);
      // Count prefix is 2
      expect(Array.from(strVecEnc.slice(0, 8))).toEqual([2, 0, 0, 0, 0, 0, 0, 0]);
      // First string: 8 bytes len + 1 byte "a" = 9 bytes
      // Second string: 8 bytes len + 2 bytes "bc" = 10 bytes
      expect(strVecEnc.length).toBe(8 + 9 + 10);

      const pk1 = hexToBytes("11".repeat(32));
      const pk2 = hexToBytes("22".repeat(32));
      const bytesVecEnc = encodeBincodeBytes32Vec([pk1, pk2]);
      expect(Array.from(bytesVecEnc.slice(0, 8))).toEqual([2, 0, 0, 0, 0, 0, 0, 0]);
      expect(bytesVecEnc.length).toBe(8 + 32 + 32);
    });

    it("constructs and signs a name_register smart contract call (String, [u8; 32], Vec<String>)", () => {
      const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
      const sender = accounts[0];
      const targetPubkey = accounts[1].publicKey;
      const contract = hexToBytes("36".repeat(32));
      const endpoints = ["https://relay1.kovanica.org", "https://relay2.kovanica.org"];

      const args = buildNameRegisterCall("alice", targetPubkey, endpoints);
      expect(args instanceof Uint8Array).toBe(true);

      // Verify layout: 8 (len 'alice') + 5 ('alice') + 32 (pubkey) + 8 (vec len 2) + (8 + 27) + (8 + 27) = 115
      const expectedLen = 8 + 5 + 32 + 8 + (8 + "https://relay1.kovanica.org".length) + (8 + "https://relay2.kovanica.org".length);
      expect(args.length).toBe(expectedLen);

      // Name length prefix is 5
      expect(Array.from(args.slice(0, 8))).toEqual([5, 0, 0, 0, 0, 0, 0, 0]);
      // Name bytes
      expect(new TextDecoder().decode(args.slice(8, 13))).toBe("alice");
      // Pubkey at offset 13
      expect(args.slice(13, 13 + 32)).toEqual(targetPubkey);

      // Sign transaction
      const nameCallTx = buildNameRegisterCallTx(contract, "alice", targetPubkey, endpoints);
      expect(nameCallTx.method).toBe("name_register");
      expect(nameCallTx.args).toEqual(args);

      const tx: UnsignedTx = {
        sender: sender.publicKey,
        nonce: 102n,
        kind: nameCallTx,
        fee: 35_000n,
      };

      const signed = signAndSerializeTransaction(tx, sender.secretKey, CHAIN_IDS.TESTNET);
      expect(ed.verify(signed.signature, signed.sighash, sender.publicKey)).toBe(true);
      expect(signed.rawTxHex.includes("06000000")).toBe(true); // Call wire tag 6
    });

    it("constructs and signs an htlc_create smart contract call ([u8; 32], u64, [u8; 32])", () => {
      const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
      const sender = accounts[0];
      const recipient = accounts[1].publicKey;
      const contract = hexToBytes("44".repeat(32));
      const hashlock = hexToBytes("ab".repeat(32));
      const timelock = 1750000000n;

      const args = buildHtlcCreateCall(hashlock, timelock, recipient);
      // Exact length: 32 + 8 + 32 = 72 bytes
      expect(args.length).toBe(72);
      expect(args.slice(0, 32)).toEqual(hashlock);
      // Timelock u64le at offset 32..40
      const view = new DataView(args.buffer, args.byteOffset + 32, 8);
      expect(view.getBigUint64(0, true)).toBe(timelock);
      expect(args.slice(40, 72)).toEqual(recipient);

      // Build call transaction
      const htlcCallTx = buildHtlcCreateCallTx(contract, hashlock, timelock, recipient);
      expect(htlcCallTx.method).toBe("htlc_create");
      expect(htlcCallTx.args).toEqual(args);

      const tx: UnsignedTx = {
        sender: sender.publicKey,
        nonce: 103n,
        kind: htlcCallTx,
        fee: 25_000n,
      };

      const signed = signAndSerializeTransaction(tx, sender.secretKey, CHAIN_IDS.TESTNET);
      expect(ed.verify(signed.signature, signed.sighash, sender.publicKey)).toBe(true);
    });

    it("constructs and signs an nft_mint smart contract call ([u8; 32], [u8; 32], u128, String)", () => {
      const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
      const sender = accounts[0];
      const recipient = accounts[1].publicKey;
      const contract = hexToBytes("55".repeat(32));
      const collection = hexToBytes("cc".repeat(32));
      const tokenId = 42n;
      const tokenUri = "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

      const args = buildNftMintCall(collection, recipient, tokenId, tokenUri);
      // Expected length: 32 + 32 + 16 + 8 + len(tokenUri) = 88 + 66 = 154
      expect(args.length).toBe(88 + tokenUri.length);
      expect(args.slice(0, 32)).toEqual(collection);
      expect(args.slice(32, 64)).toEqual(recipient);
      // u128le token id at 64..80
      const lowView = new DataView(args.buffer, args.byteOffset + 64, 8);
      expect(lowView.getBigUint64(0, true)).toBe(42n);
      // String length prefix at 80..88
      const strLenView = new DataView(args.buffer, args.byteOffset + 80, 8);
      expect(strLenView.getBigUint64(0, true)).toBe(BigInt(tokenUri.length));
      expect(new TextDecoder().decode(args.slice(88))).toBe(tokenUri);

      // Build call transaction
      const nftCallTx = buildNftMintCallTx(contract, collection, recipient, tokenId, tokenUri);
      expect(nftCallTx.method).toBe("nft_mint");
      expect(nftCallTx.args).toEqual(args);

      const tx: UnsignedTx = {
        sender: sender.publicKey,
        nonce: 104n,
        kind: nftCallTx,
        fee: 30_000n,
      };

      const signed = signAndSerializeTransaction(tx, sender.secretKey, CHAIN_IDS.TESTNET);
      expect(ed.verify(signed.signature, signed.sighash, sender.publicKey)).toBe(true);
    });

    it("constructs and signs an escrow_create smart contract call (Vec<[u8; 32]>, u8, u64, u64)", () => {
      const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
      const sender = accounts[0];
      const parties = [accounts[0].publicKey, accounts[1].publicKey];
      const contract = hexToBytes("66".repeat(32));
      const threshold = 2;
      const amount = 500_000_000n;
      const deadline = 1750000000n;

      const args = buildEscrowCreateCall(parties, threshold, amount, deadline);
      // Expected length: 8 (count) + 64 (2*32) + 1 (threshold) + 8 (amount) + 8 (deadline) = 89
      expect(args.length).toBe(89);
      expect(Array.from(args.slice(0, 8))).toEqual([2, 0, 0, 0, 0, 0, 0, 0]);
      expect(args.slice(8, 40)).toEqual(parties[0]);
      expect(args.slice(40, 72)).toEqual(parties[1]);
      expect(args[72]).toBe(2);

      const amountView = new DataView(args.buffer, args.byteOffset + 73, 8);
      expect(amountView.getBigUint64(0, true)).toBe(amount);
      const deadlineView = new DataView(args.buffer, args.byteOffset + 81, 8);
      expect(deadlineView.getBigUint64(0, true)).toBe(deadline);

      // Invalid threshold
      expect(() => buildEscrowCreateCall(parties, 300, amount, deadline)).toThrow(/Threshold must be between 0 and 255/);

      // Build call transaction
      const escrowCallTx = buildEscrowCreateCallTx(contract, parties, threshold, amount, deadline);
      expect(escrowCallTx.method).toBe("escrow_create");
      expect(escrowCallTx.args).toEqual(args);

      const tx: UnsignedTx = {
        sender: sender.publicKey,
        nonce: 105n,
        kind: escrowCallTx,
        fee: 40_000n,
      };

      const signed = signAndSerializeTransaction(tx, sender.secretKey, CHAIN_IDS.TESTNET);
      expect(ed.verify(signed.signature, signed.sighash, sender.publicKey)).toBe(true);
    });

    it("rejects invalid arguments gracefully in builders", () => {
      const valid32 = hexToBytes("11".repeat(32));
      const invalidShort = new Uint8Array(16);

      expect(() => buildNameRegisterCall("bob", invalidShort, [])).toThrow(/Expected 32-byte pubkey/);
      expect(() => buildHtlcCreateCall(invalidShort, 100n, valid32)).toThrow(/Expected 32-byte hashlock/);
      expect(() => buildHtlcCreateCall(valid32, 100n, invalidShort)).toThrow(/Expected 32-byte recipient/);
      expect(() => buildNftMintCall(invalidShort, valid32, 1n, "uri")).toThrow(/Expected 32-byte collection/);
      expect(() => buildNftMintCall(valid32, invalidShort, 1n, "uri")).toThrow(/Expected 32-byte to pubkey/);
      expect(() => encodeBincodeBytes32Vec([valid32, invalidShort])).toThrow(/Expected 32-byte item/);
    });

    it("passes all steps in runGoldenVectorSelfTest()", () => {
      const result = runGoldenVectorSelfTest();
      expect(result.ok).toBe(true);
      expect(result.steps.length).toBeGreaterThanOrEqual(10);
      for (const step of result.steps) {
        expect(step.passed).toBe(true);
      }
    });
  });

  describe("SDK v0.4.0 Fee Estimation & Typed Bincode State Decoders", () => {
    it("estimates fee, wire size, gas limit, and nonce via estimateContractCall (estimateAndBuildCall)", async () => {
      const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
      const contract = hexToBytes("33".repeat(32));
      const call = buildNameRegisterCallTx(
        contract,
        "alice",
        accounts[1].publicKey,
        ["https://relay1.kovanica.org"],
      );

      const mockClient = {
        estimateFee: async () => 25n,
        getNonce: async () => 7n,
      };

      const prepared = await estimateContractCall(mockClient, call, {
        sender: accounts[0].testnetAddress,
        chainId: CHAIN_IDS.TESTNET,
      });

      expect(prepared.nonce).toBe(7n);
      expect(prepared.feeRatePerByte).toBe(25n);
      expect(prepared.chainId).toBe(CHAIN_IDS.TESTNET);
      expect(prepared.gasLimit).toBe(100_000n);
      expect(prepared.estimatedTxSize).toBeGreaterThan(152);

      // Verify exact fee math (+20% ceil safety margin over feeRatePerByte * estimatedTxSize)
      const baseFee = 25n * BigInt(prepared.estimatedTxSize);
      const expectedFee = (baseFee * 12_000n + 9_999n) / 10_000n;
      expect(prepared.fee).toBe(expectedFee);

      // Verify wire size matches signed transaction byte-for-byte
      const signed = signAndSerializeTransaction(
        {
          sender: accounts[0].publicKey,
          nonce: prepared.nonce!,
          kind: call,
          fee: prepared.fee,
        },
        accounts[0].secretKey,
        CHAIN_IDS.TESTNET,
      );
      expect(prepared.estimatedTxSize).toBe(signed.txSize);
    });

    it("decodes a NameRecord from hex and derives canonical BLAKE3 storage slots", () => {
      const owner = hexToBytes("aa".repeat(32));
      const pubkey = hexToBytes("bb".repeat(32));
      // NameEntry layout: (owner: [u8;32], pubkey: [u8;32], relay_endpoints: Vec<String>)
      const encoded = concat([
        owner,
        pubkey,
        encodeBincodeStringVec(["https://relay.kovanica.org"]),
      ]);

      const decoded = decodeContractStateHex("name", `0x${bytesToHex(encoded)}`) as {
        owner: Uint8Array;
        ownerHex: string;
        pubkey: Uint8Array;
        pubkeyHex: string;
        relayEndpoints: string[];
      };

      expect(decoded.owner).toEqual(owner);
      expect(decoded.ownerHex).toBe("aa".repeat(32));
      expect(decoded.pubkey).toEqual(pubkey);
      expect(decoded.pubkeyHex).toBe("bb".repeat(32));
      expect(decoded.relayEndpoints).toEqual(["https://relay.kovanica.org"]);

      const slotHex = deriveStorageSlotHex("name", "alice");
      expect(slotHex).toMatch(/^[0-9a-f]{64}$/);
    });

    it("fails closed with KovanicaDecodeError on truncated or malformed Bincode input", () => {
      expect(() => decodeContractStateHex("htlc", "0xdeadbeef")).toThrow(KovanicaDecodeError);
      expect(() => decodeContractStateHex("name", "0xzzzz")).toThrow(KovanicaDecodeError);
    });

    it("derives canonical BLAKE3 storage slots across all contract types and custom prefixes", () => {
      const id32Hex = "ab".repeat(32);

      // Canonical record types
      expect(deriveContractStorageSlotHex({ kind: "name", key: "Alice" })).toBe(
        deriveStorageSlotHex("name", "alice"),
      );
      expect(deriveContractStorageSlotHex({ kind: "htlc", key: id32Hex })).toBe(
        deriveStorageSlotHex("htlc", id32Hex),
      );
      expect(deriveContractStorageSlotHex({ kind: "escrow", key: id32Hex })).toBe(
        deriveStorageSlotHex("escrow", id32Hex),
      );
      expect(deriveContractStorageSlotHex({ kind: "vault", key: id32Hex })).toBe(
        deriveStorageSlotHex("vault", id32Hex),
      );
      expect(deriveContractStorageSlotHex({ kind: "token_metadata" })).toBe(
        deriveStorageSlotHex("token"),
      );
      expect(deriveContractStorageSlotHex({ kind: "nft_metadata" })).toBe(
        deriveStorageSlotHex("nft"),
      );
      expect(deriveContractStorageSlotHex({ kind: "multisig" })).toBe(
        deriveStorageSlotHex("multisig"),
      );

      // Custom prefix + key via derivePrefixedStorageSlot
      const customNameSlot = deriveContractStorageSlotHex({
        kind: "name",
        customPrefix: "kvnc/v1/name/",
        key: "alice",
      });
      expect(customNameSlot).toBe(
        bytesToHex(derivePrefixedStorageSlot("kvnc/v1/name/", "alice")),
      );
      expect(customNameSlot).toBe(deriveStorageSlotHex("name", "alice"));

      // Custom prefix with 32-byte hex key
      const customHtlcSlot = deriveContractStorageSlotHex({
        kind: "htlc",
        customPrefix: "kvnc/v1/htlc/",
        key: `0x${id32Hex}`,
      });
      expect(customHtlcSlot).toBe(
        bytesToHex(derivePrefixedStorageSlot("kvnc/v1/htlc/", hexToBytes(id32Hex))),
      );
      expect(customHtlcSlot).toBe(deriveStorageSlotHex("htlc", id32Hex));

      // Custom singleton prefix without key
      const customSingletonSlot = deriveContractStorageSlotHex({
        kind: "token_metadata",
        customPrefix: "kvnc/v1/pool",
        key: "",
      });
      expect(customSingletonSlot).toBe(
        bytesToHex(derivePrefixedStorageSlot("kvnc/v1/pool")),
      );
    });

    it("fetches and decodes live contract storage slots across all 7 decoder types via kovanica_getStorageAt", async () => {
      const contractAddress = "0x" + "33".repeat(32);
      const pkA = hexToBytes("aa".repeat(32));
      const pkB = hexToBytes("bb".repeat(32));

      // 1. NameRecord
      const nameBytes = concat([
        pkA,
        pkB,
        encodeBincodeStringVec(["https://relay1.kovanica.org"]),
      ]);
      const expectedNameSlot = deriveStorageSlotHex("name", "alice");
      let capturedAddr = "";
      let capturedSlot = "";

      const nameRes = await fetchAndDecodeContractStorageSlot(
        {
          getStorageAt: async (addr, slot) => {
            capturedAddr = addr;
            capturedSlot = slot;
            return `0x${bytesToHex(nameBytes)}`;
          },
        },
        {
          contractAddress,
          kind: "name",
          key: "alice",
        },
      );
      expect(capturedAddr).toBe(contractAddress);
      expect(capturedSlot).toBe(`0x${expectedNameSlot}`);
      expect(nameRes.slotHex).toBe(expectedNameSlot);
      expect(nameRes.isEmpty).toBe(false);
      expect(nameRes.rawStorageHex).toBe(`0x${bytesToHex(nameBytes)}`);
      expect((nameRes.decoded as any).ownerHex).toBe("aa".repeat(32));
      expect((nameRes.decoded as any).relayEndpoints).toEqual(["https://relay1.kovanica.org"]);

      // 2. HtlcRecord (via fallback client.call("kovanica_getStorageAt", ...))
      const hashLock = hexToBytes("cc".repeat(32));
      const htlcBytes = concat([
        pkA,
        pkB,
        u128le(500_000_000n),
        hashLock,
        u64le(1750000000n),
        Uint8Array.of(1), // claimed = true
        Uint8Array.of(0), // refunded = false
      ]);
      const htlcIdHex = "11".repeat(32);
      const htlcRes = await fetchAndDecodeContractStorageSlot(
        {
          call: async (method, params) => {
            expect(method).toBe("kovanica_getStorageAt");
            expect(params).toEqual([
              contractAddress,
              `0x${deriveStorageSlotHex("htlc", htlcIdHex)}`,
            ]);
            return `0x${bytesToHex(htlcBytes)}` as any;
          },
        },
        {
          contractAddress,
          kind: "htlc",
          key: htlcIdHex,
        },
      );
      expect(htlcRes.isEmpty).toBe(false);
      expect((htlcRes.decoded as any).amount).toBe(500_000_000n);
      expect((htlcRes.decoded as any).status).toBe("claimed");

      // 3. EscrowRecord
      const escrowIdHex = "22".repeat(32);
      const escrowBytes = concat([
        pkA,
        encodeBincodeBytes32Vec([pkA, pkB]),
        Uint8Array.of(2),
        encodeBincodeBytes32Vec([pkA]),
        u128le(1_000_000_000n),
        u64le(1760000000n),
        Uint8Array.of(0),
        Uint8Array.of(0),
      ]);
      const escrowRes = await fetchAndDecodeContractStorageSlot(
        { getStorageAt: async () => `0x${bytesToHex(escrowBytes)}` },
        { contractAddress, kind: "escrow", key: escrowIdHex },
      );
      expect(escrowRes.isEmpty).toBe(false);
      expect((escrowRes.decoded as any).threshold).toBe(2);
      expect((escrowRes.decoded as any).status).toBe("open");

      // 4. VaultRecord (Absolute schedule variant 0)
      const vaultIdHex = "44".repeat(32);
      const vaultBytes = concat([
        pkA,
        pkB,
        u128le(10_000_000_000n),
        u128le(2_000_000_000n),
        u32le(0),
        u64le(1800000000n),
        Uint8Array.of(0),
      ]);
      const vaultRes = await fetchAndDecodeContractStorageSlot(
        { getStorageAt: async () => `0x${bytesToHex(vaultBytes)}` },
        { contractAddress, kind: "vault", key: vaultIdHex },
      );
      expect(vaultRes.isEmpty).toBe(false);
      expect((vaultRes.decoded as any).totalAmount).toBe(10_000_000_000n);
      expect((vaultRes.decoded as any).schedule).toEqual({
        kind: "absolute",
        unlockAt: 1800000000n,
      });

      // 5. TokenMetadata
      const tokenBytes = concat([
        encodeBincodeString("Kovanica USD"),
        encodeBincodeString("KUSD"),
        Uint8Array.of(6),
        u128le(1_000_000_000_000n),
        pkA,
        pkB,
        u64le(0n), // balances count
        u64le(0n), // allowances count
        Uint8Array.of(0), // paused = false
        encodeBincodeString("https://kovanica.network/kusd.svg"),
      ]);
      const tokenRes = await fetchAndDecodeContractStorageSlot(
        { getStorageAt: async () => `0x${bytesToHex(tokenBytes)}` },
        { contractAddress, kind: "token_metadata" },
      );
      expect(tokenRes.slotHex).toBe(deriveStorageSlotHex("token"));
      expect((tokenRes.decoded as any).symbol).toBe("KUSD");
      expect((tokenRes.decoded as any).decimals).toBe(6);

      // 6. NftMetadata
      const nftBytes = concat([
        encodeBincodeString("Kovanica Artifacts"),
        encodeBincodeString("KART"),
        encodeBincodeString("ipfs://base/"),
        pkA,
        pkB,
        u64le(0n), // tokens count
      ]);
      const nftRes = await fetchAndDecodeContractStorageSlot(
        { getStorageAt: async () => `0x${bytesToHex(nftBytes)}` },
        { contractAddress, kind: "nft_metadata" },
      );
      expect(nftRes.slotHex).toBe(deriveStorageSlotHex("nft"));
      expect((nftRes.decoded as any).name).toBe("Kovanica Artifacts");

      // 7. MultisigState
      const multisigBytes = concat([
        encodeBincodeBytes32Vec([pkA, pkB]),
        u32le(2),
        u64le(5n),
      ]);
      const multisigRes = await fetchAndDecodeContractStorageSlot(
        { getStorageAt: async () => `0x${bytesToHex(multisigBytes)}` },
        { contractAddress, kind: "multisig" },
      );
      expect(multisigRes.slotHex).toBe(deriveStorageSlotHex("multisig"));
      expect((multisigRes.decoded as any).threshold).toBe(2);
      expect((multisigRes.decoded as any).nextTxId).toBe(5n);
    });

    it("handles empty, null, or uninitialized storage slots gracefully without throwing decode errors", async () => {
      const contractAddress = "0x" + "33".repeat(32);

      expect(isStorageSlotEmpty(null)).toBe(true);
      expect(isStorageSlotEmpty(undefined)).toBe(true);
      expect(isStorageSlotEmpty("")).toBe(true);
      expect(isStorageSlotEmpty("0x")).toBe(true);
      expect(isStorageSlotEmpty("0x0")).toBe(true);
      expect(isStorageSlotEmpty("0x" + "00".repeat(32))).toBe(true);
      expect(isStorageSlotEmpty("0x01")).toBe(false);

      for (const emptyRaw of [null, undefined, "", "0x", "0x0", "0x" + "00".repeat(32)]) {
        const res = await fetchAndDecodeContractStorageSlot(
          { getStorageAt: async () => emptyRaw },
          { contractAddress, kind: "name", key: "nonexistent" },
        );
        expect(res.isEmpty).toBe(true);
        expect(res.decoded).toBeNull();
        expect(res.slotHex).toBe(deriveStorageSlotHex("name", "nonexistent"));
      }
    });

    it("surfaces RPC errors and KovanicaDecodeError on invalid inputs or malformed storage bytes", async () => {
      const contractAddress = "0x" + "33".repeat(32);

      // Missing contract address
      await expect(
        fetchAndDecodeContractStorageSlot(
          { getStorageAt: async () => "0x" },
          { contractAddress: "   ", kind: "name", key: "alice" },
        ),
      ).rejects.toThrow(KovanicaDecodeError);

      // Invalid slot key (e.g., htlc requires 32-byte key)
      await expect(
        fetchAndDecodeContractStorageSlot(
          { getStorageAt: async () => "0x" },
          { contractAddress, kind: "htlc", key: "not-32-bytes" },
        ),
      ).rejects.toThrow(KovanicaDecodeError);

      // Malformed / truncated Bincode storage payload returned by RPC
      await expect(
        fetchAndDecodeContractStorageSlot(
          { getStorageAt: async () => "0xdeadbeef" },
          { contractAddress, kind: "htlc", key: "11".repeat(32) },
        ),
      ).rejects.toThrow(KovanicaDecodeError);

      // Transport / RPC error propagation
      await expect(
        fetchAndDecodeContractStorageSlot(
          {
            getStorageAt: async () => {
              throw new Error("RPC -32000: storage backend unavailable");
            },
          },
          { contractAddress, kind: "name", key: "alice" },
        ),
      ).rejects.toThrow(/RPC -32000: storage backend unavailable/);
    });

    it("estimates a multi-call batch with sequential nonces, single fee lookup, and aggregate totals via estimateContractCallBatch", async () => {
      const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
      const contract = hexToBytes("33".repeat(32));

      const call1 = buildNameRegisterCallTx(
        contract,
        "alice",
        accounts[1].publicKey,
        ["https://relay1.kovanica.org"],
      );
      const call2 = buildTokenTransferCall(contract, accounts[1].publicKey, 500_000n);
      const call3 = buildHtlcCreateCallTx(
        contract,
        hexToBytes("11".repeat(32)),
        1750000000n,
        accounts[1].publicKey,
      );

      let estimateFeeCallCount = 0;
      let getNonceCallCount = 0;

      const mockClient = {
        estimateFee: async () => {
          estimateFeeCallCount++;
          return 20n;
        },
        getNonce: async (addr: string) => {
          getNonceCallCount++;
          expect(addr).toBe(accounts[0].testnetAddress);
          return 10n;
        },
      };

      const batchResult = await estimateContractCallBatch(
        mockClient,
        [call1, call2, call3],
        {
          sender: accounts[0].testnetAddress,
          chainId: CHAIN_IDS.TESTNET,
        },
      );

      // Single RPC fee lookup & single nonce lookup
      expect(estimateFeeCallCount).toBe(1);
      expect(getNonceCallCount).toBe(1);

      expect(batchResult.startNonce).toBe(10n);
      expect(batchResult.feeRatePerByte).toBe(20n);
      expect(batchResult.chainId).toBe(CHAIN_IDS.TESTNET);
      expect(batchResult.calls.length).toBe(3);

      // Sequential nonces: startNonce + i
      expect(batchResult.calls[0].nonce).toBe(10n);
      expect(batchResult.calls[1].nonce).toBe(11n);
      expect(batchResult.calls[2].nonce).toBe(12n);

      // Per-call +20% margined fee & aggregate totals match sum of individual calls
      let expectedTotalFee = 0n;
      let expectedTotalGas = 0n;
      let expectedTotalSize = 0;
      for (const item of batchResult.calls) {
        const baseFee = 20n * BigInt(item.estimatedTxSize);
        const expectedCallFee = (baseFee * 12_000n + 9_999n) / 10_000n;
        expect(item.fee).toBe(expectedCallFee);
        expectedTotalFee += item.fee;
        expectedTotalGas += item.gasLimit;
        expectedTotalSize += item.estimatedTxSize;
      }

      expect(batchResult.totalFee).toBe(expectedTotalFee);
      expect(batchResult.totalGasLimit).toBe(expectedTotalGas);
      expect(batchResult.totalEstimatedTxSize).toBe(expectedTotalSize);

      // Rejects empty batch fail-closed before any RPC I/O
      await expect(estimateContractCallBatch(mockClient, [])).rejects.toThrow(RangeError);
      expect(estimateFeeCallCount).toBe(1);
    });

    it("generates ready-to-run JSON-RPC cURL and kovanica-sdk TypeScript snippets for a contract call", () => {
      const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
      const contract = hexToBytes("33".repeat(32));
      const call = buildNameRegisterCallTx(
        contract,
        "alice",
        accounts[1].publicKey,
        ["https://relay1.kovanica.org"],
      );

      const curlSnippet = buildPlaygroundCallCurlSnippet({
        rpcUrl: "http://127.0.0.1:8545/rpc",
        call,
        sender: accounts[0].testnetAddress,
      });

      expect(curlSnippet).toContain('curl -sS -X POST "http://127.0.0.1:8545/rpc"');
      expect(curlSnippet).toContain('"method": "kovanica_call"');
      expect(curlSnippet).toContain('"entry": "name_register"');
      expect(curlSnippet).toContain(`"data": "0x${bytesToHex(call.args)}"`);
      expect(curlSnippet).toContain(`"from": "${accounts[0].mainnetAddress}"`);
      expect(curlSnippet).toContain('"gas": "0x186a0"');

      const sdkSnippet = buildPlaygroundCallSdkSnippet({
        rpcUrl: "http://127.0.0.1:8545/rpc",
        call,
        sender: accounts[0].testnetAddress,
        chainId: CHAIN_IDS.TESTNET,
      });

      expect(sdkSnippet).toContain('import {');
      expect(sdkSnippet).toContain('KovanicaClient');
      expect(sdkSnippet).toContain('estimateAndBuildCall');
      expect(sdkSnippet).toContain('dryRunCall');
      expect(sdkSnippet).toContain(`contract: "0x${"33".repeat(32)}"`);
      expect(sdkSnippet).toContain('method: "name_register"');
      expect(sdkSnippet).toContain(`args: hexToBytes("${bytesToHex(call.args)}")`);
      expect(sdkSnippet).toContain(`sender: "${accounts[0].testnetAddress}"`);
      expect(sdkSnippet).toContain("chainId: CHAIN_IDS.TESTNET");
    });

    describe("Transaction Receipt Poller & Emitted Log Bincode Decoder (pollAndDecodeTransactionReceipt)", () => {
      const validTxHash = "ab".repeat(32);
      const validBlockHash = "0x" + "cd".repeat(32);

      it("resolves immediately on first poll hit and normalizes status, gasUsed, and blockHash", async () => {
        let callCount = 0;
        const res = await pollAndDecodeTransactionReceipt(
          {
            getTransactionReceipt: async (hash) => {
              callCount++;
              expect(hash).toBe(`0x${validTxHash}`);
              return {
                transactionHash: `0x${validTxHash}`,
                blockHash: validBlockHash,
                status: 1,
                success: true,
                gasUsed: "0x5208",
                logs: [],
              };
            },
          },
          {
            txHash: validTxHash,
            pollIntervalMs: 10,
            timeoutMs: 1000,
          },
        );

        expect(callCount).toBe(1);
        expect(res.status).toBe("success");
        expect(res.gasUsed).toBe(21000n);
        expect(res.blockHash).toBe(validBlockHash);
        expect(res.decodedLogs).toEqual([]);
        expect(res.decodeErrors).toEqual([]);
      });

      it("polls multiple times until a non-null receipt is returned and decodes typed Bincode logs across decoders", async () => {
        const owner = hexToBytes("11".repeat(32));
        const pubkey = hexToBytes("22".repeat(32));
        const nameLogBytes = concat([
          owner,
          pubkey,
          encodeBincodeStringVec(["https://relay1.kovanica.org"]),
        ]);

        let attempts = 0;
        const res = await pollAndDecodeTransactionReceipt(
          {
            call: async (method, params) => {
              expect(method).toBe("kovanica_getTransactionReceipt");
              expect(params).toEqual([`0x${validTxHash}`]);
              attempts++;
              if (attempts < 3) {
                return null as any;
              }
              return {
                transactionHash: `0x${validTxHash}`,
                blockHash: validBlockHash,
                status: "0x1",
                gasUsed: 48500n,
                logs: [
                  {
                    address: "0x" + "33".repeat(32),
                    topics: ["0x" + "ff".repeat(32)],
                    data: `0x${bytesToHex(nameLogBytes)}`,
                  },
                ],
              } as any;
            },
          },
          {
            txHash: `0x${validTxHash}`,
            decoderKind: "name",
            pollIntervalMs: 5,
            timeoutMs: 1000,
          },
        );

        expect(attempts).toBe(3);
        expect(res.status).toBe("success");
        expect(res.gasUsed).toBe(48500n);
        expect(res.blockHash).toBe(validBlockHash);
        expect(res.decodeErrors).toEqual([]);
        expect(res.decodedLogs).toHaveLength(1);
        expect(res.decodedLogs[0].logIndex).toBe(0);
        expect(res.decodedLogs[0].decoderKind).toBe("name");
        expect((res.decodedLogs[0].decoded as any).ownerHex).toBe("11".repeat(32));
        expect((res.decodedLogs[0].decoded as any).pubkeyHex).toBe("22".repeat(32));
        expect((res.decodedLogs[0].decoded as any).relayEndpoints).toEqual([
          "https://relay1.kovanica.org",
        ]);

        // Also test HTLC & Multisig Bincode log decoding + malformed log collection in decodeErrors
        const multisigLogBytes = concat([
          encodeBincodeBytes32Vec([owner, pubkey]),
          u32le(2),
          u64le(9n),
        ]);

        const msRes = await pollAndDecodeTransactionReceipt(
          {
            getTransactionReceipt: async () => ({
              transactionHash: `0x${validTxHash}`,
              blockHash: validBlockHash,
              status: 1,
              gasUsed: "12000",
              logs: [
                { data: `0x${bytesToHex(multisigLogBytes)}` },
                { data: "0xdeadbeef" },
              ],
            }),
          },
          {
            txHash: validTxHash,
            decoderKind: "multisig",
            pollIntervalMs: 5,
            timeoutMs: 1000,
          },
        );

        expect(msRes.decodedLogs).toHaveLength(1);
        expect((msRes.decodedLogs[0].decoded as any).threshold).toBe(2);
        expect((msRes.decodedLogs[0].decoded as any).nextTxId).toBe(9n);
        expect(msRes.decodeErrors).toHaveLength(1);
        expect(msRes.decodeErrors[0].logIndex).toBe(1);
        expect(msRes.decodeErrors[0].decoderKind).toBe("multisig");
      });

      it("detects reverted receipts from status=0 / 0x0 / success=false", async () => {
        const revertedByZero = await pollAndDecodeTransactionReceipt(
          {
            getTransactionReceipt: async () => ({
              transactionHash: `0x${validTxHash}`,
              blockHash: validBlockHash,
              status: 0,
              success: false,
              gasUsed: 100000n,
              logs: [],
            }),
          },
          { txHash: validTxHash },
        );
        expect(revertedByZero.status).toBe("reverted");
        expect(revertedByZero.gasUsed).toBe(100000n);

        const revertedByHexZero = await pollAndDecodeTransactionReceipt(
          {
            getTransactionReceipt: async () => ({
              transactionHash: `0x${validTxHash}`,
              blockHash: validBlockHash,
              status: "0x0",
              gasUsed: "0x2710",
            }),
          },
          { txHash: validTxHash },
        );
        expect(revertedByHexZero.status).toBe("reverted");
        expect(revertedByHexZero.gasUsed).toBe(10000n);
      });

      it("rejects with a timeout error when receipt stays null past timeoutMs", async () => {
        let polls = 0;
        await expect(
          pollAndDecodeTransactionReceipt(
            {
              getTransactionReceipt: async () => {
                polls++;
                return null;
              },
            },
            {
              txHash: validTxHash,
              pollIntervalMs: 10,
              timeoutMs: 35,
            },
          ),
        ).rejects.toThrow(/Timed out waiting for transaction receipt/);
        expect(polls).toBeGreaterThanOrEqual(2);
      });

      it("rejects invalid 32-byte txHash fail-closed before making any RPC calls", async () => {
        let rpcCalled = false;
        const client = {
          getTransactionReceipt: async () => {
            rpcCalled = true;
            return null;
          },
        };

        await expect(
          pollAndDecodeTransactionReceipt(client, { txHash: "" }),
        ).rejects.toThrow(KovanicaDecodeError);

        await expect(
          pollAndDecodeTransactionReceipt(client, { txHash: "0x1234" }),
        ).rejects.toThrow(KovanicaDecodeError);

        await expect(
          pollAndDecodeTransactionReceipt(client, { txHash: "zz".repeat(32) }),
        ).rejects.toThrow(KovanicaDecodeError);

        expect(rpcCalled).toBe(false);
      });

      it("decodes typed Bincode logs and receipts via re-exported SDK decodeContractLog, decodeTransactionReceiptLogs, estimateBatchCalls, and waitForTransactionReceipt", async () => {
        const owner = hexToBytes("aa".repeat(32));
        const pubkey = hexToBytes("bb".repeat(32));
        const nameLogBytes = concat([
          owner,
          pubkey,
          encodeBincodeStringVec(["https://relay1.kovanica.org", "https://relay2.kovanica.org"]),
        ]);
        const nameLogHex = `0x${bytesToHex(nameLogBytes)}`;

        // 1. decodeContractLog direct discriminated union
        const singleLog = decodeContractLog(nameLogHex, "name");
        expect(singleLog.kind).toBe("name");
        expect(singleLog.record.ownerHex).toBe("aa".repeat(32));
        expect(singleLog.record.pubkeyHex).toBe("bb".repeat(32));
        expect(singleLog.record.relayEndpoints).toEqual([
          "https://relay1.kovanica.org",
          "https://relay2.kovanica.org",
        ]);

        // 2. decodeTransactionReceiptLogs with both a fixed kind and a selective resolver callback
        const multisigLogBytes = concat([
          encodeBincodeBytes32Vec([owner, pubkey]),
          u32le(2),
          u64le(11n),
        ]);
        const receiptWithLogs = {
          logs: [
            {
              address: "0x" + "11".repeat(32),
              topics: ["0x" + "aa".repeat(32)],
              data: nameLogHex,
            },
            {
              address: "0x" + "22".repeat(32),
              topics: ["0x" + "bb".repeat(32)],
              data: "0xdeadbeef", // skipped by resolver
            },
            {
              address: "0x" + "33".repeat(32),
              topics: ["0x" + "cc".repeat(32)],
              data: `0x${bytesToHex(multisigLogBytes)}`,
            },
          ],
        };

        const decodedFixed = decodeTransactionReceiptLogs(
          { logs: [receiptWithLogs.logs[0]] },
          "name",
        );
        expect(decodedFixed).toHaveLength(1);
        expect(decodedFixed[0].index).toBe(0);
        expect(decodedFixed[0].kind).toBe("name");
        expect(decodedFixed[0].record.ownerHex).toBe("aa".repeat(32));

        const decodedSelective = decodeTransactionReceiptLogs(receiptWithLogs, (_log, index) => {
          if (index === 0) return "name";
          if (index === 2) return "multisig_state";
          return null;
        });
        expect(decodedSelective).toHaveLength(2);
        expect(decodedSelective[0].index).toBe(0);
        expect(decodedSelective[0].kind).toBe("name");
        expect(decodedSelective[1].index).toBe(2);
        expect(decodedSelective[1].kind).toBe("multisig_state");
        if (decodedSelective[1].kind === "multisig_state") {
          expect(decodedSelective[1].record.threshold).toBe(2);
          expect(decodedSelective[1].record.nextTxId).toBe(11n);
        }

        // 3. Re-exported estimateBatchCalls and waitForTransactionReceipt
        const contract = hexToBytes("44".repeat(32));
        const sdkBatch = await estimateBatchCalls(
          {
            estimateFee: async () => 15n,
            getNonce: async () => 5n,
          },
          [
            {
              contract,
              method: "token_transfer",
              args: concat([pubkey, u128le(100n)]),
            },
          ],
          { sender: "0x" + "aa".repeat(32), chainId: CHAIN_IDS.TESTNET },
        );
        expect(sdkBatch.calls).toHaveLength(1);
        expect(sdkBatch.startNonce).toBe(5n);
        expect(sdkBatch.feeRatePerByte).toBe(15n);

        const waitedReceipt = await waitForTransactionReceipt(
          {
            getTransactionReceipt: async (hash) => ({
              transactionHash: hash,
              blockHash: validBlockHash,
              blockNumber: 42n,
              transactionIndex: 0n,
              status: 1,
              success: true,
              gasUsed: 21000n,
            }),
          },
          `0x${validTxHash}`,
          { pollIntervalMs: 10, timeoutMs: 500 },
        );
        expect(waitedReceipt.transactionHash).toBe(`0x${validTxHash}`);
        expect(waitedReceipt.success).toBe(true);
      });
    });
  });
});
