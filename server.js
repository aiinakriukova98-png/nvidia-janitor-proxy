// server.js — строгий Janitor → NVIDIA NIM proxy (DeepSeek only)

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

// ⛔ СТРОГОЕ СОПОСТАВЛЕНИЕ МОДЕЛЕЙ
// Левая часть — ЧТО ты пишешь в Janitor
// Правая часть — ТОЧНОЕ имя модели NVIDIA
const MODEL_MAPPING = {
  "deepseek-3.2": "deepseek-ai/deepseek-v3.2",
  "deepseek-3.1": "deepseek-ai/deepseek-v3.1",
  "deepseek-3.1-terminus": "deepseek-ai/deepseek-v3.1-terminus"
};

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// (необязательно, но полезно) список моделей для Janitor
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

  const nimModel = MODEL_MAPPING[model];

  // ❌ ЕСЛИ МОДЕЛИ НЕТ — ОШИБКА, А НЕ ПОДМЕНА
  if (!nimModel) {
    return res.status(400).json({
      error: {
        message: `Model "${model}" is not allowed or does not exist`,
        type: "invalid_model"
      }
    });
  }

  try {
    const response = await axios.post(
      NIM_ENDPOINT,
      {
        model: nimModel,
        messages,
        temperature: temperature ?? 0.7,
        max_tokens: max_tokens ?? 8192,
        stream: stream ?? false,
        // thinking включаем ВСЕГДА — DeepSeek это умеет
        extra_body: {
          chat_template_kwargs: { thinking: true }
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

    // Стрим просто прокидываем как есть
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      response.data.pipe(res);
      return;
    }

    // Нестрима — приводим к OpenAI-формату
    res.json({
      id: "chatcmpl-deepseek",
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
  console.log("DeepSeek proxy running on port", PORT);
});
