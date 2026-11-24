import { describe, expect, it } from "vitest";
import { CHAIN_IDS, KOVANICA_COIN_TYPE } from "kovanica-sdk";
import * as ed from "@noble/ed25519";
import {
  AIRGAP_ENVELOPE_PREFIX,
  AIRGAP_ENVELOPE_VERSION,
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
  computeFeeRecommendations,
  computeTransferTransactionSigningHash,
  concat,
  createWatchOnlyAccount,
  decodeAirgapTxEnvelope,
  decodeContractLog,
  decodeContractStateHex,
  decodeSignedCallTransaction,
  decodeSignedTransactionAuto,
  decodeSignedTransferTransaction,
  decodeTransactionReceiptLogs,
  DEFAULT_JSONRPC_READ_BATCH_PRESET,
  deriveAccountsFromMnemonic,
  deriveContractStorageSlotHex,
  derivePrefixedStorageSlot,
  deriveStorageSlotHex,
  dryRunBatchCalls,
  encodeAirgapTxEnvelope,
  encodeBincodeBytes32Vec,
  encodeBincodeString,
  encodeBincodeStringVec,
  EscrowClient,
  estimateBatchCalls,
  estimateContractCall,
  estimateContractCallBatch,
  executeJsonRpcReadBatch,
  exportContractPresetsJson,
  fetchAccountTxHistorySummary,
  fetchAndDecodeContractStorageSlot,
  formatAddressForChain,
  generateMnemonic,
  getAccountTxHistory,
  getContractLogHistory,
  hexToBytes,
  HtlcClient,
  inspectAddress,
  inspectAnySignedTx,
  inspectRawSignedCallTx,
  inspectRawSignedTransferTx,
  inspectWatchOnlyAccount,
  isStorageSlotEmpty,
  KovanicaDecodeError,
  MAX_CONTRACT_PRESETS_ITEMS,
  MAX_CONTRACT_PRESETS_JSON_BYTES,
  MAX_JSONRPC_BATCH_SIZE,
  MultisigClient,
  NameRegistryClient,
  NftClient,
  normalizeAddressList,
  parseBip44Path,
  parseImportedContractPresetsJson,
  parseMempoolFeeStats,
  peekTransactionVariant,
  pollAndDecodeTransactionReceipt,
  probeFailoverRpcEndpoints,
  probeRpcNode,
  readContractStorage,
  runContractLogHistoryQuery,
  runGoldenVectorSelfTest,
  runMempoolFeeTierProbe,
  runNodeCapabilityProbe,
  runTypedFacadeRead,
  signAndSerializeTransaction,
  signTransferTransaction,
  subscribeContractEvents,
  TokenClient,
  u128le,
  u32le,
  u64le,
  validateBip44Path,
  validateMnemonic,
  VaultClient,
  verifyCallTransactionSignature,
  verifyEd25519,
  verifySignedTransactionAuto,
  verifyTransferTransactionSignature,
  waitForTransactionReceipt,
  type ContractFacadeClient,
  type MempoolFeeStats,
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

    describe("SDK a2ec93f readContractStorage, dryRunBatchCalls, and Call Presets JSON Export/Import", () => {
      it("reads and decodes canonical storage slots via re-exported readContractStorage", async () => {
        const contractHex = "33".repeat(32);
        const owner = hexToBytes("aa".repeat(32));
        const pubkey = hexToBytes("bb".repeat(32));
        const nameBytes = concat([
          owner,
          pubkey,
          encodeBincodeStringVec(["https://relay1.kovanica.org"]),
        ]);

        const result = await readContractStorage(
          {
            getStorageAt: async (_addr, slot) => {
              expect(slot).toBe(`0x${deriveStorageSlotHex("name", "alice")}`);
              return `0x${bytesToHex(nameBytes)}`;
            },
          },
          `0x${contractHex}`,
          { kind: "name", key: "alice" },
        );

        expect(result.isEmpty).toBe(false);
        expect(result.slotHex).toBe(`0x${deriveStorageSlotHex("name", "alice")}`);
        expect(result.decoded?.ownerHex).toBe("aa".repeat(32));
        expect(result.decoded?.pubkeyHex).toBe("bb".repeat(32));
        expect(result.decoded?.relayEndpoints).toEqual(["https://relay1.kovanica.org"]);

        const emptyResult = await readContractStorage(
          {
            getStorageAt: async () => "0x",
          },
          `0x${contractHex}`,
          { kind: "name", key: "missing" },
        );
        expect(emptyResult.isEmpty).toBe(true);
        expect(emptyResult.decoded).toBeUndefined();
      });

      it("simulates a batch of contract calls via re-exported dryRunBatchCalls (including continueOnError)", async () => {
        const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
        const contract = hexToBytes("44".repeat(32));
        const call1 = buildTokenTransferCall(contract, accounts[1].publicKey, 100n);
        const call2 = buildNameRegisterCallTx(
          contract,
          "alice",
          accounts[1].publicKey,
          ["https://relay1.kovanica.org"],
        );

        let rpcCalls = 0;
        const batchRes = await dryRunBatchCalls(
          {
            call: async (_method, _params) => {
              rpcCalls++;
              if (rpcCalls === 1) {
                return "0xdeadbeef" as any;
              }
              throw new Error("VM execution reverted");
            },
          },
          [
            {
              contract: call1.contract,
              method: call1.method,
              args: call1.args,
              call_value: call1.value,
              gas_limit: call1.gasLimit,
            },
            {
              contract: call2.contract,
              method: call2.method,
              args: call2.args,
              call_value: call2.value,
              gas_limit: call2.gasLimit,
            },
          ],
          { continueOnError: true },
        );

        expect(batchRes.totalCalls).toBe(2);
        expect(batchRes.passedCount).toBe(1);
        expect(batchRes.failedCount).toBe(1);
        expect(batchRes.results[0].ok).toBe(true);
        if (batchRes.results[0].ok) {
          expect(batchRes.results[0].result.rawHex).toBe("0xdeadbeef");
        }
        expect(batchRes.results[1].ok).toBe(false);
        if (!batchRes.results[1].ok) {
          expect(batchRes.results[1].error.message).toContain("VM execution reverted");
        }
      });

      it("round-trips contract call presets via exportContractPresetsJson and parseImportedContractPresetsJson", () => {
        const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
        const contract = hexToBytes("33".repeat(32));

        const call1 = buildTokenTransferCall(contract, accounts[1].publicKey, 250_000n, 120_000n);
        const call2 = buildNameRegisterCallTx(
          contract,
          "alice",
          accounts[1].publicKey,
          ["https://relay1.kovanica.org"],
          150_000n,
        );

        const exportedJson = exportContractPresetsJson([call1, call2]);
        const imported = parseImportedContractPresetsJson(exportedJson);

        expect(imported).toHaveLength(2);
        expect(imported[0]).toEqual(call1);
        expect(imported[1]).toEqual(call2);
      });

      it("rejects malformed, invalid-schema, and oversized presets JSON fail-closed", () => {
        const contractHex = "33".repeat(32);

        // Empty / non-JSON
        expect(() => parseImportedContractPresetsJson("")).toThrow(KovanicaDecodeError);
        expect(() => parseImportedContractPresetsJson("{not-json")).toThrow(KovanicaDecodeError);

        // Wrong root type / wrong schema version / empty presets
        expect(() => parseImportedContractPresetsJson("[]")).toThrow(KovanicaDecodeError);
        expect(() =>
          parseImportedContractPresetsJson(JSON.stringify({ version: 2, presets: [] })),
        ).toThrow(KovanicaDecodeError);
        expect(() =>
          parseImportedContractPresetsJson(JSON.stringify({ version: 1, presets: [] })),
        ).toThrow(KovanicaDecodeError);

        // Invalid fields (bad contractHex, bad argsHex, non-positive gasLimit, negative value)
        expect(() =>
          parseImportedContractPresetsJson(
            JSON.stringify({
              version: 1,
              presets: [
                {
                  contractHex: "1234",
                  method: "token_transfer",
                  argsHex: "",
                  value: "0",
                  gasLimit: "100000",
                },
              ],
            }),
          ),
        ).toThrow(KovanicaDecodeError);

        expect(() =>
          parseImportedContractPresetsJson(
            JSON.stringify({
              version: 1,
              presets: [
                {
                  contractHex,
                  method: "token_transfer",
                  argsHex: "abc", // odd length
                  value: "0",
                  gasLimit: "100000",
                },
              ],
            }),
          ),
        ).toThrow(KovanicaDecodeError);

        expect(() =>
          parseImportedContractPresetsJson(
            JSON.stringify({
              version: 1,
              presets: [
                {
                  contractHex,
                  method: "token_transfer",
                  argsHex: "",
                  value: "-1",
                  gasLimit: "100000",
                },
              ],
            }),
          ),
        ).toThrow(KovanicaDecodeError);

        expect(() =>
          parseImportedContractPresetsJson(
            JSON.stringify({
              version: 1,
              presets: [
                {
                  contractHex,
                  method: "token_transfer",
                  argsHex: "",
                  value: "0",
                  gasLimit: "0",
                },
              ],
            }),
          ),
        ).toThrow(KovanicaDecodeError);

        // Exceeds MAX_CONTRACT_PRESETS_ITEMS bound
        const tooMany = Array.from({ length: MAX_CONTRACT_PRESETS_ITEMS + 1 }, () => ({
          contractHex,
          method: "token_transfer",
          argsHex: "",
          value: "0",
          gasLimit: "100000",
        }));
        expect(() =>
          parseImportedContractPresetsJson(JSON.stringify({ version: 1, presets: tooMany })),
        ).toThrow(KovanicaDecodeError);

        // Exceeds MAX_CONTRACT_PRESETS_JSON_BYTES bound
        const oversizedJson = JSON.stringify({
          version: 1,
          presets: [
            {
              contractHex,
              method: "token_transfer",
              argsHex: "aa".repeat(MAX_CONTRACT_PRESETS_JSON_BYTES),
              value: "0",
              gasLimit: "100000",
            },
          ],
        });
        expect(() => parseImportedContractPresetsJson(oversizedJson)).toThrow(KovanicaDecodeError);
      });
    });

    describe("SDK e5f3b79 Typed Contract Facades & JSON-RPC 2.0 Read Batch Runner", () => {
      it("executes a bundled read-only JSON-RPC 2.0 batch in a single callBatch round-trip and isolates per-item errors", async () => {
        let batchCalls = 0;
        let capturedMethods: string[] = [];

        const mockClient = {
          callBatch: async (requests: ReadonlyArray<{ method: string; params?: unknown }>) => {
            batchCalls += 1;
            capturedMethods = requests.map((r) => r.method);
            return [
              { ok: true as const, result: "0x2" },
              { ok: true as const, result: "0x10" },
              {
                ok: false as const,
                error: Object.assign(new Error("Method temporarily unavailable"), {
                  code: -32000,
                  data: { detail: "fee oracle warming up" },
                }),
              },
            ] as any;
          },
        };

        const summary = await executeJsonRpcReadBatch(mockClient, DEFAULT_JSONRPC_READ_BATCH_PRESET);

        expect(batchCalls).toBe(1);
        expect(capturedMethods).toEqual([
          "kovanica_chainId",
          "kovanica_blockNumber",
          "kovanica_estimateFee",
        ]);
        expect(summary.totalRequests).toBe(3);
        expect(summary.succeededCount).toBe(2);
        expect(summary.failedCount).toBe(1);
        expect(summary.items[0]).toEqual({
          index: 0,
          method: "kovanica_chainId",
          ok: true,
          result: "0x2",
        });
        expect(summary.items[1]).toEqual({
          index: 1,
          method: "kovanica_blockNumber",
          ok: true,
          result: "0x10",
        });
        expect(summary.items[2]).toEqual({
          index: 2,
          method: "kovanica_estimateFee",
          ok: false,
          error: {
            code: -32000,
            message: "Method temporarily unavailable",
            data: { detail: "fee oracle warming up" },
          },
        });
      });

      it("rejects empty batches, > MAX_JSONRPC_BATCH_SIZE batches, and state-mutating methods fail-closed", async () => {
        let called = false;
        const mockClient = {
          callBatch: async () => {
            called = true;
            return [];
          },
        };

        // Empty batch
        await expect(executeJsonRpcReadBatch(mockClient, [])).rejects.toThrow(KovanicaDecodeError);

        // Oversized batch (33 > MAX_JSONRPC_BATCH_SIZE=32)
        const oversized = Array.from({ length: MAX_JSONRPC_BATCH_SIZE + 1 }, () => ({
          method: "kovanica_blockNumber",
          params: [],
        }));
        await expect(executeJsonRpcReadBatch(mockClient, oversized)).rejects.toThrow(
          KovanicaDecodeError,
        );

        // State-mutating / non-read-only methods must be rejected before transport
        await expect(
          executeJsonRpcReadBatch(mockClient, [
            { method: "kovanica_chainId", params: [] },
            { method: "kovanica_sendRawTransaction", params: ["0xdeadbeef"] },
          ]),
        ).rejects.toThrow(KovanicaDecodeError);

        await expect(
          executeJsonRpcReadBatch(mockClient, [{ method: "kovanica_submitWork", params: [] }]),
        ).rejects.toThrow(KovanicaDecodeError);

        expect(called).toBe(false);
      });

      it("exposes and instantiates all 7 typed contract facades from kovanica-sdk", async () => {
        const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
        const contractHex = "33".repeat(32);
        const pkA = accounts[0].publicKey;
        const pkB = accounts[1].publicKey;

        const multisigBytes = concat([
          encodeBincodeBytes32Vec([pkA, pkB]),
          u32le(2),
          u64le(9n),
        ]);

        const mockFacadeClient: ContractFacadeClient = {
          call: async () => "0x" as any,
          estimateFee: async () => 10n,
          getNonce: async () => 1n,
          getStorageAt: async () => `0x${bytesToHex(multisigBytes)}`,
        };

        const nameClient = new NameRegistryClient(mockFacadeClient, contractHex);
        const tokenClient = new TokenClient(mockFacadeClient, contractHex);
        const escrowClient = new EscrowClient(mockFacadeClient, contractHex);
        const htlcClient = new HtlcClient(mockFacadeClient, contractHex);
        const nftClient = new NftClient(mockFacadeClient, contractHex);
        const vaultClient = new VaultClient(mockFacadeClient, contractHex);
        const multisigClient = new MultisigClient(mockFacadeClient, contractHex);

        for (const facade of [
          nameClient,
          tokenClient,
          escrowClient,
          htlcClient,
          nftClient,
          vaultClient,
          multisigClient,
        ]) {
          expect(facade.contractHex).toBe(contractHex);
          expect(facade.contractAddress.startsWith("kvnc")).toBe(true);
        }

        const preparedName = await nameClient.prepareRegister(
          {
            name: "alice",
            pubkey: pkB,
            relayEndpoints: ["https://relay1.kovanica.org"],
          },
          { sender: accounts[0].testnetAddress, chainId: CHAIN_IDS.TESTNET },
        );
        expect(preparedName.call.method).toBe("name_register");

        const preparedToken = await tokenClient.prepareTransfer(
          {
            recipient: pkB,
            amount: 1_000n,
          },
          { sender: accounts[0].testnetAddress, chainId: CHAIN_IDS.TESTNET },
        );
        expect(preparedToken.call.method).toBe("token_transfer");

        const preparedEscrow = await escrowClient.prepareCreate(
          {
            parties: [pkA, pkB],
            threshold: 2,
            amount: 500_000n,
            deadline: 1_800_000_000n,
          },
          { sender: accounts[0].testnetAddress, chainId: CHAIN_IDS.TESTNET },
        );
        expect(preparedEscrow.call.method).toBe("escrow_create");

        const preparedHtlc = await htlcClient.prepareCreate(
          {
            hashlock: hexToBytes("11".repeat(32)),
            timelock: 1_800_000_000n,
            recipient: pkB,
          },
          { sender: accounts[0].testnetAddress, chainId: CHAIN_IDS.TESTNET },
        );
        expect(preparedHtlc.call.method).toBe("htlc_create");

        const preparedNft = await nftClient.prepareMint(
          {
            collection: hexToBytes("77".repeat(32)),
            to: pkB,
            tokenId: 1n,
            tokenUri: "ipfs://example",
          },
          { sender: accounts[0].testnetAddress, chainId: CHAIN_IDS.TESTNET },
        );
        expect(preparedNft.call.method).toBe("nft_mint");

        const preparedVault = await vaultClient.prepareCreate(
          {
            beneficiary: pkB,
            amount: 100_000n,
            lockUntil: 1_800_000_000_000n,
          },
          { sender: accounts[0].testnetAddress, chainId: CHAIN_IDS.TESTNET },
        );
        expect(preparedVault.call.method).toBe("vault_create");

        const msState = await multisigClient.getState();
        expect(msState).not.toBeNull();
        expect(msState?.threshold).toBe(2);
        expect(msState?.nextTxId).toBe(9n);
      });
    });

    describe("SDK edd5cb5 runTypedFacadeRead, getContractLogHistory & subscribeContractEvents", () => {
      it("dispatches runTypedFacadeRead cleanly across all 7 canonical contract facades", async () => {
        const contractHex = "33".repeat(32);
        const pkA = hexToBytes("aa".repeat(32));
        const pkB = hexToBytes("bb".repeat(32));
        const id32 = "11".repeat(32);

        const nameBytes = concat([
          pkA,
          pkB,
          encodeBincodeStringVec(["https://relay1.kovanica.org"]),
        ]);
        const tokenBytes = concat([
          encodeBincodeString("Kovanica USD"),
          encodeBincodeString("KUSD"),
          Uint8Array.of(6),
          u128le(1_000_000_000n),
          pkA,
          pkB,
          u64le(0n),
          u64le(0n),
          Uint8Array.of(0),
          encodeBincodeString("https://kovanica.network/kusd.svg"),
        ]);
        const nftBytes = concat([
          encodeBincodeString("Kovanica Artifacts"),
          encodeBincodeString("KART"),
          encodeBincodeString("ipfs://base/"),
          pkA,
          pkB,
          u64le(0n),
        ]);
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
        const htlcBytes = concat([
          pkA,
          pkB,
          u128le(500_000_000n),
          hexToBytes("cc".repeat(32)),
          u64le(1750000000n),
          Uint8Array.of(0),
          Uint8Array.of(0),
        ]);
        const vaultBytes = concat([
          pkA,
          pkB,
          u128le(10_000_000_000n),
          u128le(2_000_000_000n),
          u32le(0),
          u64le(1800000000n),
          Uint8Array.of(0),
        ]);
        const multisigBytes = concat([
          encodeBincodeBytes32Vec([pkA, pkB]),
          u32le(2),
          u64le(7n),
        ]);

        const mkClient = (payload: Uint8Array | null): ContractFacadeClient => ({
          call: async () => "0x" as any,
          estimateFee: async () => 10n,
          getNonce: async () => 0n,
          getStorageAt: async () => (payload ? `0x${bytesToHex(payload)}` : "0x"),
        });

        const nameRes = await runTypedFacadeRead(mkClient(nameBytes), {
          facade: "name",
          contract: contractHex,
          key: "alice",
        });
        expect(nameRes.method).toBe("NameRegistryClient.getRecord");
        expect(nameRes.found).toBe(true);
        expect((nameRes.record as any).ownerHex).toBe("aa".repeat(32));

        const tokenRes = await runTypedFacadeRead(mkClient(tokenBytes), {
          facade: "token",
          contract: contractHex,
        });
        expect(tokenRes.method).toBe("TokenClient.getMetadata");
        expect(tokenRes.found).toBe(true);
        expect((tokenRes.record as any).symbol).toBe("KUSD");

        const nftRes = await runTypedFacadeRead(mkClient(nftBytes), {
          facade: "nft",
          contract: contractHex,
        });
        expect(nftRes.method).toBe("NftClient.getMetadata");
        expect(nftRes.found).toBe(true);
        expect((nftRes.record as any).name).toBe("Kovanica Artifacts");

        const escrowRes = await runTypedFacadeRead(mkClient(escrowBytes), {
          facade: "escrow",
          contract: contractHex,
          key: id32,
        });
        expect(escrowRes.method).toBe("EscrowClient.getEscrow");
        expect(escrowRes.found).toBe(true);
        expect((escrowRes.record as any).threshold).toBe(2);

        const htlcRes = await runTypedFacadeRead(mkClient(htlcBytes), {
          facade: "htlc",
          contract: contractHex,
          key: id32,
        });
        expect(htlcRes.method).toBe("HtlcClient.getHtlc");
        expect(htlcRes.found).toBe(true);
        expect((htlcRes.record as any).amount).toBe(500_000_000n);

        const vaultRes = await runTypedFacadeRead(mkClient(vaultBytes), {
          facade: "vault",
          contract: contractHex,
          key: id32,
        });
        expect(vaultRes.method).toBe("VaultClient.getVault");
        expect(vaultRes.found).toBe(true);
        expect((vaultRes.record as any).totalAmount).toBe(10_000_000_000n);

        const msRes = await runTypedFacadeRead(mkClient(multisigBytes), {
          facade: "multisig",
          contract: contractHex,
        });
        expect(msRes.method).toBe("MultisigClient.getState");
        expect(msRes.found).toBe(true);
        expect((msRes.record as any).nextTxId).toBe(7n);

        // Empty slot returns found: false, record: null
        const emptyRes = await runTypedFacadeRead(mkClient(null), {
          facade: "multisig",
          contract: contractHex,
        });
        expect(emptyRes.found).toBe(false);
        expect(emptyRes.record).toBeNull();

        // Fail-closed validation on missing contract or missing required key
        await expect(
          runTypedFacadeRead(mkClient(null), { facade: "token", contract: "  " }),
        ).rejects.toThrow(KovanicaDecodeError);
        await expect(
          runTypedFacadeRead(mkClient(null), { facade: "name", contract: contractHex }),
        ).rejects.toThrow(KovanicaDecodeError);
        await expect(
          runTypedFacadeRead(mkClient(null), { facade: "escrow", contract: contractHex, key: "" }),
        ).rejects.toThrow(KovanicaDecodeError);
      });

      it("supports getContractLogHistory and subscribeContractEvents re-exported from kovanica-sdk", async () => {
        const pkA = hexToBytes("aa".repeat(32));
        const pkB = hexToBytes("bb".repeat(32));
        const nameBytes = concat([
          pkA,
          pkB,
          encodeBincodeStringVec(["https://relay.kovanica.org"]),
        ]);
        const nameHex = `0x${bytesToHex(nameBytes)}`;

        // 1. getContractLogHistory
        const history = await getContractLogHistory(
          {
            getLogs: async () => [
              {
                address: "0x" + "33".repeat(32),
                topics: ["0x01"],
                data: nameHex,
                blockNumber: 5n,
              },
            ],
          },
          {
            fromBlock: 1n,
            toBlock: 10n,
            chunkSize: 10,
            kind: "name",
          },
        );
        expect(history.chunksQueried).toBe(1);
        expect(history.decodedLogs).toHaveLength(1);
        expect(history.decodedLogs[0].kind).toBe("name");
        expect(history.decodedLogs[0].record.ownerHex).toBe("aa".repeat(32));

        // 2. subscribeContractEvents
        let capturedCb: ((payload: any) => void) | null = null;
        let unsubscribedId = "";
        const received: Array<{ kind: string; ownerHex: string }> = [];

        const handle = await subscribeContractEvents(
          {
            subscribeLogs: async (_filter, cb) => {
              capturedCb = cb;
              return "0xsub-ev-1";
            },
            unsubscribe: async (id) => {
              unsubscribedId = id;
              return true;
            },
          },
          { kind: "name" },
          (ev) => {
            received.push({ kind: ev.kind, ownerHex: ev.record.ownerHex });
          },
        );

        expect(handle.subscriptionId).toBe("0xsub-ev-1");
        expect(capturedCb).not.toBeNull();
        capturedCb!([{ events: [{ data: nameHex }] }]);

        expect(received).toEqual([{ kind: "name", ownerHex: "aa".repeat(32) }]);
        expect(await handle.unsubscribe()).toBe(true);
        expect(unsubscribedId).toBe("0xsub-ev-1");
      });
    });

    describe("Contract Log History Explorer & Failover RPC Probe", () => {
      it("runs chunked runContractLogHistoryQuery with optional Bincode decode and JSON-safe output", async () => {
        const pkA = hexToBytes("aa".repeat(32));
        const pkB = hexToBytes("bb".repeat(32));
        const nameBytes = concat([
          pkA,
          pkB,
          encodeBincodeStringVec(["https://relay1.kovanica.org"]),
        ]);
        const nameHex = `0x${bytesToHex(nameBytes)}`;
        const requestedRanges: Array<{ fromBlock: string; toBlock: string }> = [];

        const mockClient = {
          getLogs: async (filter: { fromBlock: string; toBlock: string }) => {
            requestedRanges.push({
              fromBlock: filter.fromBlock,
              toBlock: filter.toBlock,
            });
            if (filter.fromBlock === "0x0") {
              return [
                {
                  address: "0x" + "33".repeat(32),
                  topics: ["0x01"],
                  data: nameHex,
                  blockNumber: 5n,
                  logIndex: 0n,
                },
              ];
            }
            if (filter.fromBlock === "0x14") {
              return [
                {
                  address: "0x" + "33".repeat(32),
                  topics: ["0x01"],
                  data: nameHex,
                  blockNumber: 22n,
                  logIndex: 1n,
                },
              ];
            }
            return [];
          },
        };

        const result = await runContractLogHistoryQuery(mockClient, {
          fromBlock: "0",
          toBlock: "25",
          address: "0x" + "33".repeat(32),
          decoderKind: "name",
          chunkSize: 10,
        });

        expect(result.chunksQueried).toBe(3);
        expect(requestedRanges).toEqual([
          { fromBlock: "0x0", toBlock: "0x9" },
          { fromBlock: "0xa", toBlock: "0x13" },
          { fromBlock: "0x14", toBlock: "0x19" },
        ]);
        expect(result.fromBlock).toBe("0");
        expect(result.toBlock).toBe("25");
        expect(result.totalLogs).toBe(2);
        expect(result.decodedCount).toBe(2);
        expect(result.decoderKind).toBe("name");
        expect((result.logs[0] as { blockNumber: string }).blockNumber).toBe("5");
        expect((result.decodedLogs[0] as { record: { ownerHex: string } }).record.ownerHex).toBe(
          "aa".repeat(32),
        );

        // Must be cleanly JSON-serializable without custom bigint replacer
        const serialized = JSON.stringify(result);
        expect(serialized).toContain("https://relay1.kovanica.org");

        // Raw mode (no decoderKind) leaves decodedLogs empty
        const rawResult = await runContractLogHistoryQuery(mockClient, {
          fromBlock: 0,
          toBlock: 9,
          chunkSize: 10,
        });
        expect(rawResult.chunksQueried).toBe(1);
        expect(rawResult.totalLogs).toBe(1);
        expect(rawResult.decodedCount).toBe(0);
        expect(rawResult.decoderKind).toBeNull();
      });

      it("probes failover RPC endpoints and automatically fails over from primary 503 to secondary", async () => {
        const calledUrls: string[] = [];
        const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          calledUrls.push(url);
          if (url.startsWith("https://primary.kovanica.test")) {
            return new Response("Service Unavailable", {
              status: 503,
              statusText: "Service Unavailable",
            });
          }
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            id: number | string;
            method: string;
          };
          const result = body.method === "kovanica_chainId" ? "0x2" : "0x2a";
          return new Response(
            JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }) as typeof fetch;

        const probe = await probeFailoverRpcEndpoints(
          "https://primary.kovanica.test/rpc\nhttps://secondary.kovanica.test/rpc",
          mockFetch,
        );

        expect(probe.ok).toBe(true);
        expect(probe.chainId).toBe(2);
        expect(probe.blockNumber).toBe("42");
        expect(probe.failoverEvents.length).toBeGreaterThanOrEqual(1);
        expect(probe.failoverEvents[0].fromUrl).toBe("https://primary.kovanica.test/rpc");
        expect(probe.failoverEvents[0].toUrl).toBe("https://secondary.kovanica.test/rpc");
        expect(probe.failoverEvents[0].status).toBe(503);
        expect(probe.activeEndpoints).toHaveLength(2);
        expect(probe.activeEndpoints[0].healthy).toBe(false);
        expect(probe.activeEndpoints[0].state).toBe("open");
        expect(probe.activeEndpoints[1].healthy).toBe(true);
        expect(probe.activeEndpoints[1].totalSuccesses).toBe(2);
        expect(calledUrls[0]).toBe("https://primary.kovanica.test/rpc");
        expect(calledUrls[1]).toBe("https://secondary.kovanica.test/rpc");

        // Empty list fails cleanly without throwing
        const emptyProbe = await probeFailoverRpcEndpoints("  , \n ");
        expect(emptyProbe.ok).toBe(false);
        expect(emptyProbe.activeEndpoints).toEqual([]);
      });
    });

    describe("Raw Wire Tx Decoder & Node Capability Probe", () => {
      it("decodes and verifies a valid signed Call transaction offline via inspectRawSignedCallTx", () => {
        const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
        const sender = accounts[0];
        const recipient = accounts[1];
        const contract = hexToBytes("33".repeat(32));

        const callKind = buildTokenTransferCall(contract, recipient.publicKey, 750_000n, 120_000n);
        const signed = signAndSerializeTransaction(
          {
            sender: sender.publicKey,
            nonce: 9n,
            kind: callKind,
            fee: 18_500n,
          },
          sender.secretKey,
          CHAIN_IDS.TESTNET,
        );

        const inspected = inspectRawSignedCallTx(`0x${signed.rawTxHex}`, {
          chainId: BigInt(CHAIN_IDS.TESTNET),
        });

        expect(inspected.signatureValid).toBe(true);
        expect(inspected.senderHex).toBe(`0x${sender.publicKeyHex}`);
        expect(inspected.contractHex).toBe(`0x${"33".repeat(32)}`);
        expect(inspected.method).toBe("token_transfer");
        expect(inspected.nonce).toBe("9");
        expect(inspected.fee).toBe("18500");
        expect(inspected.callValue).toBe("0");
        expect(inspected.gasLimit).toBe("120000");
        expect(inspected.chainId).toBe(CHAIN_IDS.TESTNET);
        expect(inspected.wireSizeBytes).toBe(signed.txSize);
        expect(inspected.argsByteLength).toBe(callKind.args.length);
        expect(inspected.signingHashHex).toBe(`0x${signed.sighashHex}`);
        expect(inspected.signatureHex).toBe(`0x${signed.signatureHex}`);

        // Must be cleanly JSON-serializable without custom bigint replacer
        const serialized = JSON.stringify(inspected);
        expect(serialized).toContain('"signatureValid":true');
        expect(serialized).toContain('"method":"token_transfer"');

        // Explicit matching publicKeyHex verifies true; mismatched publicKeyHex verifies false
        expect(
          inspectRawSignedCallTx(signed.rawTxHex, {
            chainId: CHAIN_IDS.TESTNET,
            publicKeyHex: `0x${sender.publicKeyHex}`,
          }).signatureValid,
        ).toBe(true);
        expect(
          inspectRawSignedCallTx(signed.rawTxHex, {
            chainId: CHAIN_IDS.TESTNET,
            publicKeyHex: recipient.publicKeyHex,
          }).signatureValid,
        ).toBe(false);

        // Wrong chainId invalidates the recomputed signing hash
        expect(
          inspectRawSignedCallTx(signed.rawTxHex, {
            chainId: CHAIN_IDS.MAINNET,
          }).signatureValid,
        ).toBe(false);

        // Direct SDK re-exports work identically
        const rawDecoded = decodeSignedCallTransaction(signed.rawTxHex, {
          chainId: CHAIN_IDS.TESTNET,
        });
        expect(verifyCallTransactionSignature(rawDecoded)).toBe(true);
        expect(verifyEd25519(rawDecoded.signature, rawDecoded.signingHash, sender.publicKey)).toBe(
          true,
        );
      });

      it("detects tampered signatures and fails closed on malformed raw wire tx hex", () => {
        const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
        const sender = accounts[0];
        const contract = hexToBytes("44".repeat(32));
        const callKind = buildNameRegisterCallTx(
          contract,
          "bob",
          accounts[1].publicKey,
          ["https://relay.kovanica.org"],
        );
        const signed = signAndSerializeTransaction(
          {
            sender: sender.publicKey,
            nonce: 1n,
            kind: callKind,
            fee: 12_000n,
          },
          sender.secretKey,
          CHAIN_IDS.TESTNET,
        );

        // Flip one byte inside the 64-byte signature (which precedes the 32-byte wire hash)
        const tamperedBytes = new Uint8Array(signed.rawTxBytes);
        const sigByteIndex = tamperedBytes.length - 32 - 1;
        tamperedBytes[sigByteIndex] ^= 0xff;
        const tamperedHex = bytesToHex(tamperedBytes);

        const tamperedResult = inspectRawSignedCallTx(tamperedHex, {
          chainId: CHAIN_IDS.TESTNET,
        });
        expect(tamperedResult.method).toBe("name_register");
        expect(tamperedResult.signatureValid).toBe(false);

        // Malformed / truncated hex throws KovanicaDecodeError
        expect(() => inspectRawSignedCallTx("0xdeadbeef")).toThrow(KovanicaDecodeError);
        expect(() => inspectRawSignedCallTx("0xzzzz")).toThrow(KovanicaDecodeError);
        expect(() => inspectRawSignedCallTx("")).toThrow(KovanicaDecodeError);

        // Invalid publicKeyHex throws KovanicaDecodeError
        expect(() =>
          inspectRawSignedCallTx(signed.rawTxHex, {
            chainId: CHAIN_IDS.TESTNET,
            publicKeyHex: "0x1234",
          }),
        ).toThrow(KovanicaDecodeError);
      });

      it("runs runNodeCapabilityProbe with JSON-safe bigint conversion and header inspection", async () => {
        expect(typeof probeRpcNode).toBe("function");

        let clockMs = 1_000;
        const mockFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
          clockMs += 37;
          const batch = JSON.parse(String(init?.body ?? "[]")) as Array<{
            id: number;
            method: string;
          }>;
          const responses = batch.map((req) => {
            if (req.method === "kovanica_chainId") {
              return { jsonrpc: "2.0", id: req.id, result: "0x2" };
            }
            if (req.method === "kovanica_blockNumber") {
              return { jsonrpc: "2.0", id: req.id, result: "0x64" };
            }
            if (req.method === "kovanica_estimateFee") {
              return { jsonrpc: "2.0", id: req.id, result: "0x19" };
            }
            return { jsonrpc: "2.0", id: req.id, result: null };
          });
          return new Response(JSON.stringify(responses), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "X-Kovanica-Network-Tag": "2-24cdb5fadd98b207",
              "X-Kovanica-Rpc-Version": "1.0.0",
              "X-Kovanica-Chain-Id": "2",
            },
          });
        }) as typeof fetch;

        const summary = await runNodeCapabilityProbe("https://testnet.kovanica.test/rpc", {
          fetch: mockFetch,
          expectedChainId: 2,
          now: () => clockMs,
        });

        expect(summary.ok).toBe(true);
        expect(summary.url).toBe("https://testnet.kovanica.test/rpc");
        expect(summary.chainId).toBe("2");
        expect(summary.blockHeight).toBe("100");
        expect(summary.feeRate).toBe("25");
        expect(summary.headerChainId).toBe("2");
        expect(summary.batchSupported).toBe(true);
        expect(summary.networkTag).toBe("2-24cdb5fadd98b207");
        expect(summary.rpcVersion).toBe("1.0.0");
        expect(summary.canonicalTagMatch).toBe(true);
        expect(summary.latencyMs).toBe(37);
        expect(summary.error).toBeUndefined();

        // Must be cleanly JSON-serializable without custom bigint replacer
        const serialized = JSON.stringify(summary);
        expect(serialized).toContain('"networkTag":"2-24cdb5fadd98b207"');
        expect(serialized).toContain('"blockHeight":"100"');

        // Mismatched canonical network tag fails closed
        const badTagFetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
          const batch = JSON.parse(String(init?.body ?? "[]")) as Array<{
            id: number;
            method: string;
          }>;
          const responses = batch.map((req) => ({
            jsonrpc: "2.0",
            id: req.id,
            result: req.method === "kovanica_chainId" ? "0x2" : "0x1",
          }));
          return new Response(JSON.stringify(responses), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "X-Kovanica-Network-Tag": "2-0000000000000000",
            },
          });
        }) as typeof fetch;

        const badTagSummary = await runNodeCapabilityProbe("https://spoofed.kovanica.test/rpc", {
          fetch: badTagFetch,
        });
        expect(badTagSummary.ok).toBe(false);
        expect(badTagSummary.canonicalTagMatch).toBe(false);
        expect(badTagSummary.networkTag).toBe("2-0000000000000000");

        // Transport failure returns ok: false with batchSupported: false
        const failingFetch = (async () => {
          throw new Error("ECONNREFUSED");
        }) as typeof fetch;

        const failedSummary = await runNodeCapabilityProbe("http://127.0.0.1:9999/rpc", {
          fetch: failingFetch,
        });
        expect(failedSummary.ok).toBe(false);
        expect(failedSummary.batchSupported).toBe(false);
        expect(failedSummary.error).toBeTruthy();
      });
    });

    describe("Address Inspector & Transfer Tx Verifier", () => {
      it("inspects PRO-21 and legacy hex addresses with Chain 1/2/3 policy validation via inspectAddress", () => {
        // Valid Mainnet PRO-21 address
        const mainnetRes = inspectAddress(goldenCanonicalAddr, CHAIN_IDS.MAINNET);
        expect(mainnetRes.valid).toBe(true);
        expect(mainnetRes.format).toBe("pro21-mainnet");
        expect(mainnetRes.checksumValid).toBe(true);
        expect(mainnetRes.chainAllowed).toBe(true);
        expect(mainnetRes.payloadHex).toBe(`0x${goldenPubkey}`);
        expect(mainnetRes.canonicalMainnet).toBe(goldenCanonicalAddr);
        expect(mainnetRes.canonicalTestnet).toBe(goldenTestnetAddr);

        // Valid Testnet PRO-21 address
        const testnetRes = inspectAddress(goldenTestnetAddr, CHAIN_IDS.TESTNET);
        expect(testnetRes.valid).toBe(true);
        expect(testnetRes.format).toBe("pro21-testnet");
        expect(testnetRes.checksumValid).toBe(true);
        expect(testnetRes.chainAllowed).toBe(true);

        // Legacy 64-hex address: rejected on Mainnet (1) and Testnet (2), allowed on Devnet (3)
        const legacyHex = `0x${goldenPubkey}`;
        const legacyMainnet = inspectAddress(legacyHex, CHAIN_IDS.MAINNET);
        expect(legacyMainnet.format).toBe("legacy-hex");
        expect(legacyMainnet.chainAllowed).toBe(false);

        const legacyTestnet = inspectAddress(legacyHex, CHAIN_IDS.TESTNET);
        expect(legacyTestnet.format).toBe("legacy-hex");
        expect(legacyTestnet.chainAllowed).toBe(false);

        const legacyDevnet = inspectAddress(legacyHex, CHAIN_IDS.DEVNET);
        expect(legacyDevnet.valid).toBe(true);
        expect(legacyDevnet.format).toBe("legacy-hex");
        expect(legacyDevnet.chainAllowed).toBe(true);
        expect(legacyDevnet.canonicalMainnet).toBe(goldenCanonicalAddr);

        // Invalid address never throws
        const badRes = inspectAddress("kvncinvalidchecksum000000000000000000000000000000000000000000dag");
        expect(badRes.valid).toBe(false);
        expect(badRes.checksumValid).toBe(false);
        expect(badRes.format).toBe("invalid");

        // normalizeAddressList deduplicates and separates invalid entries
        const normalized = normalizeAddressList([
          goldenCanonicalAddr,
          goldenTestnetAddr,
          "not-an-address",
        ]);
        expect(normalized.valid).toEqual([goldenCanonicalAddr]);
        expect(normalized.invalid).toHaveLength(1);
        expect(normalized.invalid[0].input).toBe("not-an-address");
      });

      it("decodes and verifies a valid signed Transfer transaction offline via inspectRawSignedTransferTx", () => {
        const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
        const sender = accounts[0];
        const recipient = accounts[1];

        const signed = signTransferTransaction({
          privateKey: sender.secretKey,
          to: recipient.testnetAddress,
          amount: 2_500_000_000n,
          nonce: 12n,
          fee: 10_000n,
          chainId: CHAIN_IDS.TESTNET,
        });

        const inspected = inspectRawSignedTransferTx(`0x${signed.rawTxHex}`, {
          chainId: BigInt(CHAIN_IDS.TESTNET),
        });

        expect(inspected.signatureValid).toBe(true);
        expect(inspected.senderHex).toBe(`0x${sender.publicKeyHex}`);
        expect(inspected.recipientHex).toBe(`0x${recipient.publicKeyHex}`);
        expect(inspected.nonce).toBe("12");
        expect(inspected.amount).toBe("2500000000");
        expect(inspected.fee).toBe("10000");
        expect(inspected.chainId).toBe(String(CHAIN_IDS.TESTNET));
        expect(inspected.wireSizeBytes).toBe(196);
        expect(inspected.signingHashHex).toBe(`0x${signed.signingHashHex}`);
        expect(inspected.signatureHex).toBe(`0x${signed.signatureHex}`);

        // Must be cleanly JSON-serializable without custom bigint replacer
        const serialized = JSON.stringify(inspected);
        expect(serialized).toContain('"signatureValid":true');
        expect(serialized).toContain('"amount":"2500000000"');

        // Explicit matching publicKeyHex verifies true; mismatched publicKeyHex verifies false
        expect(
          inspectRawSignedTransferTx(signed.rawTxHex, {
            chainId: CHAIN_IDS.TESTNET,
            publicKeyHex: `0x${sender.publicKeyHex}`,
          }).signatureValid,
        ).toBe(true);
        expect(
          inspectRawSignedTransferTx(signed.rawTxHex, {
            chainId: CHAIN_IDS.TESTNET,
            publicKeyHex: recipient.publicKeyHex,
          }).signatureValid,
        ).toBe(false);

        // Wrong chainId invalidates the recomputed signing hash
        expect(
          inspectRawSignedTransferTx(signed.rawTxHex, {
            chainId: CHAIN_IDS.MAINNET,
          }).signatureValid,
        ).toBe(false);

        // Direct SDK re-exports work identically
        const rawDecoded = decodeSignedTransferTransaction(signed.rawTxHex, {
          chainId: CHAIN_IDS.TESTNET,
        });
        expect(verifyTransferTransactionSignature(rawDecoded)).toBe(true);
        const recomputedHash = computeTransferTransactionSigningHash(
          {
            sender: sender.publicKey,
            to: recipient.publicKey,
            amount: 2_500_000_000n,
            nonce: 12n,
            fee: 10_000n,
          },
          CHAIN_IDS.TESTNET,
        );
        expect(bytesToHex(recomputedHash)).toBe(signed.signingHashHex);
      });

      it("detects tampered Transfer signatures and fails closed on malformed raw wire tx hex", () => {
        const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
        const sender = accounts[0];
        const recipient = accounts[1];

        const signed = signTransferTransaction({
          privateKey: sender.secretKey,
          to: recipient.publicKey,
          amount: 1_000_000n,
          nonce: 3n,
          fee: 10_000n,
          chainId: CHAIN_IDS.TESTNET,
        });

        // Flip one byte inside the 64-byte signature (which precedes the 32-byte wire hash)
        const tamperedBytes = new Uint8Array(signed.rawTxBytes);
        const sigByteIndex = tamperedBytes.length - 32 - 1;
        tamperedBytes[sigByteIndex] ^= 0xff;
        const tamperedHex = bytesToHex(tamperedBytes);

        const tamperedResult = inspectRawSignedTransferTx(tamperedHex, {
          chainId: CHAIN_IDS.TESTNET,
        });
        expect(tamperedResult.amount).toBe("1000000");
        expect(tamperedResult.signatureValid).toBe(false);

        // Malformed / truncated / empty hex throws KovanicaDecodeError
        expect(() => inspectRawSignedTransferTx("0xdeadbeef")).toThrow(KovanicaDecodeError);
        expect(() => inspectRawSignedTransferTx("0xzzzz")).toThrow(KovanicaDecodeError);
        expect(() => inspectRawSignedTransferTx("")).toThrow(KovanicaDecodeError);

        // Invalid publicKeyHex throws KovanicaDecodeError
        expect(() =>
          inspectRawSignedTransferTx(signed.rawTxHex, {
            chainId: CHAIN_IDS.TESTNET,
            publicKeyHex: "0x1234",
          }),
        ).toThrow(KovanicaDecodeError);
      });
    });

    describe("Universal Tx Auto-Decoder & Air-Gap Envelope Studio", () => {
      it("auto-decodes and verifies both signed Transfer and signed Call transactions via inspectAnySignedTx", () => {
        const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
        const sender = accounts[0];
        const recipient = accounts[1];

        // 1. Signed Transfer (variant 0)
        const signedTransfer = signTransferTransaction({
          privateKey: sender.secretKey,
          to: recipient.testnetAddress,
          amount: 1_250_000_000n,
          nonce: 9n,
          fee: 10_000n,
          chainId: CHAIN_IDS.TESTNET,
        });

        expect(peekTransactionVariant(signedTransfer.rawTxHex)).toBe(0);
        const rawAutoTransfer = decodeSignedTransactionAuto(signedTransfer.rawTxHex, {
          chainId: CHAIN_IDS.TESTNET,
        });
        expect(rawAutoTransfer.kind).toBe("transfer");
        expect(verifySignedTransactionAuto(rawAutoTransfer)).toBe(true);

        const inspectedTransfer = inspectAnySignedTx(`0x${signedTransfer.rawTxHex}`, {
          chainId: CHAIN_IDS.TESTNET,
        });
        expect(inspectedTransfer.kind).toBe("transfer");
        expect(inspectedTransfer.variant).toBe(0);
        expect(inspectedTransfer.signatureValid).toBe(true);
        if (inspectedTransfer.kind === "transfer") {
          expect(inspectedTransfer.amount).toBe("1250000000");
          expect(inspectedTransfer.nonce).toBe("9");
          expect(inspectedTransfer.fee).toBe("10000");
          expect(inspectedTransfer.recipientHex).toBe(`0x${recipient.publicKeyHex}`);
        }
        expect(JSON.stringify(inspectedTransfer)).toContain('"kind":"transfer"');

        // 2. Signed Wasmi Call (variant 6)
        const contract = hexToBytes("33".repeat(32));
        const callKind = buildNameRegisterCallTx(
          contract,
          "alice",
          recipient.publicKey,
          ["https://relay1.kovanica.org"],
        );
        const signedCall = signAndSerializeTransaction(
          {
            sender: sender.publicKey,
            nonce: 10n,
            kind: callKind,
            fee: 25_000n,
          },
          sender.secretKey,
          CHAIN_IDS.TESTNET,
        );

        expect(peekTransactionVariant(signedCall.rawTxHex)).toBe(6);
        const rawAutoCall = decodeSignedTransactionAuto(signedCall.rawTxHex, {
          chainId: CHAIN_IDS.TESTNET,
        });
        expect(rawAutoCall.kind).toBe("call");
        expect(verifySignedTransactionAuto(rawAutoCall)).toBe(true);

        const inspectedCall = inspectAnySignedTx(signedCall.rawTxHex, {
          chainId: BigInt(CHAIN_IDS.TESTNET),
        });
        expect(inspectedCall.kind).toBe("call");
        expect(inspectedCall.variant).toBe(6);
        expect(inspectedCall.signatureValid).toBe(true);
        if (inspectedCall.kind === "call") {
          expect(inspectedCall.method).toBe("name_register");
          expect(inspectedCall.nonce).toBe("10");
          expect(inspectedCall.fee).toBe("25000");
          expect(inspectedCall.gasLimit).toBe("100000");
          expect(inspectedCall.contractHex).toBe(`0x${"33".repeat(32)}`);
        }
        expect(JSON.stringify(inspectedCall)).toContain('"kind":"call"');

        // Wrong chainId or wrong publicKeyHex override fails signature verification
        expect(
          inspectAnySignedTx(signedTransfer.rawTxHex, {
            chainId: CHAIN_IDS.MAINNET,
          }).signatureValid,
        ).toBe(false);
        expect(
          inspectAnySignedTx(signedCall.rawTxHex, {
            chainId: CHAIN_IDS.TESTNET,
            publicKeyHex: recipient.publicKeyHex,
          }).signatureValid,
        ).toBe(false);
      });

      it("detects tampered Transfer and Call signatures and fails closed on malformed hex in inspectAnySignedTx", () => {
        const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
        const sender = accounts[0];
        const recipient = accounts[1];

        const signedTransfer = signTransferTransaction({
          privateKey: sender.secretKey,
          to: recipient.publicKey,
          amount: 500_000n,
          nonce: 1n,
          fee: 10_000n,
          chainId: CHAIN_IDS.TESTNET,
        });
        const tamperedTransferBytes = new Uint8Array(signedTransfer.rawTxBytes);
        tamperedTransferBytes[tamperedTransferBytes.length - 32 - 1] ^= 0xff;
        const tamperedTransfer = inspectAnySignedTx(bytesToHex(tamperedTransferBytes), {
          chainId: CHAIN_IDS.TESTNET,
        });
        expect(tamperedTransfer.kind).toBe("transfer");
        expect(tamperedTransfer.signatureValid).toBe(false);

        const contract = hexToBytes("44".repeat(32));
        const signedCall = signAndSerializeTransaction(
          {
            sender: sender.publicKey,
            nonce: 2n,
            kind: buildTokenTransferCall(contract, recipient.publicKey, 100n),
            fee: 15_000n,
          },
          sender.secretKey,
          CHAIN_IDS.TESTNET,
        );
        const tamperedCallBytes = new Uint8Array(signedCall.rawTxBytes);
        tamperedCallBytes[tamperedCallBytes.length - 32 - 1] ^= 0xff;
        const tamperedCall = inspectAnySignedTx(bytesToHex(tamperedCallBytes), {
          chainId: CHAIN_IDS.TESTNET,
        });
        expect(tamperedCall.kind).toBe("call");
        expect(tamperedCall.signatureValid).toBe(false);

        expect(() => inspectAnySignedTx("0xdeadbeef")).toThrow(KovanicaDecodeError);
        expect(() => inspectAnySignedTx("")).toThrow(KovanicaDecodeError);
      });

      it("encodes, decodes, and verifies air-gap tx envelopes with BLAKE3 checksum and canonical network-tag pinning", () => {
        expect(AIRGAP_ENVELOPE_PREFIX).toBe("kvnc-tx:v1:");
        expect(AIRGAP_ENVELOPE_VERSION).toBe(1);

        const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.TESTNET);
        const sender = accounts[0];
        const recipient = accounts[1];

        const signedTransfer = signTransferTransaction({
          privateKey: sender.secretKey,
          to: recipient.testnetAddress,
          amount: 3_000_000_000n,
          nonce: 4n,
          fee: 10_000n,
          chainId: CHAIN_IDS.TESTNET,
        });

        const wrapped = encodeAirgapTxEnvelope({
          chainId: CHAIN_IDS.TESTNET,
          kind: "transfer",
          rawTxHex: signedTransfer.rawTxHex,
          signingHashHex: signedTransfer.signingHashHex,
        });

        expect(wrapped.encoded.startsWith(AIRGAP_ENVELOPE_PREFIX)).toBe(true);
        expect(wrapped.envelope.version).toBe(1);
        expect(wrapped.envelope.chainId).toBe(CHAIN_IDS.TESTNET);
        expect(wrapped.envelope.networkTag).toBe("2-24cdb5fadd98b207");
        expect(wrapped.envelope.kind).toBe("transfer");
        expect(wrapped.envelope.rawTxHex).toBe(`0x${signedTransfer.rawTxHex}`);
        expect(wrapped.envelope.checksumHex).toMatch(/^[0-9a-f]{16}$/);

        // Round-trip from compact kvnc-tx:v1:... string
        const decodedCompact = decodeAirgapTxEnvelope(wrapped.encoded, {
          expectedChainId: CHAIN_IDS.TESTNET,
        });
        expect(decodedCompact).toEqual(wrapped.envelope);

        // Auto-verify embedded tx from decoded envelope
        const verifiedInner = inspectAnySignedTx(decodedCompact.rawTxHex, {
          chainId: decodedCompact.chainId,
        });
        expect(verifiedInner.kind).toBe("transfer");
        expect(verifiedInner.signatureValid).toBe(true);

        // Round-trip from raw JSON string
        const decodedJson = decodeAirgapTxEnvelope(JSON.stringify(wrapped.envelope));
        expect(decodedJson).toEqual(wrapped.envelope);

        // Fail closed on expectedChainId mismatch
        expect(() =>
          decodeAirgapTxEnvelope(wrapped.encoded, { expectedChainId: CHAIN_IDS.MAINNET }),
        ).toThrow(KovanicaDecodeError);

        // Fail closed on tampered checksum
        const badChecksumEnvelope = {
          ...wrapped.envelope,
          checksumHex: "0000000000000000",
        };
        expect(() => decodeAirgapTxEnvelope(JSON.stringify(badChecksumEnvelope))).toThrow(
          KovanicaDecodeError,
        );

        // Fail closed on spoofed canonical network tag for Chain 2
        expect(() =>
          encodeAirgapTxEnvelope({
            chainId: CHAIN_IDS.TESTNET,
            networkTag: "2-0000000000000000",
            kind: "transfer",
            rawTxHex: signedTransfer.rawTxHex,
          }),
        ).toThrow(KovanicaDecodeError);

        // Fail closed on malformed framing
        expect(() => decodeAirgapTxEnvelope("kvnc-tx:v2:invalid")).toThrow(KovanicaDecodeError);
      });
    });

    describe("Mempool Fee-Tier Estimator (kovanica-sdk v0.5.0)", () => {
      it("re-exports parseMempoolFeeStats and computeFeeRecommendations directly from kovanica-sdk", () => {
        const parsed = parseMempoolFeeStats({
          pending_count: 14,
          total_bytes: 4200,
          min_fee_per_byte: "0x0a",
          p50_fee_per_byte: "0x14",
          p90_fee_per_byte: "0x32",
          max_fee_per_byte: "0x64",
        });

        expect(parsed).toEqual({
          pendingCount: 14,
          totalBytes: 4200,
          minFeePerByte: 10n,
          p50FeePerByte: 20n,
          p90FeePerByte: 50n,
          maxFeePerByte: 100n,
        });

        const recs = computeFeeRecommendations(parsed);
        expect(recs.source).toBe("mempool");
        expect(recs.economy).toBe(10n);
        expect(recs.standard).toBeGreaterThanOrEqual(recs.economy);
        expect(recs.priority).toBeGreaterThanOrEqual(recs.standard);
      });

      it("computes JSON-safe fee-tier recommendations from a populated mempool via runMempoolFeeTierProbe", async () => {
        let estimateFeeCalls = 0;
        const populatedStats: MempoolFeeStats = {
          pendingCount: 25,
          totalBytes: 8_192,
          minFeePerByte: 10n,
          p50FeePerByte: 25n,
          p90FeePerByte: 60n,
          maxFeePerByte: 120n,
        };

        const result = await runMempoolFeeTierProbe({
          getMempoolStats: async () => populatedStats,
          estimateFee: async () => {
            estimateFeeCalls += 1;
            return 15n;
          },
        });

        expect(estimateFeeCalls).toBe(0);
        expect(result.source).toBe("mempool");
        expect(result.pendingCount).toBe(25);
        expect(result.totalBytes).toBe(8_192);
        expect(result.economyAtoms).toBe("10");
        expect(BigInt(result.standardAtoms)).toBeGreaterThanOrEqual(BigInt(result.economyAtoms));
        expect(BigInt(result.priorityAtoms)).toBeGreaterThanOrEqual(BigInt(result.standardAtoms));
        expect(() => JSON.stringify(result)).not.toThrow();
      });

      it("falls back gracefully to estimateFee() when the mempool is empty", async () => {
        let estimateFeeCalls = 0;
        const emptyStats: MempoolFeeStats = {
          pendingCount: 0,
          totalBytes: 0,
          minFeePerByte: null,
          p50FeePerByte: null,
          p90FeePerByte: null,
          maxFeePerByte: null,
        };

        const result = await runMempoolFeeTierProbe({
          getMempoolStats: async () => emptyStats,
          estimateFee: async () => {
            estimateFeeCalls += 1;
            return 20n;
          },
        });

        expect(estimateFeeCalls).toBe(1);
        expect(result.source).toBe("fallback");
        expect(result.pendingCount).toBe(0);
        expect(result.totalBytes).toBe(0);
        expect(result.economyAtoms).toBe("20");
        expect(BigInt(result.standardAtoms)).toBeGreaterThanOrEqual(20n);
        expect(BigInt(result.priorityAtoms)).toBeGreaterThanOrEqual(BigInt(result.standardAtoms));
      });

      it("falls back gracefully to estimateFee() when getMempoolStats() fails on legacy nodes", async () => {
        let estimateFeeCalls = 0;

        const result = await runMempoolFeeTierProbe({
          getMempoolStats: async () => {
            throw new Error("RPC -32601: Method not found (kovanica_mempoolStats)");
          },
          estimateFee: async () => {
            estimateFeeCalls += 1;
            return 30n;
          },
        });

        expect(estimateFeeCalls).toBe(1);
        expect(result.source).toBe("fallback");
        expect(result.pendingCount).toBe(0);
        expect(result.totalBytes).toBe(0);
        expect(result.economyAtoms).toBe("30");
        expect(BigInt(result.standardAtoms)).toBeGreaterThanOrEqual(30n);
        expect(BigInt(result.priorityAtoms)).toBeGreaterThanOrEqual(BigInt(result.standardAtoms));
        expect(() => JSON.stringify(result)).not.toThrow();
      });
    });

    describe("Watch-Only Account Inspector & Account Tx History Explorer", () => {
      const goldenMainnet =
        "kvncschhpna0ex6cz6vl34n4nr4vdxwtey4alj2qa90d0ms73kqspel0nuhe8dag";
      const goldenTestnet =
        "tkncschhpna0ex6cz6vl34n4nr4vdxwtey4alj2qa90d0ms73kqspel0nuhe8dag";

      it("inspects valid PRO-21 mainnet and testnet accounts with canSign: false", () => {
        const mainnetRes = inspectWatchOnlyAccount(goldenMainnet, CHAIN_IDS.MAINNET);
        expect(mainnetRes.ok).toBe(true);
        if (mainnetRes.ok) {
          expect(mainnetRes.account.network).toBe("mainnet");
          expect(mainnetRes.account.chainId).toBe(1);
          expect(mainnetRes.account.readOnly).toBe(true);
          expect(mainnetRes.account.isWatchOnly).toBe(true);
          expect(mainnetRes.account.canSign).toBe(false);
          expect(mainnetRes.account.canonicalMainnet).toBe(goldenMainnet);
          expect(mainnetRes.account.canonicalTestnet).toBe(goldenTestnet);
        }

        const testnetAuto = inspectWatchOnlyAccount(goldenTestnet);
        expect(testnetAuto.ok).toBe(true);
        if (testnetAuto.ok) {
          expect(testnetAuto.account.network).toBe("testnet");
          expect(testnetAuto.account.chainId).toBe(2);
          expect(testnetAuto.account.canSign).toBe(false);
        }

        // Direct SDK re-export parity
        expect(createWatchOnlyAccount(goldenMainnet).address).toBe(goldenMainnet);
      });

      it("rejects empty, legacy hex, malformed, and chain-mismatched watch-only inputs", () => {
        expect(inspectWatchOnlyAccount("").ok).toBe(false);
        expect(inspectWatchOnlyAccount("0x" + "11".repeat(32), CHAIN_IDS.DEVNET).ok).toBe(false);
        expect(inspectWatchOnlyAccount(goldenTestnet, CHAIN_IDS.MAINNET).ok).toBe(false);
        expect(inspectWatchOnlyAccount("not-an-address").ok).toBe(false);
      });

      it("re-exports parseBip44Path and validateBip44Path from kovanica-sdk", () => {
        const parsed = parseBip44Path("m/44'/3007'/0'/0'/0'", { requireAllHardened: true });
        expect(parsed.coinType).toBe(3007);
        expect(parsed.allHardened).toBe(true);
        expect(validateBip44Path("m/44'/3007'/0'/0'/0'", { requireAllHardened: true }).valid).toBe(true);
        expect(validateBip44Path("m/44'/60'/0'/0/0").valid).toBe(false);
      });

      it("fetches and formats lossless account tx history with direction filtering and pagination", async () => {
        const seenParams: unknown[] = [];
        const summary = await fetchAccountTxHistorySummary(
          {
            getTransactionHistory: async (params) => {
              seenParams.push(params);
              if (!params.cursor) {
                return {
                  entries: [
                    {
                      hash: "0x" + "ab".repeat(32),
                      height: "0x100",
                      timestamp: "1750000000000",
                      from: goldenMainnet,
                      to: goldenTestnet,
                      amount: "9007199254740993000", // > Number.MAX_SAFE_INTEGER
                      fee: "15000",
                      kind: "transfer",
                      status: "success",
                    },
                  ],
                  next_cursor: "next-cur-1",
                };
              }
              return { entries: [], next_cursor: null };
            },
          },
          {
            address: goldenMainnet,
            direction: "received",
            limit: 10,
            maxPages: 1,
          },
        );

        expect(seenParams).toEqual([
          { address: goldenMainnet, direction: "received", limit: 10 },
        ]);
        expect(summary.direction).toBe("received");
        expect(summary.pagesFetched).toBe(1);
        expect(summary.hasMore).toBe(true);
        expect(summary.nextCursor).toBe("next-cur-1");
        expect(summary.items).toHaveLength(1);
        expect(summary.items[0].height).toBe("256");
        expect(summary.items[0].amountAtoms).toBe("9007199254740993000");
        expect(summary.items[0].amountKvnc).toBe("9007199254.740993");
        expect(summary.items[0].feeAtoms).toBe("15000");
        expect(summary.items[0].feeKvnc).toBe("0.000015");
        expect(() => JSON.stringify(summary)).not.toThrow();

        // Direct SDK re-export parity
        const rawRes = await getAccountTxHistory(
          {
            getTransactionHistory: async () => ({ entries: [], next_cursor: null }),
          },
          { address: goldenMainnet, direction: "all" },
        );
        expect(rawRes.items).toEqual([]);
        expect(rawRes.hasMore).toBe(false);
      });
    });
  });
});
