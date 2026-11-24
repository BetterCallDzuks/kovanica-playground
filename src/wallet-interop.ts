import { blake3 } from "@noble/hashes/blake3.js";
import { sha512 } from "@noble/hashes/sha2.js";
import * as ed from "@noble/ed25519";
import { generateMnemonic as scureGenerateMnemonic, validateMnemonic as scureValidateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  ADDRESS_PREFIX,
  AIRGAP_ENVELOPE_PREFIX,
  AIRGAP_ENVELOPE_VERSION,
  applyFeeBuffer,
  bip39Seed,
  CHAIN_IDS,
  checkMultisigQuorum,
  computeFeeRecommendations,
  computeRbfFeeBump,
  computeTransferTransactionSigningHash,
  ContractFacade,
  createFailoverClient,
  createWatchOnlyAccount,
  decodeAddress,
  decodeAirgapTxEnvelope,
  decodeContractLog,
  decodeEscrowRecord,
  decodeHtlcRecord,
  decodeMultisigProposalBundle,
  decodeMultisigState,
  decodeNameRecord,
  decodeNftMetadata,
  decodeSignedCallTransaction,
  decodeSignedTransactionAuto,
  decodeSignedTransferTransaction,
  decodeTokenMetadata,
  decodeTransactionReceiptLogs,
  decodeVaultRecord,
  DEFAULT_ACCOUNT_TX_HISTORY_LIMIT,
  DEFAULT_ACCOUNT_TX_HISTORY_MAX_PAGES,
  DEFAULT_BLOCK_RECEIPT_CONCURRENCY,
  DEFAULT_HIGH_CONGESTION_PENDING_COUNT,
  DEFAULT_IDEMPOTENT_RPC_METHODS,
  DEFAULT_LOG_HISTORY_CHUNK_SIZE,
  DEFAULT_MODERATE_CONGESTION_PENDING_COUNT,
  DEFAULT_RBF_BUMP_BPS,
  DEFAULT_RBF_MIN_BUMP_ATOMS,
  DEFAULT_WS_MAX_QUEUE_SIZE,
  deriveBip44,
  derivePrefixedStorageSlot,
  deriveStorageSlot,
  deriveStorageSlotHex,
  dryRunBatchCalls,
  encodeAddress,
  encodeAirgapTxEnvelope,
  encodeMultisigProposalBundle,
  EscrowClient,
  estimateAndBuildCall,
  estimateBatchCalls,
  estimateCallTxSize,
  estimatePriorityFeeTiers,
  estimateTxFeeWithBuffer,
  FailoverHttpTransport,
  formatBip44Path,
  formatKvnc,
  getAccountTxHistory,
  getContractLogHistory,
  getPublicKey,
  HtlcClient,
  inspectAddress,
  KOVANICA_COIN_TYPE,
  KovanicaClient,
  KovanicaDecodeError,
  KovanicaWsClient,
  MAX_ACCOUNT_TX_HISTORY_LIMIT,
  MAX_JSONRPC_BATCH_SIZE,
  MAX_RBF_BUMP_BPS,
  MIN_RBF_BUMP_BPS,
  MULTISIG_BUNDLE_FORMAT,
  MULTISIG_BUNDLE_VERSION,
  MultisigClient,
  NameRegistryClient,
  NftClient,
  normalizeAddressList,
  parseAccountTxHistoryEntry,
  parseBip44Path,
  parseKvnc,
  parseMempoolFeeStats,
  peekTransactionVariant,
  probeRpcNode,
  readContractStorage,
  sanitizeRpcUrl,
  signTransferTransaction,
  STORAGE_KEY_PREFIXES,
  subscribeContractEvents,
  subscribeNewBlocksWithReceipts,
  TESTNET_ADDRESS_PREFIX,
  TokenClient,
  toHexQuantity,
  validateBip44Path,
  VaultClient,
  verifyCallTransactionSignature,
  verifyEd25519,
  verifySignedTransactionAuto,
  verifyTransferTransactionSignature,
  waitForTransactionFinality,
  waitForTransactionReceipt,
  type AccountTxDirection,
  type AccountTxHistoryClient,
  type AccountTxHistoryEntry,
  type AccountTxHistoryResult,
  type AccountTxStatus,
  type AddressFormat,
  type AddressInspectionResult,
  type AirgapTxEnvelope,
  type AirgapTxKind,
  type BatchDryRunItemResult,
  type BatchDryRunResult,
  type Bip44PathHardening,
  type Bip44PathOptions,
  type Bip44PathValidationResult,
  type BlockReceiptErrorContext,
  type BlockReceiptsRpcClient,
  type BlockWithReceiptsEvent,
  type BlockWithReceiptsSubscriptionHandle,
  type ContractEventSubscriptionHandle,
  type ContractFacadeClient,
  type ContractLogEntry,
  type ContractLogHistoryResult,
  type ContractLogKind,
  type ContractLogKindResolver,
  type ContractStorageReadResult,
  type ContractStorageTarget,
  type DecodeAirgapTxEnvelopeOptions,
  type DecodedContractEvent,
  type DecodedContractLog,
  type DecodedContractLogByKind,
  type DecodedMultisigProposalBundle,
  type DecodedSignedCallTransaction,
  type DecodeSignedCallTransactionOptions,
  type DecodedSignedTransactionAuto,
  type DecodeSignedTransactionAutoOptions,
  type DecodedSignedTransferTransaction,
  type DecodeSignedTransferTransactionOptions,
  type DecodedTransactionReceiptLog,
  type DecodedTransactionReceiptLogByKind,
  type DefaultDecodedStorageByKind,
  type DryRunBatchCallItem,
  type DryRunBatchCallsOptions,
  type DryRunCallClient,
  type DryRunCallOptions,
  type DryRunCallResult,
  type EncodeAirgapTxEnvelopeInput,
  type EncodeMultisigProposalBundleInput,
  type EncodedAirgapTxEnvelope,
  type EscrowCreateParams,
  type EstimateAndBuildCallClient,
  type EstimateAndBuildCallOptions,
  type EstimateBatchCallsOptions,
  type EstimatePriorityFeeTiersOptions,
  type FailoverEndpointHealth,
  type FailoverEvent,
  type FailoverHttpTransportOptions,
  type FeeBufferEstimate,
  type FeeBufferOptions,
  type FeeRecommendationOptions,
  type FeeRecommendations,
  type FeeRecommendationTier,
  type FinalityClient,
  type FinalityProgress,
  type FinalityReceiptLike,
  type FinalityResult,
  type FinalityStatus,
  type GetAccountTxHistoryOptions,
  type GetContractLogHistoryOptions,
  type GetLogsClient,
  type GetLogsFilter,
  type GetTransactionHistoryParams,
  type HtlcCreateParams,
  type JsonRpcBatchItemResult,
  type JsonRpcBatchRequestItem,
  type MempoolCongestionLevel,
  type MempoolFeeStats,
  type MultisigApprovalEntry,
  type MultisigBundleChainId,
  type MultisigCreateParams,
  type MultisigProposalBundle,
  type MultisigProposeParams,
  type MultisigQuorumInput,
  type MultisigQuorumResult,
  type MultisigTxParams,
  type NameRegisterParams,
  type NameResolveOptions,
  type NftMintParams,
  type NormalizeAddressListOptions,
  type NormalizeAddressListResult,
  type ParsedBip44Path,
  type PreparedBatchCallTransactions,
  type PreparedCallTransaction,
  type PriorityFeeTier,
  type PriorityFeeTierName,
  type PriorityFeeTiersClient,
  type PriorityFeeTiersEstimate,
  type RawAccountTxHistoryEntry,
  type RawAccountTxHistoryPage,
  type RbfFeeBumpOptions,
  type RbfFeeBumpResult,
  type ReadContractStorageClient,
  type ReadContractStorageOptions,
  type ReceiptLogEntry,
  type ReceiptWithLogs,
  type RequestOptions,
  type RpcNodeProbeOptions,
  type RpcNodeProbeResult,
  type RpcRetryConfig,
  type SignedTransferTxResult,
  type SignTransferTxParams,
  type StorageSlotContract,
  type StorageSlotKey,
  type StorageSlotKind,
  type SubscribeContractEventsOptions,
  type SubscribeLogsWsClient,
  type SubscribeNewBlocksWithReceiptsOptions,
  type SubscribeNewHeadsWsClient,
  type TokenTransferParams,
  type TransferSigningHashParams,
  type VaultCreateParams,
  type WaitForFinalityOptions,
  type WaitForTransactionReceiptClient,
  type WaitForTransactionReceiptOptions,
  type WatchOnlyAccount,
  type WatchOnlyNetwork,
  type WsBackpressureDropEvent,
  type WsBackpressureOverflowPolicy,
  type WsNewHeadEvent,
} from "kovanica-sdk";

// Configure ed25519 sha512 provider
ed.hashes.sha512 = sha512;

export const DOMAIN_TAG_STR = "KVNC/tx/v1";
export const KEYED_HASH_TAG_STR = "KVNC-TX-v1";
export const TX_DOMAIN = asciiPad(DOMAIN_TAG_STR, 16);
export const TX_KEY = asciiPad(KEYED_HASH_TAG_STR, 32);

// --- Byte Utilities ---

export function asciiPad(str: string, len: number): Uint8Array {
  const buf = new Uint8Array(len);
  for (let i = 0; i < str.length && i < len; i++) {
    buf[i] = str.charCodeAt(i);
  }
  return buf;
}

export function u32le(val: number | bigint): Uint8Array {
  const buf = new Uint8Array(4);
  const view = new DataView(buf.buffer);
  view.setUint32(0, Number(val), true);
  return buf;
}

export function u64le(val: number | bigint): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, BigInt(val), true);
  return buf;
}

export function u128le(val: number | bigint): Uint8Array {
  const buf = new Uint8Array(16);
  const view = new DataView(buf.buffer);
  const b = BigInt(val);
  const low = b & 0xffffffffffffffffn;
  const high = b >> 64n;
  view.setBigUint64(0, low, true);
  view.setBigUint64(8, high, true);
  return buf;
}

export function concat(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((acc, curr) => acc + curr.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

export function encodeBincodeString(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  return concat([u64le(BigInt(bytes.length)), bytes]);
}

export function encodeBincodeStringVec(strings: string[]): Uint8Array {
  const parts: Uint8Array[] = [u64le(BigInt(strings.length))];
  for (const s of strings) {
    parts.push(encodeBincodeString(s));
  }
  return concat(parts);
}

export function encodeBincodeBytes32Vec(items: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [u64le(BigInt(items.length))];
  for (const item of items) {
    if (item.length !== 32) {
      throw new Error(`Expected 32-byte item, got ${item.length}`);
    }
    parts.push(item);
  }
  return concat(parts);
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("Invalid hex length");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const val = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(val)) throw new Error(`Invalid hex byte at index ${i * 2}`);
    bytes[i] = val;
  }
  return bytes;
}

// --- Address & Derivation ---

export function formatAddressForChain(
  addressOrPubkey: string | Uint8Array,
  chainId: number | null,
): string {
  let pubkey: Uint8Array;
  if (typeof addressOrPubkey === "string") {
    try {
      pubkey = decodeAddress(addressOrPubkey.trim());
    } catch {
      return addressOrPubkey;
    }
  } else {
    pubkey = addressOrPubkey;
  }
  const prefix = chainId === CHAIN_IDS.TESTNET ? TESTNET_ADDRESS_PREFIX : ADDRESS_PREFIX;
  return encodeAddress(pubkey, prefix);
}

export function generateMnemonic(strength: 128 | 256 = 256): string {
  return scureGenerateMnemonic(wordlist, strength);
}

export function validateMnemonic(phrase: string): boolean {
  return scureValidateMnemonic(phrase.trim(), wordlist);
}

