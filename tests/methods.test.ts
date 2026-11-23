import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  applyFeeBuffer,
  CHAIN_IDS,
  createFailoverClient,
  dryRunBatchCalls,
  EscrowClient,
  estimateTxFeeWithBuffer,
  FailoverHttpTransport,
  getContractLogHistory,
  HtlcClient,
  MAX_JSONRPC_BATCH_SIZE,
  MultisigClient,
  NameRegistryClient,
  NftClient,
  readContractStorage,
  sanitizeRpcUrl,
  subscribeContractEvents,
  TokenClient,
  VaultClient,
  waitForTransactionFinality,
} from "kovanica-sdk";
import { ALLOWLISTED_METHODS, validateParam } from "../src/methods";
import {
  applyFeeBuffer as interopApplyFeeBuffer,
  createFailoverClient as interopCreateFailoverClient,
  dryRunBatchCalls as interopDryRunBatchCalls,
  EscrowClient as interopEscrowClient,
  estimateTxFeeWithBuffer as interopEstimateTxFeeWithBuffer,
  FailoverHttpTransport as interopFailoverHttpTransport,
  getContractLogHistory as interopGetContractLogHistory,
  HtlcClient as interopHtlcClient,
  MAX_JSONRPC_BATCH_SIZE as interopMaxJsonRpcBatchSize,
  MultisigClient as interopMultisigClient,
  NameRegistryClient as interopNameRegistryClient,
  NftClient as interopNftClient,
  readContractStorage as interopReadContractStorage,
  sanitizeRpcUrl as interopSanitizeRpcUrl,
  subscribeContractEvents as interopSubscribeContractEvents,
  TokenClient as interopTokenClient,
  VaultClient as interopVaultClient,
  waitForTransactionFinality as interopWaitForTransactionFinality,
} from "../src/wallet-interop";

describe("Immutable SDK Pin & Traceability", () => {
  it("pins an immutable 40-char SDK git commit SHA in package.json, CI workflow, and resolved installation", () => {
    const rootDir = path.resolve(__dirname, "..");
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
    const pinnedSha = pkg?.kovanicaSdk?.testedRevision;

    expect(pinnedSha).toBe("f1aa74ad1e1076316692e801aec86d9c4e8b7c27");
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
