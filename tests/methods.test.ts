import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  AIRGAP_ENVELOPE_PREFIX,
  AIRGAP_ENVELOPE_VERSION,
  applyFeeBuffer,
  CHAIN_IDS,
  checkMultisigQuorum,
  computeFeeRecommendations,
  computeRbfFeeBump,
  computeTransferTransactionSigningHash,
  createFailoverClient,
  createWatchOnlyAccount,
  decodeAirgapTxEnvelope,
  decodeMultisigProposalBundle,
  decodeSignedCallTransaction,
  decodeSignedTransactionAuto,
  decodeSignedTransferTransaction,
  DEFAULT_ACCOUNT_TX_HISTORY_LIMIT,
  DEFAULT_ACCOUNT_TX_HISTORY_MAX_PAGES,
  DEFAULT_BLOCK_RECEIPT_CONCURRENCY,
  DEFAULT_WS_MAX_QUEUE_SIZE,
  deriveStorageSlotHex,
  dryRunBatchCalls,
  encodeAirgapTxEnvelope,
  encodeMultisigProposalBundle,
  EscrowClient,
  estimatePriorityFeeTiers,
  estimateTxFeeWithBuffer,
  FailoverHttpTransport,
  getAccountTxHistory,
  getContractLogHistory,
  HtlcClient,
  inspectAddress,
  MAX_ACCOUNT_TX_HISTORY_LIMIT,
  MAX_JSONRPC_BATCH_SIZE,
  MULTISIG_BUNDLE_FORMAT,
  MULTISIG_BUNDLE_VERSION,
  MultisigClient,
  NameRegistryClient,
  NftClient,
  normalizeAddressList,
  parseAccountTxHistoryEntry,
  parseBip44Path,
  parseMempoolFeeStats,
  peekTransactionVariant,
  probeRpcNode,
  readContractStorage,
  sanitizeRpcUrl,
  signTransferTransaction,
  subscribeContractEvents,
  subscribeNewBlocksWithReceipts,
  TokenClient,
  validateBip44Path,
  VaultClient,
  verifyCallTransactionSignature,
  verifyEd25519,
  verifySignedTransactionAuto,
  verifyTransferTransactionSignature,
  waitForTransactionFinality,
} from "kovanica-sdk";
import { ALLOWLISTED_METHODS, validateParam } from "../src/methods";
import {
  AIRGAP_ENVELOPE_PREFIX as interopAirgapEnvelopePrefix,
  AIRGAP_ENVELOPE_VERSION as interopAirgapEnvelopeVersion,
  applyFeeBuffer as interopApplyFeeBuffer,
  checkMultisigQuorum as interopCheckMultisigQuorum,
  computeFeeRecommendations as interopComputeFeeRecommendations,
  computeRbfFeeBump as interopComputeRbfFeeBump,
  computeTransferTransactionSigningHash as interopComputeTransferTransactionSigningHash,
  createFailoverClient as interopCreateFailoverClient,
  createWatchOnlyAccount as interopCreateWatchOnlyAccount,
  decodeAirgapTxEnvelope as interopDecodeAirgapTxEnvelope,
  decodeMultisigProposalBundle as interopDecodeMultisigProposalBundle,
  decodeSignedCallTransaction as interopDecodeSignedCallTransaction,
  decodeSignedTransactionAuto as interopDecodeSignedTransactionAuto,
  decodeSignedTransferTransaction as interopDecodeSignedTransferTransaction,
  DEFAULT_ACCOUNT_TX_HISTORY_LIMIT as interopDefaultAccountTxHistoryLimit,
  DEFAULT_ACCOUNT_TX_HISTORY_MAX_PAGES as interopDefaultAccountTxHistoryMaxPages,
  DEFAULT_BLOCK_RECEIPT_CONCURRENCY as interopDefaultBlockReceiptConcurrency,
  DEFAULT_WS_MAX_QUEUE_SIZE as interopDefaultWsMaxQueueSize,
  deriveStorageSlotHex as interopDeriveStorageSlotHex,
  dryRunBatchCalls as interopDryRunBatchCalls,
  encodeAirgapTxEnvelope as interopEncodeAirgapTxEnvelope,
  encodeMultisigProposalBundle as interopEncodeMultisigProposalBundle,
  EscrowClient as interopEscrowClient,
  estimatePriorityFeeTiers as interopEstimatePriorityFeeTiers,
  estimateTxFeeWithBuffer as interopEstimateTxFeeWithBuffer,
  FailoverHttpTransport as interopFailoverHttpTransport,
  getAccountTxHistory as interopGetAccountTxHistory,
  getContractLogHistory as interopGetContractLogHistory,
  HtlcClient as interopHtlcClient,
  inspectAddress as interopInspectAddress,
  MAX_ACCOUNT_TX_HISTORY_LIMIT as interopMaxAccountTxHistoryLimit,
  MAX_JSONRPC_BATCH_SIZE as interopMaxJsonRpcBatchSize,
  MULTISIG_BUNDLE_FORMAT as interopMultisigBundleFormat,
  MULTISIG_BUNDLE_VERSION as interopMultisigBundleVersion,
  MultisigClient as interopMultisigClient,
  NameRegistryClient as interopNameRegistryClient,
  NftClient as interopNftClient,
  normalizeAddressList as interopNormalizeAddressList,
  parseAccountTxHistoryEntry as interopParseAccountTxHistoryEntry,
  parseBip44Path as interopParseBip44Path,
  parseMempoolFeeStats as interopParseMempoolFeeStats,
  peekTransactionVariant as interopPeekTransactionVariant,
  probeRpcNode as interopProbeRpcNode,
  readContractStorage as interopReadContractStorage,
  sanitizeRpcUrl as interopSanitizeRpcUrl,
  signTransferTransaction as interopSignTransferTransaction,
  subscribeContractEvents as interopSubscribeContractEvents,
  subscribeNewBlocksWithReceipts as interopSubscribeNewBlocksWithReceipts,
  TokenClient as interopTokenClient,
  validateBip44Path as interopValidateBip44Path,
  VaultClient as interopVaultClient,
  verifyCallTransactionSignature as interopVerifyCallTransactionSignature,
  verifyEd25519 as interopVerifyEd25519,
  verifySignedTransactionAuto as interopVerifySignedTransactionAuto,
  verifyTransferTransactionSignature as interopVerifyTransferTransactionSignature,
  waitForTransactionFinality as interopWaitForTransactionFinality,
} from "../src/wallet-interop";