export interface DerivedAccountInfo {
  accountIndex: number;
  path: string;
  secretKeyHex: string;
  publicKeyHex: string;
  address: string;
  mainnetAddress: string;
  testnetAddress: string;
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export function deriveAccountsFromMnemonic(
  phrase: string,
  passphrase = "",
  count = 2,
  chainId: number = CHAIN_IDS.TESTNET,
): DerivedAccountInfo[] {
  const seed64 = bip39Seed(phrase.trim(), passphrase);
  const accounts: DerivedAccountInfo[] = [];

  for (let i = 0; i < count; i++) {
    const node = deriveBip44(seed64, i, 0, 0, KOVANICA_COIN_TYPE);
    const pub = getPublicKey(node.key);
    const path = formatBip44Path(i, 0, 0, KOVANICA_COIN_TYPE);
    const mainnetAddress = encodeAddress(pub, ADDRESS_PREFIX);
    const testnetAddress = encodeAddress(pub, TESTNET_ADDRESS_PREFIX);
    const address = formatAddressForChain(pub, chainId);

    accounts.push({
      accountIndex: i,
      path,
      secretKeyHex: bytesToHex(node.key),
      publicKeyHex: bytesToHex(pub),
      address,
      mainnetAddress,
      testnetAddress,
      secretKey: node.key,
      publicKey: pub,
    });
  }

  return accounts;
}

// --- Transaction Construction, Signing & Serialization ---

export type CallTxKind = {
  type: "call";
  contract: Uint8Array;
  value: bigint;
  method: string;
  args: Uint8Array;
  gasLimit: bigint;
};

export type TxKind =
  | { type: "transfer"; to: Uint8Array; amount: bigint }
  | CallTxKind;

export interface UnsignedTx {
  sender: Uint8Array;
  nonce: bigint;
  kind: TxKind;
  fee: bigint;
}

export function signingKind(kind: TxKind): Uint8Array {
  if (kind.type === "transfer") {
    return concat([Uint8Array.of(0), kind.to, u64le(kind.amount)]);
  }
  const methodBytes = new TextEncoder().encode(kind.method);
  return concat([
    Uint8Array.of(4),
    kind.contract,
    u64le(kind.value),
    u64le(BigInt(methodBytes.length)),
    methodBytes,
    u64le(BigInt(kind.args.length)),
    kind.args,
    u64le(kind.gasLimit),
  ]);
}

export function wireKind(kind: TxKind): Uint8Array {
  if (kind.type === "transfer") {
    return concat([u32le(0), kind.to, u64le(kind.amount)]);
  }
  const methodBytes = new TextEncoder().encode(kind.method);
  return concat([
    u32le(6),
    kind.contract,
    u64le(kind.value),
    u64le(BigInt(methodBytes.length)),
    methodBytes,
    u64le(BigInt(kind.args.length)),
    kind.args,
    u64le(kind.gasLimit),
  ]);
}

export function signingHash(tx: UnsignedTx, chainId: number): Uint8Array {
  const preimage = concat([
    TX_DOMAIN,
    u64le(BigInt(chainId)),
    tx.sender,
    u64le(tx.nonce),
    signingKind(tx.kind),
    u64le(tx.fee),
  ]);
  return blake3(preimage, { key: TX_KEY });
}

export interface SignedTxResult {
  sighash: Uint8Array;
  sighashHex: string;
  signature: Uint8Array;
  signatureHex: string;
  rawTxBytes: Uint8Array;
  rawTxHex: string;
  txSize: number;
}

export function signAndSerializeTransaction(
  tx: UnsignedTx,
  secretKey: Uint8Array,
  chainId: number,
): SignedTxResult {
  const sighash = signingHash(tx, chainId);
  const signature = ed.sign(sighash, secretKey);
  const rawTxBytes = concat([
    tx.sender,
    u64le(tx.nonce),
    wireKind(tx.kind),
    u64le(tx.fee),
    u64le(64n), // u64 LE length prefix for Signature in bincode
    signature,
    sighash,
  ]);
  return {
    sighash,
    sighashHex: bytesToHex(sighash),
    signature,
    signatureHex: bytesToHex(signature),
    rawTxBytes,
    rawTxHex: bytesToHex(rawTxBytes),
    txSize: rawTxBytes.length,
  };
}

// --- Wasmi Smart Contract Invocation Helpers ---

export function buildTokenTransferCall(
  contractPubkey: Uint8Array,
  recipientPubkey: Uint8Array,
  tokenUnits: bigint,
  gasLimit = 100_000n,
): CallTxKind {
  return {
    type: "call",
    contract: contractPubkey,
    value: 0n,
    method: "token_transfer",
    args: concat([recipientPubkey, u128le(tokenUnits)]),
    gasLimit,
  };
}

export function buildVaultCreateCall(
  contractPubkey: Uint8Array,
  beneficiaryPubkey: Uint8Array,
  amountAtoms: bigint,
  lockUntilMs: bigint,
  gasLimit = 100_000n,
): CallTxKind {
  return {
    type: "call",
    contract: contractPubkey,
    value: 0n,
    method: "vault_create",
    args: concat([beneficiaryPubkey, u128le(amountAtoms), u32le(0), u64le(lockUntilMs)]),
    gasLimit,
  };
}

export function buildNameRegisterCall(
  name: string,
  pubkey: Uint8Array,
  relayEndpoints: string[],
): Uint8Array {
  if (pubkey.length !== 32) {
    throw new Error(`Expected 32-byte pubkey, got ${pubkey.length}`);
  }
  return concat([
    encodeBincodeString(name),
    pubkey,
    encodeBincodeStringVec(relayEndpoints),
  ]);
}
export const encodeNameRegisterArgs = buildNameRegisterCall;

export function buildNameRegisterCallTx(
  contractPubkey: Uint8Array,
  name: string,
  pubkey: Uint8Array,
  relayEndpoints: string[],
  gasLimit = 100_000n,
): CallTxKind {
  return {
    type: "call",
    contract: contractPubkey,
    value: 0n,
    method: "name_register",
    args: buildNameRegisterCall(name, pubkey, relayEndpoints),
    gasLimit,
  };
}

export function buildHtlcCreateCall(
  hashlock: Uint8Array,
  timelock: bigint | number,
  recipient: Uint8Array,
): Uint8Array {
  if (hashlock.length !== 32) {
    throw new Error(`Expected 32-byte hashlock, got ${hashlock.length}`);
  }
  if (recipient.length !== 32) {
    throw new Error(`Expected 32-byte recipient, got ${recipient.length}`);
  }
  return concat([
    hashlock,
    u64le(timelock),
    recipient,
  ]);
}
export const encodeHtlcCreateArgs = buildHtlcCreateCall;

export function buildHtlcCreateCallTx(
  contractPubkey: Uint8Array,
  hashlock: Uint8Array,
  timelock: bigint | number,
  recipient: Uint8Array,
  gasLimit = 100_000n,
): CallTxKind {
  return {
    type: "call",
    contract: contractPubkey,
    value: 0n,
    method: "htlc_create",
    args: buildHtlcCreateCall(hashlock, timelock, recipient),
    gasLimit,
  };
}

export function buildNftMintCall(
  collection: Uint8Array,
  to: Uint8Array,
  tokenId: bigint | number,
  tokenUri: string,
): Uint8Array {
  if (collection.length !== 32) {
    throw new Error(`Expected 32-byte collection, got ${collection.length}`);
  }
  if (to.length !== 32) {
    throw new Error(`Expected 32-byte to pubkey, got ${to.length}`);
  }
  return concat([
    collection,
    to,
    u128le(tokenId),
    encodeBincodeString(tokenUri),
  ]);
}
export const encodeNftMintArgs = buildNftMintCall;

export function buildNftMintCallTx(
  contractPubkey: Uint8Array,
  collection: Uint8Array,
  to: Uint8Array,
  tokenId: bigint | number,
  tokenUri: string,
  gasLimit = 100_000n,
): CallTxKind {
  return {
    type: "call",
    contract: contractPubkey,
    value: 0n,
    method: "nft_mint",
    args: buildNftMintCall(collection, to, tokenId, tokenUri),
    gasLimit,
  };
}

export function buildEscrowCreateCall(
  parties: Uint8Array[],
  threshold: number,
  amount: bigint | number,
  deadline: bigint | number,
): Uint8Array {
  if (threshold < 0 || threshold > 255) {
    throw new Error(`Threshold must be between 0 and 255, got ${threshold}`);
  }
  return concat([
    encodeBincodeBytes32Vec(parties),
    Uint8Array.of(threshold),
    u64le(amount),
    u64le(deadline),
  ]);
}
export const encodeEscrowCreateArgs = buildEscrowCreateCall;

export function buildEscrowCreateCallTx(
  contractPubkey: Uint8Array,
  parties: Uint8Array[],
  threshold: number,
  amount: bigint | number,
  deadline: bigint | number,
  gasLimit = 100_000n,
): CallTxKind {
  return {
    type: "call",
    contract: contractPubkey,
    value: 0n,
    method: "escrow_create",
    args: buildEscrowCreateCall(parties, threshold, amount, deadline),
    gasLimit,
  };
}

// --- Self-Test & Invariant Verification ---

export interface SelfTestStep {
  name: string;
  passed: boolean;
  expected?: string;
  actual?: string;
  details?: string;
}

export function runGoldenVectorSelfTest(): { ok: boolean; steps: SelfTestStep[] } {
  const steps: SelfTestStep[] = [];
  const goldenMnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const goldenPubkeyHex =
    "862f70cfafc9b581699f8d67598eac699cbc92bdfc940e95ed7ee1e8d8100e7e";
  const goldenCanonicalAddr =
    "kvncschhpna0ex6cz6vl34n4nr4vdxwtey4alj2qa90d0ms73kqspel0nuhe8dag";
  const goldenTestnetAddr =
    "tkncschhpna0ex6cz6vl34n4nr4vdxwtey4alj2qa90d0ms73kqspel0nuhe8dag";

  // Step 1: Verify coin type 3007
  steps.push({
    name: "Canonical Coin Type is 3007",
    passed: KOVANICA_COIN_TYPE === 3007,
    expected: "3007",
    actual: KOVANICA_COIN_TYPE.toString(),
  });

  // Step 2: Derive Account #0 & Account #1
  const accounts = deriveAccountsFromMnemonic(goldenMnemonic, "", 2, CHAIN_IDS.MAINNET);
  const acc0 = accounts[0];
  const acc1 = accounts[1];

  steps.push({
    name: "Account #0 derivation path m/44'/3007'/0'/0'/0'",
    passed: acc0.path === "m/44'/3007'/0'/0'/0'",
    expected: "m/44'/3007'/0'/0'/0'",
    actual: acc0.path,
  });

  steps.push({
    name: "Account #0 Golden Public Key",
    passed: acc0.publicKeyHex === goldenPubkeyHex,
    expected: goldenPubkeyHex,
    actual: acc0.publicKeyHex,
  });

  steps.push({
    name: "Account #0 Mainnet Address kvnc...dag",
    passed: acc0.mainnetAddress === goldenCanonicalAddr,
    expected: goldenCanonicalAddr,
    actual: acc0.mainnetAddress,
  });

  steps.push({
    name: "Account #0 Testnet Address tknc...dag",
    passed: acc0.testnetAddress === goldenTestnetAddr,
    expected: goldenTestnetAddr,
    actual: acc0.testnetAddress,
  });

  steps.push({
    name: "Account #1 distinct derivation m/44'/3007'/1'/0'/0'",
    passed: acc1.path === "m/44'/3007'/1'/0'/0'" && acc1.publicKeyHex !== acc0.publicKeyHex,
    expected: "Distinct key derived for Account #1",
    actual: `Path: ${acc1.path}, Pub: ${acc1.publicKeyHex.slice(0, 16)}...`,
  });

  // Step 3: Transaction signing with domain tag KVNC/tx/v1
  const transferTx: UnsignedTx = {
    sender: acc0.publicKey,
    nonce: 1n,
    kind: {
      type: "transfer",
      to: acc1.publicKey,
      amount: 1_000_000_000n, // 1 KVNC
    },
    fee: 10_000n,
  };
  const transferSigned = signAndSerializeTransaction(transferTx, acc0.secretKey, CHAIN_IDS.TESTNET);
  const isValidSig = ed.verify(transferSigned.signature, transferSigned.sighash, acc0.publicKey);

  steps.push({
    name: "Transaction Signing & Domain Tag Verification (KVNC/tx/v1)",
    passed: isValidSig && transferSigned.rawTxBytes.length > 0,
    expected: "Valid Ed25519 signature over keyed BLAKE3 sighash",
    actual: `Sig: ${transferSigned.signatureHex.slice(0, 16)}..., Size: ${transferSigned.txSize}B`,
  });

  // Step 4: Wasmi Smart Contract Interoperability (token_transfer & vault_create)
  const dummyContractPubkey = hexToBytes("33".repeat(32));
  const tokenCall = buildTokenTransferCall(dummyContractPubkey, acc1.publicKey, 500n);
  const tokenTx: UnsignedTx = {
    sender: acc0.publicKey,
    nonce: 2n,
    kind: tokenCall,
    fee: 15_000n,
  };
  const tokenSigned = signAndSerializeTransaction(tokenTx, acc0.secretKey, CHAIN_IDS.TESTNET);
  const isTokenSigValid = ed.verify(tokenSigned.signature, tokenSigned.sighash, acc0.publicKey);

  // Wire kind tag for call is 6 (06000000 in bincode)
  const isCallWire6 = tokenSigned.rawTxHex.includes("06000000");

  steps.push({
    name: "Wasmi Contract Interoperability (token_transfer wire tag 6)",
    passed: isTokenSigValid && isCallWire6,
    expected: "Valid signature, wire kind tag 6 (06000000)",
    actual: `Wire tag 6 matched: ${isCallWire6}, Sighash: ${tokenSigned.sighashHex.slice(0, 16)}...`,
  });

  const vaultCall = buildVaultCreateCall(dummyContractPubkey, acc1.publicKey, 100_000n, 1750000000000n);
  const vaultTx: UnsignedTx = {
    sender: acc0.publicKey,
    nonce: 3n,
    kind: vaultCall,
    fee: 20_000n,
  };
  const vaultSigned = signAndSerializeTransaction(vaultTx, acc0.secretKey, CHAIN_IDS.TESTNET);
  const isVaultSigValid = ed.verify(vaultSigned.signature, vaultSigned.sighash, acc0.publicKey);

  steps.push({
    name: "Wasmi Contract Interoperability (vault_create schedule & balance pull)",
    passed: isVaultSigValid,
    expected: "Valid bincode serialized vault_create call payload",
    actual: `Signed size: ${vaultSigned.txSize}B, Signature verified: ${isVaultSigValid}`,
  });

  // Step 5: Wasmi Contract Interoperability (name_register, htlc_create, nft_mint, escrow_create)
  const nameCallTx = buildNameRegisterCallTx(
    dummyContractPubkey,
    "alice",
    acc1.publicKey,
    ["https://relay1.kovanica.org", "https://relay2.kovanica.org"],
  );
  const nameTx: UnsignedTx = {
    sender: acc0.publicKey,
    nonce: 4n,
    kind: nameCallTx,
    fee: 25_000n,
  };
  const nameSigned = signAndSerializeTransaction(nameTx, acc0.secretKey, CHAIN_IDS.TESTNET);
  const isNameSigValid = ed.verify(nameSigned.signature, nameSigned.sighash, acc0.publicKey);
  steps.push({
    name: "Wasmi Contract Interoperability (name_register ABI layout)",
    passed: isNameSigValid && nameCallTx.args.length > 0,
    expected: "Valid bincode serialized name_register call payload",
    actual: `Signed size: ${nameSigned.txSize}B, Args length: ${nameCallTx.args.length}B`,
  });

  const htlcCallTx = buildHtlcCreateCallTx(
    dummyContractPubkey,
    hexToBytes("11".repeat(32)),
    1750000000n,
    acc1.publicKey,
  );
  const htlcTx: UnsignedTx = {
    sender: acc0.publicKey,
    nonce: 5n,
    kind: htlcCallTx,
    fee: 20_000n,
  };
  const htlcSigned = signAndSerializeTransaction(htlcTx, acc0.secretKey, CHAIN_IDS.TESTNET);
  const isHtlcSigValid = ed.verify(htlcSigned.signature, htlcSigned.sighash, acc0.publicKey);
  steps.push({
    name: "Wasmi Contract Interoperability (htlc_create 72-byte layout)",
    passed: isHtlcSigValid && htlcCallTx.args.length === 72,
    expected: "Exact 72-byte bincode layout for ([u8; 32], u64, [u8; 32])",
    actual: `Args length: ${htlcCallTx.args.length}B, Signature verified: ${isHtlcSigValid}`,
  });

  const nftCallTx = buildNftMintCallTx(
    dummyContractPubkey,
    hexToBytes("77".repeat(32)),
    acc1.publicKey,
    1n,
    "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  );
  const nftTx: UnsignedTx = {
    sender: acc0.publicKey,
    nonce: 6n,
    kind: nftCallTx,
    fee: 30_000n,
  };
  const nftSigned = signAndSerializeTransaction(nftTx, acc0.secretKey, CHAIN_IDS.TESTNET);
  const isNftSigValid = ed.verify(nftSigned.signature, nftSigned.sighash, acc0.publicKey);
  steps.push({
    name: "Wasmi Contract Interoperability (nft_mint ABI layout)",
    passed: isNftSigValid && nftCallTx.args.length > 88,
    expected: "Valid bincode serialized nft_mint call payload",
    actual: `Signed size: ${nftSigned.txSize}B, Args length: ${nftCallTx.args.length}B`,
  });

  const escrowCallTx = buildEscrowCreateCallTx(
    dummyContractPubkey,
    [acc0.publicKey, acc1.publicKey],
    2,
    1_000_000_000n,
    1750000000n,
  );
  const escrowTx: UnsignedTx = {
    sender: acc0.publicKey,
    nonce: 7n,
    kind: escrowCallTx,
    fee: 35_000n,
  };
  const escrowSigned = signAndSerializeTransaction(escrowTx, acc0.secretKey, CHAIN_IDS.TESTNET);
  const isEscrowSigValid = ed.verify(escrowSigned.signature, escrowSigned.sighash, acc0.publicKey);
  steps.push({
    name: "Wasmi Contract Interoperability (escrow_create threshold & parties layout)",
    passed: isEscrowSigValid && escrowCallTx.args.length === 8 + 64 + 1 + 8 + 8,
    expected: "Exact 89-byte bincode layout for (Vec<[u8; 32]>, u8, u64, u64)",
    actual: `Args length: ${escrowCallTx.args.length}B, Signature verified: ${isEscrowSigValid}`,
  });

  const ok = steps.every((s) => s.passed);
  return { ok, steps };
}

// --- SDK v0.4.0 Fee/Gas Estimation & Typed Bincode State Decoders ---

export {
  AIRGAP_ENVELOPE_PREFIX,
  AIRGAP_ENVELOPE_VERSION,
  applyFeeBuffer,
  checkMultisigQuorum,
  computeFeeRecommendations,
  computeRbfFeeBump,
  computeTransferTransactionSigningHash,
  ContractFacade,
  createFailoverClient,
  createWatchOnlyAccount,
  DEFAULT_ACCOUNT_TX_HISTORY_LIMIT,
  DEFAULT_ACCOUNT_TX_HISTORY_MAX_PAGES,
  DEFAULT_BLOCK_RECEIPT_CONCURRENCY,
  DEFAULT_HIGH_CONGESTION_PENDING_COUNT,
  DEFAULT_LOG_HISTORY_CHUNK_SIZE,
  DEFAULT_MODERATE_CONGESTION_PENDING_COUNT,
  DEFAULT_RBF_BUMP_BPS,
  DEFAULT_RBF_MIN_BUMP_ATOMS,
  DEFAULT_WS_MAX_QUEUE_SIZE,
  decodeAirgapTxEnvelope,
  decodeContractLog,
  decodeMultisigProposalBundle,
  decodeSignedCallTransaction,
  decodeSignedTransactionAuto,
  decodeSignedTransferTransaction,
  decodeTransactionReceiptLogs,
  derivePrefixedStorageSlot,
  deriveStorageSlot,
  deriveStorageSlotHex,
  dryRunBatchCalls,
  encodeAirgapTxEnvelope,
  encodeMultisigProposalBundle,
  EscrowClient,
  estimateAndBuildCall,
  estimateBatchCalls,
  estimateCallTxSize,
  estimatePriorityFeeTiers,
  estimateTxFeeWithBuffer,
  FailoverHttpTransport,
  formatKvnc,
  getAccountTxHistory,
  getContractLogHistory,
  HtlcClient,
  inspectAddress,
  KovanicaDecodeError,
  KovanicaWsClient,
  MAX_ACCOUNT_TX_HISTORY_LIMIT,
  MAX_JSONRPC_BATCH_SIZE,
  MAX_RBF_BUMP_BPS,
  MIN_RBF_BUMP_BPS,
  MULTISIG_BUNDLE_FORMAT,
  MULTISIG_BUNDLE_VERSION,
  MultisigClient,
  NameRegistryClient,
  NftClient,
  normalizeAddressList,
  parseAccountTxHistoryEntry,
  parseBip44Path,
  parseKvnc,
  parseMempoolFeeStats,
  peekTransactionVariant,
  probeRpcNode,
  readContractStorage,
  sanitizeRpcUrl,
  signTransferTransaction,
  STORAGE_KEY_PREFIXES,
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
  waitForTransactionReceipt,
  type AccountTxDirection,
  type AccountTxHistoryClient,
  type AccountTxHistoryEntry,
  type AccountTxHistoryResult,
  type AccountTxStatus,
  type AddressFormat,
  type AddressInspectionResult,
  type AirgapTxEnvelope,
  type AirgapTxKind,
  type BatchDryRunItemResult,
  type BatchDryRunResult,
  type Bip44PathHardening,
  type Bip44PathOptions,
  type Bip44PathValidationResult,
  type BlockReceiptErrorContext,
  type BlockReceiptsRpcClient,
  type BlockWithReceiptsEvent,
  type BlockWithReceiptsSubscriptionHandle,
  type ContractEventSubscriptionHandle,
  type ContractFacadeClient,
  type ContractLogEntry,
  type ContractLogHistoryResult,
  type ContractLogKind,
  type ContractLogKindResolver,
  type ContractStorageReadResult,
  type ContractStorageTarget,
  type DecodeAirgapTxEnvelopeOptions,
  type DecodedContractEvent,
  type DecodedContractLog,
  type DecodedContractLogByKind,
  type DecodedMultisigProposalBundle,
  type DecodedSignedCallTransaction,
  type DecodeSignedCallTransactionOptions,
  type DecodedSignedTransactionAuto,
  type DecodeSignedTransactionAutoOptions,
  type DecodedSignedTransferTransaction,
  type DecodeSignedTransferTransactionOptions,
  type DecodedTransactionReceiptLog,
  type DecodedTransactionReceiptLogByKind,
  type DefaultDecodedStorageByKind,
  type DryRunBatchCallItem,
  type DryRunBatchCallsOptions,
  type DryRunCallClient,
  type DryRunCallOptions,
  type DryRunCallResult,
  type EncodeAirgapTxEnvelopeInput,
  type EncodeMultisigProposalBundleInput,
  type EncodedAirgapTxEnvelope,
  type EscrowCreateParams,
  type EstimateAndBuildCallClient,
  type EstimateAndBuildCallOptions,
  type EstimateBatchCallsOptions,
  type EstimatePriorityFeeTiersOptions,
  type FailoverEndpointHealth,
  type FailoverEvent,
  type FailoverHttpTransportOptions,
  type FeeBufferEstimate,
  type FeeBufferOptions,
  type FeeRecommendationOptions,
  type FeeRecommendations,
  type FeeRecommendationTier,
  type FinalityClient,
  type FinalityProgress,
  type FinalityReceiptLike,
  type FinalityResult,
  type FinalityStatus,
  type GetAccountTxHistoryOptions,
  type GetContractLogHistoryOptions,
  type GetLogsClient,
  type GetLogsFilter,
  type GetTransactionHistoryParams,
  type HtlcCreateParams,
  type JsonRpcBatchItemResult,
  type JsonRpcBatchRequestItem,
  type MempoolCongestionLevel,
  type MempoolFeeStats,
  type MultisigApprovalEntry,
  type MultisigBundleChainId,
  type MultisigCreateParams,
  type MultisigProposalBundle,
  type MultisigProposeParams,
  type MultisigQuorumInput,
  type MultisigQuorumResult,
  type MultisigTxParams,
  type NameRegisterParams,
  type NameResolveOptions,
  type NftMintParams,
  type NormalizeAddressListOptions,
  type NormalizeAddressListResult,
  type ParsedBip44Path,
  type PreparedBatchCallTransactions,
  type PreparedCallTransaction,
  type PriorityFeeTier,
  type PriorityFeeTierName,
  type PriorityFeeTiersClient,
  type PriorityFeeTiersEstimate,
  type RawAccountTxHistoryEntry,
  type RawAccountTxHistoryPage,
  type RbfFeeBumpOptions,
  type RbfFeeBumpResult,
  type ReadContractStorageClient,
  type ReadContractStorageOptions,
  type ReceiptLogEntry,
  type ReceiptWithLogs,
  type RequestOptions,
  type RpcNodeProbeOptions,
  type RpcNodeProbeResult,
  type RpcRetryConfig,
  type SignedTransferTxResult,
  type SignTransferTxParams,
  type StorageSlotContract,
  type StorageSlotKey,
  type StorageSlotKind,
  type SubscribeContractEventsOptions,
  type SubscribeLogsWsClient,
  type SubscribeNewBlocksWithReceiptsOptions,
  type SubscribeNewHeadsWsClient,
  type TokenTransferParams,
  type TransferSigningHashParams,
  type VaultCreateParams,
  type WaitForFinalityOptions,
  type WaitForTransactionReceiptClient,
  type WaitForTransactionReceiptOptions,
  type WatchOnlyAccount,
  type WatchOnlyNetwork,
  type WsBackpressureDropEvent,
  type WsBackpressureOverflowPolicy,
  type WsNewHeadEvent,
};

export interface EstimateContractCallBatchOptions {
  /**
   * Optional sender address (PRO-21 `kvnc...dag` / `tknc...dag` or 32-byte hex).
   * When provided and `startNonce` is omitted, fetches the sender's current nonce once via `client.getNonce(sender)`.
   */
  sender?: string;
  /**
   * Explicit starting nonce override for the first call in the batch (`calls[0]`).
   * Subsequent calls receive sequential nonces `startNonce + BigInt(i)`.
   * Skips the `client.getNonce` RPC call when provided.
   */
  startNonce?: bigint | number;
  /**
   * Explicit fee rate override in atoms per byte. Skips the `client.estimateFee` RPC call when provided.
   */
  feeRatePerByte?: bigint | number;
  /**
   * Fee safety margin in basis points (`10_000` = 1.0x, `12_000` = +20%).
   * Default: `12_000` (+20%).
   */
  feeMarginBps?: number;
  /**
   * Minimum fee floor per individual call in atoms. Default: `0n`.
   */
  minFeePerCall?: bigint | number;
  /**
   * Optional maximum aggregate fee cap across the entire batch in atoms.
   */
  maxTotalFee?: bigint | number;
  /**
   * Chain ID to attach to each prepared call transaction and the batch result. Default: `CHAIN_IDS.MAINNET`.
   */
  chainId?: number;
}

export interface PreparedContractCallBatch {
  calls: PreparedCallTransaction[];
  totalFee: bigint;
  totalGasLimit: bigint;
  totalEstimatedTxSize: number;
  feeRatePerByte: bigint;
  startNonce?: bigint;
  chainId: number;
}

export type ContractDecoderKind =
  | "name"
  | "htlc"
  | "escrow"
  | "vault"
  | "token_metadata"
  | "nft_metadata"
  | "multisig";

/**
 * Estimates fee, gas limit, serialized wire size, and sender nonce for a
 * Wasmi contract call using `kovanica-sdk`'s `estimateAndBuildCall`.
 */
export async function estimateContractCall(
  client: EstimateAndBuildCallClient,
  call: CallTxKind,
  options: EstimateAndBuildCallOptions = {},
): Promise<PreparedCallTransaction> {
  return estimateAndBuildCall(
    client,
    {
      contract: call.contract,
      method: call.method,
      args: call.args,
      call_value: call.value,
      gas_limit: call.gasLimit,
    },
    options,
  );
}

/**
 * Estimates fee, gas limit, per-call wire size, sequential nonces (`startNonce + i`),
 * single fee-rate lookup (`kovanica_estimateFee`), and aggregate batch totals for 1+
 * Wasmi contract calls.
 */
export async function estimateContractCallBatch(
  client: EstimateAndBuildCallClient,
  calls: ReadonlyArray<CallTxKind>,
  options: EstimateContractCallBatchOptions = {},
): Promise<PreparedContractCallBatch> {
  if (!Array.isArray(calls) || calls.length === 0) {
    throw new RangeError("estimateContractCallBatch requires a non-empty array of calls");
  }

  const feeMarginBps = options.feeMarginBps ?? 12_000;
  if (!Number.isInteger(feeMarginBps) || feeMarginBps < 10_000) {
    throw new RangeError(
      `feeMarginBps must be an integer >= 10000 (1.0x), got ${feeMarginBps}`,
    );
  }
  const marginBpsBig = BigInt(feeMarginBps);

  const minFeePerCall =
    options.minFeePerCall !== undefined ? BigInt(options.minFeePerCall) : 0n;
  if (minFeePerCall < 0n) {
    throw new RangeError(`minFeePerCall must be non-negative, got ${minFeePerCall}`);
  }

  const maxTotalFee =
    options.maxTotalFee !== undefined ? BigInt(options.maxTotalFee) : undefined;
  if (maxTotalFee !== undefined && maxTotalFee < 0n) {
    throw new RangeError(`maxTotalFee must be non-negative, got ${maxTotalFee}`);
  }

  let explicitStartNonce: bigint | undefined;
  if (options.startNonce !== undefined) {
    explicitStartNonce = BigInt(options.startNonce);
    if (explicitStartNonce < 0n) {
      throw new RangeError(`startNonce must be non-negative, got ${explicitStartNonce}`);
    }
  }

  let explicitFeeRate: bigint | undefined;
  if (options.feeRatePerByte !== undefined) {
    explicitFeeRate = BigInt(options.feeRatePerByte);
    if (explicitFeeRate < 0n) {
      throw new RangeError(
        `feeRatePerByte must be non-negative, got ${explicitFeeRate}`,
      );
    }
  }

  // Validate wire size for all calls fail-closed before any RPC I/O
  const precomputedSizes: number[] = calls.map((c, idx) => {
    if (!c || typeof c !== "object") {
      throw new TypeError(`Call at index ${idx} must be a valid call object`);
    }
    return estimateCallTxSize({
      contract: c.contract,
      method: c.method,
      args: c.args,
      call_value: c.value,
      gas_limit: c.gasLimit,
    });
  });

  const needsFeeEstimate = explicitFeeRate === undefined;
  const needsNonce =
    explicitStartNonce === undefined && options.sender !== undefined;

  const [fetchedFeeRate, fetchedNonce] = await Promise.all([
    needsFeeEstimate ? client.estimateFee() : Promise.resolve(undefined),
    needsNonce ? client.getNonce(options.sender!) : Promise.resolve(undefined),
  ]);

  const feeRatePerByte = explicitFeeRate ?? fetchedFeeRate!;
  if (feeRatePerByte < 0n) {
    throw new RangeError(
      `Estimated fee rate must be non-negative, got ${feeRatePerByte}`,
    );
  }

  const startNonce = explicitStartNonce ?? fetchedNonce;
  if (startNonce !== undefined && startNonce < 0n) {
    throw new RangeError(`Fetched startNonce must be non-negative, got ${startNonce}`);
  }

  const chainId = options.chainId ?? CHAIN_IDS.MAINNET;
  const preparedCalls: PreparedCallTransaction[] = [];
  let totalFee = 0n;
  let totalGasLimit = 0n;
  let totalEstimatedTxSize = 0;

  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    const estimatedTxSize = precomputedSizes[i];
    const baseFee = feeRatePerByte * BigInt(estimatedTxSize);
    const marginedFee =
      baseFee === 0n ? 0n : (baseFee * marginBpsBig + 9_999n) / 10_000n;
    const fee = marginedFee < minFeePerCall ? minFeePerCall : marginedFee;
    const nonce = startNonce !== undefined ? startNonce + BigInt(i) : undefined;

    const prepared = await estimateAndBuildCall(
      client,
      {
        contract: c.contract,
        method: c.method,
        args: c.args,
        call_value: c.value,
        gas_limit: c.gasLimit,
      },
      {
        fee,
        nonce,
        chainId,
      },
    );

    const preparedWithRate: PreparedCallTransaction = {
      ...prepared,
      feeRatePerByte,
    };

    totalFee += preparedWithRate.fee;
    totalGasLimit += preparedWithRate.gasLimit;
    totalEstimatedTxSize += preparedWithRate.estimatedTxSize;
    preparedCalls.push(preparedWithRate);
  }

  if (maxTotalFee !== undefined && totalFee > maxTotalFee) {
    throw new RangeError(
      `Computed batch totalFee ${totalFee} exceeds maxTotalFee ${maxTotalFee}`,
    );
  }

  return {
    calls: preparedCalls,
    totalFee,
    totalGasLimit,
    totalEstimatedTxSize,
    feeRatePerByte,
    startNonce,
    chainId,
  };
}

// --- Developer Code Exporters (`cURL` + `kovanica-sdk` TypeScript Snippets) ---

export interface PlaygroundCallCurlSnippetOptions {
  rpcUrl: string;
  call: CallTxKind;
  sender?: string;
}

export interface PlaygroundCallSdkSnippetOptions {
  rpcUrl: string;
  call: CallTxKind;
  sender?: string;
  chainId?: number;
}

function resolveContractCanonicalAddress(contract: Uint8Array | string): string {
  if (contract instanceof Uint8Array) {
    if (contract.length !== 32) {
      throw new Error(`Expected 32-byte contract address, got ${contract.length}`);
    }
    return encodeAddress(contract, ADDRESS_PREFIX);
  }
  const trimmed = contract.trim();
  if (trimmed.startsWith("kvnc") || trimmed.startsWith("tknc")) {
    const pub = decodeAddress(trimmed);
    return encodeAddress(pub, ADDRESS_PREFIX);
  }
  const bytes = hexToBytes(trimmed);
  if (bytes.length !== 32) {
    throw new Error(`Expected 32-byte contract address, got ${bytes.length}`);
  }
  return encodeAddress(bytes, ADDRESS_PREFIX);
}

function resolveContractHex(contract: Uint8Array | string): string {
  if (contract instanceof Uint8Array) {
    return bytesToHex(contract);
  }
  const trimmed = contract.trim();
  if (trimmed.startsWith("kvnc") || trimmed.startsWith("tknc")) {
    return bytesToHex(decodeAddress(trimmed));
  }
  return trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;
}

/**
 * Generates a ready-to-run JSON-RPC `curl` command invoking `kovanica_call` for the
 * active Wasmi smart contract call.
 */
export function buildPlaygroundCallCurlSnippet(
  options: PlaygroundCallCurlSnippetOptions,
): string {
  const rpcUrl = options.rpcUrl.trim() || "http://127.0.0.1:8545/rpc";
  const toAddress = resolveContractCanonicalAddress(options.call.contract);
  const dataHex = `0x${bytesToHex(options.call.args)}`;
  const valueHex = toHexQuantity(options.call.value);
  const gasHex = toHexQuantity(options.call.gasLimit);

  const callObj: Record<string, string> = {
    to: toAddress,
    entry: options.call.method,
    method: options.call.method,
    data: dataHex,
    value: valueHex,
    gas: gasHex,
  };

  if (options.sender && options.sender.trim().length > 0) {
    const trimmedSender = options.sender.trim();
    try {
      const senderPub =
        trimmedSender.startsWith("kvnc") || trimmedSender.startsWith("tknc")
          ? decodeAddress(trimmedSender)
          : hexToBytes(trimmedSender);
      callObj.from = encodeAddress(senderPub, ADDRESS_PREFIX);
    } catch {
      callObj.from = trimmedSender;
    }
  }

  const payload = JSON.stringify(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "kovanica_call",
      params: [callObj],
    },
    null,
    2,
  );

