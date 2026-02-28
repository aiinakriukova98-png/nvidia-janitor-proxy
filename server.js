// server.js — Janitor → NVIDIA NIM Universal Bridge
// GLM: native inference (true thinking toggle)
// DeepSeek: OpenAI endpoint (reasoning toggle)

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.PORT || 3000;
const NIM_API_KEY = process.env.NIM_API_KEY;

// Endpoints
const NIM_OPENAI_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

const NIM_NATIVE_ENDPOINTS = {
  "glm4.7": "https://api.nvidia.com/v1/inference/z-ai/glm4.7",
  "glm5":   "https://api.nvidia.com/v1/inference/z-ai/glm5"
};

// Model routing map
const MODEL_MAPPING = {
  // DeepSeek
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

  // GLM
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

// Health
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Model list for Janitor
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

// Convert messages → prompt (for native GLM)
function buildPrompt(messages) {
  let prompt = "";

  for (const msg of messages) {
    if (msg.role === "system") {
      prompt += `<system>\n${msg.content}\n</system>\n\n`;
    } else if (msg.role === "user") {
      prompt += `<user>\n${msg.content}\n</user>\n\n`;
    } else if (msg.role === "assistant") {
      prompt += `<assistant>\n${msg.content}\n</assistant>\n\n`;
    }
  }

  prompt += `<assistant>\n`;
  return prompt;
}

// Main endpoint
app.post("/v1/chat/completions", async (req, res) => {
  const { model, messages, temperature, max_tokens } = req.body;

  const cfg = MODEL_MAPPING[model];
  if (!cfg) {
    return res.status(400).json({
      error: { message: `Unknown model: ${model}` }
    });
  }

  try {

    // ---- DeepSeek via OpenAI NIM ----
    if (cfg.type === "openai") {
      const payload = {
        model: cfg.id,
        messages,
        temperature: temperature ?? 0.9,
        top_p: req.body.top_p ?? 0.9,
        max_tokens: max_tokens ?? 4096,
        stream: false,
        reasoning: cfg.thinking
      };

      const response = await axios.post(
        NIM_OPENAI_ENDPOINT,
        payload,
        {
          headers: {
            Authorization: `Bearer ${NIM_API_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );

      return res.json({
        id: "chatcmpl-proxy",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: response.data.choices,
        usage: response.data.usage
      });
    }

    // ---- GLM via native NIM ----
    const prompt = buildPrompt(messages);

    const payload = {
      input: prompt,
      parameters: {
        max_new_tokens: max_tokens ?? 1024,
        temperature: temperature ?? 0.9,
        chat_template_kwargs: {
          enable_thinking: cfg.thinking
        }
      }
    };

    const response = await axios.post(
      cfg.endpoint,
      payload,
      {
        headers: {
          Authorization: `Bearer ${NIM_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 300000
      }
    );

    const text =
      response.data?.output_text ||
      response.data?.generated_text ||
      response.data?.text ||
      "";

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
      ],
      usage: {
        prompt_tokens: -1,
        completion_tokens: -1,
        total_tokens: -1
      }
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