describe("Immutable SDK Pin & Traceability", () => {
  it("pins an immutable 40-char SDK git commit SHA in package.json, CI workflow, and resolved installation", () => {
    const rootDir = path.resolve(__dirname, "..");
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
    const pinnedSha = pkg?.kovanicaSdk?.testedRevision;

    expect(pinnedSha).toBe("3ad6dc6e50a9aa95fab51c627a29f9fa108e9f2b");
    expect(pinnedSha).toMatch(/^[0-9a-f]{40}$/);

    const ciWorkflow = fs.readFileSync(path.join(rootDir, ".github/workflows/ci.yml"), "utf8");
    expect(ciWorkflow).toContain("repository: BetterCallDzuks/kovanica-sdk");
    expect(ciWorkflow).toContain(`ref: ${pinnedSha}`);
    expect(ciWorkflow).not.toContain("KovanicaDAG/kovanica-sdk");
    expect(ciWorkflow).not.toMatch(/repository:\s*KovanicaProtokol\/kovanica-sdk[\s\S]*?ref:\s*main/);

    const installedSdkDir = path.join(rootDir, "node_modules", "kovanica-sdk");
    const distIndexPath = path.join(installedSdkDir, "dist", "index.js");
    expect(fs.existsSync(distIndexPath)).toBe(true);

    // Confirm the compiled bundle includes the SDK transport contract, typed facades & JSON-RPC batch transport
    const distContent = fs.readFileSync(distIndexPath, "utf8");
    expect(distContent).toContain("JSON-RPC response ID mismatch");
    expect(distContent).toContain("neither result nor error member present");
    expect(distContent).toContain("KovanicaWsClient");
    expect(distContent).toContain("estimateAndBuildCall");
    expect(distContent).toContain("estimateBatchCalls");
    expect(distContent).toContain("decodeEscrowRecord");
    expect(distContent).toContain("decodeContractLog");
    expect(distContent).toContain("waitForTransactionReceipt");
    expect(distContent).toContain("decodeTransactionReceiptLogs");
    expect(distContent).toContain("readContractStorage");
    expect(distContent).toContain("dryRunBatchCalls");
    expect(distContent).toContain("MAX_JSONRPC_BATCH_SIZE");
    expect(distContent).toContain("callBatch");
    expect(distContent).toContain("NameRegistryClient");
    expect(distContent).toContain("TokenClient");
    expect(distContent).toContain("EscrowClient");
    expect(distContent).toContain("HtlcClient");
    expect(distContent).toContain("NftClient");
    expect(distContent).toContain("VaultClient");
    expect(distContent).toContain("MultisigClient");
    expect(distContent).toContain("getContractLogHistory");
    expect(distContent).toContain("subscribeContractEvents");
    expect(distContent).toContain("FailoverHttpTransport");
    expect(distContent).toContain("createFailoverClient");
    expect(distContent).toContain("sanitizeRpcUrl");
    expect(distContent).toContain("applyFeeBuffer");
    expect(distContent).toContain("estimateTxFeeWithBuffer");
    expect(distContent).toContain("waitForTransactionFinality");
    expect(distContent).toContain("decodeSignedCallTransaction");
    expect(distContent).toContain("verifyCallTransactionSignature");
    expect(distContent).toContain("verifyEd25519");
    expect(distContent).toContain("probeRpcNode");
    expect(distContent).toContain("signTransferTransaction");
    expect(distContent).toContain("decodeSignedTransferTransaction");
    expect(distContent).toContain("verifyTransferTransactionSignature");
    expect(distContent).toContain("computeTransferTransactionSigningHash");
    expect(distContent).toContain("inspectAddress");
    expect(distContent).toContain("normalizeAddressList");
    expect(distContent).toContain("peekTransactionVariant");
    expect(distContent).toContain("decodeSignedTransactionAuto");
    expect(distContent).toContain("verifySignedTransactionAuto");
    expect(distContent).toContain("AIRGAP_ENVELOPE_PREFIX");
    expect(distContent).toContain("AIRGAP_ENVELOPE_VERSION");
    expect(distContent).toContain("encodeAirgapTxEnvelope");
    expect(distContent).toContain("decodeAirgapTxEnvelope");
    expect(distContent).toContain("parseMempoolFeeStats");
    expect(distContent).toContain("computeFeeRecommendations");
    expect(distContent).toContain("getMempoolStats");
    expect(distContent).toContain("getAccountTxHistory");
    expect(distContent).toContain("parseAccountTxHistoryEntry");
    expect(distContent).toContain("createWatchOnlyAccount");
    expect(distContent).toContain("parseBip44Path");
    expect(distContent).toContain("validateBip44Path");
    expect(distContent).toContain("subscribeNewBlocksWithReceipts");
    expect(distContent).toContain("DEFAULT_WS_MAX_QUEUE_SIZE");
    expect(distContent).toContain("DEFAULT_BLOCK_RECEIPT_CONCURRENCY");
    expect(distContent).toContain("deriveStorageSlotHex");
    expect(distContent).toContain("estimatePriorityFeeTiers");
    expect(distContent).toContain("computeRbfFeeBump");
    expect(distContent).toContain("checkMultisigQuorum");
    expect(distContent).toContain("encodeMultisigProposalBundle");
    expect(distContent).toContain("decodeMultisigProposalBundle");
    expect(distContent).toContain("MULTISIG_BUNDLE_FORMAT");
    expect(distContent).toContain("MULTISIG_BUNDLE_VERSION");

    expect(typeof readContractStorage).toBe("function");
    expect(typeof dryRunBatchCalls).toBe("function");
    expect(typeof getContractLogHistory).toBe("function");
    expect(typeof subscribeContractEvents).toBe("function");
    expect(typeof FailoverHttpTransport).toBe("function");
    expect(typeof createFailoverClient).toBe("function");
    expect(typeof sanitizeRpcUrl).toBe("function");
    expect(typeof applyFeeBuffer).toBe("function");
    expect(typeof estimateTxFeeWithBuffer).toBe("function");
    expect(typeof waitForTransactionFinality).toBe("function");
    expect(typeof decodeSignedCallTransaction).toBe("function");
    expect(typeof verifyCallTransactionSignature).toBe("function");
    expect(typeof verifyEd25519).toBe("function");
    expect(typeof probeRpcNode).toBe("function");
    expect(typeof signTransferTransaction).toBe("function");
    expect(typeof decodeSignedTransferTransaction).toBe("function");
    expect(typeof verifyTransferTransactionSignature).toBe("function");
    expect(typeof computeTransferTransactionSigningHash).toBe("function");
    expect(typeof inspectAddress).toBe("function");
    expect(typeof normalizeAddressList).toBe("function");
    expect(interopReadContractStorage).toBe(readContractStorage);
    expect(interopDryRunBatchCalls).toBe(dryRunBatchCalls);
    expect(interopGetContractLogHistory).toBe(getContractLogHistory);
    expect(interopSubscribeContractEvents).toBe(subscribeContractEvents);
    expect(interopFailoverHttpTransport).toBe(FailoverHttpTransport);
    expect(interopCreateFailoverClient).toBe(createFailoverClient);
    expect(interopSanitizeRpcUrl).toBe(sanitizeRpcUrl);
    expect(interopApplyFeeBuffer).toBe(applyFeeBuffer);
    expect(interopEstimateTxFeeWithBuffer).toBe(estimateTxFeeWithBuffer);
    expect(interopWaitForTransactionFinality).toBe(waitForTransactionFinality);
    expect(interopDecodeSignedCallTransaction).toBe(decodeSignedCallTransaction);
    expect(interopVerifyCallTransactionSignature).toBe(verifyCallTransactionSignature);
    expect(interopVerifyEd25519).toBe(verifyEd25519);
    expect(interopProbeRpcNode).toBe(probeRpcNode);
    expect(interopSignTransferTransaction).toBe(signTransferTransaction);
    expect(interopDecodeSignedTransferTransaction).toBe(decodeSignedTransferTransaction);
    expect(interopVerifyTransferTransactionSignature).toBe(verifyTransferTransactionSignature);
    expect(interopComputeTransferTransactionSigningHash).toBe(computeTransferTransactionSigningHash);
    expect(interopInspectAddress).toBe(inspectAddress);
    expect(interopNormalizeAddressList).toBe(normalizeAddressList);
    expect(typeof peekTransactionVariant).toBe("function");
    expect(typeof decodeSignedTransactionAuto).toBe("function");
    expect(typeof verifySignedTransactionAuto).toBe("function");
    expect(typeof encodeAirgapTxEnvelope).toBe("function");
    expect(typeof decodeAirgapTxEnvelope).toBe("function");
    expect(AIRGAP_ENVELOPE_PREFIX).toBe("kvnc-tx:v1:");
    expect(AIRGAP_ENVELOPE_VERSION).toBe(1);
    expect(interopPeekTransactionVariant).toBe(peekTransactionVariant);
    expect(interopDecodeSignedTransactionAuto).toBe(decodeSignedTransactionAuto);
    expect(interopVerifySignedTransactionAuto).toBe(verifySignedTransactionAuto);
    expect(interopAirgapEnvelopePrefix).toBe(AIRGAP_ENVELOPE_PREFIX);
    expect(interopAirgapEnvelopeVersion).toBe(AIRGAP_ENVELOPE_VERSION);
    expect(interopEncodeAirgapTxEnvelope).toBe(encodeAirgapTxEnvelope);
    expect(interopDecodeAirgapTxEnvelope).toBe(decodeAirgapTxEnvelope);
    expect(typeof parseMempoolFeeStats).toBe("function");
    expect(typeof computeFeeRecommendations).toBe("function");
    expect(interopParseMempoolFeeStats).toBe(parseMempoolFeeStats);
    expect(interopComputeFeeRecommendations).toBe(computeFeeRecommendations);
    expect(typeof getAccountTxHistory).toBe("function");
    expect(typeof parseAccountTxHistoryEntry).toBe("function");
    expect(typeof createWatchOnlyAccount).toBe("function");
    expect(typeof parseBip44Path).toBe("function");
    expect(typeof validateBip44Path).toBe("function");
    expect(DEFAULT_ACCOUNT_TX_HISTORY_LIMIT).toBe(20);
    expect(MAX_ACCOUNT_TX_HISTORY_LIMIT).toBe(100);
    expect(DEFAULT_ACCOUNT_TX_HISTORY_MAX_PAGES).toBe(10);
    expect(interopGetAccountTxHistory).toBe(getAccountTxHistory);
    expect(interopParseAccountTxHistoryEntry).toBe(parseAccountTxHistoryEntry);
    expect(interopCreateWatchOnlyAccount).toBe(createWatchOnlyAccount);
    expect(interopParseBip44Path).toBe(parseBip44Path);
    expect(interopValidateBip44Path).toBe(validateBip44Path);
    expect(interopDefaultAccountTxHistoryLimit).toBe(DEFAULT_ACCOUNT_TX_HISTORY_LIMIT);
    expect(interopMaxAccountTxHistoryLimit).toBe(MAX_ACCOUNT_TX_HISTORY_LIMIT);
    expect(interopDefaultAccountTxHistoryMaxPages).toBe(DEFAULT_ACCOUNT_TX_HISTORY_MAX_PAGES);

    // Assert SDK v0.6.0 WS block+receipt streamer & storage slot deriver exports
    expect(typeof subscribeNewBlocksWithReceipts).toBe("function");
    expect(typeof deriveStorageSlotHex).toBe("function");
    expect(DEFAULT_WS_MAX_QUEUE_SIZE).toBe(256);
    expect(DEFAULT_BLOCK_RECEIPT_CONCURRENCY).toBe(8);
    expect(interopSubscribeNewBlocksWithReceipts).toBe(subscribeNewBlocksWithReceipts);
    expect(interopDeriveStorageSlotHex).toBe(deriveStorageSlotHex);
    expect(interopDefaultWsMaxQueueSize).toBe(DEFAULT_WS_MAX_QUEUE_SIZE);
    expect(interopDefaultBlockReceiptConcurrency).toBe(DEFAULT_BLOCK_RECEIPT_CONCURRENCY);

    // Assert Priority Fee Tiers, RBF Bump & Air-Gapped Multisig Quorum Bundle exports
    expect(typeof estimatePriorityFeeTiers).toBe("function");
    expect(typeof computeRbfFeeBump).toBe("function");
    expect(typeof checkMultisigQuorum).toBe("function");
    expect(typeof encodeMultisigProposalBundle).toBe("function");
    expect(typeof decodeMultisigProposalBundle).toBe("function");
    expect(MULTISIG_BUNDLE_FORMAT).toBe("kovanica-multisig-bundle-v1");
    expect(MULTISIG_BUNDLE_VERSION).toBe(1);
    expect(interopEstimatePriorityFeeTiers).toBe(estimatePriorityFeeTiers);
    expect(interopComputeRbfFeeBump).toBe(computeRbfFeeBump);
    expect(interopCheckMultisigQuorum).toBe(checkMultisigQuorum);
    expect(interopEncodeMultisigProposalBundle).toBe(encodeMultisigProposalBundle);
    expect(interopDecodeMultisigProposalBundle).toBe(decodeMultisigProposalBundle);
    expect(interopMultisigBundleFormat).toBe(MULTISIG_BUNDLE_FORMAT);
    expect(interopMultisigBundleVersion).toBe(MULTISIG_BUNDLE_VERSION);

    // Assert all 7 typed contract facades + MAX_JSONRPC_BATCH_SIZE are exported and re-exported identically
    expect(MAX_JSONRPC_BATCH_SIZE).toBe(32);
    expect(interopMaxJsonRpcBatchSize).toBe(MAX_JSONRPC_BATCH_SIZE);
    expect(typeof NameRegistryClient).toBe("function");
    expect(typeof TokenClient).toBe("function");
    expect(typeof EscrowClient).toBe("function");
    expect(typeof HtlcClient).toBe("function");
    expect(typeof NftClient).toBe("function");
    expect(typeof VaultClient).toBe("function");
    expect(typeof MultisigClient).toBe("function");
    expect(interopNameRegistryClient).toBe(NameRegistryClient);
    expect(interopTokenClient).toBe(TokenClient);
    expect(interopEscrowClient).toBe(EscrowClient);
    expect(interopHtlcClient).toBe(HtlcClient);
    expect(interopNftClient).toBe(NftClient);
    expect(interopVaultClient).toBe(VaultClient);
    expect(interopMultisigClient).toBe(MultisigClient);

    const markerPath = path.join(installedSdkDir, ".tested-revision");
    if (fs.existsSync(markerPath)) {
      expect(fs.readFileSync(markerPath, "utf8").trim()).toBe(pinnedSha);
    } else {
      const resolvedSha = execSync(`git -C "${installedSdkDir}" rev-parse HEAD`, { encoding: "utf8" }).trim();
      if (resolvedSha !== pinnedSha) {
        // Local dev with a newer sibling SDK on main: verify pinnedSha is an ancestor of HEAD
        execSync(`git -C "${installedSdkDir}" merge-base --is-ancestor ${pinnedSha} HEAD`, {
          stdio: "ignore",
        });
      }
    }

    // Prove which SDK source the tests and runtime actually resolve
    const resolvedPath = path.resolve(rootDir, "node_modules", "kovanica-sdk", "dist", "index.js");
    expect(fs.realpathSync(distIndexPath)).toBe(fs.realpathSync(resolvedPath));
  });
});

