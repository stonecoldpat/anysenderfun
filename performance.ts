import { ethers, Wallet } from "ethers";
import { PerformanceTestFactory } from "./src/contracts/PerformanceTestFactory";
import { AnySenderClient } from "@any-sender/client";
import { RelayTransaction } from "@any-sender/data-entities";
import { RelayFactory } from "@any-sender/contracts";
import { Provider } from "ethers/providers";
import { parseEther, defaultAbiCoder, keccak256, arrayify } from "ethers/utils";
import fetch from "cross-fetch";

const mnemonic = "<12 word seed>";
const INFURA_PROJECT_ID = "<proejct id>";
const MINIMUM_ANYSENDER_DEADLINE = 610; // Maximum deadline for transaction to get in the blockchain
const ANYSENDER_BALANCE_URL = "18.188.185.156"; // URL to fetch balance
const ANYSENDER_RELAY_URL =
  "https://y9g7myp1zl.execute-api.us-east-2.amazonaws.com/Stage"; // URL to send jobs
const ANYSENDER_PORT = "5399"; // Magical port for magical paeople
const ANYSENDER_BALANCE = "/balance/"; // Entry point for balance
const ANYSENDER_ADDR = "0xE25ec6cB37b1a37D8383891BC5DFd627c6Cd66C8"; // Relay.sol contract
const RECEIPT_ADDR = "0xe41743ca34762b84004d3abe932443fc51d561d5"; // Signer of receipt
const DEPOSIT_CONFIRMATIONS = 100; //

/**
 * Computes a hash of the relay transaction ID.
 * @param relayTx Unsigned Relay Transaction
 */
function getRelayTxID(relayTx: {
  to: string;
  from: string;
  gas: number;
  data: string;
  deadlineBlockNumber: number;
  refund: string;
  relayContractAddress: string;
}): string {
  const messageEncoded = defaultAbiCoder.encode(
    ["address", "address", "bytes", "uint", "uint", "uint", "address"],
    [
      relayTx.to,
      relayTx.from,
      relayTx.data,
      relayTx.deadlineBlockNumber,
      relayTx.refund,
      relayTx.gas,
      relayTx.relayContractAddress
    ]
  );
  return keccak256(messageEncoded);
}

/**
 * Set up the provider and wallet
 */
async function setup() {
  const infuraProvider = new ethers.providers.InfuraProvider(
    "ropsten",
    INFURA_PROJECT_ID
  );

  const mnemonicWallet = ethers.Wallet.fromMnemonic(mnemonic);
  const connectedWallet = mnemonicWallet.connect(infuraProvider);

  return { wallet: connectedWallet, provider: infuraProvider };
}

/**
 * Deposit coins into any.sender contract
 * @param wallet Signer
 * @param provider InfuraProvider
 */
async function deposit(wallet: Wallet, provider: Provider) {
  let blockNo = await provider.getBlockNumber();
  let balance = await provider.getBalance(wallet.address);

  console.log("**** BEFORE DEPOSIT ****");
  console.log("address:" + wallet.address);
  console.log("block number:" + blockNo.toString());
  console.log("balance: " + balance.toString());

  console.log(
    "Sending transaction. Must wait " + DEPOSIT_CONFIRMATIONS + " confirmations"
  );
  const tx = await wallet.sendTransaction({
    to: ANYSENDER_ADDR,
    value: parseEther("7")
  });

  await tx.wait(DEPOSIT_CONFIRMATIONS);

  console.log("**** AFTER DEPOSITING 7 ETHER ****");
  console.log("address:" + wallet.address);
  console.log("block number:" + blockNo.toString());
  console.log("balance: " + balance.toString());
  console.log(tx);
}

/**
 * Fetch balance for an account
 * @param wallet Signer
 * @param provider InfuraProvider
 */
async function checkBalance(wallet: Wallet) {
  const balanceUrl =
    "http://" +
    ANYSENDER_BALANCE_URL +
    ":" +
    ANYSENDER_PORT +
    ANYSENDER_BALANCE +
    wallet.address;

  const res = await fetch(balanceUrl);

  if (res.status > 200) {
    throw new Error("Bad response from server");
  }

  const user = await res.json();
  console.log(user);
}

/**
 * Deploy performance test contract to the network
 * @param wallet Signer
 * @param provider InfuraProvider
 */
async function deployPerformanceTest(
  wallet: Wallet,
  provider: Provider
): Promise<string> {
  const performanceTestFactory = new PerformanceTestFactory(wallet);
  const performanceTestTransaction = performanceTestFactory.getDeployTransaction();
  const response = await wallet.sendTransaction(performanceTestTransaction);
  const receipt = await response.wait(6);

  console.log("NEW PERFORMANCE TEST CONTRACT: " + receipt.contractAddress);
  return receipt.contractAddress;
}

/**
 *
 * Sends up 32 jobs, various gas requirements, to the any.sender service.
 * @param performanceTestAddr Performance Test Contract address
 * @param wallet Wallet
 * @param provider InfuraProvider
 */
