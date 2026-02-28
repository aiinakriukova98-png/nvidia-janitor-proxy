// server.js — Janitor → NVIDIA NIM proxy (DeepSeek / GLM with thinking toggle)

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const PORT = process.env.PORT || 3000;
const NIM_API_KEY = process.env.NIM_API_KEY;
const NIM_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

/*
  MODEL_MAPPING:
  Ключ — что ты выбираешь в Janitor
  id — точное имя модели NVIDIA
  thinking — включён ли reasoning режим
*/
const MODEL_MAPPING = {
  // DeepSeek
  "deepseek-3.2": {
    id: "deepseek-ai/deepseek-v3.2",
    thinking: true
  },
  "deepseek-3.2-nothink": {
    id: "deepseek-ai/deepseek-v3.2",
    thinking: false
  },

  // GLM 4.7
  "glm4.7": {
    id: "z-ai/glm4.7",
    thinking: true
  },
  "glm4.7-nothink": {
    id: "z-ai/glm4.7",
    thinking: false
  },

  // GLM 5
  "glm5": {
    id: "z-ai/glm5",
    thinking: true
  },
  "glm5-nothink": {
    id: "z-ai/glm5",
    thinking: false
  }
};

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Список моделей для Janitor
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

// Основной endpoint
app.post("/v1/chat/completions", async (req, res) => {
  const { model, messages, temperature, max_tokens, stream } = req.body;

  const modelConfig = MODEL_MAPPING[model];

  if (!modelConfig) {
    return res.status(400).json({
      error: {
        message: `Model "${model}" is not allowed or does not exist`,
        type: "invalid_model"
      }
    });
  }

  const nimModel = modelConfig.id;
  const thinkingEnabled = modelConfig.thinking;

  try {
    const response = await axios.post(
      NIM_ENDPOINT,
      {
        model: nimModel,
        messages,
        temperature: temperature ?? 0.9,
        top_p: req.body.top_p ?? 0.9,
        max_tokens: max_tokens ?? 8192,
        stream: stream ?? false,
        extra_body: {
          chat_template_kwargs: {
            thinking: thinkingEnabled
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${NIM_API_KEY}`,
          "Content-Type": "application/json"
        },
        responseType: stream ? "stream" : "json"
      }
    );

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      response.data.pipe(res);
      return;
    }

    res.json({
      id: "chatcmpl-proxy",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: response.data.choices,
      usage: response.data.usage
    });

  } catch (err) {
    res.status(err.response?.status || 500).json({
      error: {
        message: err.response?.data || err.message,
        type: "proxy_error"
      }
    });
  }
});

app.listen(PORT, () => {
  console.log("NVIDIA NIM proxy running on port", PORT);
});