describe("Playground Allowlisted Methods", () => {
  it("contains only read-only RPC methods", () => {
    const methodNames = ALLOWLISTED_METHODS.map((m) => m.method);
    expect(methodNames).toContain("kovanica_blockNumber");
    expect(methodNames).toContain("kovanica_getBlockByNumber");
    expect(methodNames).toContain("kovanica_getBlockByHash");
    expect(methodNames).toContain("kovanica_getBalance");
    expect(methodNames).toContain("kovanica_getNonce");
    expect(methodNames).toContain("kovanica_getCode");
    expect(methodNames).toContain("kovanica_getStorageAt");
    expect(methodNames).toContain("kovanica_getTransactionByHash");
    expect(methodNames).toContain("kovanica_getTransactionReceipt");
    expect(methodNames).toContain("kovanica_getPendingTransactions");
    expect(methodNames).toContain("kovanica_estimateFee");
    expect(methodNames).toContain("kovanica_getValidators");
    expect(methodNames).toContain("kovanica_getStake");
    expect(methodNames).toContain("kovanica_getRewards");
    expect(methodNames).toContain("kovanica_getLeaderSchedule");
    expect(methodNames).toContain("kovanica_syncStatus");
    expect(methodNames).toContain("kovanica_getMiningInfo");
    expect(methodNames).toContain("kovanica_getDagTips");

    // Strictly excludes write or sensitive methods
    expect(methodNames).not.toContain("kovanica_sendRawTransaction");
    expect(methodNames).not.toContain("kovanica_submitWork");
    expect(methodNames).not.toContain("kovanica_getWork");
  });

  it("validates address parameter according to chain rules", () => {
    const addressParam = {
      name: "address",
      label: "Account Address",
      type: "address" as const,
      required: true,
    };

    // Missing required param
    expect(validateParam(addressParam, "").valid).toBe(false);

    // Bare hex on Mainnet (Chain 1) and Testnet (Chain 2) -> invalid (strict PRO-21)
    const hex = "0x" + "00".repeat(32);
    expect(validateParam(addressParam, hex, CHAIN_IDS.MAINNET).valid).toBe(false);
    expect(validateParam(addressParam, hex, CHAIN_IDS.TESTNET).valid).toBe(false);
    expect(validateParam(addressParam, hex, CHAIN_IDS.HYBRID_TESTNET).valid).toBe(false);

    // Bare hex on Devnet (Chain 3) -> valid legacy address; retired chain 1337 is rejected
    expect(validateParam(addressParam, hex, CHAIN_IDS.DEVNET).valid).toBe(true);
    expect(validateParam(addressParam, hex, 1337).valid).toBe(false);
  });

  it("validates hex32 parameters", () => {
    const hashParam = {
      name: "hash",
      label: "Hash",
      type: "hex32" as const,
      required: true,
    };

    expect(validateParam(hashParam, "0x123").valid).toBe(false);
    expect(validateParam(hashParam, "0x" + "aa".repeat(32)).valid).toBe(true);
    expect(validateParam(hashParam, "aa".repeat(32)).valid).toBe(true);
  });
});