  const escapedPayload = payload.replace(/'/g, "'\\''");
  return [
    `curl -sS -X POST ${JSON.stringify(rpcUrl)} \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${escapedPayload}'`,
  ].join("\n");
}

/**
 * Generates a ready-to-run TypeScript `kovanica-sdk` snippet (`KovanicaClient` +
 * `estimateAndBuildCall` + `dryRunCall`) for the active Wasmi smart contract call.
 */
export function buildPlaygroundCallSdkSnippet(
  options: PlaygroundCallSdkSnippetOptions,
): string {
  const rpcUrl = options.rpcUrl.trim() || "http://127.0.0.1:8545/rpc";
  const contractHex = resolveContractHex(options.call.contract);
  const argsHex = bytesToHex(options.call.args);
  const chainId = options.chainId ?? CHAIN_IDS.TESTNET;
  const chainExpr =
    chainId === CHAIN_IDS.MAINNET
      ? "CHAIN_IDS.MAINNET"
      : chainId === CHAIN_IDS.TESTNET
        ? "CHAIN_IDS.TESTNET"
        : chainId === CHAIN_IDS.DEVNET
          ? "CHAIN_IDS.DEVNET"
          : String(chainId);

  const senderLine =
    options.sender && options.sender.trim().length > 0
      ? `  sender: ${JSON.stringify(options.sender.trim())},\n`
      : "";

  return [
    `import {`,
    `  CHAIN_IDS,`,
    `  KovanicaClient,`,
    `  dryRunCall,`,
    `  estimateAndBuildCall,`,
    `  hexToBytes,`,
    `} from "kovanica-sdk";`,
    ``,
    `const client = new KovanicaClient({ url: ${JSON.stringify(rpcUrl)} });`,
    ``,
    `const call = {`,
    `  contract: "0x${contractHex}",`,
    `  method: ${JSON.stringify(options.call.method)},`,
    `  args: hexToBytes("${argsHex}"),`,
    `  call_value: ${options.call.value.toString()}n,`,
    `  gas_limit: ${options.call.gasLimit.toString()}n,`,
    `};`,
    ``,
    `// 1. Estimate fee (+20% margin), wire size, gas limit, and sender nonce`,
    `const prepared = await estimateAndBuildCall(client, call, {`,
    `${senderLine}  chainId: ${chainExpr},`,
    `});`,
    `console.log("Estimated fee (atoms):", prepared.fee, "Wire size (B):", prepared.estimatedTxSize);`,
    ``,
    `// 2. Optional read-only simulation via kovanica_call`,
    `const simulation = await dryRunCall(client, prepared.call);`,
    `console.log("Dry-run result hex:", simulation.rawHex);`,
  ].join("\n");
}

/**
 * Decodes a hex-encoded (or raw Uint8Array) Bincode 1.x contract state record
 * using `kovanica-sdk` v0.4.0 typed ABI decoders.
 */
export function decodeContractStateHex(
  kind: ContractDecoderKind,
  input: string | Uint8Array,
): unknown {
  switch (kind) {
    case "name":
      return decodeNameRecord(input);
    case "htlc":
      return decodeHtlcRecord(input);
    case "escrow":
      return decodeEscrowRecord(input);
    case "vault":
      return decodeVaultRecord(input);
    case "token_metadata":
      return decodeTokenMetadata(input);
    case "nft_metadata":
      return decodeNftMetadata(input);
    case "multisig":
      return decodeMultisigState(input);
  }
}

export interface DeriveContractStorageSlotOptions {
  kind: ContractDecoderKind;
  key?: string;
  customPrefix?: string;
}

/**
 * Derives a canonical 32-byte BLAKE3 storage slot (64-char hex string) for a
 * contract record type and key, or a custom prefix + key via `derivePrefixedStorageSlot`.
 * If `key` is already a raw `0x`-prefixed 32-byte hex slot and no `customPrefix`
 * is specified for singleton kinds, or when explicitly provided for custom lookup,
 * returns the canonical 64-char lowercase hex slot.
 */
export function deriveContractStorageSlotHex(
  options: DeriveContractStorageSlotOptions,
): string {
  const rawKey = (options.key ?? "").trim();
  const customPrefix = (options.customPrefix ?? "").trim();

  if (customPrefix.length > 0) {
    if (rawKey.length === 0) {
      return bytesToHex(derivePrefixedStorageSlot(customPrefix));
    }
    const cleanHex = rawKey.startsWith("0x") || rawKey.startsWith("0X") ? rawKey.slice(2) : rawKey;
    const isHex32 = /^[0-9a-fA-F]{64}$/.test(cleanHex);
    const keyArg: string | Uint8Array = isHex32 ? hexToBytes(cleanHex) : rawKey;
    return bytesToHex(derivePrefixedStorageSlot(customPrefix, keyArg));
  }

  switch (options.kind) {
    case "name":
      return deriveStorageSlotHex("name", rawKey);
    case "htlc":
      return deriveStorageSlotHex("htlc", rawKey);
    case "escrow":
      return deriveStorageSlotHex("escrow", rawKey);
    case "vault":
      return deriveStorageSlotHex("vault", rawKey);
    case "token_metadata":
      return deriveStorageSlotHex("token");
    case "nft_metadata":
      return deriveStorageSlotHex("nft");
    case "multisig":
      return deriveStorageSlotHex("multisig");
  }
}

export interface StorageAtRpcClient {
  getStorageAt?: (address: string, slot: string) => Promise<string | null | undefined>;
  call?: <TResult = unknown>(method: string, params?: unknown) => Promise<TResult>;
}

export interface FetchAndDecodeStorageSlotOptions {
  contractAddress: string;
  kind: ContractDecoderKind;
  key?: string;
  customPrefix?: string;
  slotOverrideHex?: string;
}

export interface FetchAndDecodeStorageSlotResult {
  contractAddress: string;
  slotHex: string;
  rawStorageHex: string;
  isEmpty: boolean;
  decoded: unknown | null;
}

/**
 * Checks whether a raw hex storage response from `kovanica_getStorageAt` represents
 * an uninitialized / empty storage slot (`null`, `""`, `"0x"`, or all-zero bytes when empty).
 */
export function isStorageSlotEmpty(rawHex: string | null | undefined): boolean {
  if (rawHex === null || rawHex === undefined) {
    return true;
  }
  const trimmed = String(rawHex).trim();
  const clean = trimmed.startsWith("0x") || trimmed.startsWith("0X")
    ? trimmed.slice(2)
    : trimmed;
  return clean.length === 0 || /^0+$/.test(clean);
}

/**
 * Derives the canonical 32-byte BLAKE3 storage slot (via `deriveStorageSlotHex` or
 * `derivePrefixedStorageSlot`), calls `kovanica_getStorageAt` against the configured
 * RPC client, and decodes the returned Bincode state record using the selected typed decoder.
 */
export async function fetchAndDecodeContractStorageSlot(
  client: StorageAtRpcClient,
  options: FetchAndDecodeStorageSlotOptions,
): Promise<FetchAndDecodeStorageSlotResult> {
  const contractAddress = options.contractAddress.trim();
  if (!contractAddress) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      "Contract address is required for kovanica_getStorageAt",
      { field: "contractAddress" },
    );
  }

  let slotHex: string;
  if (options.slotOverrideHex && options.slotOverrideHex.trim().length > 0) {
    const clean = options.slotOverrideHex.trim().replace(/^0x/i, "");
    if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        "Storage slot override must be a 32-byte (64-char) hex string",
        { field: "slotOverrideHex" },
      );
    }
    slotHex = clean.toLowerCase();
  } else {
    slotHex = deriveContractStorageSlotHex({
      kind: options.kind,
      key: options.key,
      customPrefix: options.customPrefix,
    });
  }

  const rpcSlotArg = slotHex.startsWith("0x") ? slotHex : `0x${slotHex}`;
  let rawResponse: string | null | undefined;
  if (typeof client.getStorageAt === "function") {
    rawResponse = await client.getStorageAt(contractAddress, rpcSlotArg);
  } else if (typeof client.call === "function") {
    rawResponse = await client.call<string | null | undefined>("kovanica_getStorageAt", [
      contractAddress,
      rpcSlotArg,
    ]);
  } else {
    throw new Error("RPC client must provide getStorageAt() or call()");
  }

  const normalizedRaw =
    rawResponse === null || rawResponse === undefined ? "" : String(rawResponse).trim();

  if (isStorageSlotEmpty(normalizedRaw)) {
    return {
      contractAddress,
      slotHex,
      rawStorageHex: normalizedRaw || "0x",
      isEmpty: true,
      decoded: null,
    };
  }

  const decoded = decodeContractStateHex(options.kind, normalizedRaw);
  return {
    contractAddress,
    slotHex,
    rawStorageHex: normalizedRaw,
    isEmpty: false,
    decoded,
  };
}

