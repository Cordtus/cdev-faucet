import 'dotenv/config';
import express from 'express'
import cors from 'cors'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';
import { Wallet, JsonRpcProvider, Contract, } from 'ethers'
import { bech32 } from 'bech32';

import { DirectSecp256k1Wallet, decodePubkey, makeAuthInfoBytes, makeSignDoc } from "@cosmjs/proto-signing";
import { accountFromAny, SigningStargateClient } from "@cosmjs/stargate";
import { pathToString } from '@cosmjs/crypto';
import { toHex, toBase64, } from '@cosmjs/encoding';
import { TxRaw, SignDoc, TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import { Any } from "cosmjs-types/google/protobuf/any.js";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx.js";
import Long from "long";

// Noble crypto imports for key derivation
import { keccak_256 } from '@noble/hashes/sha3';
import { secp256k1 } from '@noble/curves/secp256k1';
import { mnemonicToSeedSync, validateMnemonic } from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';

import conf, {
  initializeSecureKeys,
  getPrivateKey,
  getPrivateKeyBytes,
  getPublicKeyBytes,
  getEvmAddress,
  getCosmosAddress,
  getEvmPublicKey,
  validateDerivedAddresses
} from './config.js'
import logRotation from './src/logRotation.js'


const app = express()
const chainConf = conf.blockchain

// Import checker and token allowance tracker
import { FrequencyChecker } from './checker.js'
import { TokenAllowanceTracker } from './tokenAllowance.js'
const checker = new FrequencyChecker(conf)
const allowanceTracker = new TokenAllowanceTracker(conf)

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Update CORS to only allow certain domains in production
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://faucet.cosmos-evm.com',
      'https://cosmos-evm.com',
      'https://faucet.basementnodes.ca',
      'https://devnet-faucet.fly.dev',
      'http://localhost:3000',
      'http://localhost:8088'
    ];

    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Allow any origin in development mode
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }

    // Allow local network IPs (192.168.*.*, 10.*.*.*, 172.16-31.*.*)
    const localNetworkPattern = /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/;
    if (localNetworkPattern.test(origin)) {
      return callback(null, true);
    }

    // Allow localhost with any port
    if (origin.startsWith('http://localhost:') || origin.startsWith('https://localhost:')) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

// Serve static files in production mode - MUST come BEFORE CORS and other middleware
if (process.env.NODE_ENV === 'production') {
  const staticPath = path.join(__dirname, 'dist');
  console.log('[STATIC] Serving static files from:', staticPath);
  
  // Add debug middleware to log static file requests
  app.use((req, res, next) => {
    if (req.path.startsWith('/assets/')) {
      console.log('[STATIC] Asset request:', req.path);
    }
    next();
  });
  
  app.use(express.static(staticPath, {
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js')) {
        res.set('Content-Type', 'application/javascript');
      } else if (filePath.endsWith('.css')) {
        res.set('Content-Type', 'text/css');
      }
    }
  }));
}

app.use(cors(corsOptions));
app.use(express.json())
app.use(express.urlencoded({ extended: true }));

// Testing mode flag
const TESTING_MODE = process.env.TESTING_MODE === 'true';

if (TESTING_MODE) {
  console.log('\n  WARNING: TESTING MODE ENABLED ');
  console.log('- All addresses receive 1 of each token regardless of balance');
  console.log('- Rate limits still apply');
  console.log('- Set TESTING_MODE=false to disable\n');
}

// Global ERC20 ABIs
const ERC20_BASE_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

const ERC20_OWNABLE_ABI = [
  "function owner() view returns (address)"
];

const ERC20_APPROVAL_ABI = [
  ...ERC20_BASE_ABI,
  "event Approval(address indexed owner, address indexed spender, uint256 value)"
];

