import express from "express";
import { ethers } from "ethers";
import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// 🔁 deux RPC différents
const RPC_URL_1 = process.env.RPC_URL_1;
const RPC_URL_2 = process.env.RPC_URL_2;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

const provider1 = new ethers.providers.JsonRpcProvider(RPC_URL_1);
const provider2 = new ethers.providers.JsonRpcProvider(RPC_URL_2);

const wallet1 = new ethers.Wallet(PRIVATE_KEY, provider1);
const wallet2 = new ethers.Wallet(PRIVATE_KEY, provider2);

const ABI = [
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

const contract1 = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet1);
const contract2 = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet2);

app.get("/execute-from/:start", async (req, res) => {
  const start = parseInt(req.params.start);
  const end = 0; // ou une autre limite
  const responses = [];

  console.log(`🚀 Start executing orders from ID ${start} to ${end}`);

  for (let i = start; i > end; i--) {
    const contract = i % 2 === 0 ? contract1 : contract2; // alterner entre les deux RPCs

    try {
      console.log(`⏳ Order ID ${i} | RPC: ${contract.provider.connection.url}`);

      const proofRes = await fetch("https://proof-production.up.railway.app/get-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: 0 }) // index 0 par défaut
      });

      const proofData = await proofRes.json();
      const proof = proofData.proof_bytes;

      if (!proof) throw new Error("No proof returned");

      const tx = await contract.executePendingOrder(i, proof, {
        gasLimit: 800000
      });
      await tx.wait();

      console.log(`✅ Executed order #${i} with tx: ${tx.hash}`);
      responses.push({ orderId: i, status: "executed", txHash: tx.hash });
    } catch (err) {
      console.error(`❌ Order #${i} failed:`, err.reason || err.message);
      responses.push({ orderId: i, status: "failed", reason: err.reason || err.message });
    }
  }

  res.json({ result: responses });
});

app.listen(port, () => {
  console.log(`🟢 Server listening on port ${port}`);
});
