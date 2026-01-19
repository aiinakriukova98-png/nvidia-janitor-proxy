// server.js — прокси для Janitor → NVIDIA NIM
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const NIM_API_KEY = process.env.NIM_API_KEY;
const NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/v1/chat/completions", async (req, res) => {
  try {
    const response = await axios.post(
      NIM_URL,
      {
        model: "deepseek-ai/deepseek-v3.1",
        messages: req.body.messages,
        temperature: req.body.temperature ?? 0.7,
        max_tokens: req.body.max_tokens ?? 2048
      },
      {
        headers: {
          Authorization: `Bearer ${NIM_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    res.json({
      id: "chatcmpl-janitor",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: response.data.choices[0].message,
          finish_reason: "stop"
        }
      ]
    });
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log("Proxy running on port", PORT);
});