// --- Transaction Receipt Poller & Emitted Log Bincode Decoder (`kovanica_getTransactionReceipt`) ---

export interface TransactionReceiptRpcLog {
  address?: string;
  topics?: ReadonlyArray<string>;
  topic?: string;
  data?: string | Uint8Array | ReadonlyArray<number>;
  logIndex?: number | string | bigint;
}

export interface TransactionReceiptRpcPayload {
  transactionHash?: string;
  tx_hash?: string;
  blockHash?: string | null;
  block_hash?: string | null;
  blockNumber?: bigint | number | string | null;
  block_number?: bigint | number | string | null;
  transactionIndex?: bigint | number | string | null;
  transaction_index?: bigint | number | string | null;
  status?: number | bigint | string | boolean;
  success?: boolean;
  gasUsed?: bigint | number | string | null;
  gas_used?: bigint | number | string | null;
  logs?: ReadonlyArray<TransactionReceiptRpcLog | string | Uint8Array>;
  events?: ReadonlyArray<TransactionReceiptRpcLog | string | Uint8Array>;
}

export interface TransactionReceiptRpcClient {
  getTransactionReceipt?: (
    hash: string,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ) => Promise<TransactionReceiptRpcPayload | null | undefined>;
  call?: <TResult = unknown>(
    method: string,
    params?: unknown,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ) => Promise<TResult>;
  transport?: unknown;
}

