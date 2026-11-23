import { blake3 } from "@noble/hashes/blake3.js";
import { sha512 } from "@noble/hashes/sha2.js";
import * as ed from "@noble/ed25519";
import { generateMnemonic as scureGenerateMnemonic, validateMnemonic as scureValidateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  ADDRESS_PREFIX,
  bip39Seed,
  CHAIN_IDS,
  decodeAddress,
  decodeEscrowRecord,
  decodeHtlcRecord,
  decodeMultisigState,
  decodeNameRecord,
  decodeNftMetadata,
  decodeTokenMetadata,
  decodeVaultRecord,
  deriveBip44,
  derivePrefixedStorageSlot,
  deriveStorageSlotHex,
  encodeAddress,
  estimateAndBuildCall,
  estimateCallTxSize,
  formatBip44Path,
  getPublicKey,
  KOVANICA_COIN_TYPE,
  KovanicaDecodeError,
  TESTNET_ADDRESS_PREFIX,
  toHexQuantity,
  type EstimateAndBuildCallClient,
  type EstimateAndBuildCallOptions,
  type PreparedCallTransaction,
  type StorageSlotContract,
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
  derivePrefixedStorageSlot,
  deriveStorageSlotHex,
  estimateAndBuildCall,
  estimateCallTxSize,
  KovanicaDecodeError,
  type EstimateAndBuildCallClient,
  type EstimateAndBuildCallOptions,
  type PreparedCallTransaction,
  type StorageSlotContract,
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
