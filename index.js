import express from "express";
import { ethers } from "ethers";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const RPC_1 = process.env.RPC_URL_1;
const RPC_2 = process.env.RPC_URL_2;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const ABI = [{
    "inputs": [],
    "name": "getAllPendingOrders",
    "outputs": [
      { "internalType": "uint256[]", "name": "orderIds", "type": "uint256[]" },
      { "internalType": "address[]", "name": "users", "type": "address[]" },
      { "internalType": "uint256[]", "name": "assetIndexes", "type": "uint256[]" },
      { "internalType": "uint256[]", "name": "usdSizes", "type": "uint256[]" },
      { "internalType": "uint256[]", "name": "leverages", "type": "uint256[]" },
      { "internalType": "bool[]", "name": "isLongs", "type": "bool[]" },
      { "internalType": "uint256[]", "name": "slPrices", "type": "uint256[]" },
      { "internalType": "uint256[]", "name": "tpPrices", "type": "uint256[]" },
      { "internalType": "uint256[]", "name": "timestamps", "type": "uint256[]" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "orderId", "type": "uint256" },
      { "internalType": "bytes", "name": "proof", "type": "bytes" }
    ],
    "name": "executePendingOrder",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }];

const provider1 = new ethers.providers.JsonRpcProvider(RPC_1);
const provider2 = new ethers.providers.JsonRpcProvider(RPC_2);

const wallet1 = new ethers.Wallet(PRIVATE_KEY, provider1);
const wallet2 = new ethers.Wallet(PRIVATE_KEY, provider2);

const contract1 = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet1);
const contract2 = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet2);

const BATCH_SIZE = 10;

async function processBatch(startIndex, orderIds, users, assetIndexes, contract, responses) {
  const promises = [];

  for (let i = startIndex; i < startIndex + BATCH_SIZE && i < orderIds.length; i++) {
    const orderId = orderIds[i];
    const user = users[i];
    const index = assetIndexes[i];

    if (user === "0x0000000000000000000000000000000000000000") {
      responses.push({ orderId, status: "skipped", reason: "Order deleted" });
      continue;
    }

    const p = (async () => {
      try {
        const proofRes = await fetch("https://proof-production.up.railway.app/get-proof", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ index }),
        });

        const proofData = await proofRes.json();
        const proof = proofData.proof_bytes;
        if (!proof) throw new Error("No proof returned");

        const tx = await contract.executePendingOrder(orderId, proof, { gasLimit: 800000 });
        await tx.wait();

        responses.push({ orderId, status: "executed", txHash: tx.hash });
      } catch (err) {
        responses.push({ orderId, status: "failed", reason: err.reason || err.message });
      }
    })();

    promises.push(p);
  }

  await Promise.allSettled(promises);
}

app.get("/execute-all", async (req, res) => {
  try {
    const result = await contract1.getAllPendingOrders();

    const orderIds = result[0].map(Number);
    const users = result[1];
    const assetIndexes = result[2].map(Number);

    const group1 = { orderIds: [], users: [], assetIndexes: [] };
    const group2 = { orderIds: [], users: [], assetIndexes: [] };

    for (let i = 0; i < orderIds.length; i++) {
      if (i % 2 === 0) {
        group1.orderIds.push(orderIds[i]);
        group1.users.push(users[i]);
        group1.assetIndexes.push(assetIndexes[i]);
      } else {
        group2.orderIds.push(orderIds[i]);
        group2.users.push(users[i]);
        group2.assetIndexes.push(assetIndexes[i]);
      }
    }

    const responses = [];

    await Promise.all([
      (async () => {
        for (let i = 0; i < group1.orderIds.length; i += BATCH_SIZE) {
          await processBatch(i, group1.orderIds, group1.users, group1.assetIndexes, contract1, responses);
        }
      })(),
      (async () => {
        for (let i = 0; i < group2.orderIds.length; i += BATCH_SIZE) {
          await processBatch(i, group2.orderIds, group2.users, group2.assetIndexes, contract2, responses);
        }
      })(),
    ]);

    res.json({ executed: responses });
  } catch (err) {
    console.error("🔥 Error:", err.message);
    res.status(500).json({ error: "Execution failed", details: err.message });
  }
});

app.listen(port, () => {
  console.log(`🟢 Executor running on port ${port}`);
});