export interface PollAndDecodeTransactionReceiptOptions {
  /** 32-byte (64-hex-character) transaction hash, with or without `0x` prefix. */
  txHash: string;
  /** Optional typed Bincode contract state/log decoder kind. */
  decoderKind?: ContractDecoderKind;
  /** Polling interval in milliseconds between `kovanica_getTransactionReceipt` calls. Default: `500`. */
  pollIntervalMs?: number;
  /** Total polling timeout in milliseconds before rejecting. Default: `15_000`. */
  timeoutMs?: number;
  /** Optional cancellation signal. */
  signal?: AbortSignal;
}

export interface DecodedReceiptLog {
  logIndex: number;
  address?: string;
  topics?: string[];
  rawDataHex: string;
  decoderKind?: ContractDecoderKind;
  decoded: unknown | null;
  [key: string]: unknown;
}

export interface ReceiptLogDecodeError {
  logIndex: number;
  rawDataHex: string;
  decoderKind: ContractDecoderKind;
  error: string;
  code?: string;
}

export interface PollAndDecodeTransactionReceiptResult {
  receipt: TransactionReceiptRpcPayload;
  status: "success" | "reverted";
  gasUsed: bigint;
  blockHash: string | null;
  decodedLogs: DecodedReceiptLog[];
  decodeErrors: ReceiptLogDecodeError[];
}

function parseReceiptQuantityBigInt(val: unknown): bigint {
  if (val === null || val === undefined || val === "") {
    return 0n;
  }
  if (typeof val === "bigint") {
    return val;
  }
  if (typeof val === "number") {
    if (!Number.isFinite(val) || val < 0) return 0n;
    return BigInt(Math.trunc(val));
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed || trimmed === "0x" || trimmed === "0X") return 0n;
    return BigInt(trimmed);
  }
  return 0n;
}

function resolveReceiptStatus(receipt: TransactionReceiptRpcPayload): "success" | "reverted" {
  if (receipt.success === false) {
    return "reverted";
  }
  const rawStatus = receipt.status;
  if (rawStatus !== undefined && rawStatus !== null) {
    if (typeof rawStatus === "boolean") {
      return rawStatus ? "success" : "reverted";
    }
    if (typeof rawStatus === "number" || typeof rawStatus === "bigint") {
      return BigInt(rawStatus) === 0n ? "reverted" : "success";
    }
    if (typeof rawStatus === "string") {
      const lower = rawStatus.trim().toLowerCase();
      if (lower === "reverted" || lower === "failed" || lower === "0" || lower === "0x0" || lower === "0x00") {
        return "reverted";
      }
      if (lower === "success" || lower === "ok" || lower === "1" || lower === "0x1" || lower === "0x01") {
        return "success";
      }
    }
  }
  if (receipt.success === true) {
    return "success";
  }
  return "success";
}

function normalizeLogDataHex(entry: TransactionReceiptRpcLog | string | Uint8Array): {
  rawDataHex: string;
  address?: string;
  topics?: string[];
} {
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    const clean = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;
    return { rawDataHex: `0x${clean}` };
  }
  if (entry instanceof Uint8Array) {
    return { rawDataHex: `0x${bytesToHex(entry)}` };
  }
  let rawDataHex = "0x";
  if (typeof entry.data === "string") {
    const trimmed = entry.data.trim();
    const clean = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;
    rawDataHex = `0x${clean}`;
  } else if (entry.data instanceof Uint8Array) {
    rawDataHex = `0x${bytesToHex(entry.data)}`;
  } else if (Array.isArray(entry.data)) {
    rawDataHex = `0x${bytesToHex(Uint8Array.from(entry.data))}`;
  }
  const address = typeof entry.address === "string" ? entry.address : undefined;
  const topics = Array.isArray(entry.topics)
    ? entry.topics.map(String)
    : typeof entry.topic === "string"
      ? [entry.topic]
      : undefined;
  return { rawDataHex, address, topics };
}

function waitWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Transaction receipt polling aborted"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Transaction receipt polling aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Validates a 32-byte hex `txHash`, polls `kovanica_getTransactionReceipt` until a non-null
 * receipt is returned (or timeout/abort), and decodes any hex `logs` data payloads using
 * the selected typed Bincode decoder (`decodeContractStateHex`).
 */
export async function pollAndDecodeTransactionReceipt(
  client: TransactionReceiptRpcClient,
  options: PollAndDecodeTransactionReceiptOptions,
): Promise<PollAndDecodeTransactionReceiptResult> {
  const rawTxHash = (options?.txHash ?? "").trim();
  const cleanHash =
    rawTxHash.startsWith("0x") || rawTxHash.startsWith("0X")
      ? rawTxHash.slice(2)
      : rawTxHash;

  if (!/^[0-9a-fA-F]{64}$/.test(cleanHash)) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      "Transaction hash must be a 32-byte (64-character) hexadecimal string",
      { field: "txHash" },
    );
  }

  const normalizedTxHash = `0x${cleanHash.toLowerCase()}`;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
    throw new RangeError(`pollIntervalMs must be a non-negative number, got ${pollIntervalMs}`);
  }

  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`timeoutMs must be a positive number, got ${timeoutMs}`);
  }

  if (options.signal?.aborted) {
    throw new Error("Transaction receipt polling aborted");
  }

  const deadline = Date.now() + timeoutMs;
  let receipt: TransactionReceiptRpcPayload | null | undefined = null;

  const fetchReceiptOnce = async (): Promise<TransactionReceiptRpcPayload | null | undefined> => {
    const reqOpts = options.signal ? { signal: options.signal } : undefined;
    // If client is a KovanicaClient instance (with transport & call), prefer client.call("kovanica_getTransactionReceipt")
    // so raw receipt fields like `logs` / `events` are preserved intact.
    if (
      typeof client.call === "function" &&
      (typeof client.getTransactionReceipt !== "function" || "transport" in client)
    ) {
      return client.call<TransactionReceiptRpcPayload | null | undefined>(
        "kovanica_getTransactionReceipt",
        [normalizedTxHash],
        reqOpts,
      );
    }
    if (typeof client.getTransactionReceipt === "function") {
      return client.getTransactionReceipt(normalizedTxHash, reqOpts);
    }
    throw new Error("RPC client must provide getTransactionReceipt() or call()");
  };

  while (true) {
    if (options.signal?.aborted) {
      throw new Error("Transaction receipt polling aborted");
    }

    receipt = await fetchReceiptOnce();
    if (receipt !== null && receipt !== undefined) {
      break;
    }

    const now = Date.now();
    const remaining = deadline - now;
    if (remaining <= 0) {
      throw new Error(
        `Timed out waiting for transaction receipt ${normalizedTxHash} after ${timeoutMs}ms`,
      );
    }

    await waitWithSignal(Math.min(pollIntervalMs, remaining), options.signal);

    if (Date.now() >= deadline) {
      // Perform one final check right at deadline before timing out
      receipt = await fetchReceiptOnce();
      if (receipt !== null && receipt !== undefined) {
        break;
      }
      throw new Error(
        `Timed out waiting for transaction receipt ${normalizedTxHash} after ${timeoutMs}ms`,
      );
    }
  }

  const status = resolveReceiptStatus(receipt);
  const gasUsed = parseReceiptQuantityBigInt(receipt.gasUsed ?? receipt.gas_used);
  const rawBlockHash = receipt.blockHash ?? receipt.block_hash;
  const blockHash =
    typeof rawBlockHash === "string" && rawBlockHash.trim().length > 0
      ? rawBlockHash.trim()
      : null;

  const rawLogs = Array.isArray(receipt.logs)
    ? receipt.logs
    : Array.isArray(receipt.events)
      ? receipt.events
      : [];

  const decodedLogs: DecodedReceiptLog[] = [];
  const decodeErrors: ReceiptLogDecodeError[] = [];

  for (let i = 0; i < rawLogs.length; i++) {
    const entry = rawLogs[i];
    const { rawDataHex, address, topics } = normalizeLogDataHex(entry);
    const cleanData = rawDataHex.slice(2);

    if (!options.decoderKind || cleanData.length === 0) {
      decodedLogs.push({
        logIndex: i,
        ...(address !== undefined ? { address } : {}),
        ...(topics !== undefined ? { topics } : {}),
        rawDataHex,
        ...(options.decoderKind ? { decoderKind: options.decoderKind } : {}),
        decoded: null,
      });
      continue;
    }

    try {
      const decoded = decodeContractStateHex(options.decoderKind, rawDataHex);
      decodedLogs.push({
        ...(typeof decoded === "object" && decoded !== null
          ? (decoded as Record<string, unknown>)
          : {}),
        logIndex: i,
        ...(address !== undefined ? { address } : {}),
        ...(topics !== undefined ? { topics } : {}),
        rawDataHex,
        decoderKind: options.decoderKind,
        decoded,
      });
    } catch (err: unknown) {
      decodeErrors.push({
        logIndex: i,
        rawDataHex,
        decoderKind: options.decoderKind,
        error: err instanceof Error ? err.message : String(err),
        ...(err instanceof KovanicaDecodeError ? { code: err.code } : {}),
      });
    }
  }

  return {
    receipt,
    status,
    gasUsed,
    blockHash,
    decodedLogs,
    decodeErrors,
  };
}

