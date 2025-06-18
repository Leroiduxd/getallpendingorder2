import express from "express";
import { ethers } from "ethers";
import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const ABI = [
  {
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
  }
];

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

console.log("🚀 Executor wallet address:", wallet.address);

app.get("/execute-all", async (req, res) => {
  try {
    const result = await contract.getAllPendingOrders();

    // Trie des ordres du plus grand ID au plus petit
    const orders = result[0].map((id, i) => ({
      orderId: Number(id),
      user: result[1][i],
      index: Number(result[2][i]),
    }));

    const sortedOrders = orders.sort((a, b) => b.orderId - a.orderId);
    const responses = [];

    for (const { orderId, user, index } of sortedOrders) {
      if (user === "0x0000000000000000000000000000000000000000") {
        console.log(`⚠️ Skipping deleted order #${orderId}`);
        responses.push({ orderId, status: "skipped", reason: "Order deleted" });
        continue;
      }

      try {
        console.log(`⏳ Fetching proof for order #${orderId}, index ${index}...`);
        const proofRes = await fetch("https://proof-production.up.railway.app/get-proof", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ index }),
        });

        const proofData = await proofRes.json();
        const proof = proofData.proof_bytes;

        if (!proof) throw new Error("No proof returned");

        console.log(`🚀 Executing order #${orderId}...`);
        const tx = await contract.executePendingOrder(orderId, proof, {
          gasLimit: 800000
        });

        await tx.wait();

        console.log(`✅ Order #${orderId} executed successfully. Tx: ${tx.hash}`);
        responses.push({ orderId, status: "executed", txHash: tx.hash });
      } catch (err) {
        console.error(`❌ Failed to execute order #${orderId}:`, err.reason || err.message);
        responses.push({ orderId, status: "failed", reason: err.reason || err.message });
      }
    }

    res.json({ executed: responses });
  } catch (err) {
    console.error("🔥 Global error while executing orders:", err.message);
    res.status(500).json({ error: "Global failure", details: err.message });
  }
});

app.listen(port, () => {
  console.log(`🟢 Server running on port ${port}`);
});
