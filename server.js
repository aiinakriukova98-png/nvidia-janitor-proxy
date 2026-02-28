// server.js — Janitor → NVIDIA NIM Universal Bridge (STABLE)

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 3000;
const NIM_API_KEY = process.env.NIM_API_KEY;

const NIM_OPENAI_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

const NIM_NATIVE_ENDPOINTS = {
  "glm4.7": "https://api.nvcf.nvidia.com/v1/inference/z-ai/glm4.7",
  "glm5":   "https://api.nvcf.nvidia.com/v1/inference/z-ai/glm5"
};

const MODEL_MAPPING = {
  "deepseek-3.2": {
    type: "openai",
    id: "deepseek-ai/deepseek-v3.2",
    thinking: true
  },
  "deepseek-3.2-nothink": {
    type: "openai",
    id: "deepseek-ai/deepseek-v3.2",
    thinking: false
  },

  "glm4.7": {
    type: "native",
    endpoint: NIM_NATIVE_ENDPOINTS["glm4.7"],
    thinking: true
  },
  "glm4.7-nothink": {
    type: "native",
    endpoint: NIM_NATIVE_ENDPOINTS["glm4.7"],
    thinking: false
  },

  "glm5": {
    type: "native",
    endpoint: NIM_NATIVE_ENDPOINTS["glm5"],
    thinking: true
  },
  "glm5-nothink": {
    type: "native",
    endpoint: NIM_NATIVE_ENDPOINTS["glm5"],
    thinking: false
  }
};

app.get("/v1/models", (req, res) => {
  res.json({
    object: "list",
    data: Object.keys(MODEL_MAPPING).map(id => ({
      id,
      object: "model",
      owned_by: "nvidia-nim"
    }))
  });
});

function buildPrompt(messages) {
  let prompt = "";

  for (const msg of messages) {
    if (msg.role === "system")
      prompt += `<system>\n${msg.content}\n</system>\n\n`;
    else if (msg.role === "user")
      prompt += `<user>\n${msg.content}\n</user>\n\n`;
    else if (msg.role === "assistant")
      prompt += `<assistant>\n${msg.content}\n</assistant>\n\n`;
  }

  prompt += `<assistant>\n`;
  return prompt;
}

function extractGLMText(data) {
  if (!data) return "";

  if (typeof data === "string") return data;

  if (data.output_text) return data.output_text;

  if (data.generated_text) return data.generated_text;

  if (Array.isArray(data.outputs) && data.outputs[0]?.generated_text)
    return data.outputs[0].generated_text;

  if (Array.isArray(data.data) && data.data[0]?.text)
    return data.data[0].text;

  return JSON.stringify(data);
}

app.post("/v1/chat/completions", async (req, res) => {
  const { model, messages, temperature, max_tokens } = req.body;

  const cfg = MODEL_MAPPING[model];
  if (!cfg) return res.status(400).json({ error: "Unknown model" });

  try {

    if (cfg.type === "openai") {
      const response = await axios.post(
        NIM_OPENAI_ENDPOINT,
        {
          model: cfg.id,
          messages,
          temperature: temperature ?? 0.9,
          max_tokens: max_tokens ?? 4096,
          reasoning: cfg.thinking ? "medium" : "off"
        },
        {
          headers: {
            Authorization: `Bearer ${NIM_API_KEY}`,
            "Content-Type": "application/json"
          },
          timeout: 180000
        }
      );

      return res.json(response.data);
    }

    const response = await axios.post(
      cfg.endpoint,
      {
        input: buildPrompt(messages),
        parameters: {
          max_new_tokens: max_tokens ?? 1024,
          temperature: temperature ?? 0.9,
          chat_template_kwargs: {
            enable_thinking: cfg.thinking
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${NIM_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 180000
      }
    );

    const text = extractGLMText(response.data);

    res.json({
      id: "chatcmpl-native",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop"
        }
      ]
    });

  } catch (err) {
    console.error("Proxy error:", err?.response?.data || err.message);

    res.status(500).json({
      error: {
        message: err?.response?.data || err.message,
        type: "proxy_error"
      }
    });
  }
});

app.listen(PORT, () => {
  console.log("NIM Universal Proxy running on port", PORT);
});