// --- Export / Import Contract Call Presets (Strict Schema & Bounds) ---

export const CONTRACT_PRESETS_SCHEMA_VERSION = 1;
export const MAX_CONTRACT_PRESETS_ITEMS = 64;
export const MAX_CONTRACT_PRESETS_JSON_BYTES = 262_144; // 256 KiB
const MAX_PRESET_ARGS_BYTES = 32_768; // 32 KiB per call
const MAX_PRESET_METHOD_LENGTH = 128;
const U64_MAX = 0xffffffffffffffffn;

export interface SerializedContractCallPreset {
  contractHex: string;
  method: string;
  argsHex: string;
  value: string;
  gasLimit: string;
}

export interface ContractPresetsExportBundle {
  version: typeof CONTRACT_PRESETS_SCHEMA_VERSION;
  presets: SerializedContractCallPreset[];
}

/**
 * Serializes a list of Wasmi `CallTxKind` presets into a deterministic, versioned JSON bundle.
 * Validates array bounds and each preset field fail-closed before serialization.
 */
export function exportContractPresetsJson(
  presets: ReadonlyArray<CallTxKind>,
): string {
  if (!Array.isArray(presets)) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      "Contract call presets must be an array",
      { field: "presets" },
    );
  }
  if (presets.length === 0) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      "Cannot export an empty contract call presets list",
      { field: "presets" },
    );
  }
  if (presets.length > MAX_CONTRACT_PRESETS_ITEMS) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      `Cannot export more than ${MAX_CONTRACT_PRESETS_ITEMS} call presets (got ${presets.length})`,
      { field: "presets" },
    );
  }

  const serialized: SerializedContractCallPreset[] = presets.map((preset, idx) => {
    if (!preset || typeof preset !== "object" || preset.type !== "call") {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Preset at index ${idx} must be a valid CallTxKind`,
        { field: `presets[${idx}]` },
      );
    }
    if (!(preset.contract instanceof Uint8Array) || preset.contract.length !== 32) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Preset at index ${idx} must have a 32-byte contract address`,
        { field: `presets[${idx}].contract` },
      );
    }
    const method = typeof preset.method === "string" ? preset.method.trim() : "";
    if (method.length === 0 || method.length > MAX_PRESET_METHOD_LENGTH) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Preset at index ${idx} method must be 1..${MAX_PRESET_METHOD_LENGTH} characters`,
        { field: `presets[${idx}].method` },
      );
    }
    if (!(preset.args instanceof Uint8Array) || preset.args.length > MAX_PRESET_ARGS_BYTES) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Preset at index ${idx} args must be a Uint8Array <= ${MAX_PRESET_ARGS_BYTES} bytes`,
        { field: `presets[${idx}].args` },
      );
    }
    if (typeof preset.value !== "bigint" || preset.value < 0n || preset.value > U64_MAX) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Preset at index ${idx} value must be a u64 bigint`,
        { field: `presets[${idx}].value` },
      );
    }
    if (typeof preset.gasLimit !== "bigint" || preset.gasLimit <= 0n || preset.gasLimit > U64_MAX) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Preset at index ${idx} gasLimit must be a positive u64 bigint`,
        { field: `presets[${idx}].gasLimit` },
      );
    }

    return {
      contractHex: bytesToHex(preset.contract),
      method,
      argsHex: bytesToHex(preset.args),
      value: preset.value.toString(),
      gasLimit: preset.gasLimit.toString(),
    };
  });

  const bundle: ContractPresetsExportBundle = {
    version: CONTRACT_PRESETS_SCHEMA_VERSION,
    presets: serialized,
  };
  return JSON.stringify(bundle, null, 2);
}

/**
 * Parses and strictly validates an imported JSON contract call presets bundle,
 * enforcing byte-size, schema version, max-items, hex, and u64 integer bounds.
 */
export function parseImportedContractPresetsJson(rawJson: string): CallTxKind[] {
  if (typeof rawJson !== "string" || rawJson.trim().length === 0) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      "Presets JSON input must be a non-empty string",
      { field: "rawJson" },
    );
  }

  const byteLen = new TextEncoder().encode(rawJson).length;
  if (byteLen > MAX_CONTRACT_PRESETS_JSON_BYTES) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      `Presets JSON payload exceeds maximum allowed size of ${MAX_CONTRACT_PRESETS_JSON_BYTES} bytes (got ${byteLen})`,
      { field: "rawJson" },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err: unknown) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      `Malformed presets JSON: ${err instanceof Error ? err.message : String(err)}`,
      { field: "rawJson" },
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      "Presets JSON root must be an object with { version: 1, presets: [...] }",
      { field: "root" },
    );
  }

  const root = parsed as Record<string, unknown>;
  if (root.version !== CONTRACT_PRESETS_SCHEMA_VERSION) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      `Unsupported presets schema version: expected ${CONTRACT_PRESETS_SCHEMA_VERSION}, got ${String(root.version)}`,
      { field: "version" },
    );
  }

  if (!Array.isArray(root.presets)) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      "Presets JSON must contain a presets array",
      { field: "presets" },
    );
  }

  if (root.presets.length === 0) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      "Presets JSON contains no contract call presets",
      { field: "presets" },
    );
  }

  if (root.presets.length > MAX_CONTRACT_PRESETS_ITEMS) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      `Presets JSON exceeds maximum allowed count of ${MAX_CONTRACT_PRESETS_ITEMS} items (got ${root.presets.length})`,
      { field: "presets" },
    );
  }

  return root.presets.map((entry, idx): CallTxKind => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Preset at index ${idx} must be an object`,
        { field: `presets[${idx}]` },
      );
    }

    const item = entry as Record<string, unknown>;

    if (typeof item.contractHex !== "string") {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Preset at index ${idx} is missing string contractHex`,
        { field: `presets[${idx}].contractHex` },
      );
    }
    const cleanContractHex = item.contractHex.trim().replace(/^0x/i, "");
    if (!/^[0-9a-fA-F]{64}$/.test(cleanContractHex)) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Preset at index ${idx} contractHex must be a 32-byte (64-char) hex string`,
        { field: `presets[${idx}].contractHex` },
      );
    }

    if (typeof item.method !== "string") {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Preset at index ${idx} is missing string method`,
        { field: `presets[${idx}].method` },
      );
    }
    const method = item.method.trim();
    if (
      method.length === 0 ||
      method.length > MAX_PRESET_METHOD_LENGTH ||
      !/^[\x20-\x7e]+$/.test(method)
    ) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Preset at index ${idx} method must be 1..${MAX_PRESET_METHOD_LENGTH} printable ASCII characters`,
        { field: `presets[${idx}].method` },
      );
    }

    if (typeof item.argsHex !== "string") {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Preset at index ${idx} is missing string argsHex`,
        { field: `presets[${idx}].argsHex` },
      );
    }
    const cleanArgsHex = item.argsHex.trim().replace(/^0x/i, "");
    if (
      cleanArgsHex.length % 2 !== 0 ||
      cleanArgsHex.length / 2 > MAX_PRESET_ARGS_BYTES ||
      (cleanArgsHex.length > 0 && !/^[0-9a-fA-F]+$/.test(cleanArgsHex))
    ) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Preset at index ${idx} argsHex must be valid even-length hex <= ${MAX_PRESET_ARGS_BYTES} bytes`,
        { field: `presets[${idx}].argsHex` },
      );
    }

    if (typeof item.value !== "string" || !/^(0|[1-9][0-9]*)$/.test(item.value.trim())) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Preset at index ${idx} value must be a non-negative decimal integer string`,
        { field: `presets[${idx}].value` },
      );
    }
    const value = BigInt(item.value.trim());
    if (value < 0n || value > U64_MAX) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Preset at index ${idx} value exceeds u64 range`,
        { field: `presets[${idx}].value` },
      );
    }

    if (typeof item.gasLimit !== "string" || !/^[1-9][0-9]*$/.test(item.gasLimit.trim())) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Preset at index ${idx} gasLimit must be a positive decimal integer string`,
        { field: `presets[${idx}].gasLimit` },
      );
    }
    const gasLimit = BigInt(item.gasLimit.trim());
    if (gasLimit <= 0n || gasLimit > U64_MAX) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Preset at index ${idx} gasLimit exceeds u64 range`,
        { field: `presets[${idx}].gasLimit` },
      );
    }

    return {
      type: "call",
      contract: hexToBytes(cleanContractHex),
      value,
      method,
      args: hexToBytes(cleanArgsHex),
      gasLimit,
    };
  });
}

// --- JSON-RPC 2.0 Read-Only Batch Runner ---

export const READ_ONLY_JSONRPC_BATCH_METHODS: ReadonlySet<string> = new Set(
  DEFAULT_IDEMPOTENT_RPC_METHODS,
);

export const DEFAULT_JSONRPC_READ_BATCH_PRESET: ReadonlyArray<JsonRpcBatchRequestItem> = Object.freeze([
  { method: "kovanica_chainId", params: [] },
  { method: "kovanica_blockNumber", params: [] },
  { method: "kovanica_estimateFee", params: [] },
]);

export interface JsonRpcBatchClient {
  callBatch<TResult = unknown>(
    requests: ReadonlyArray<JsonRpcBatchRequestItem>,
    options?: RequestOptions,
  ): Promise<Array<JsonRpcBatchItemResult<TResult>>>;
}

export type JsonRpcReadBatchEntry =
  | {
      index: number;
      method: string;
      ok: true;
      result: unknown;
    }
  | {
      index: number;
      method: string;
      ok: false;
      error: {
        code?: number;
        message: string;
        data?: unknown;
      };
    };

export interface JsonRpcReadBatchSummary {
  totalRequests: number;
  succeededCount: number;
  failedCount: number;
  elapsedMs: number;
  items: JsonRpcReadBatchEntry[];
}

/**
 * Executes a bounded (`1..=MAX_JSONRPC_BATCH_SIZE`, i.e. `1..=32`) read-only JSON-RPC 2.0 batch
 * in a single HTTP POST via `client.callBatch(requests, options)`.
 *
 * Rejects empty batches, oversized batches (> 32 items), and any non-read-only or state-mutating
 * RPC methods (such as `kovanica_sendRawTransaction` or `kovanica_submitWork`) fail-closed before
 * issuing any network request.
 */
export async function executeJsonRpcReadBatch(
  client: JsonRpcBatchClient,
  requests: ReadonlyArray<JsonRpcBatchRequestItem>,
  options?: RequestOptions,
): Promise<JsonRpcReadBatchSummary> {
  if (!client || typeof client.callBatch !== "function") {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      "RPC client must provide a callBatch(requests, options) method",
      { field: "client" },
    );
  }
  if (!Array.isArray(requests)) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      "JSON-RPC batch requests must be an array",
      { field: "requests" },
    );
  }
  if (requests.length < 1 || requests.length > MAX_JSONRPC_BATCH_SIZE) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      `JSON-RPC read batch must contain between 1 and ${MAX_JSONRPC_BATCH_SIZE} requests (got ${requests.length})`,
      { field: "requests" },
    );
  }

  const normalizedRequests: JsonRpcBatchRequestItem[] = requests.map((item, idx) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Batch item at index ${idx} must be an object with { method, params? }`,
        { field: `requests[${idx}]` },
      );
    }
    const method = typeof item.method === "string" ? item.method.trim() : "";
    if (method.length === 0) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Batch item at index ${idx} is missing a non-empty method name`,
        { field: `requests[${idx}].method` },
      );
    }
    if (!READ_ONLY_JSONRPC_BATCH_METHODS.has(method)) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Batch item at index ${idx} method "${method}" is not an allowlisted read-only JSON-RPC method`,
        { field: `requests[${idx}].method` },
      );
    }
    return item.params === undefined ? { method } : { method, params: item.params };
  });

  const startedAt = Date.now();
  const rawResults = await client.callBatch(normalizedRequests, options);
  const elapsedMs = Math.max(0, Date.now() - startedAt);

  let succeededCount = 0;
  let failedCount = 0;
  const items: JsonRpcReadBatchEntry[] = rawResults.map((entry, idx) => {
    const method = normalizedRequests[idx]?.method ?? "unknown";
    if (entry.ok) {
      succeededCount += 1;
      return {
        index: idx,
        method,
        ok: true,
        result: entry.result,
      };
    }
    failedCount += 1;
    const rpcErr = entry.error as { code?: number; message?: string; data?: unknown } | undefined;
    return {
      index: idx,
      method,
      ok: false,
      error: {
        ...(typeof rpcErr?.code === "number" ? { code: rpcErr.code } : {}),
        message: rpcErr?.message || String(entry.error),
        ...(rpcErr?.data !== undefined ? { data: rpcErr.data } : {}),
      },
    };
  });

  return {
    totalRequests: normalizedRequests.length,
    succeededCount,
    failedCount,
    elapsedMs,
    items,
  };
}