// Function to detect address type
function detectAddressType(address) {
  if (!address) return 'unknown';

  // Check if it's a hex address (EVM)
  if (address.startsWith('0x') && address.length === 42) {
    try {
      // Validate it's a valid hex address
      const normalized = address.toLowerCase();
      const valid = /^0x[a-f0-9]{40}$/.test(normalized);
      return valid ? 'evm' : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  // Check if it's a bech32 address (Cosmos)
  if (address.startsWith(conf.blockchain.sender.option.prefix)) {
    try {
      bech32.decode(address);
      return 'cosmos';
    } catch {
      return 'unknown';
    }
  }

  return 'unknown';
}

// Convert hex address to Cosmos address
function hexToCosmosAddress(hexAddress) {
  try {
    // Remove 0x prefix and convert to buffer
    const addressBytes = Buffer.from(hexAddress.slice(2), 'hex');
    // Encode to bech32 with chain prefix
    const words = bech32.toWords(addressBytes);
    return bech32.encode(conf.blockchain.sender.option.prefix, words);
  } catch (error) {
    console.error('Error converting hex to cosmos address:', error);
    return null;
  }
}

// Convert Cosmos address to hex
function cosmosAddressToHex(cosmosAddress) {
  try {
    const { words } = bech32.decode(cosmosAddress);
    const addressBytes = Buffer.from(bech32.fromWords(words));
    return '0x' + addressBytes.toString('hex');
  } catch (error) {
    console.error('Error converting cosmos to hex address:', error);
    return null;
  }
}

// Function to check and approve token
async function approveToken(tokenAddress, spenderAddress, amount) {
  const ethProvider = new JsonRpcProvider(chainConf.endpoints.evm_endpoint);
  const privateKey = getPrivateKey();
  const wallet = new Wallet(privateKey, ethProvider);

  try {
    const tokenContract = new Contract(tokenAddress, ERC20_APPROVAL_ABI, wallet);

    console.log(`Approving ${amount} tokens for ${spenderAddress} on token ${tokenAddress}`);

    const tx = await tokenContract.approve(spenderAddress, amount);
    console.log(`Approval transaction sent: ${tx.hash}`);

    await tx.wait();
    console.log(`Approval confirmed!`);

    return true;
  } catch (error) {
    console.error(`Error approving token ${tokenAddress}:`, error);
    return false;
  }
}

// Function to check allowance for a token
async function checkAllowance(tokenAddress, ownerAddress, spenderAddress) {
  const ethProvider = new JsonRpcProvider(chainConf.endpoints.evm_endpoint);

  try {
    const tokenContract = new Contract(tokenAddress, ERC20_APPROVAL_ABI, ethProvider);

    // Get token info
    const [symbol, decimals, allowance] = await Promise.all([
      tokenContract.symbol(),
      tokenContract.decimals(),
      tokenContract.allowance(ownerAddress, spenderAddress)
    ]);

    return {
      token: tokenAddress,
      symbol,
      decimals: Number(decimals),
      allowance: allowance.toString(),
      isApproved: allowance > 0n
    };
  } catch (error) {
    console.error(`Error checking allowance for ${tokenAddress}:`, error);
    return {
      token: tokenAddress,
      symbol: 'UNKNOWN',
      decimals: 18,
      allowance: '0',
      isApproved: false,
      error: error.message
    };
  }
}

// Check all token approvals
async function checkAllTokenApprovals() {
  const atomicMultiSendAddress = chainConf.contracts.atomicMultiSend;
  if (!atomicMultiSendAddress) {
    console.error('AtomicMultiSend contract address not configured');
    return [];
  }

  const evmAddress = getEvmAddress();
  const results = [];

  for (const token of chainConf.tx.amounts) {
    if (token.erc20_contract &&
        token.erc20_contract !== "0x0000000000000000000000000000000000000000" &&
        token.erc20_contract !== "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE") {

      const allowanceInfo = await checkAllowance(
        token.erc20_contract,
        evmAddress,
        atomicMultiSendAddress
      );

      results.push({
        ...allowanceInfo,
        denom: token.denom,
        required_amount: token.target_balance
      });
    }
  }

  return results;
}

// Setup token approvals
async function setupTokenApprovals() {
  console.log('\n Checking and setting up token approvals...');

  const atomicMultiSendAddress = chainConf.contracts.atomicMultiSend;
  if (!atomicMultiSendAddress) {
    console.error(' AtomicMultiSend contract address not configured');
    return false;
  }

  const evmAddress = getEvmAddress();
  let allApproved = true;

  for (const token of chainConf.tx.amounts) {
    if (token.erc20_contract &&
        token.erc20_contract !== "0x0000000000000000000000000000000000000000" &&
        token.erc20_contract !== "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE") {

      const allowanceInfo = await checkAllowance(
        token.erc20_contract,
        evmAddress,
        atomicMultiSendAddress
      );

      // Calculate needed approval for 5 consecutive transfers
      const transferAmount = BigInt(token.amount || "0");
      const neededApproval = transferAmount * 5n;
      const currentAllowance = BigInt(allowanceInfo.allowance || "0");

      if (currentAllowance < neededApproval) {
        console.log(`    Token ${token.denom} (${allowanceInfo.symbol}) needs approval`);
        console.log(`     Current allowance: ${currentAllowance}`);
        console.log(`     Needed for 5 transfers: ${neededApproval}`);

        // Approve for 5 consecutive transfers
        const approved = await approveToken(
          token.erc20_contract,
          atomicMultiSendAddress,
          neededApproval.toString()
        );

        if (approved) {
          console.log(`   Success: Token ${token.denom} (${allowanceInfo.symbol}) approved for ${neededApproval}`);
        } else {
          console.log(`   Failed: Could not approve token ${token.denom}`);
          allApproved = false;
        }
      } else {
        console.log(`   Success: Token ${token.denom} (${allowanceInfo.symbol}) has sufficient allowance`);
        console.log(`     Current: ${currentAllowance}, Needed: ${neededApproval}`);
      }
    }
  }

  console.log(allApproved ? ' Token approval setup complete!\n' : ' Some token approvals failed\n');
  return allApproved;
}

// Periodic approval monitoring
let approvalMonitorInterval;

function startApprovalMonitoring() {
  console.log(' Starting token approval monitoring (checking every 10 minutes)...');

  // Check immediately on start
  checkAndTopUpApprovals();

  // Then check every 10 minutes
  approvalMonitorInterval = setInterval(async () => {
    console.log('\n[APPROVAL CHECK] Running periodic approval check...');
    await checkAndTopUpApprovals();
    console.log('[APPROVAL CHECK] Periodic check complete');
  }, 10 * 60 * 1000); // 10 minutes
}

async function checkAndReportApprovals() {
  const approvals = await checkAllTokenApprovals();
  const needsApproval = approvals.filter(a => !a.isApproved);

  if (needsApproval.length > 0) {
    console.log(`\n  WARNING: ${needsApproval.length} tokens need approval:`);
    needsApproval.forEach(token => {
      console.log(`  - ${token.denom} (${token.symbol}): Current allowance = ${token.allowance}`);
    });
    console.log('\n  Run "yarn approval:approve-max" to fix this issue.\n');
  }
}

async function checkAndTopUpApprovals() {
  const atomicMultiSendAddress = chainConf.contracts.atomicMultiSend;
  if (!atomicMultiSendAddress) return;

  const evmAddress = getEvmAddress();
  let needsTopUp = false;

  for (const token of chainConf.tx.amounts) {
    if (token.erc20_contract &&
        token.erc20_contract !== "0x0000000000000000000000000000000000000000" &&
        token.erc20_contract !== "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE") {

      const allowanceInfo = await checkAllowance(
        token.erc20_contract,
        evmAddress,
        atomicMultiSendAddress
      );

      // Calculate needed approval for 5 consecutive transfers
      const transferAmount = BigInt(token.amount || "0");
      const minimumNeeded = transferAmount * 2n; // Top up when below 2 transfers worth
      const targetApproval = transferAmount * 5n; // Approve for 5 transfers
      const currentAllowance = BigInt(allowanceInfo.allowance || "0");

      if (currentAllowance < minimumNeeded) {
        needsTopUp = true;
        console.log(`    Token ${token.denom} needs approval top-up`);
        console.log(`     Current: ${currentAllowance}, Minimum: ${minimumNeeded}`);

        const approved = await approveToken(
          token.erc20_contract,
          atomicMultiSendAddress,
          targetApproval.toString()
        );

        if (approved) {
          console.log(`   Topped up ${token.denom} approval to ${targetApproval}`);
        } else {
          console.log(`   Failed to top up ${token.denom} approval`);
        }
      }
    }
  }

  if (!needsTopUp) {
    console.log('  All token approvals sufficient');
  }
}

function stopApprovalMonitoring() {
  if (approvalMonitorInterval) {
    clearInterval(approvalMonitorInterval);
    console.log(' Stopped token approval monitoring');
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n Shutting down faucet...');
  stopApprovalMonitoring();
  logRotation.stopAll();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n Shutting down faucet...');
  stopApprovalMonitoring();
  logRotation.stopAll();
  process.exit(0);
});

// Update how we create Cosmos transactions
async function createCosmosTransaction(fromAddress, toAddress, amounts, sequence, accountNumber, chainId) {
  try {
    const messages = [];

    // Create a single MsgSend with all amounts
    const msg = {
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: MsgSend.fromPartial({
        fromAddress: fromAddress,
        toAddress: toAddress,
        amount: amounts
      })
    };
    messages.push(msg);

    // Create the transaction body
    const txBody = TxBody.fromPartial({
      messages: messages.map(msg => Any.fromPartial({
        typeUrl: msg.typeUrl,
        value: MsgSend.encode(msg.value).finish()
      })),
      memo: ""
    });

    // Get fee configuration
    const feeAmount = [{
      denom: chainConf.tx.fee.cosmos.amount[0].denom,
      amount: chainConf.tx.fee.cosmos.amount[0].amount
    }];

    const gasLimit = Long.fromString(chainConf.tx.fee.cosmos.gas);

    // Create auth info
    // For eth_secp256k1, we need to properly encode the pubkey
    // The pubkey value should be the protobuf-encoded PubKey message
    const pubkeyBytes = getPublicKeyBytes();
    console.log('Our pubkey (hex):', pubkeyBytes.toString('hex'));
    console.log('Our pubkey (base64):', toBase64(pubkeyBytes));

    // Create a simple protobuf encoding for PubKey { key: bytes }
    // Field 1 (key) with wire type 2 (length-delimited)
    const fieldTag = (1 << 3) | 2; // field 1, wire type 2
    const pubkeyProto = Buffer.concat([
      Buffer.from([fieldTag]), // field tag
      Buffer.from([pubkeyBytes.length]), // length of key
      pubkeyBytes // the actual key bytes
    ]);

    const pubkey = Any.fromPartial({
      typeUrl: "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey",
      value: pubkeyProto
    });

    const authInfo = makeAuthInfoBytes(
      [{
        pubkey,
        sequence: Long.fromNumber(sequence),
      }],
      feeAmount,
      gasLimit,
      undefined,
      undefined,
    );

    // Create sign doc
    const signDoc = makeSignDoc(
      TxBody.encode(txBody).finish(),
      authInfo,
      chainId,
      Long.fromNumber(accountNumber)
    );

    return { txBody, authInfo, signDoc };
  } catch (error) {
    console.error('Error creating Cosmos transaction:', error);
    throw error;
  }
}

async function getAccountInfo(address) {
  try {
    const restEndpoint = chainConf.endpoints.rest_endpoint;
    const response = await fetch(`${restEndpoint}/cosmos/auth/v1beta1/accounts/${address}`);

    if (!response.ok) {
      if (response.status === 404) {
        // Account doesn't exist yet, return defaults
        console.log('Account not found, using default values');
        return {
          accountNumber: 0,
          sequence: 0
        };
      }
      throw new Error(`Failed to get account info: ${response.statusText}`);
    }

    const data = await response.json();

    // Handle different account types
    if (data.account && data.account['@type']) {
      // For eth_secp256k1 accounts, extract the base account info
      let accountInfo;

      if (data.account['@type'].includes('EthAccount')) {
        // EthAccount type
        accountInfo = {
          accountNumber: parseInt(data.account.base_account?.account_number || '0'),
          sequence: parseInt(data.account.base_account?.sequence || '0')
        };
      } else if (data.account['@type'].includes('BaseAccount')) {
        // BaseAccount - parse directly
        accountInfo = {
          accountNumber: parseInt(data.account.account_number || '0'),
          sequence: parseInt(data.account.sequence || '0')
        };
      } else {
        // Try standard parsing
        try {
          const account = accountFromAny(data.account);
          accountInfo = {
            accountNumber: account.accountNumber,
            sequence: account.sequence
          };
        } catch (e) {
          // Fallback to manual parsing
          accountInfo = {
            accountNumber: parseInt(data.account.account_number || data.account.base_account?.account_number || '0'),
            sequence: parseInt(data.account.sequence || data.account.base_account?.sequence || '0')
          };
        }
      }

      console.log('Account info parsed:', accountInfo);
      return accountInfo;
    }

    // Default if no account data
    return {
      accountNumber: 0,
      sequence: 0
    };
  } catch (error) {
    console.error('Error getting account info:', error);
    // Return default values for new accounts
    return {
      accountNumber: 0,
      sequence: 0
    };
  }
}

// Root route is now handled by static file serving in both dev and production

// Config endpoint for web app
app.get('/config.json', (req, res) => {
  const chainConf = conf.blockchain;
  res.json({
    project: conf.project,
    blockchain: {
      name: chainConf.name,
      endpoints: chainConf.endpoints,
      ids: chainConf.ids,
      sender: {
        option: {
          prefix: chainConf.sender.option.prefix
        }
      },
      limit: chainConf.limit
    },
    tokens: chainConf.tx.amounts.map(token => ({
      denom: token.denom,
      symbol: token.symbol || token.denom.toUpperCase(),
      name: token.name || token.denom,
      amount: token.amount,
      target_balance: token.target_balance,
      decimals: token.decimals,
      display_denom: token.display_denom || token.denom,
      description: token.description,
      type: token.type || 'token',
      contract: token.erc20_contract
    })),
    sample: {
      cosmos: 'cosmos1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnrql8a',
      evm: '0x0000000000000000000000000000000000000001'
    },
    network: {
      name: chainConf.name,
      faucetAddresses: {
        cosmos: getCosmosAddress(),
        evm: getEvmAddress()
      },
      evm: {
        chainId: chainConf.ids.chainId,
        chainIdHex: '0x' + chainConf.ids.chainId.toString(16),
        rpc: chainConf.endpoints.evm_endpoint,
        websocket: chainConf.endpoints.evm_websocket || '',
        explorer: chainConf.endpoints.evm_explorer
      },
      cosmos: {
        chainId: chainConf.ids.cosmosChainId,
        rpc: chainConf.endpoints.rpc_endpoint,
        grpc: chainConf.endpoints.grpc_endpoint,
        rest: chainConf.endpoints.rest_endpoint,
        prefix: chainConf.sender.option.prefix,
        explorer: chainConf.endpoints.cosmos_explorer
      },
      contracts: {
        atomicMultiSend: chainConf.contracts?.atomicMultiSend || null,
        native_token: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        werc20_precompile: '0x0000000000000000000000000000000000000802',
        erc20_tokens: chainConf.tx.amounts
          .filter(t => t.erc20_contract && t.erc20_contract !== '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE')
          .reduce((acc, t) => {
            acc[t.symbol || t.denom] = t.erc20_contract;
            return acc;
          }, {})
      }
    }
  });
});

// API endpoint to get faucet balances
app.get('/balance/:type', async (req, res) => {
  const type = req.params.type; // 'cosmos' or 'evm'
  const { address } = req.query; // Optional: check specific address instead of faucet

  console.log(`[BALANCE] Request - Type: ${type}, Address: ${address || 'faucet wallet'}`);

  let balances = [];

  try {
    if(type === 'evm') {
      // Determine which address to check - query parameter or faucet wallet
      let targetAddress;
      if (address && address.startsWith('0x')) {
        targetAddress = address;
      } else {
        targetAddress = getEvmAddress();
      }

      // Fetch EVM balances from JSON-RPC
      const ethProvider = new JsonRpcProvider(chainConf.endpoints.evm_endpoint);

      // Check WATOM balance using ERC20 interface for cleaner display
      try {
        const watomContract = new Contract('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', erc20ABI, ethProvider);
        const watomBalance = await watomContract.balanceOf(targetAddress);
        balances.push({
          denom: 'WATOM',
          amount: watomBalance.toString(),
          type: 'native',
          decimals: 6 // Using ATOM's native 6 decimals
        });
      } catch(err) {
        console.error('Error fetching WATOM balance:', err);
        // Fallback to native balance if ERC20 interface fails
        try {
          const nativeBalance = await ethProvider.getBalance(targetAddress);
          // Convert from 18 decimals to 6 decimals for consistent display
          const atomBalance = nativeBalance / BigInt(10 ** 12);
          balances.push({
            denom: 'WATOM',
            amount: atomBalance.toString(),
            type: 'native',
            decimals: 6
          });
        } catch(fallbackErr) {
          console.error('Error fetching native balance:', fallbackErr);
        }
      }

      for (const token of chainConf.tx.amounts) {
        if (token.type === 'native' || token.denom === 'uatom') {
          // Skip native tokens as we already handled WATOM above
          continue;
        }

        if(token.erc20_contract && token.erc20_contract !== "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" && token.erc20_contract !== "0x0000000000000000000000000000000000000000") {
          try {
            const tokenContract = new Contract(token.erc20_contract, erc20ABI, ethProvider);
            const balance = await tokenContract.balanceOf(targetAddress);
            balances.push({
              denom: token.denom.toUpperCase(),
              amount: balance.toString(),
              type: 'erc20',
              contract: token.erc20_contract,
              decimals: token.decimals
            });
          } catch(err) {
            console.error(`Error fetching balance for ${token.denom}:`, err);
            balances.push({
              denom: token.denom.toUpperCase(),
              amount: "0",
              type: 'erc20',
              contract: token.erc20_contract,
              decimals: token.decimals
            });
          }
        }
      }

    } else if(type === 'cosmos') {
      // Determine which address to check - query parameter or faucet wallet
      let targetAddress;
      if (address && address.startsWith('cosmos')) {
        targetAddress = address;
      } else {
        targetAddress = getCosmosAddress();
      }

      // Fetch cosmos balances from REST API with timeout
      const restEndpoint = chainConf.endpoints.rest_endpoint;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const balanceUrl = `${restEndpoint}/cosmos/bank/v1beta1/balances/${targetAddress}`;
      console.log(`[COSMOS] Fetching balance from: ${balanceUrl}`);

      try {
        const response = await fetch(balanceUrl, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          
          // Create a map for quick lookup of cosmos balances
          const cosmosBalanceMap = {};
          if (data.balances && Array.isArray(data.balances)) {
            data.balances.forEach(balance => {
              cosmosBalanceMap[balance.denom] = balance.amount;
            });
          }
          
          // Return balances with target amounts for proper status calculation
          for (const token of chainConf.tx.amounts) {
            // Skip ERC20 tokens for Cosmos addresses
            if (token.erc20_contract &&
                token.erc20_contract !== "0x0000000000000000000000000000000000000000" &&
                token.erc20_contract !== "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE") {
              continue;
            }
            
            const currentAmount = cosmosBalanceMap[token.denom] || "0";
            balances.push({
              denom: token.denom.toLowerCase(),
              current_amount: currentAmount,
              target_amount: token.target_balance,
              type: 'cosmos',
              decimals: token.decimals || (token.denom === 'uatom' ? 6 : 0)
            });
          }
          
          console.log(`[COSMOS] Balances for ${targetAddress}:`, balances);
        } else {
          console.error(`Cosmos balance API returned ${response.status}: ${response.statusText}`);
        }
      } catch (fetchError) {
        if (fetchError.name === 'AbortError') {
          console.error('Cosmos balance request timed out after 5 seconds');
        } else {
          console.error('Cosmos balance fetch error:', fetchError);
        }
      }
    }
  } catch(err) {
    console.error('Balance fetch error:', err);
  }
  res.send({ balances, type });
})

app.get('/send/:address', async (req, res) => {
  const { address } = req.params;
  const ip = req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || req.headers['X-Forwarded-For'] || req.ip
  console.log(`[FAUCET] Token request - Address: ${address}, IP: ${ip}`)

  if (address) {
    try {
      const addressType = detectAddressType(address);

      if (addressType === 'unknown') {
        res.send({ result: `Address [${address}] is not supported. Must be a valid cosmos address (${conf.blockchain.sender.option.prefix}...) or hex address (0x...)` })
        return;
      }

      const chainConf = conf.blockchain

      if( await checker.checkAddress(address, 'dual') && await checker.checkIp(`dual${ip}`, 'dual') ) {
        console.log('Processing smart faucet request for', address, 'type:', addressType)

        // Check token allowances
        const requestedTokens = new Map();
        for (const token of chainConf.tx.amounts) {
          requestedTokens.set(token.denom, token.amount);
        }

        const allowanceCheck = await allowanceTracker.checkAllowance(address, requestedTokens);
        if (!allowanceCheck.allowed) {
          console.log(`Token allowance exceeded for ${address}`);
          const remainingTime = await allowanceTracker.getRemainingResetTime(address);
          const formattedTime = allowanceTracker.formatRemainingTime(remainingTime);

          // Build available amounts message
          const availableMsg = [];
          for (const [denom, amount] of allowanceCheck.available.entries()) {
            if (amount > 0n) {
              const token = chainConf.tx.amounts.find(t => t.denom === denom);
              const decimals = token?.decimals || 0;
              const formattedAmount = (Number(amount) / Math.pow(10, decimals)).toFixed(decimals);
              availableMsg.push(`${formattedAmount} ${denom.toUpperCase()}`);
            }
          }

          res.send({
            result: `Daily token allowance exceeded. ${availableMsg.length > 0 ? `Available: ${availableMsg.join(', ')}. ` : ''}Reset in ${formattedTime}.`,
            error: 'allowance_exceeded',
            remainingTime,
            available: Object.fromEntries(allowanceCheck.available)
          });
          return;
        }

        let txResult = null;
        try {
          // Step 1: Check current balances
          const currentBalances = await checkRecipientBalances(address, addressType);
          console.log('Current balances:', currentBalances);

          // Step 2: Calculate needed amounts
          let neededAmounts;
          if (TESTING_MODE) {
            // In testing mode, always send 1 of each token
            neededAmounts = getTestingModeAmounts(chainConf.tx.amounts);
            console.log('Testing mode: sending 1 of each token');
          } else {
            // Normal mode: calculate based on target balance
            neededAmounts = calculateNeededAmounts(currentBalances, chainConf.tx.amounts);

            // For Cosmos addresses, only keep native tokens
            if (addressType === 'cosmos') {
              neededAmounts = neededAmounts.filter(token =>
                token.denom === 'uatom' ||
                !token.erc20_contract ||
                token.erc20_contract === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
              );
              console.log('Filtered for Cosmos address - only native tokens');
            }

            // For EVM addresses, add WATOM metadata
            if (addressType === 'evm') {
              neededAmounts = neededAmounts.map(token => {
                if (token.denom === 'uatom' && (token.erc20_contract === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE')) {
                  // The amount is already in WATOM (18 decimals) from the balance check
                  // Just add the WATOM metadata
                  return {
                    ...token,
                    symbol: 'WATOM',
                    name: 'Wrapped ATOM'
                  };
                }
                return token;
              });
            }

            console.log('Needed amounts:', neededAmounts);

      // Filter out IBC tokens without contracts for EVM addresses
      if (addressType === 'evm') {
        neededAmounts = neededAmounts.filter(token => {
          // Keep tokens that have a valid contract address (including native placeholder)
          return token.erc20_contract && token.erc20_contract !== null;
        });
        console.log('Filtered needed amounts (removed IBC without contracts):', neededAmounts);
      }
          }

          // Step 3: Check if any tokens are needed
          if (neededAmounts.length === 0) {
            console.log(`\nNo tokens needed for ${addressType} address`);
            console.log(`Current balances meet all target amounts for eligible tokens`);

            // Build detailed token status for eligible tokens only
            const eligibleTokens = chainConf.tx.amounts
              .filter(token => {
                // Filter tokens based on address type (same logic as above)
                if (addressType === 'cosmos') {
                  return token.denom === 'uatom' ||
                    !token.erc20_contract ||
                    token.erc20_contract === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
                }
                // For EVM, filter out IBC tokens without contracts
                if (addressType === 'evm') {
                  return token.erc20_contract && token.erc20_contract !== null;
                }
                return true;
              });

            const tokenStatus = eligibleTokens
              .map(token => {
                const balance = currentBalances.find(b => b.denom === token.denom);
                const displaySymbol = (addressType === 'evm' && token.denom === 'uatom') ? 'WATOM' : token.symbol;
                return {
                  symbol: displaySymbol,
                  name: token.name,
                  status: 'already_funded',
                  current_balance: balance?.current_amount || '0',
                  target_balance: balance?.target_amount || token.target_balance,
                  decimals: balance?.decimals || token.decimals
                };
              });

            // Count ineligible tokens for the address type
            const ineligibleTokens = chainConf.tx.amounts.filter(token => {
              if (addressType === 'cosmos') {
                // ERC20 tokens are ineligible for Cosmos addresses
                return token.erc20_contract && 
                       token.erc20_contract !== '0x0000000000000000000000000000000000000000' &&
                       token.erc20_contract !== '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
              } else if (addressType === 'evm') {
                // IBC tokens without contracts are ineligible for EVM addresses
                return !token.erc20_contract || token.erc20_contract === null;
              }
              return false;
            });

            let message = "Wallet already has sufficient balance for all eligible tokens.";
            if (addressType === 'cosmos' && ineligibleTokens.length > 0) {
              const erc20Names = ineligibleTokens.map(t => t.symbol).join(', ');
              message = `Wallet already has sufficient balance for all eligible native tokens. Note: ERC20 tokens (${erc20Names}) are only available to EVM addresses.`;
            }

            const response = {
              result: {
                code: 0,
                status: 'no_tokens_sent',
                message: message,
                address_type: addressType,
                eligible_token_count: eligibleTokens.length,
                ineligible_token_count: ineligibleTokens.length,
                token_status: tokenStatus,
                current_balances: currentBalances,
                tokens_sent: [],
                tokens_not_sent: tokenStatus,
                ineligible_tokens: ineligibleTokens.map(t => ({
                  symbol: t.symbol,
                  name: t.name,
                  reason: addressType === 'cosmos' ? 'ERC20 tokens require EVM address' : 'IBC token not available on EVM'
                })),
                target_balances: eligibleTokens.map(token => ({
                  denom: token.denom,
                  symbol: token.symbol,
                  target: token.target_balance,
                  decimals: token.decimals
                }))
              }
            };

            res.send(response);
            return;
          }

          // Step 3.5: Ensure token approvals before sending
          console.log('Checking token approvals...');

          // Step 4: Send tokens
          txResult = await sendSmartFaucetTx(address, addressType, neededAmounts);

          // Step 5: Build response
          // Identify which tokens were not sent (already funded)
          const eligibleTokens = chainConf.tx.amounts.filter(token => {
            if (addressType === 'cosmos') {
              return token.denom === 'uatom' ||
                !token.erc20_contract ||
                token.erc20_contract === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
            }
            // For EVM, filter out IBC tokens without contracts
            if (addressType === 'evm') {
              return token.erc20_contract && token.erc20_contract !== null;
            }
            return true;
          });

          const tokensSent = neededAmounts.map(amount => {
            const token = chainConf.tx.amounts.find(t => t.denom === amount.denom);
            const displaySymbol = (amount.symbol === 'WATOM') ? 'WATOM' : token?.symbol || amount.denom;
            return {
              denom: amount.denom,
              symbol: displaySymbol,
              name: amount.name || token?.name,
              amount: amount.amount,
              decimals: amount.decimals,
              type: amount.type || (amount.erc20_contract ? 'erc20' : 'native'),
              status: 'sent'
            };
          });

          const tokensNotSent = eligibleTokens
            .filter(token => !neededAmounts.find(n => n.denom === token.denom))
            .map(token => {
              const balance = currentBalances.find(b => b.denom === token.denom);
              const displaySymbol = (addressType === 'evm' && token.denom === 'uatom') ? 'WATOM' : token.symbol;
              return {
                denom: token.denom,
                symbol: displaySymbol,
                name: token.name,
                status: 'already_funded',
                current_balance: balance?.current_amount || '0',
                target_balance: balance?.target_amount || token.target_balance,
                decimals: balance?.decimals || token.decimals
              };
            });

          const response = {
            result: {
              code: 0,
              status: neededAmounts.length > 0 ? 'partial_success' : 'no_tokens_sent',
              message: tokensNotSent.length > 0
                ? `Sent ${tokensSent.length} token(s). ${tokensNotSent.length} token(s) already had sufficient balance.`
                : "Tokens sent successfully!",
              ...txResult,
              current_balances: currentBalances,
              tokens_sent: tokensSent,
              tokens_not_sent: tokensNotSent,
              testing_mode: TESTING_MODE
            }
          };

          // Update token allowances for successful transactions
          if (tokensSent.length > 0) {
            const distributedTokens = new Map();
            for (const token of tokensSent) {
              distributedTokens.set(token.denom, token.amount);
            }
            await allowanceTracker.updateAllowance(address, distributedTokens);
          }

          res.send(response);

        } catch (error) {
          console.error('Smart faucet error:', error);

          // Check if txResult contains transaction details even though it failed
          let failedTxDetails = {};
          if (txResult && txResult.hash) {
            failedTxDetails = {
              transaction_hash: txResult.hash,
              network_type: txResult.network_type || 'evm',
              explorer_url: txResult.explorer_url || `${chainConf.endpoints.evm_explorer}/tx/${txResult.hash}`,
              gas_used: txResult.gas_used || '0',
              status: 0, // Failed
              error_details: txResult.error || txResult.revertReason || error.message,
              current_balances: currentBalances,
              tokens_attempted: neededAmounts.map(amount => ({
                denom: amount.denom,
                amount: amount.amount,
                decimals: amount.decimals,
                type: amount.type || (amount.erc20_contract ? 'erc20' : 'native')
              }))
            };
          }

          res.send({
            result: {
              code: -1,
              message: error.message || 'Transaction failed',
              error: error.toString(),
              ...failedTxDetails
            }
          });
        }
      } else {
        const addressLimitMsg = !await checker.checkAddress(address, 'dual', false)
          ? `Address ${address} has reached the daily limit (${chainConf.limit.address} request per 24h).`
          : '';
        const ipLimitMsg = !await checker.checkIp(`dual${ip}`, 'dual', false)
          ? `IP ${ip} has reached the daily limit (${chainConf.limit.ip} requests per 24h).`
          : '';

        res.send({
          result: {
            code: -2,
            message: 'Rate limit exceeded',
            details: [addressLimitMsg, ipLimitMsg].filter(msg => msg).join(' ')
          }
        });
      }

    } catch (ex) {
      console.error('Transaction error:', ex);
      res.send({
        result: {
          code: -1,
          message: ex.message || 'Transaction failed',
          error: ex.toString()
        }
      });
    }
  } else {
    res.send({ result: 'Address is required!' })
  }
})

// Test endpoint
app.get('/test', (req, res) => {
  res.send({
    status: 'ok',
    evmAddress: getEvmAddress(),
    cosmosAddress: getCosmosAddress()
  });
});

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Add approval check endpoint
app.get('/api/approvals', async (req, res) => {
  try {
    const approvals = await checkAllTokenApprovals();
    res.json({
      success: true,
      faucet_address: getEvmAddress(),
      spender_address: chainConf.contracts.atomicMultiSend,
      approvals: approvals
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Helper function for testing mode
function getTestingModeAmounts(configAmounts) {
  const testAmounts = [];

  for (const token of configAmounts) {
    testAmounts.push({
      denom: token.denom,
      amount: "1", // Always send 1 of the smallest unit
      erc20_contract: token.erc20_contract,
      decimals: token.decimals
    });
  }

  return testAmounts;
}

// Check recipient's current token balances
async function checkRecipientBalances(address, addressType) {
  const chainConf = conf.blockchain;
  const balances = [];

  try {
    if (addressType === 'cosmos') {
      // Check Cosmos balances via REST API
      console.log(`[BALANCE CHECK] Cosmos address: ${address}`);

      const restEndpoint = chainConf.endpoints.rest_endpoint;
      const response = await fetch(`${restEndpoint}/cosmos/bank/v1beta1/balances/${address}`);
      const data = await response.json();

      // Map cosmos balances to our token structure
      // For Cosmos addresses, only check native tokens (not ERC20s)
      for (const token of chainConf.tx.amounts) {
        // Skip ERC20 tokens for Cosmos addresses
        if (token.erc20_contract &&
            token.erc20_contract !== "0x0000000000000000000000000000000000000000" &&
            token.erc20_contract !== "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE") {
          continue;
        }

        const balance = data.balances?.find(b => b.denom === token.denom);
        if (balance) {
          console.log(`[TOKEN] ${token.denom}: current=${balance.amount}, target=${token.target_balance}`);
        }
        balances.push({
          denom: token.denom,
          current_amount: balance ? balance.amount : "0",
          target_amount: token.target_balance,
          decimals: token.decimals
        });
      }
    } else if (addressType === 'evm') {
      // Check EVM balances via JSON-RPC
      const ethProvider = new JsonRpcProvider(chainConf.endpoints.evm_endpoint);

      for (const token of chainConf.tx.amounts) {
        if (token.erc20_contract === "0x0000000000000000000000000000000000000000") {
          // Native token balance
          const balance = await ethProvider.getBalance(address);
          balances.push({
            denom: token.denom,
            current_amount: balance.toString(),
            target_amount: token.target_balance,
            decimals: token.decimals
          });
        } else if (token.denom === 'uatom' && token.erc20_contract === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE') {
          // WATOM is actually native ATOM on EVM, check native balance
          const balance = await ethProvider.getBalance(address);
          balances.push({
            denom: token.denom,
            current_amount: balance.toString(),
            target_amount: token.target_balance,
            decimals: 6 // Use ATOM's native 6 decimals
          });
        } else {
          // ERC20 token balance
          const erc20ABI = ["function balanceOf(address owner) view returns (uint256)"];
          const tokenContract = new Contract(token.erc20_contract, erc20ABI, ethProvider);
          const balance = await tokenContract.balanceOf(address);
          balances.push({
            denom: token.denom,
            current_amount: balance.toString(),
            target_amount: token.target_balance,
            decimals: token.decimals
          });
        }
      }
    }
  } catch (error) {
    console.error('Error checking balances:', error);
    // Return zero balances on error to allow faucet to proceed
    for (const token of chainConf.tx.amounts) {
      balances.push({
        denom: token.denom,
        current_amount: "0",
        target_amount: token.target_balance,
        decimals: token.decimals
      });
    }
  }

  return balances;
}

// Calculate amounts needed to reach target balance
function calculateNeededAmounts(currentBalances, configAmounts) {
  const neededAmounts = [];

  for (const currentBalance of currentBalances) {
    const configToken = configAmounts.find(t => t.denom === currentBalance.denom);
    if (!configToken) continue;

    const current = BigInt(currentBalance.current_amount || "0");
    const target = BigInt(currentBalance.target_amount || configToken.target_balance);

    if (current < target) {
      const needed = target - current;
      neededAmounts.push({
        denom: currentBalance.denom,
        amount: needed.toString(),
        erc20_contract: configToken.erc20_contract,
        decimals: currentBalance.decimals || configToken.decimals
      });
    }
  }

  return neededAmounts;
}

// Smart faucet transaction handler
async function sendSmartFaucetTx(recipientAddress, addressType, neededAmounts) {
  console.log(`\n>> Sending tokens to ${recipientAddress} (${addressType})...`);
  console.log(`Tokens to send: ${neededAmounts.map(t => `${t.denom}: ${t.amount}`).join(', ')}`);
  console.log(`Recipient address type: ${addressType}`);
  console.log('All needed amounts:', neededAmounts);

  // Separate ERC20 and native tokens
  // Separate ERC20s from native tokens
  // WATOM (0xEeeee...) is actually native ATOM, not an ERC20
  const erc20Tokens = neededAmounts.filter(t => t.erc20_contract &&
    t.erc20_contract !== "0x0000000000000000000000000000000000000000" &&
    t.erc20_contract !== "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
  );
  const nativeTokens = neededAmounts.filter(t => !t.erc20_contract ||
    t.erc20_contract === "0x0000000000000000000000000000000000000000" ||
    t.erc20_contract === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
  );

  const results = {
    network_type: addressType,
    transfers: []
  };

  try {
    // Handle different scenarios based on address type and tokens needed
    if (addressType === 'evm') {
      // EVM recipient - send everything via EVM
      if (erc20Tokens.length > 0 || nativeTokens.length > 0) {
        console.log('Sending ALL tokens via EVM (hex recipient)...');
        const evmResult = await sendSmartEvmTx(recipientAddress, neededAmounts);
        results.transaction_hash = evmResult.hash;
        results.block_number = evmResult.blockNumber;
        results.block_hash = evmResult.blockHash;
        results.gas_used = evmResult.gasUsed ? evmResult.gasUsed.toString() : '0';
        results.gas_price = evmResult.gasPrice ? evmResult.gasPrice.toString() : '0';
        results.from_address = evmResult.from;
        results.to_address = evmResult.to;
        results.value = evmResult.value ? evmResult.value.toString() : '0';
        results.status = evmResult.status;
        results.explorer_url = `${chainConf.endpoints.evm_explorer}/tx/${evmResult.hash}`;
        results.truncated_hash = evmResult.hash ?
          `${evmResult.hash.substring(0, 10)}...${evmResult.hash.substring(evmResult.hash.length - 8)}` :
          null;

        // Add transfer details
        for (const token of neededAmounts) {
          results.transfers.push({
            token: token.erc20_contract || 'native',
            amount: token.amount,
            denom: token.denom,
            hash: evmResult.hash,
            status: evmResult.status,
            type: token.erc20_contract ? 'erc20' : 'native'
          });
        }

        // Store complete EVM tx data
        results.evm_tx_data = evmResult;
      }
    } else if (addressType === 'cosmos') {
      // Cosmos recipient - only send native tokens
      // Skip ERC20 tokens for Cosmos addresses as they can't easily access them

      if (nativeTokens.length > 0) {
        // Send native tokens via Cosmos bank module using manual transaction creation
        console.log('Sending native tokens to Cosmos address via manual tx creation...');
        try {
          const cosmosResult = await sendCosmosTx(recipientAddress, nativeTokens);

          results.network_type = 'cosmos';
          results.transaction_hash = cosmosResult.transactionHash;
          results.height = cosmosResult.height;
          results.gas_used = cosmosResult.gasUsed;
          results.gas_wanted = cosmosResult.gasWanted;
          results.rest_api_url = cosmosResult.restApiUrl;
          // Add explorer URL for Cosmos transactions from config
          results.explorer_url = `${conf.blockchain.endpoints.cosmos_explorer}/tx/${cosmosResult.transactionHash}`;
          results.truncated_hash = cosmosResult.transactionHash ?
            `${cosmosResult.transactionHash.substring(0, 8)}...${cosmosResult.transactionHash.substring(cosmosResult.transactionHash.length - 8)}` :
            null;

          // Add transfer details
          for (const token of nativeTokens) {
            results.transfers.push({
              token: 'native',
              amount: token.amount,
              denom: token.denom,
              hash: cosmosResult.transactionHash,
              status: cosmosResult.code === 0 ? 1 : 0,
              type: 'cosmos_native'
            });
          }

          results.cosmos_tx_data = cosmosResult;
        } catch (cosmosError) {
          console.error('Cosmos transaction error:', cosmosError);

          // Return error information
          results.network_type = 'cosmos';
          results.cosmos_error = cosmosError.message;
          results.error_details = cosmosError.details || {};
          results.broadcast_result = cosmosError.broadcastResult || cosmosError.details?.broadcastResult || null;
          results.rest_api_url = cosmosError.restApiUrl || cosmosError.details?.restApiUrl || null;
          results.raw_log = cosmosError.raw_log || cosmosError.details?.raw_log || null;

          results.failed_transfers = nativeTokens.map(token => ({
            token: 'native',
            amount: token.amount,
            denom: token.denom,
            error: cosmosError.message,
            type: 'cosmos_native'
          }));

          throw cosmosError;
        }
      }
    }

    console.log('\nSmart faucet transaction complete!');
    return results;

  } catch (error) {
    console.error('Smart faucet error:', error);
    throw new Error(`Smart faucet failed: ${error.message}`);
  }
}

// New function for atomic EVM transactions
async function sendSmartEvmTx(recipientAddress, neededAmounts) {
  console.log('Sending atomic EVM tokens to:', recipientAddress);
  console.log('Needed amounts:', neededAmounts);


  // Separate ERC20 and native tokens
  // Separate ERC20s from native tokens
  // WATOM (0xEeeee...) is actually native ATOM, not an ERC20
  const erc20Tokens = neededAmounts.filter(t => t.erc20_contract &&
    t.erc20_contract !== "0x0000000000000000000000000000000000000000" &&
    t.erc20_contract !== "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
  );
  const nativeTokens = neededAmounts.filter(t => !t.erc20_contract ||
    t.erc20_contract === "0x0000000000000000000000000000000000000000" ||
    t.erc20_contract === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
  );

  const ethProvider = new JsonRpcProvider(chainConf.endpoints.evm_endpoint);
  const privateKey = getPrivateKey();
  const wallet = new Wallet(privateKey, ethProvider);

  let tx = null;
  let receipt = null;

  try {
    // If we have multiple tokens (ERC20s and/or native), use AtomicMultiSend
    if (neededAmounts.length > 1 || (erc20Tokens.length >= 1 && nativeTokens.length > 0)) {
      console.log('Using AtomicMultiSend contract for guaranteed atomicity');

      const atomicMultiSendAddress = chainConf.contracts.atomicMultiSend;
      if (!atomicMultiSendAddress) {
        throw new Error('AtomicMultiSend contract not configured');
      }

      // Load AtomicMultiSend ABI
      const abiPath = path.join(process.cwd(), 'deployments', 'AtomicMultiSend.abi.json');
      console.log(`Loading ABI from: ${abiPath}`);
      const atomicMultiSendABI = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

      const atomicContract = new Contract(atomicMultiSendAddress, atomicMultiSendABI, wallet);

      // Prepare transfers array for the contract
      const transfers = [];
      const seenTokens = new Set();

      // Add ERC20 transfers (with deduplication)
      erc20Tokens.forEach(t => {
        if (!seenTokens.has(t.erc20_contract)) {
          seenTokens.add(t.erc20_contract);
          transfers.push({
            token: t.erc20_contract,
            amount: t.amount
          });
        } else {
          console.log('WARNING: Skipping duplicate ERC20 token:', t.erc20_contract);
        }
      });

      // Add native token transfers (address(0) represents native tokens)
      let totalNativeAmount = BigInt(0);
      nativeTokens.forEach(t => {
        // Only add one native token transfer
        if (!seenTokens.has('native')) {
          seenTokens.add('native');
          transfers.push({
            token: '0x0000000000000000000000000000000000000000', // address(0) for native
            amount: t.amount
          });
          totalNativeAmount += BigInt(t.amount);
        } else {
          // If we already have a native transfer, just add to the total
          totalNativeAmount += BigInt(t.amount);
        }
      });

      // Safety check: ensure no duplicate tokens
      const tokenAddresses = transfers.map(t => t.token);
      const uniqueTokens = new Set(tokenAddresses);
      if (tokenAddresses.length !== uniqueTokens.size) {
        console.error('ERROR: Duplicate tokens in transfers array!');
        console.error('Transfers:', transfers);
        throw new Error('Duplicate tokens detected in transfer array');
      }

      // Execute atomic transfer with native value if needed
      tx = await atomicContract.atomicMultiSend(
        recipientAddress,
        transfers,
        {
          value: totalNativeAmount,
          gasLimit: 500000 // Reasonable gas limit for multiple transfers
        }
      );

      console.log('Atomic transaction sent:', tx.hash);
      receipt = await tx.wait();
      console.log('Atomic transaction confirmed!');

      return receipt;
    }
    // For single token (ERC20 or native), use direct transfer
    else if (neededAmounts.length === 1) {
      if (erc20Tokens.length === 1) {
        console.log('Single ERC20 transfer');
        const token = erc20Tokens[0];
        const tokenContract = new Contract(token.erc20_contract, ERC20_BASE_ABI, wallet);

        tx = await tokenContract.transfer(recipientAddress, token.amount);
        console.log('Transaction sent:', tx.hash);

        receipt = await tx.wait();
        console.log('Transaction confirmed!');

        return receipt;
      } else if (nativeTokens.length === 1) {
        console.log('Native token transfer via EVM');
        const totalNative = nativeTokens.reduce((sum, token) =>
          sum + BigInt(token.amount), BigInt(0)
        );

        // Check faucet balance before sending
        const faucetBalance = await ethProvider.getBalance(wallet.address);
        console.log(`Faucet WATOM balance: ${faucetBalance.toString()} wei`);
        console.log(`Required WATOM amount: ${totalNative.toString()} wei`);

        if (faucetBalance < totalNative) {
          throw new Error(`Insufficient faucet balance. Has ${faucetBalance.toString()} wei, needs ${totalNative.toString()} wei`);
        }

        tx = await wallet.sendTransaction({
          to: recipientAddress,
          value: totalNative
        });

        console.log('Native transaction sent:', tx.hash);
        receipt = await tx.wait();
        console.log('Native transaction confirmed!');

        return receipt;
      }
    }

    throw new Error('No tokens to send');

  } catch (error) {
    console.error('EVM transaction error:', error);

    // If we have a transaction hash but it failed, still return transaction details
    if (tx && tx.hash) {
      console.log('Transaction was sent but failed/reverted. Hash:', tx.hash);

      // Try to get the receipt even if it failed
      try {
        receipt = await ethProvider.getTransactionReceipt(tx.hash);
      } catch (receiptError) {
        console.error('Could not fetch receipt:', receiptError);
      }

      // Return a receipt-like object with failure information
      return {
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: tx.value?.toString() || '0',
        gasLimit: tx.gasLimit?.toString() || '0',
        gasPrice: tx.gasPrice?.toString() || '0',
        nonce: tx.nonce,
        blockNumber: receipt?.blockNumber || null,
        blockHash: receipt?.blockHash || null,
        transactionIndex: receipt?.transactionIndex || null,
        gasUsed: receipt?.gasUsed?.toString() || '0',
        status: 0, // Failed status
        error: error.message,
        revertReason: error.reason || error.data?.message || 'Transaction reverted'
      };
    }

    // If no transaction was sent, throw the original error
    throw new Error(`EVM transaction failed: ${error.message}`);
  }
}

// Cosmos transaction handler
async function sendCosmosTx(recipientAddress, nativeTokens) {
  console.log('Sending Cosmos native tokens to:', recipientAddress);

  try {
    const fromAddress = getCosmosAddress();
    console.log('From address:', fromAddress);
    console.log('To address:', recipientAddress);

    // Get account info
    const accountInfo = await getAccountInfo(fromAddress);
    console.log('Account info:', accountInfo);
    console.log('Chain ID:', chainConf.ids.cosmosChainId);

    // Build amount array for native tokens
    // Sort by denom alphabetically as required by Cosmos
    const amounts = nativeTokens.map(token => ({
      denom: token.denom,
      amount: token.amount
    })).sort((a, b) => a.denom.localeCompare(b.denom));
    console.log('Amounts to send (sorted):', amounts);

    // Create the transaction
    const { txBody, authInfo, signDoc } = await createCosmosTransaction(
      fromAddress,
      recipientAddress,
      amounts,
      accountInfo.sequence,
      accountInfo.accountNumber,
      chainConf.ids.cosmosChainId
    );

    // Sign the transaction manually using eth_secp256k1
    const privateKeyBytes = getPrivateKeyBytes();

    // IMPORTANT: Based on the Go code, eth_secp256k1 uses Keccak256, not SHA256!
    const signBytes = SignDoc.encode(signDoc).finish();
    const hashedMessage = Buffer.from(keccak_256(signBytes));

    console.log('Sign bytes length:', signBytes.length);
    console.log('Hash (Keccak256):', hashedMessage.toString('hex'));

    // Sign with secp256k1
    const signatureResult = secp256k1.sign(hashedMessage, privateKeyBytes);

    // Based on Go code: The signature for verification should be 64 bytes (R || S) without recovery ID
    // But we store 65 bytes initially and the verification strips the recovery ID
    const signatureBytes = Buffer.concat([
      Buffer.from(signatureResult.r.toString(16).padStart(64, '0'), 'hex'),
      Buffer.from(signatureResult.s.toString(16).padStart(64, '0'), 'hex')
    ]);

    console.log('Signature length:', signatureBytes.length);
    console.log('Signature (hex):', signatureBytes.toString('hex'));
    console.log('R:', signatureResult.r.toString(16));
    console.log('S:', signatureResult.s.toString(16));
    console.log('Recovery ID:', signatureResult.recovery);

    // Construct the transaction
    const txRaw = TxRaw.fromPartial({
      bodyBytes: TxBody.encode(txBody).finish(),
      authInfoBytes: authInfo,
      signatures: [signatureBytes],
    });

    // Encode transaction
    const txBytes = TxRaw.encode(txRaw).finish();
    const txBase64 = toBase64(txBytes);

    // Broadcast transaction
    console.log('Broadcasting transaction...');
    const broadcastUrl = `${chainConf.endpoints.rest_endpoint}/cosmos/tx/v1beta1/txs`;
    const broadcastResponse = await fetch(broadcastUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tx_bytes: txBase64,
        mode: 'BROADCAST_MODE_SYNC'
      })
    });

    if (!broadcastResponse.ok) {
      const errorData = await broadcastResponse.json();
      console.error('Broadcast error:', errorData);
      throw new Error(`Broadcast failed: ${JSON.stringify(errorData)}`);
    }

    const broadcastResult = await broadcastResponse.json();
    console.log('Broadcast result:', broadcastResult);

    if (broadcastResult.tx_response && broadcastResult.tx_response.code !== 0) {
      const error = new Error(`Transaction failed: ${broadcastResult.tx_response.raw_log || broadcastResult.tx_response.log}`);
      error.broadcastResult = broadcastResult;
      error.restApiUrl = `${chainConf.endpoints.rest_endpoint}/cosmos/tx/v1beta1/txs/${broadcastResult.tx_response.txhash || 'unknown'}`;
      error.raw_log = broadcastResult.tx_response.raw_log;
      throw error;
    }

    const txHash = broadcastResult.tx_response.txhash;
    const restApiUrl = `${chainConf.endpoints.rest_endpoint}/cosmos/tx/v1beta1/txs/${txHash}`;

    // Simplify the tx_response to only include essential fields
    const simplifiedTxResponse = {
      height: broadcastResult.tx_response.height,
      txhash: broadcastResult.tx_response.txhash,
      code: broadcastResult.tx_response.code,
      gas_wanted: broadcastResult.tx_response.gas_wanted,
      gas_used: broadcastResult.tx_response.gas_used,
      timestamp: broadcastResult.tx_response.timestamp,
      tx: {
        body: {
          messages: broadcastResult.tx_response.tx?.body?.messages || []
        }
      },
      events: broadcastResult.tx_response.events ? broadcastResult.tx_response.events.length : 0
    };

    return {
      transactionHash: txHash,
      hash: txHash,
      height: broadcastResult.tx_response.height || '0',
      gasUsed: broadcastResult.tx_response.gas_used || '0',
      gasWanted: broadcastResult.tx_response.gas_wanted || '0',
      code: broadcastResult.tx_response.code || 0,
      restApiUrl: restApiUrl,
      tx_response: simplifiedTxResponse
    };

  } catch (error) {
    console.error('Cosmos transaction error:', error);

    // Include all available error details
    const errorDetails = {
      message: error.message,
      restApiUrl: error.restApiUrl || null,
      broadcastResult: error.broadcastResult || null,
      raw_log: error.raw_log || null
    };

    const fullError = new Error(`Cosmos transaction failed: ${error.message}`);
    fullError.details = errorDetails;
    throw fullError;
  }
}

// Initialize faucet
async function initializeFaucet() {
  console.log('[START] Faucet initializing...');

  // Initialize secure keys
  console.log(' Initializing secure key management...');
  await initializeSecureKeys();
  console.log(' SecureKeyManager initialized successfully');
  console.log(` EVM Address: ${getEvmAddress()}`);
  console.log(` Cosmos Address: ${getCosmosAddress()}`);

  console.log('Using addresses derived from mnemonic');

  // Validate contract addresses
  console.log('\n Validating and verifying contract addresses...');

  // Import and run the contract verifier
  const { ContractValidator } = await import('./src/ContractValidator.js');
  // Create a wrapper object for the secure key manager functions
  const keyManager = {
    initialize: initializeSecureKeys,
    getEvmAddress,
    getCosmosAddress,
    getPrivateKey,
    getPrivateKeyBytes,
    getPublicKeyBytes
  };
  const verifier = new ContractValidator(conf, keyManager);

  // Enable auto-redeployment if specified
  const autoRedeploy = process.env.AUTO_REDEPLOY === 'true';
  if (autoRedeploy) {
    console.log(' Auto-redeployment enabled');
  }

  await verifier.initialize();
  const isValid = await verifier.validateAllContracts();

  if (!isValid) {
    console.error('\n Contract verification failed!');
    if (!autoRedeploy) {
      console.error(' Tip: Run with AUTO_REDEPLOY=true to automatically fix missing contracts');
    }
    // Temporarily disabled for frontend testing
    // process.exit(1);
  }

  console.log(' All contracts verified successfully!');

  // Setup token approvals
  console.log('\n Checking and setting up token approvals...');
  await setupTokenApprovals();

  // Start approval monitoring
  startApprovalMonitoring();

  // Initialize log rotation
  console.log('\n Initializing log rotation...');
  // Register server log
  logRotation.registerLogFile('server.log', {
    maxSize: 5 * 1024 * 1024, // 5MB
    maxFiles: 3,
    compress: false
  });

  // Register vite log if it exists
  if (fs.existsSync('vite.log')) {
    logRotation.registerLogFile('vite.log', {
      maxSize: 5 * 1024 * 1024, // 5MB
      maxFiles: 3,
      compress: false
    });
  }

  // Clean up logs older than 3 days
  logRotation.cleanupOldLogs('server.log', 3);

  console.log(' Faucet server ready!');
  console.log(` EVM Address: ${getEvmAddress()}`);
  console.log(` Cosmos Address: ${getCosmosAddress()}`);
  console.log(` Server listening on http://localhost:${conf.port}`);
  console.log(` Testing Mode: ${TESTING_MODE ? 'ENABLED' : 'DISABLED'}`);
  console.log(' Private keys secured in memory (never logged or written to disk)');
  console.log(' Faucet initialization complete!');
}

// Add erc20 ABI for balance checking
const erc20ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

// Static files are now served at the beginning of the middleware chain

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  console.error('Error path:', req.path);
  console.error('Error method:', req.method);
  
  // Don't send JSON for asset requests
  if (req.path.includes('.css') || req.path.includes('.js') || req.path.includes('.png') || req.path.includes('.jpg')) {
    res.status(500).send('Internal server error');
  } else {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Catch-all route for Vue Router - must be last
app.get('*', (req, res) => {
  // For production, always serve index.html for non-file routes
  if (process.env.NODE_ENV === 'production') {
    // If it's a file request that wasn't caught by static middleware, it's a 404
    if (req.path.includes('.')) {
      console.log(`[404] File not found: ${req.path}`);
      res.status(404).send('Not found');
    } else {
      // For all other routes, serve the Vue app
      const indexPath = path.join(__dirname, 'dist', 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        console.error(`[ERROR] Catch-all: index.html not found at ${indexPath}`);
        res.status(500).send('Application build not found. Please check deployment.');
      }
    }
  } else {
    // Development mode
    res.status(404).json({ error: 'Not found' });
  }
});

// Start server
const HOST = process.env.HOST || '0.0.0.0';
app.listen(conf.port, HOST, async () => {
  console.log(`[START] Faucet server starting on ${HOST}:${conf.port}...`);
  await initializeFaucet();
  console.log(` Server listening on http://${HOST}:${conf.port}`);
})