async function relayJob(
  performanceTestAddr: string,
  wallet: Wallet,
  provider: Provider
) {
  const anysender = new AnySenderClient(
    ANYSENDER_RELAY_URL,
    ANYSENDER_ADDR,
    RECEIPT_ADDR
  );

  let blockNo = (await provider.getBlockNumber()) + MINIMUM_ANYSENDER_DEADLINE;
  const performanceTestFactory = new PerformanceTestFactory(wallet);
  let performTestContract = new ethers.Contract(
    performanceTestAddr,
    performanceTestFactory.interface.abi,
    provider
  );

  const jobs = [
    3001,
    3002,
    3003,
    3004,
    3005,
    3006,
    103,
    1,
    3007,
    3008,
    201,
    3,
    2,
    301,
    400,
    605,
    100,
    4,
    5,
    6,
    4009,
    10,
    20,
    41,
    4000,
    80,
    30,
    40,
    202,
    800,
    900,
    401
  ];

  let totalHashes = 0;

  let listOfPromises = [];

  for (let i = 0; i < jobs.length; i++) {
    const callData = performTestContract.interface.functions.test.encode([
      jobs[i]
    ]);

    totalHashes = totalHashes + jobs[i];

    let gas = 250000;
    if (jobs[i] > 200) {
      gas = 3000000;
    }
    const unsignedRelayTx = {
      from: wallet.address,
      to: performanceTestAddr,
      gas: gas,
      data: callData,
      deadlineBlockNumber: blockNo,
      refund: parseEther("0.00000001").toString(),
      relayContractAddress: ANYSENDER_ADDR
    };

    const relayTxId = getRelayTxID(unsignedRelayTx);
    const signature = await wallet.signMessage(arrayify(relayTxId));

    const signedRelayTx: RelayTransaction = {
      ...unsignedRelayTx,
      signature: signature
    };

    // Send receipt!
    const txReceipt = await anysender.executeRequest(signedRelayTx);
    console.log(txReceipt);

    listOfPromises.push(subscribe(relayTxId, wallet, provider));
  }

  console.log("Total jobs: " + jobs.length);
  console.log("Total hahses: " + totalHashes);

  await Promise.all(listOfPromises);
}

/**
 * Funds spam accounts by sending 3 ether to 20 addresses.
 * @param wallet Wallet
 * @param provider InfuraProvider
 */
async function prepareSpamWallets(wallet: Wallet, provider: Provider) {
  for (let i = 0; i < 20; i++) {
    let path = "m/44'/60'/1'/0/" + i;
    let secondMnemonicWallet = ethers.Wallet.fromMnemonic(mnemonic, path);
    let connectedWallet = secondMnemonicWallet.connect(provider);

    let response = await wallet.sendTransaction({
      to: connectedWallet.address,
      value: parseEther("3")
    });

    await response.wait(3);

    let bal = await provider.getBalance(secondMnemonicWallet.address);
    console.log("address: " + secondMnemonicWallet.address) +
      "balance: " +
      bal.toString();
  }
}

/**
 * Spam ropsten with hash junk
 * @param performanceTestAddr Spam contract
 * @param wallet Signer
 * @param provider InfuraProvider
 */
async function spam(
  performanceTestAddr: string,
  wallet: Wallet,
  provider: Provider
) {
  const performanceTestFactory = new PerformanceTestFactory(wallet);
  let performTestContract = new ethers.Contract(
    performanceTestAddr,
    performanceTestFactory.interface.abi,
    provider
  );

  // Let's send lots of big transactions.
  for (let i = 2; i < 20; i++) {
    let path = "m/44'/60'/1'/0/" + i;
    let secondMnemonicWallet = ethers.Wallet.fromMnemonic(mnemonic, path);
    let connectedWallet = secondMnemonicWallet.connect(provider);

    for (let j = 0; j < 9; j++) {
      try {
        let receipt = await performTestContract
          .connect(connectedWallet)
          .test(10000, {
            gasLimit: 8000000,
            gasPrice: parseEther("0.00000004")
          });

        console.log(receipt);

        await delay(500);
      } catch (e) {
        console.log(e);
      }
    }
  }
}

/**
 * Returns a promise that is resolved when relay transaction id is detected via an event
 * @param relayTxId Relay Transaction ID
 * @param wallet Signer
 * @param provider InfuraProvider
 */
async function subscribe(
  relayTxId: string,
  wallet: Wallet,
  provider: Provider
) {
  let topic = ethers.utils.id(
    "RelayExecuted(bytes32,bool,address,uint256,uint256)"
  );

  let blockNo = await provider.getBlockNumber();

  let filter = {
    address: ANYSENDER_ADDR,
    fromBlock: blockNo - 10,
    topics: [topic]
  };

  return new Promise(resolve => {
    provider.on(filter, result => {
      const relay = new RelayFactory(wallet).attach(ANYSENDER_ADDR);

      let recordedRelayTxId = relay.interface.events.RelayExecuted.decode(
        result.data,
        result.topics
      ).relayTxId;

      if (relayTxId == recordedRelayTxId) {
        console.log("Found: " + relayTxId);
        resolve();
      }
    });
  });
}
/**
 * Delay function
 * @param ms Milli-seconds
 */
function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Runs the entire program.
 * - Deposits from main wallet
 * - Checks balance on any.sender for main wallet
 * - Deploy performance contract
 * - Set up spam wallets (e.g. deposit ether)
 * - Send spam to network
 * - Send relay jobs to any.sender
 */
(async () => {
  const { wallet, provider } = await setup();

  // await deposit(wallet, provider);
  // await checkBalance(wallet);
  const testContractAddr = await deployPerformanceTest(wallet, provider);
  // await prepareSpamWallets(wallet, provider);
  // await spam(testContractAddr, wallet, provider);
  await relayJob(testContractAddr, wallet, provider);

  console.log("One small step for satoshi, one giant leap for mankind");
})().catch(e => {
  console.log(e);
  // Deal with the fact the chain failed
});
