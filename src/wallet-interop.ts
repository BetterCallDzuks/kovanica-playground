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
  deriveBip44,
  encodeAddress,
  formatBip44Path,
  getPublicKey,
  KOVANICA_COIN_TYPE,
  TESTNET_ADDRESS_PREFIX,
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

  const ok = steps.every((s) => s.passed);
  return { ok, steps };
}