// --- Typed Contract Facades Studio Runner ---

export type TypedFacadeKind =
  | "name"
  | "token"
  | "nft"
  | "escrow"
  | "htlc"
  | "vault"
  | "multisig";

export interface TypedFacadeReadParams {
  facade: TypedFacadeKind;
  contract: Uint8Array | string;
  key?: Uint8Array | string;
}

export interface TypedFacadeReadResult {
  facade: TypedFacadeKind;
  method: string;
  contractAddress: string;
  contractHex: string;
  found: boolean;
  record: unknown | null;
}

function requireNonEmptyFacadeKey(
  facade: TypedFacadeKind,
  key: Uint8Array | string | undefined,
): Uint8Array | string {
  if (key === undefined) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      `Facade "${facade}" requires a non-empty key`,
      { field: "key" },
    );
  }
  if (typeof key === "string") {
    const trimmed = key.trim();
    if (trimmed.length === 0) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Facade "${facade}" requires a non-empty key`,
        { field: "key" },
      );
    }
    return trimmed;
  }
  if (key.length === 0) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      `Facade "${facade}" requires a non-empty key`,
      { field: "key" },
    );
  }
  return key;
}

/**
 * Dispatches a typed read across all 7 canonical Kovanica SDK contract facades:
 * - `name`     -> `NameRegistryClient.getRecord(key)`
 * - `token`    -> `TokenClient.getMetadata()`
 * - `nft`      -> `NftClient.getMetadata()`
 * - `escrow`   -> `EscrowClient.getEscrow(key)`
 * - `htlc`     -> `HtlcClient.getHtlc(key)`
 * - `vault`    -> `VaultClient.getVault(key)`
 * - `multisig` -> `MultisigClient.getState()`
 */
export async function runTypedFacadeRead(
  client: ContractFacadeClient,
  params: TypedFacadeReadParams,
  options?: ReadContractStorageOptions,
): Promise<TypedFacadeReadResult> {
  const contractInput =
    typeof params.contract === "string" ? params.contract.trim() : params.contract;
  if (
    !contractInput ||
    (typeof contractInput === "string" && contractInput.length === 0) ||
    (contractInput instanceof Uint8Array && contractInput.length === 0)
  ) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      "Contract address must be a non-empty 32-byte hex string, Uint8Array, or PRO-21 address",
      { field: "contract" },
    );
  }

  switch (params.facade) {
    case "name": {
      const key = requireNonEmptyFacadeKey("name", params.key);
      if (typeof key !== "string") {
        throw new KovanicaDecodeError(
          "INVALID_INPUT",
          'Facade "name" requires a string name key',
          { field: "key" },
        );
      }
      const facade = new NameRegistryClient(client, contractInput);
      const record = await facade.getRecord(key, options);
      return {
        facade: "name",
        method: "NameRegistryClient.getRecord",
        contractAddress: facade.contractAddress,
        contractHex: facade.contractHex,
        found: record !== null,
        record,
      };
    }
    case "token": {
      const facade = new TokenClient(client, contractInput);
      const record = await facade.getMetadata(options);
      return {
        facade: "token",
        method: "TokenClient.getMetadata",
        contractAddress: facade.contractAddress,
        contractHex: facade.contractHex,
        found: record !== null,
        record,
      };
    }
    case "nft": {
      const facade = new NftClient(client, contractInput);
      const record = await facade.getMetadata(options);
      return {
        facade: "nft",
        method: "NftClient.getMetadata",
        contractAddress: facade.contractAddress,
        contractHex: facade.contractHex,
        found: record !== null,
        record,
      };
    }
    case "escrow": {
      const key = requireNonEmptyFacadeKey("escrow", params.key);
      const facade = new EscrowClient(client, contractInput);
      const record = await facade.getEscrow(key, options);
      return {
        facade: "escrow",
        method: "EscrowClient.getEscrow",
        contractAddress: facade.contractAddress,
        contractHex: facade.contractHex,
        found: record !== null,
        record,
      };
    }
    case "htlc": {
      const key = requireNonEmptyFacadeKey("htlc", params.key);
      const facade = new HtlcClient(client, contractInput);
      const record = await facade.getHtlc(key, options);
      return {
        facade: "htlc",
        method: "HtlcClient.getHtlc",
        contractAddress: facade.contractAddress,
        contractHex: facade.contractHex,
        found: record !== null,
        record,
      };
    }
    case "vault": {
      const key = requireNonEmptyFacadeKey("vault", params.key);
      const facade = new VaultClient(client, contractInput);
      const record = await facade.getVault(key, options);
      return {
        facade: "vault",
        method: "VaultClient.getVault",
        contractAddress: facade.contractAddress,
        contractHex: facade.contractHex,
        found: record !== null,
        record,
      };
    }
    case "multisig": {
      const facade = new MultisigClient(client, contractInput);
      const record = await facade.getState(options);
      return {
        facade: "multisig",
        method: "MultisigClient.getState",
        contractAddress: facade.contractAddress,
        contractHex: facade.contractHex,
        found: record !== null,
        record,
      };
    }
    default:
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `Unsupported contract facade: ${String(params.facade)}`,
        { field: "facade" },
      );
  }
}

// --- Contract Log History Explorer & Failover RPC Probe ---

export interface ContractLogHistoryQueryParams {
  fromBlock: bigint | number | string;
  toBlock: bigint | number | string;
  address?: Uint8Array | string;
  decoderKind?: ContractLogKind | "";
  chunkSize?: number;
  topics?: ReadonlyArray<string | ReadonlyArray<string> | null>;
  signal?: AbortSignal;
  requestOptions?: RequestOptions;
}

export interface ContractLogHistoryQueryResult {
  fromBlock: string;
  toBlock: string;
  chunksQueried: number;
  totalLogs: number;
  decodedCount: number;
  decoderKind: ContractLogKind | null;
  logs: unknown[];
  decodedLogs: unknown[];
}

export interface FailoverRpcProbeResult {
  ok: boolean;
  chainId?: number;
  blockNumber?: string;
  activeEndpoints: FailoverEndpointHealth[];
  failoverEvents: FailoverEvent[];
  error?: string;
}

function toJsonSafeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Uint8Array) {
    return `0x${bytesToHex(value)}`;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonSafeValue(item));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) {
        out[k] = toJsonSafeValue(v);
      }
    }
    return out;
  }
  return value;
}

function parseBlockHeightInput(
  value: bigint | number | string,
  field: string,
): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `${field} must be a non-negative integer`,
        { field },
      );
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `${field} must be a non-negative safe integer`,
        { field },
      );
    }
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(trimmed)) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        `${field} must be a non-negative decimal or 0x-hex integer`,
        { field },
      );
    }
    return BigInt(trimmed);
  }
  throw new KovanicaDecodeError(
    "INVALID_INPUT",
    `${field} must be a bigint, integer, or numeric string`,
    { field },
  );
}

/**
 * Wraps `getContractLogHistory` with fail-closed input normalization and
 * JSON-serializable output (safely converting `bigint` to string and `Uint8Array` to `0x` hex).
 */
export async function runContractLogHistoryQuery(
  client: GetLogsClient,
  params: ContractLogHistoryQueryParams,
): Promise<ContractLogHistoryQueryResult> {
  const fromBlock = parseBlockHeightInput(params.fromBlock, "fromBlock");
  const toBlock = parseBlockHeightInput(params.toBlock, "toBlock");

  const trimmedAddress =
    typeof params.address === "string" ? params.address.trim() : params.address;
  const contract =
    trimmedAddress &&
    (typeof trimmedAddress !== "string" || trimmedAddress.length > 0)
      ? trimmedAddress
      : undefined;

  const decoderKind =
    params.decoderKind && params.decoderKind.trim().length > 0
      ? (params.decoderKind.trim() as ContractLogKind)
      : undefined;

  const history = await getContractLogHistory(client, {
    fromBlock,
    toBlock,
    ...(contract !== undefined ? { contract } : {}),
    ...(decoderKind !== undefined ? { kind: decoderKind } : {}),
    ...(params.chunkSize !== undefined ? { chunkSize: params.chunkSize } : {}),
    ...(params.topics !== undefined ? { topics: params.topics } : {}),
    ...(params.signal !== undefined ? { signal: params.signal } : {}),
    ...(params.requestOptions !== undefined
      ? { requestOptions: params.requestOptions }
      : {}),
  });

  const logs = history.logs.map((entry) => toJsonSafeValue(entry));
  const decodedLogs = history.decodedLogs.map((entry) => toJsonSafeValue(entry));

  return {
    fromBlock: history.fromBlock.toString(),
    toBlock: history.toBlock.toString(),
    chunksQueried: history.chunksQueried,
    totalLogs: logs.length,
    decodedCount: decodedLogs.length,
    decoderKind: decoderKind ?? null,
    logs,
    decodedLogs,
  };
}

function parseRpcEndpointList(urls: string | readonly string[]): string[] {
  const rawList =
    typeof urls === "string" ? urls.split(/[\n,]+/) : Array.from(urls);
  return rawList.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

/**
 * Probes a comma/newline-separated list (or array) of Kovanica JSON-RPC endpoints
 * using `FailoverHttpTransport` + `KovanicaClient`, returning chain ID, block height,
 * endpoint health snapshots, and any failover events triggered during the probe.
 */
export async function probeFailoverRpcEndpoints(
  urls: string | readonly string[],
  fetchImpl?: typeof fetch,
): Promise<FailoverRpcProbeResult> {
  const parsedUrls = parseRpcEndpointList(urls);
  if (parsedUrls.length === 0) {
    return {
      ok: false,
      activeEndpoints: [],
      failoverEvents: [],
      error: "Provide at least one HTTP(S) RPC endpoint URL.",
    };
  }

  const failoverEvents: FailoverEvent[] = [];
  let transport: FailoverHttpTransport;
  try {
    transport = new FailoverHttpTransport({
      urls: parsedUrls,
      timeoutMs: 5_000,
      maxRetriesPerEndpoint: 0,
      baseBackoffMs: 0,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
      onFailover: (event) => {
        failoverEvents.push(event);
      },
    });
  } catch (err: unknown) {
    return {
      ok: false,
      activeEndpoints: [],
      failoverEvents,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const client = new KovanicaClient({ transport });
  try {
    const rawChainId = await client.call<string | number>("kovanica_chainId");
    const chainId =
      typeof rawChainId === "number"
        ? rawChainId
        : Number(BigInt(String(rawChainId).trim()));
    const blockNumber = await client.blockNumber();
    return {
      ok: true,
      chainId,
      blockNumber: blockNumber.toString(),
      activeEndpoints: transport.getEndpointHealth(),
      failoverEvents,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      activeEndpoints: transport.getEndpointHealth(),
      failoverEvents,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// --- Offline Raw Wire Tx Decoder & RPC Node Capability Probe ---

export interface InspectRawSignedCallTxOptions {
  /**
   * Optional Chain ID used when recomputing the domain-tagged BLAKE3 signing hash.
   * Defaults to `CHAIN_IDS.MAINNET` (`1`) when omitted.
   */
  chainId?: bigint | number;
  /**
   * Optional 32-byte Ed25519 signer public key hex (with or without `0x` prefix).
   * When omitted or blank, verifies against the transaction's embedded `senderBytes`.
   */
  publicKeyHex?: string;
}

export interface InspectedSignedCallTx {
  senderHex: string;
  senderAddress: string;
  nonce: string;
  fee: string;
  contractHex: string;
  contractAddress: string;
  method: string;
  callValue: string;
  argsHex: string;
  argsByteLength: number;
  gasLimit: string;
  signatureHex: string;
  signingHashHex: string;
  wireHashHex: string;
  chainId: number;
  wireSizeBytes: number;
  signatureValid: boolean;
}

export interface NodeCapabilityProbeSummary {
  ok: boolean;
  url: string;
  chainId?: string;
  blockHeight?: string;
  feeRate?: string;
  batchSupported: boolean;
  networkTag?: string;
  rpcVersion?: string;
  headerChainId?: string;
  canonicalTagMatch: boolean | null;
  latencyMs: number;
  error?: string;
}

function normalizeOptionalChainId(chainId?: bigint | number): number | undefined {
  if (chainId === undefined) return undefined;
  if (typeof chainId === "bigint") {
    if (chainId < 0n || chainId > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new KovanicaDecodeError(
        "INVALID_INPUT",
        "chainId must be a non-negative safe integer",
        { field: "chainId" },
      );
    }
    return Number(chainId);
  }
  if (!Number.isSafeInteger(chainId) || chainId < 0) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      "chainId must be a non-negative safe integer",
      { field: "chainId" },
    );
  }
  return chainId;
}

function parseOptionalPublicKeyHex(publicKeyHex?: string): Uint8Array | undefined {
  if (publicKeyHex === undefined) return undefined;
  const trimmed = publicKeyHex.trim();
  if (trimmed.length === 0) return undefined;
  const clean = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new KovanicaDecodeError(
      "INVALID_INPUT",
      "publicKeyHex must be a 32-byte (64-character) hex string",
      { field: "publicKeyHex" },
    );
  }
  return hexToBytes(clean);
}

/**
 * Decodes a raw signed Call transaction hex offline via `decodeSignedCallTransaction`,
 * verifies its Ed25519 signature via `verifyCallTransactionSignature`, and returns a
 * JSON-safe summary (with all `bigint` fields serialized as decimal strings).
 */
export function inspectRawSignedCallTx(
  rawTxHex: string,
  options?: InspectRawSignedCallTxOptions,
): InspectedSignedCallTx {
  const normalizedChainId = normalizeOptionalChainId(options?.chainId);
  const overridePubKey = parseOptionalPublicKeyHex(options?.publicKeyHex);

  const decoded = decodeSignedCallTransaction(
    rawTxHex.trim(),
    normalizedChainId !== undefined ? { chainId: normalizedChainId } : undefined,
  );
  const signatureValid = verifyCallTransactionSignature(decoded, overridePubKey);

  return {
    senderHex: decoded.senderHex,
    senderAddress: decoded.senderAddress,
    nonce: decoded.nonce.toString(),
    fee: decoded.fee.toString(),
    contractHex: decoded.contractHex,
    contractAddress: decoded.contractAddress,
    method: decoded.method,
    callValue: decoded.callValue.toString(),
    argsHex: decoded.argsHex,
    argsByteLength: decoded.args.length,
    gasLimit: decoded.gasLimit.toString(),
    signatureHex: decoded.signatureHex,
    signingHashHex: decoded.signingHashHex,
    wireHashHex: decoded.wireHashHex,
    chainId: decoded.chainId,
    wireSizeBytes: decoded.wireSizeBytes,
    signatureValid,
  };
}

export interface InspectRawSignedTransferTxOptions {
  /**
   * Optional Chain ID used when recomputing the domain-tagged BLAKE3 signing hash.
   * Defaults to `CHAIN_IDS.MAINNET` (`1`) when omitted.
   */
  chainId?: bigint | number;
  /**
   * Optional 32-byte Ed25519 signer public key hex (with or without `0x` prefix).
   * When omitted or blank, verifies against the transaction's embedded `senderBytes`.
   */
  publicKeyHex?: string;
}

export interface InspectedSignedTransferTx {
  senderHex: string;
  senderAddress: string;
  recipientHex: string;
  recipientAddress: string;
  nonce: string;
  amount: string;
  fee: string;
  signatureHex: string;
  signingHashHex: string;
  wireHashHex: string;
  chainId: string;
  wireSizeBytes: number;
  signatureValid: boolean;
}

/**
 * Decodes a raw signed native Transfer transaction hex offline via
 * `decodeSignedTransferTransaction`, verifies its Ed25519 signature via
 * `verifyTransferTransactionSignature`, and returns a JSON-safe summary
 * (with all `bigint` fields serialized as decimal strings).
 */
export function inspectRawSignedTransferTx(
  rawTxHex: string,
  options?: InspectRawSignedTransferTxOptions,
): InspectedSignedTransferTx {
  const normalizedChainId = normalizeOptionalChainId(options?.chainId);
  const overridePubKey = parseOptionalPublicKeyHex(options?.publicKeyHex);

  const decoded = decodeSignedTransferTransaction(
    rawTxHex.trim(),
    normalizedChainId !== undefined ? { chainId: normalizedChainId } : undefined,
  );
  const signatureValid = verifyTransferTransactionSignature(decoded, overridePubKey);

  return {
    senderHex: decoded.senderHex,
    senderAddress: decoded.senderAddress,
    recipientHex: decoded.recipientHex,
    recipientAddress: decoded.recipientAddress,
    nonce: decoded.nonce.toString(),
    amount: decoded.amount.toString(),
    fee: decoded.fee.toString(),
    signatureHex: decoded.signatureHex,
    signingHashHex: decoded.signingHashHex,
    wireHashHex: decoded.wireHashHex,
    chainId: decoded.chainId.toString(),
    wireSizeBytes: decoded.wireSizeBytes,
    signatureValid,
  };
}

export interface InspectAnySignedTxOptions {
  /**
   * Optional Chain ID used when recomputing the domain-tagged BLAKE3 signing hash.
   * Defaults to `CHAIN_IDS.MAINNET` (`1`) when omitted.
   */
  chainId?: bigint | number;
  /**
   * Optional 32-byte Ed25519 signer public key hex (with or without `0x` prefix).
   * When omitted or blank, verifies against the transaction's embedded `senderBytes`.
   */
  publicKeyHex?: string;
}

export type InspectedSignedTransferTxAuto = InspectedSignedTransferTx & {
  kind: "transfer";
  variant: 0;
};

export type InspectedSignedCallTxAuto = InspectedSignedCallTx & {
  kind: "call";
  variant: 6;
};

export type InspectedSignedTxAuto =
  | InspectedSignedTransferTxAuto
  | InspectedSignedCallTxAuto;

/**
 * Automatically detects the transaction variant (`transfer` or `call`) via
 * `decodeSignedTransactionAuto`, verifies its Ed25519 signature via
 * `verifySignedTransactionAuto`, and returns a JSON-safe discriminated summary
 * (with all `bigint` fields serialized as decimal strings).
 */
export function inspectAnySignedTx(
  rawTxHex: string,
  options?: InspectAnySignedTxOptions,
): InspectedSignedTxAuto {
  const normalizedChainId = normalizeOptionalChainId(options?.chainId);
  const overridePubKey = parseOptionalPublicKeyHex(options?.publicKeyHex);

  const decoded = decodeSignedTransactionAuto(
    rawTxHex.trim(),
    normalizedChainId !== undefined ? { chainId: normalizedChainId } : undefined,
  );
  const signatureValid = verifySignedTransactionAuto(decoded, overridePubKey);

  if (decoded.kind === "transfer") {
    const tx = decoded.tx;
    return {
      kind: "transfer",
      variant: 0,
      senderHex: tx.senderHex,
      senderAddress: tx.senderAddress,
      recipientHex: tx.recipientHex,
      recipientAddress: tx.recipientAddress,
      nonce: tx.nonce.toString(),
      amount: tx.amount.toString(),
      fee: tx.fee.toString(),
      signatureHex: tx.signatureHex,
      signingHashHex: tx.signingHashHex,
      wireHashHex: tx.wireHashHex,
      chainId: tx.chainId.toString(),
      wireSizeBytes: tx.wireSizeBytes,
      signatureValid,
    };
  }

  const tx = decoded.tx;
  return {
    kind: "call",
    variant: 6,
    senderHex: tx.senderHex,
    senderAddress: tx.senderAddress,
    nonce: tx.nonce.toString(),
    fee: tx.fee.toString(),
    contractHex: tx.contractHex,
    contractAddress: tx.contractAddress,
    method: tx.method,
    callValue: tx.callValue.toString(),
    argsHex: tx.argsHex,
    argsByteLength: tx.args.length,
    gasLimit: tx.gasLimit.toString(),
    signatureHex: tx.signatureHex,
    signingHashHex: tx.signingHashHex,
    wireHashHex: tx.wireHashHex,
    chainId: tx.chainId,
    wireSizeBytes: tx.wireSizeBytes,
    signatureValid,
  };
}

/**
 * Wraps `probeRpcNode` and converts all `bigint` fields (`chainId`, `blockHeight`,
 * `feeRate`, `headerChainId`) to JSON-safe decimal strings.
 */
export async function runNodeCapabilityProbe(
  url: string,
  options?: RpcNodeProbeOptions,
): Promise<NodeCapabilityProbeSummary> {
  const result = await probeRpcNode(url, options);
  return {
    ok: result.ok,
    url: result.url,
    ...(result.chainId !== undefined ? { chainId: result.chainId.toString() } : {}),
    ...(result.blockHeight !== undefined ? { blockHeight: result.blockHeight.toString() } : {}),
    ...(result.feeRate !== undefined ? { feeRate: result.feeRate.toString() } : {}),
    batchSupported: result.batchSupported,
    ...(result.networkTag !== undefined ? { networkTag: result.networkTag } : {}),
    ...(result.rpcVersion !== undefined ? { rpcVersion: result.rpcVersion } : {}),
    ...(result.headerChainId !== undefined
      ? { headerChainId: result.headerChainId.toString() }
      : {}),
    canonicalTagMatch: result.canonicalTagMatch,
    latencyMs: result.latencyMs,
    ...(result.error !== undefined ? { error: result.error } : {}),
  };
}

// --- Mempool Fee-Tier Estimator (kovanica-sdk v0.5.0) ---

export interface MempoolFeeTierProbeClient {
  getMempoolStats(): Promise<MempoolFeeStats>;
  estimateFee(): Promise<bigint>;
}

export interface MempoolFeeTierProbeResult {
  source: "mempool" | "fallback";
  pendingCount: number;
  totalBytes: number;
  economyAtoms: string;
  standardAtoms: string;
  priorityAtoms: string;
}

/**
 * Probes `kovanica_mempoolStats` and computes monotonic `economy` / `standard` / `priority`
 * fee-per-byte recommendations via `computeFeeRecommendations`.
 * Gracefully falls back to `estimateFee()` when `getMempoolStats()` fails (e.g. legacy node)
 * or when the mempool is empty.
 */
export async function runMempoolFeeTierProbe(
  client: MempoolFeeTierProbeClient,
  options?: Omit<FeeRecommendationOptions, "fallbackBaseFeePerByte">,
): Promise<MempoolFeeTierProbeResult> {
  let stats: MempoolFeeStats | null = null;
  try {
    stats = await client.getMempoolStats();
  } catch {
    stats = null;
  }

  if (stats && stats.pendingCount > 0 && stats.p50FeePerByte !== null) {
    const recommendations = computeFeeRecommendations(stats, options);
    return {
      source: recommendations.source,
      pendingCount: stats.pendingCount,
      totalBytes: stats.totalBytes,
      economyAtoms: recommendations.economy.toString(),
      standardAtoms: recommendations.standard.toString(),
      priorityAtoms: recommendations.priority.toString(),
    };
  }

  const fallbackBaseFeePerByte = await client.estimateFee();
  const emptyStats: MempoolFeeStats = {
    pendingCount: stats?.pendingCount ?? 0,
    totalBytes: stats?.totalBytes ?? 0,
    minFeePerByte: null,
    p50FeePerByte: null,
    p90FeePerByte: null,
    maxFeePerByte: null,
  };
  const recommendations = computeFeeRecommendations(emptyStats, {
    ...options,
    fallbackBaseFeePerByte,
  });

  return {
    source: recommendations.source,
    pendingCount: emptyStats.pendingCount,
    totalBytes: emptyStats.totalBytes,
    economyAtoms: recommendations.economy.toString(),
    standardAtoms: recommendations.standard.toString(),
    priorityAtoms: recommendations.priority.toString(),
  };
}

// --- Watch-Only Account Inspector & Account Tx History Explorer ---

export type WatchOnlyInspectionResult =
  | {
      ok: true;
      account: WatchOnlyAccount;
    }
  | {
      ok: false;
      error: string;
    };

/**
 * Validates a PRO-21 address and optional chain ID via `createWatchOnlyAccount`,
 * returning a structured result without throwing for UI form validation.
 */
export function inspectWatchOnlyAccount(
  address: string,
  chainId?: number,
): WatchOnlyInspectionResult {
  const trimmed = address.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "PRO-21 address is required (kvnc...dag or tknc...dag)" };
  }
  try {
    const account = createWatchOnlyAccount(trimmed, chainId);
    return { ok: true, account };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface AccountTxHistoryQueryOptions {
  address: string;
  direction?: AccountTxDirection;
  limit?: number;
  maxPages?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface FormattedAccountTxHistoryItem {
  hash: string;
  height: string;
  timestamp: string | null;
  from: string;
  to: string | null;
  amountAtoms: string;
  amountKvnc: string;
  feeAtoms: string;
  feeKvnc: string;
  kind: string;
  status: AccountTxStatus;
}

export interface AccountTxHistorySummary {
  address: string;
  direction: AccountTxDirection;
  items: FormattedAccountTxHistoryItem[];
  nextCursor: string | null;
  hasMore: boolean;
  pagesFetched: number;
}

/**
 * Fetches paginated account transaction history via `getAccountTxHistory` and formats
 * all `bigint` fields (`amount`, `fee`, `height`, `timestamp`) losslessly for UI display
 * and JSON serialization.
 */
export async function fetchAccountTxHistorySummary(
  client: AccountTxHistoryClient,
  options: AccountTxHistoryQueryOptions,
): Promise<AccountTxHistorySummary> {
  const address = options.address.trim();
  if (address.length === 0) {
    throw new Error("Account address is required to fetch transaction history");
  }
  const direction: AccountTxDirection = options.direction ?? "all";
  const result = await getAccountTxHistory(client, {
    address,
    direction,
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
    ...(options.cursor !== undefined && options.cursor.trim().length > 0
      ? { cursor: options.cursor.trim() }
      : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  return {
    address,
    direction,
    items: result.items.map((entry) => ({
      hash: entry.hash,
      height: entry.height.toString(),
      timestamp: entry.timestamp !== null ? entry.timestamp.toString() : null,
      from: entry.from,
      to: entry.to,
      amountAtoms: entry.amount.toString(),
      amountKvnc: formatKvnc(entry.amount),
      feeAtoms: entry.fee.toString(),
      feeKvnc: formatKvnc(entry.fee),
      kind: entry.kind,
      status: entry.status,
    })),
    nextCursor: result.nextCursor,
    hasMore: result.hasMore,
    pagesFetched: result.pagesFetched,
  };
}




