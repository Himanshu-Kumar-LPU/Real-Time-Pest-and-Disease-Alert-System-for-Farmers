const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const http = require("http");
const https = require("https");
const axios = require("axios");
const FormData = require("form-data");
const { execFile } = require("child_process");
const os = require("os");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const nodemailer = require("nodemailer");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});
const connectDB = require("./config/db");
const authRoutes = require("./routes/auth");
const User = require("./models/User");
const Report = require("./models/Report");
let selfsigned = null;
try {
  selfsigned = require("selfsigned");
} catch (error) {
  console.warn("⚠️  selfsigned package not found. HTTPS auto-cert generation is unavailable.");
}
console.log('🔑 GROQ_API_KEY loaded:', process.env.GROQ_API_KEY ? 'YES' : 'NO');

// groq-sdk not available in npm registry, using fallback
let groq = null;
let groqSdkAvailable = false;
const hasGroqApiKey = Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim());
try {
  const Groq = require('groq-sdk');
  const GroqClient = Groq && typeof Groq === 'function' ? Groq : (Groq && Groq.default ? Groq.default : null);
  if (!GroqClient || typeof GroqClient !== 'function') {
    throw new Error('groq-sdk did not export a constructor');
  }
  groqSdkAvailable = true;
  if (hasGroqApiKey) {
    groq = new GroqClient({
      apiKey: process.env.GROQ_API_KEY,
    });
  }
} catch (e) {
  console.warn("⚠️  groq-sdk initialization failed, using fallback guidance.", e && e.message);
  console.error(e);
}

if (!hasGroqApiKey) {
  console.warn("⚠️  WARNING: GROQ_API_KEY not found. Using fallback guidance.");
} else if (!groqSdkAvailable) {
  console.warn("⚠️  WARNING: GROQ_API_KEY is set but groq-sdk is unavailable. Using fallback guidance.");
} else if (!groq) {
  console.warn("⚠️  WARNING: Groq client failed to initialize. Using fallback guidance.");
} else {
  console.log('✅ Groq client initialized successfully');
}

const app = express();
console.log('🚀 Server starting...');
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const httpsPort = Number(process.env.HTTPS_PORT || 3443);
const httpsDevEnabled = String(process.env.HTTPS_DEV || "false").toLowerCase() === "true";
const httpsRedirectEnabled = String(process.env.HTTPS_REDIRECT || "false").toLowerCase() === "true";
const certDir = path.join(__dirname, "certs");
const certKeyPath = process.env.HTTPS_KEY_PATH || path.join(certDir, "dev-key.pem");
const certCertPath = process.env.HTTPS_CERT_PATH || path.join(certDir, "dev-cert.pem");
const dataFilePath = path.join(__dirname, "data.json");
const frontendPath = path.join(__dirname, "..", "frontend");
const reportUploadsDir = path.join(__dirname, "uploads", "reports");
const HUGGING_FACE_ROUTER = process.env.HUGGING_FACE_ROUTER || "https://router.huggingface.co/v1/chat/completions";
const HUGGING_FACE_MODEL = process.env.HUGGING_FACE_MODEL || "openai/gpt-oss-120b:fastest";
const HUGGING_FACE_API_KEY = process.env.HUGGING_FACE_API_KEY;
const WEATHER_API_KEY = process.env.WEATHER_API_KEY || "";

fs.mkdirSync(reportUploadsDir, { recursive: true });

app.use(bodyParser.json({ limit: "5mb" }));
app.use(cors());
app.use(express.static(frontendPath, { index: false }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Connect to MongoDB
connectDB().then(async () => {
  // Migrate data.json to MongoDB if collection is empty
  try {
    const reportCount = await Report.countDocuments();
    if (reportCount === 0 && fs.existsSync(dataFilePath)) {
      const fileContent = fs.readFileSync(dataFilePath, "utf-8").trim();
      if (fileContent) {
        const localData = JSON.parse(fileContent);
        if (Array.isArray(localData) && localData.length > 0) {
          console.log(`📦 Migrating ${localData.length} reports from data.json to MongoDB...`);
          // Clean up data for MongoDB (convert string IDs if needed)
          const cleanedData = localData.map(r => {
            const { id, ...rest } = r;
            return rest;
          });
          await Report.insertMany(cleanedData);
          console.log("✅ Migration complete!");
        }
      }
    }
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
  }
});

// Authentication Routes
app.use('/api/auth', authRoutes);

// 📧 Email Transporter Setup (Gmail)
const emailTransporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER || "kumarhimanshu9605@gmail.com",
    pass: process.env.EMAIL_PASSWORD || "xxxx xxxx xxxx xxxx" // App password from Gmail
  }
});

// 📧 Function to send email to admin
async function sendEmailToAdmin(reportData) {
  try {
    const htmlContent = `
      <h2>📋 New Farm Alert Report Received</h2>
      <p><strong>User Name:</strong> ${reportData.name}</p>
      <p><strong>Email:</strong> ${reportData.userEmail || "Not logged in"}</p>
      <p><strong>Location:</strong> ${reportData.location}</p>
      <p><strong>Crop:</strong> ${reportData.crop}</p>
      <p><strong>Problem:</strong> ${reportData.problem}</p>
      <p><strong>Submitted At:</strong> ${new Date(reportData.reportedAt).toLocaleString()}</p>
      ${reportData.imageUrl ? `<p><strong>Report Image:</strong> <a href="http://localhost:${port}${reportData.imageUrl}" target="_blank" rel="noopener">View uploaded image</a></p>` : ""}
      <hr>
      <p><a href="http://localhost:3000/admin.html">View all reports in Admin Dashboard</a></p>
    `;

    await emailTransporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL,
      subject: `🚨 New Report: ${reportData.crop} - ${reportData.problem}`,
      html: htmlContent
    });
    console.log('✅ Email sent to admin:', process.env.ADMIN_EMAIL);
  } catch (error) {
    console.error('❌ Email sending failed:', error.message);
  }
}

const PYTHON_ANALYSIS_TIMEOUT = process.env.PYTHON_ANALYSIS_TIMEOUT ? parseInt(process.env.PYTHON_ANALYSIS_TIMEOUT, 10) : 120000;
const LOW_CONFIDENCE_THRESHOLD = 0.5;
const FRUIT_PREDICT_API_URL = process.env.FRUIT_PREDICT_API_URL || "http://127.0.0.1:5000/predict-fruit";
const LEAF_PREDICT_API_URL = process.env.LEAF_PREDICT_API_URL || "http://127.0.0.1:5000/predict";

function normalizeConfidence(value) {
  if (typeof value === "number") {
    return value > 1 ? value / 100 : value;
  }

  if (typeof value === "string") {
    const numeric = parseFloat(value.replace("%", "").trim());
    if (!Number.isNaN(numeric)) {
      return numeric > 1 ? numeric / 100 : numeric;
    }
  }

  return 0;
}

function translateWithMyMemory(text, targetLanguage) {
  return new Promise((resolve, reject) => {
    const langpair = targetLanguage === "Hindi" ? "en|hi" : "hi|en";
    const encodedText = encodeURIComponent(text || "");
    const url = `https://api.mymemory.translated.net/get?q=${encodedText}&langpair=${langpair}`;

    https.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed && parsed.responseData && parsed.responseData.translatedText) {
            resolve(parsed.responseData.translatedText);
          } else {
            reject(new Error("Missing translatedText"));
          }
        } catch (parseError) {
          reject(parseError);
        }
      });
    }).on("error", reject);
  });
}

app.post("/translate", async (req, res) => {
  const { text, target_language } = req.body;
  if (!text || !target_language) {
    return res.status(400).json({ translated_text: "Translation failed" });
  }

  let target = "English";
  if (typeof target_language === "string" && target_language.toLowerCase() === "hindi") {
    target = "Hindi";
  }

  try {
    const translatedText = await translateWithMyMemory(text, target);
    return res.json({ translated_text: translatedText || "Translation failed" });
  } catch (error) {
    console.error("MyMemory translation error:", error);
    return res.json({ translated_text: "Translation failed" });
  }
});

app.post("/chat", async (req, res) => {
  const logEntry = `CHAT HIT ${new Date().toISOString()} body=${JSON.stringify(req.body)}\n`;
  fs.appendFileSync(path.join(__dirname, "chat-debug.log"), logEntry);
  const message = req.body?.message;
  if (!message) {
    const errEntry = `CHAT ERROR missing message ${new Date().toISOString()} body=${JSON.stringify(req.body)}\n`;
    fs.appendFileSync(path.join(__dirname, "chat-debug.log"), errEntry);
    return res.status(400).json({ error: "Missing message" });
  }

  fs.appendFileSync(path.join(__dirname, "chat-debug.log"), `CHAT MESSAGE ${new Date().toISOString()} message=${message}\n`);
  if (!HUGGING_FACE_API_KEY) {
    fs.appendFileSync(path.join(__dirname, "chat-debug.log"), `CHAT ERROR missing api key ${new Date().toISOString()}\n`);
    return res.status(500).json({ error: "Chat service unavailable" });
  }

  const payload = {
    model: HUGGING_FACE_MODEL,
    messages: [
      {
        role: "system",
        content: "You are FarmAlert assistant. Answer user questions about crop alerts, pests, diseases, and farm guidance in a friendly and concise way."
      },
      {
        role: "user",
        content: message
      }
    ],
    temperature: 0.7,
    max_tokens: 180
  };

  try {
    console.log("Calling Hugging Face router:", HUGGING_FACE_ROUTER, HUGGING_FACE_MODEL);
    const hfResponse = await fetch(HUGGING_FACE_ROUTER, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HUGGING_FACE_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    console.log("Hugging Face router status:", hfResponse.status, hfResponse.statusText);
    const rawBody = await hfResponse.text();
    let responseBody;
    try {
      responseBody = JSON.parse(rawBody);
    } catch (parseError) {
      console.error("Failed to parse Hugging Face response JSON:", rawBody);
      throw parseError;
    }

    if (!hfResponse.ok) {
      console.error("Hugging Face router error:", responseBody);
      return res.status(502).json({ error: "Chat service error", details: responseBody });
    }

    const reply = responseBody?.choices?.[0]?.message?.content || responseBody?.choices?.[0]?.text || JSON.stringify(responseBody);
    return res.json({ reply: reply || "Sorry, the chat service did not return a message." });
  } catch (error) {
    console.error("Chat endpoint error:", error.stack || error);
    return res.status(502).json({ error: "Chat request failed" });
  }
});

app.get("/weather/geocode", async (req, res) => {
  const city = String(req.query?.city || "").trim();
  if (!city) {
    return res.status(400).json({ error: "City query is required" });
  }

  if (!WEATHER_API_KEY) {
    return res.status(500).json({ error: "Weather service key is missing" });
  }

  try {
    const response = await axios.get("https://api.openweathermap.org/geo/1.0/direct", {
      params: {
        q: city,
        limit: 1,
        appid: WEATHER_API_KEY
      },
      timeout: 10000
    });

    const first = Array.isArray(response.data) ? response.data[0] : null;
    if (!first) {
      return res.status(404).json({ error: "City not found" });
    }

    return res.json({
      name: first.name,
      country: first.country,
      lat: first.lat,
      lon: first.lon
    });
  } catch (error) {
    const message = error?.response?.data?.message || "Unable to resolve city";
    return res.status(502).json({ error: message });
  }
});

app.get("/weather/current", async (req, res) => {
  const city = String(req.query?.city || "").trim();

  if (!city) {
    return res.status(400).json({ error: "City query is required" });
  }

  if (!WEATHER_API_KEY) {
    return res.status(500).json({ error: "Weather service key is missing" });
  }

  try {
    const response = await axios.get("https://api.openweathermap.org/data/2.5/weather", {
      params: {
        q: city,
        units: "metric",
        appid: WEATHER_API_KEY
      },
      timeout: 10000
    });

    return res.json(response.data);
  } catch (error) {
    const message = error?.response?.data?.message || "Unable to load current weather";
    return res.status(502).json({ error: message });
  }
});

app.get("/weather/reverse-geocode", async (req, res) => {
  const lat = Number(req.query?.lat);
  const lon = Number(req.query?.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: "Valid lat and lon are required" });
  }

  if (!WEATHER_API_KEY) {
    return res.status(500).json({ error: "Weather service key is missing" });
  }

  try {
    const response = await axios.get("https://api.openweathermap.org/geo/1.0/reverse", {
      params: {
        lat,
        lon,
        limit: 1,
        appid: WEATHER_API_KEY
      },
      timeout: 10000
    });

    const first = Array.isArray(response.data) ? response.data[0] : null;
    if (!first) {
      return res.status(404).json({ error: "Location not found" });
    }

    return res.json({
      name: first.name,
      country: first.country,
      state: first.state,
      lat: first.lat,
      lon: first.lon
    });
  } catch (error) {
    const message = error?.response?.data?.message || "Unable to resolve location";
    return res.status(502).json({ error: message });
  }
});

app.get("/weather/by-coords", async (req, res) => {
  const lat = Number(req.query?.lat);
  const lon = Number(req.query?.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: "Valid lat and lon are required" });
  }

  if (!WEATHER_API_KEY) {
    return res.status(500).json({ error: "Weather service key is missing" });
  }

  try {
    const [currentResponse, forecastResponse] = await Promise.all([
      axios.get("https://api.openweathermap.org/data/2.5/weather", {
        params: {
          lat,
          lon,
          units: "metric",
          appid: WEATHER_API_KEY
        },
        timeout: 10000
      }),
      axios.get("https://api.openweathermap.org/data/2.5/forecast", {
        params: {
          lat,
          lon,
          units: "metric",
          appid: WEATHER_API_KEY
        },
        timeout: 10000
      })
    ]);

    return res.json({
      current: currentResponse.data,
      forecast: forecastResponse.data
    });
  } catch (error) {
    const message = error?.response?.data?.message || "Unable to fetch weather data";
    return res.status(502).json({ error: message });
  }
});

app.post("/analyze", upload.single("image"), async (req, res) => {
  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: "Image file is required." });
  }

  if (!req.file.mimetype || !req.file.mimetype.startsWith("image/")) {
    return res.status(400).json({ error: "Invalid file type. Please upload a valid image." });
  }

  const tempDir = os.tmpdir();
  const safeExt = req.file.mimetype.split("/")[1]?.replace(/[^a-zA-Z0-9]/g, "") || "png";
  const tempImagePath = path.join(tempDir, `farm-alert-${Date.now()}.${safeExt}`);

  try {
    fs.writeFileSync(tempImagePath, req.file.buffer);

    const pythonScriptPath = path.join(__dirname, "..", "python_api", "analyze_image_api.py");
    const pythonExeCandidates = [
      path.join(__dirname, "..", "python_api", ".venv_clean", "Scripts", "python.exe"),
      path.join(__dirname, "..", "python_api", ".venv311", "Scripts", "python.exe"),
      path.join(__dirname, "..", ".venv-1", "Scripts", "python.exe"),
      path.join(__dirname, "..", "python_api", ".venv", "Scripts", "python.exe"),
      path.join(__dirname, "..", ".venv", "Scripts", "python.exe")
    ];
    const pythonExe = pythonExeCandidates.find(p => fs.existsSync(p)) || "python";
    if (pythonExe === "python") {
      console.warn("Warning: No project-specific Python executable found. Falling back to system python.");
    } else {
      console.log(`Using Python executable: ${pythonExe}`);
    }

    function runAnalyzerScript(args = []) {
      return new Promise((resolve, reject) => {
        execFile(pythonExe, [pythonScriptPath, ...args], { timeout: PYTHON_ANALYSIS_TIMEOUT }, (error, stdout, stderr) => {
          if (error) {
            if (stderr) console.error("stderr:", stderr);
            const stderrMessage = stderr ? stderr.toString().trim().split('\n').slice(-3).join(' ') : error.message;
            reject(new Error(`Image analysis failed. ${stderrMessage}`));
            return;
          }

          try {
            resolve(JSON.parse(stdout));
          } catch (parseError) {
            console.error("Python output parse error:", parseError, "stdout:", stdout);
            reject(new Error("Failed to parse analysis output."));
          }
        });
      });
    }

    let analysisResult;
    try {
      const typeResult = await runAnalyzerScript([tempImagePath, "--detect-only"]);
      if (typeResult?.error) {
        return res.status(400).json({ error: typeResult.error });
      }
      const detectedType = typeResult?.type;

      if (detectedType === "non_plant") {
        return res.status(400).json({
          error: "Image does not look like a clear plant leaf or fruit.",
          suggestion: "Please upload a close-up image focused on a single affected leaf or fruit with less background."
        });
      }

      if (detectedType !== "leaf" && detectedType !== "fruit") {
        return res.status(400).json({
          error: `Unsupported image type: ${detectedType || "unknown"}`,
          suggestion: "Please upload a clear plant leaf or fruit image for analysis."
        });
      }

      if (detectedType === "fruit") {
        console.log("Node -> Python API call started:", FRUIT_PREDICT_API_URL);
        const formData = new FormData();
        try {
          formData.append("image", req.file.buffer, {
            filename: req.file.originalname || "fruit-image.jpg",
            contentType: req.file.mimetype || "application/octet-stream"
          });

          const fruitResponse = await axios.post(FRUIT_PREDICT_API_URL, formData, {
            headers: formData.getHeaders(),
            timeout: PYTHON_ANALYSIS_TIMEOUT
          });

          const fruitResult = fruitResponse.data || {};
          analysisResult = {
            type: "fruit",
            model_used: "fruit_model",
            disease: fruitResult.disease,
            confidence: normalizeConfidence(fruitResult.confidence),
            suggestion: fruitResult.suggestion || "Use appropriate fungicide and isolate infected fruits.",
            low_confidence: normalizeConfidence(fruitResult.confidence) < LOW_CONFIDENCE_THRESHOLD
          };
          console.log("Node -> Python API call success. Confidence:", analysisResult.confidence);
        } catch (fruitApiError) {
          const apiMessage = fruitApiError?.response?.data?.message || fruitApiError.message;
          console.error("Node -> Python API call failed:", apiMessage);
          analysisResult = {
            type: "fruit",
            model_used: "fruit_model",
            confidence: 0,
            low_confidence: true,
            message: "Fruit model not loaded properly",
            suggestion: "Start Python API at http://127.0.0.1:5000 and ensure fruit_model.h5 is available.",
            details: apiMessage
          };
        }
      } else {
        console.log("Node -> Flask leaf API call started:", LEAF_PREDICT_API_URL);
        const formData = new FormData();
        try {
          formData.append("image", req.file.buffer, {
            filename: req.file.originalname || "leaf-image.jpg",
            contentType: req.file.mimetype || "application/octet-stream"
          });

          const leafResponse = await axios.post(LEAF_PREDICT_API_URL, formData, {
            headers: formData.getHeaders(),
            timeout: PYTHON_ANALYSIS_TIMEOUT
          });

          const leafResult = leafResponse.data || {};
          const leafConfidence = normalizeConfidence(leafResult.confidence);
          analysisResult = {
            type: "leaf",
            model_used: "leaf_model",
            disease: leafResult.disease,
            confidence: leafConfidence,
            suggestion: leafResult.solution || leafResult.suggestion || "Monitor the crop for 2-3 days and consult a local agriculture expert for confirmation.",
            low_confidence: leafConfidence < LOW_CONFIDENCE_THRESHOLD
          };
          console.log("Node -> Flask leaf API success. Confidence:", analysisResult.confidence);
        } catch (leafApiError) {
          const apiMessage = leafApiError?.response?.data?.error || leafApiError?.response?.data?.message || leafApiError.message;
          console.warn("Node -> Flask leaf API call failed, falling back to local analyzer:", apiMessage);
          analysisResult = await runAnalyzerScript([tempImagePath]);
        }
      }
    } finally {
      try {
        fs.unlinkSync(tempImagePath);
      } catch (cleanupError) {
        console.warn("Could not delete temp image:", cleanupError.message);
      }
    }

    if (!analysisResult || typeof analysisResult !== "object") {
      return res.status(502).json({ error: "Invalid analyzer response." });
    }

    if (analysisResult.error) {
      return res.status(400).json(analysisResult);
    }

    console.log("Detected type:", analysisResult.type || "unknown");
    console.log("Model selected:", analysisResult.model_used || "none");
    console.log("Confidence:", analysisResult.confidence ?? "N/A");

    const confidence = Number(analysisResult.confidence);
    if (!Number.isNaN(confidence) && confidence < LOW_CONFIDENCE_THRESHOLD) {
      analysisResult.low_confidence = true;
      analysisResult.message = analysisResult.message || "Low confidence. Unable to detect disease.";
      delete analysisResult.disease;
      if (!analysisResult.suggestion) {
        analysisResult.suggestion = "Upload a clearer image with proper focus";
      }
    }

    return res.json(analysisResult);
  } catch (error) {
    console.error("Analyze endpoint error:", error);
    try {
      fs.unlinkSync(tempImagePath);
    } catch (_) {}
    return res.status(502).json({ error: error.message || "Image analysis failed." });
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Image is too large. Maximum allowed size is 10MB." });
    }
    return res.status(400).json({ error: error.message });
  }
  return next(error);
});

// Redirect common auth paths back to the correct login or root page.
app.get("/auth/", (req, res) => {
  res.redirect("/auth/login.html");
});

app.get("/auth/index.html", (req, res) => {
  res.redirect("/auth/login.html");
});

// Handle root path - redirect to login
app.get("/", (req, res) => {
  res.redirect("/auth/login.html");
});

// Middleware to log all requests
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

let data = [];
try {
  const fileContent = fs.readFileSync(dataFilePath, "utf-8").trim();
  if (fileContent) {
    data = JSON.parse(fileContent);
  }
} catch (err) {
  data = [];
}

// Detect if text contains Hindi characters
function isHindi(text) {
  const hindiRegex = /[\u0900-\u097F]/g;
  return hindiRegex.test(text);
}

// Hindi guidance function with crop-specific diseases
function getHindiGuidance(crop, problem) {
  const text = problem.toLowerCase();
  const cropType = crop.toLowerCase();
  
  // RICE (धान)
  if (cropType.includes("rice") || cropType.includes("dhaan") || cropType.includes("धान")) {
    if (text.includes("brown spot") || text.includes("brown spots") || text.includes("धब्बा")) {
      return {
        "रोग_या_कीट": "लीफ ब्लास्ट (धान का झुलसा रोग)",
        "कारण": "यह एक फफूंदी रोग है जो अधिक नमी और खेत में पानी भरे रहने से फैलता है",
        "समाधान": "ट्राइसाइक्लाजोल (2.5 ग्राम प्रति 10 लीटर पानी) का छिड़काव करें। संक्रमित पत्तियों को हटा दें। यह दवा हर 5-7 दिन में लगाएं।",
        "रोकथाम": "खेत में जल निकासी अच्छी रखें। पौधों के बीच सही दूरी रखें। रोग-रोधी किस्में लगाएं। अधिक नाइट्रोजन न दें।"
      };
    }
    if (text.includes("sheath") || text.includes("म्यान")) {
      return {
        "रोग_या_कीट": "शीथ ब्लाइट (पत्ती म्यान का रोग)",
        "कारण": "यह फफूंदी रोग नमी वाले मौसम में तेजी से फैलता है",
        "समाधान": "हेक्साकोनाज़ोल (2 मिली प्रति 10 लीटर) या मैनकोजेब (20 ग्राम प्रति 10 लीटर) का छिड़काव करें",
        "रोकथाम": "खेत में हवा का आना-जाना सुनिश्चित करें। अधिक पानी न दें। संक्रमित पुरानी पत्तियों को हटा दें।"
      };
    }
  }
  
  // WHEAT (गेहूँ)
  if (cropType.includes("wheat") || cropType.includes("gehun") || cropType.includes("गेहूँ")) {
    if (text.includes("rust") || text.includes("गेरुई")) {
      return {
        "रोग_या_कीट": "पत्ती गेरुई रोग (लीफ रस्ट)",
        "कारण": "यह फफूंदी रोग गर्म और नम मौसम में फैलता है। हवा से बीजाणु फैलते हैं।",
        "समाधान": "हेक्साकोनाज़ोल (2 मिली प्रति 10 लीटर) या प्रोपिकोनाज़ोल (10 मिली प्रति 10 लीटर) का छिड़काव करें। हर 7 दिन में दोहराएं।",
        "रोकथाम": "रोग-रोधी किस्में लगाएं। अधिक नाइट्रोजन न दें। बीज उपचार करें। खेत साफ रखें।"
      };
    }
    if (text.includes("powdery") || text.includes("सफेद") || text.includes("उपजी")) {
      return {
        "रोग_या_कीट": "चूर्णिल आसिता (पाउडरी मिल्ड्यू)",
        "कारण": "यह फफूंदी रोग ठंडे और सूखे मौसम में होता है",
        "समाधान": "गंधक का चूर्ण (सल्फर डस्ट) डालें या हेक्साकोनाज़ोल का छिड़काव करें। 7 दिन के अंतराल पर दोहराएं।",
        "रोकथाम": "अधिक नाइट्रोजन न दें। पौधों के बीच सही दूरी रखें। खेत में हवा का आवागमन सुनिश्चित करें।"
      };
    }
  }
  
  // COTTON (कपास)
  if (cropType.includes("cotton") || cropType.includes("kapas") || cropType.includes("कपास")) {
    if (text.includes("aphid") || text.includes("माहू")) {
      return {
        "रोग_या_कीट": "कपास की माहू (कॉटन एफिड)",
        "कारण": "छोटे नरम कीट जो पत्तियों का रस चूसते हैं और पत्तियों को पीला कर देते हैं",
        "समाधान": "इमिडाक्लोप्रिड (5 मिली प्रति 10 लीटर) या नीम का तेल (5%) का छिड़काव करें। 7-10 दिन के बाद फिर छिड़काव करें।",
        "रोकथाम": "खेत में पीले रंग के चिपचिपे जाल लगाएं। संक्रमित पत्तियों को हटा दें। खेत की सफाई रखें।"
      };
    }
    if (text.includes("wilt") || text.includes("सूखा") || text.includes("फ्यूजेरियम")) {
      return {
        "रोग_या_कीट": "कपास का विल्ट रोग (फ्यूजेरियम विल्ट)",
        "कारण": "यह मिट्टी में उपस्थित फफूंद से होने वाला रोग है। जड़ें सड़ जाती हैं।",
        "समाधान": "इस रोग का कोई इलाज नहीं है। संक्रमित पौधों को तुरंत निकाल दें। जलाकर नष्ट करें।",
        "रोकथाम": "3 साल का फसल चक्र अपनाएं। रोग-रोधी किस्में लगाएं। बीज उपचार जरूर करें।"
      };
    }
  }
  
  // MAIZE (मक्का)
  if (cropType.includes("maize") || cropType.includes("makka") || cropType.includes("मक्का")) {
    if (text.includes("rust") || text.includes("गेरुई")) {
      return {
        "रोग_या_कीट": "मक्का की गेरुई (रस्ट रोग)",
        "कारण": "यह फफूंदी रोग गर्म और नम मौसम में तेजी से फैलता है",
        "समाधान": "हेक्साकोनाज़ोल (2 मिली प्रति 10 लीटर) या प्रोपिकोनाज़ोल का तुरंत छिड़काव करें। जल्दी इलाज जरूरी है।",
        "रोकथाम": "रोग-रोधी किस्में लगाएं। संक्रमित पत्तियों को हटा दें। खेत की सफाई रखें।"
      };
    }
    if (text.includes("blight") || (text.includes("spot") && text.includes("brown"))) {
      return {
        "रोग_या_कीट": "मक्का की लीफ ब्लाइट (उत्तरी पत्ती झुलसा)",
        "कारण": "यह फफूंदी रोग नमी वाले मौसम में होता है",
        "समाधान": "मैनकोजेब (20 ग्राम प्रति 10 लीटर) या हेक्साकोनाज़ोल का छिड़काव करें। बुवाई के 45 दिन बाद से शुरू करें।",
        "रोकथाम": "रोग-रोधी किस्में लगाएं। संक्रमित पत्तियों को हटा दें। खेत में सही जल निकासी रखें।"
      };
    }
  }
  
  // POTATO (आलू)
  if (cropType.includes("potato") || cropType.includes("aloo") || cropType.includes("आलू")) {
    if (text.includes("late blight") || text.includes("पछेती") || text.includes("अंगमारी")) {
      return {
        "रोग_या_कीट": "आलू का पछेती अंगमारी रोग (लेट ब्लाइट)",
        "कारण": "यह फफूंदी रोग बहुत खतरनाक है। ठंडे और गीले मौसम में तेजी से फैलता है।",
        "समाधान": "मेटालेक्सिल (10 मिली प्रति 10 लीटर) या क्लोरोथैलोनिल का त तुरंत छिड़काव करें। हर 5 दिन में दोहराएं।",
        "रोकथाम": "रोग-रोधी किस्में लगाएं। बीज उपचार करें। खेत की सफाई रखें। जल निकासी अच्छी रखें।"
      };
    }
    if (text.includes("early blight") || text.includes("शीघ्र")) {
      return {
        "रोग_या_कीट": "आलू का शीघ्र अंगमारी रोग (अर्ली ब्लाइट)",
        "कारण": "यह फफूंदी रोग पुरानी पत्तियों पर पहले आता है",
        "समाधान": "मैनकोजेब (25 ग्राम प्रति 10 लीटर) या क्लोरोथैलोनिल का छिड़काव करें। हर सप्ताह दोहराएं। नीचे की पत्तियों को हटा दें।",
        "रोकथाम": "खेत में सही दूरी रखें। संक्रमित पत्तियों को हटा दें। अच्छी जल निकासी रखें।"
      };
    }
  }
  
  // GENERAL PESTS
  if (text.includes("aphid") || text.includes("माहू")) {
    return {
      "रोग_या_कीट": "माहू कीट (एफिड्स)",
      "कारण": "छोटे नरम कीट जो पत्तियों का रस चूसते हैं। हवा से एक खेत से दूसरे खेत में आते हैं।",
      "समाधान": "इमिडाक्लोप्रिड (5 मिली प्रति 10 लीटर) का छिड़काव करें या नीम का तेल (5%) का इस्तेमाल करें। 7-10 दिन बाद फिर से लगाएं।",
      "रोकथाम": "पीले चिपचिपे जाल लगाएं। संक्रमित पत्तियों को हटा दें। शत्रु कीटों को बढ़ाएं।"
    };
  }
  
  if (text.includes("mite") || text.includes("घुन")) {
    return {
      "रोग_या_कीट": "माइट्स (मकड़ी के जैसे कीट)",
      "कारण": "छोटे कीट जो पत्तियों पर जाला बनाते हैं और रस चूसते हैं",
      "समाधान": "गीले सल्फर (20 ग्राम प्रति 10 लीटर) का छिड़काव करें या नीम का तेल लगाएं। पत्तियों पर पानी का छिड़काव करके नमी बढ़ाएं।",
      "रोकथाम": "खेत को ठंडा और नम रखें। संक्रमित पत्तियों को हटा दें।"
    };
  }
  
  if (text.includes("worm") || text.includes("सुंडी")) {
    return {
      "रोग_या_कीट": "सुंडी/कैटरपिलर (इल्ली)",
      "कारण": "इल्लियां पत्तियों को खाती हैं और छेद बनाती हैं",
      "समाधान": "स्पिनोसैड (5 मिली प्रति 10 लीटर) का छिड़काव करें या बैसिलस थुरिनजिएनसिस (Bt) का इस्तेमाल करें। संक्रमित पत्तियों को तोड़कर नष्ट करें।",
      "रोकथाम": "हाथ से इल्लियों को चुनकर नष्ट करें। प्रकाश जाल लगाएं।"
    };
  }
  
  // NUTRITIONAL DEFICIENCIES  
  if (text.includes("yellow") && text.includes("leaf")) {
    return {
      "रोग_या_कीट": "पत्तियां पीली पड़ना (नाइट्रोजन कमी या आयरन कमी)",
      "कारण": "नाइट्रोजन की कमी या मिट्टी में आयरन उपलब्ध न होना",
      "समाधान": "अगर पूरी पत्ती पीली है तो यूरिया (20 किग्रा प्रति हेक्टेयर) दें। अगर सिर्फ मध्य की नस हरी है तो आयरन सल्फेट (5 किग्रा प्रति हेक्टेयर) दें।",
      "रोकथाम": "संतुलित खाद दें। बीज उपचार करें।"
    };
  }
  
  // DEFAULT HINDI RESPONSE
  return {
    "रोग_या_कीट": "विस्तृत निरीक्षण आवश्यक है",
    "कारण": "समस्या को सही से समझने के लिए विस्तृत जानकारी चाहिए",
    "समाधान": "अपने जिले के कृषि अधिकारी से मिलकर सही निदान प्राप्त करें।",
    "रोकथाम": "नियमित निरीक्षण करते रहें और समय पर कदम उठाएं।"
  };
}

async function getGuidance(crop, problem, languagePref = "") {
  console.log('🎯 getGuidance called with:', { crop, problem, languagePref });
  console.log('🤖 groq client available:', !!groq);
  if (!groq) {
    // Fallback to static guidance with crop-specific disease identification
    const text = problem.toLowerCase();
    const cropType = crop.toLowerCase();
    
    // RICE-SPECIFIC DISEASES
    if (cropType.includes("rice")) {
      if (text.includes("brown spot") || text.includes("brown spots")) {
        return "Brown Spot (Helminthosporium oryzae): Fungal disease common in rice. Spray with Tricyclazole (2.5g/10L water) or Mancozeb weekly. Remove infected leaves. Ensure proper drainage.";
      }
      if (text.includes("blast") || (text.includes("brown") && text.includes("lesion"))) {
        return "Leaf Blast (Pyricularia grisea): Serious fungal disease. Spray Tricyclazole (2.5g/10L) immediately every 5-7 days. Use blast-resistant varieties. Avoid excess nitrogen.";
      }
      if (text.includes("sheath")) {
        return "Sheath Blight (Thanatephorus cucumeris): Spray with Hexaconazole (2ml/10L) or Mancozeb (20g/10L). Improve air circulation. Avoid waterlogging.";
      }
      if (text.includes("yellow") && text.includes("leaf")) {
        return "Brown Planthopper or Nitrogen deficiency: Check leaf color pattern. If uniform yellow, apply balanced fertilizer. If specific spots, spray for brown planthopper.";
      }
    }
    
    // WHEAT-SPECIFIC DISEASES
    if (cropType.includes("wheat")) {
      if (text.includes("rust")) {
        return "Leaf Rust (Puccinia recondita): Yellow-orange pustules on leaves. Spray Hexaconazole (2ml/10L) or Propiconazole (10ml/10L) weekly. Use resistant varieties.";
      }
      if (text.includes("stripe") && text.includes("rust")) {
        return "Stripe Rust (Puccinia striiformis): Yellow stripes on leaves. Apply Hexaconazole immediately. Don't delay treatment. Repeat every 7 days.";
      }
      if (text.includes("yellow rust")) {
        return "Yellow Rust (Puccinia striiformis): Spray Hexaconazole (2ml/10L) or Tebuconazole. Avoid excess nitrogen. Use resistant wheat varieties.";
      }
      if (text.includes("powdery mildew") || (text.includes("white") && text.includes("powder"))) {
        return "Powdery Mildew (Blumeria graminis): White powdery coating on leaves. Spray Sulfur dust or Hexaconazole. Avoid excessive nitrogen fertilizer.";
      }
    }
    
    // COTTON-SPECIFIC DISEASES
    if (cropType.includes("cotton")) {
      if (text.includes("leaf spot") || text.includes("angular")) {
        return "Angular Leaf Spot (Xanthomonas axonopodis): Brown angular lesions on leaves. Spray Copper Oxychloride (3g/10L) or Mancozeb (20g/10L) weekly.";
      }
      if (text.includes("wilt") || text.includes("fusarium")) {
        return "Fusarium Wilt (Fusarium vasinfectum): Plant wilts despite moisture. No cure - remove infected plants immediately. Practise crop rotation (2-3 years). Use resistant varieties.";
      }
      if (text.includes("boll")) {
        return "Boll Rot or Anthracnose: Spray Carbendazim (10ml/10L) or Propiconazole (10ml/10L) repeatedly. Improve field hygiene.";
      }
      if (text.includes("aphid")) {
        return "Cotton Aphid (Aphis gossypii): Yellow sticky spots on leaves. Spray Imidacloprid (5ml/10L) or Neem oil (5%). Repeat after 7-10 days if needed.";
      }
    }
    
    // TOMATO-SPECIFIC DISEASES
    if (cropType.includes("tomato")) {
      if (text.includes("septoria") || text.includes("leaf spot") || (text.includes("spot") && text.includes("leaf"))) {
        return "Septoria Leaf Spot (Septoria lycopersici): Fungal leaf spot on tomato. Remove infected leaves and avoid overhead watering. Spray Mancozeb or Copper Oxychloride every 7-10 days.";
      }
    }
    
    // MAIZE-SPECIFIC DISEASES
    if (cropType.includes("maize") || cropType.includes("corn")) {
      if (text.includes("ear rot") || text.includes("earrot") || (text.includes("rot") && text.includes("ear"))) {
        return "Corn Ear Rot (Fusarium/Aspergillus): Remove infected ears and destroy them. Improve field hygiene, avoid overhead irrigation, and spray appropriate fungicide at silking stage.";
      }
      if (text.includes("rust") || (text.includes("red") && text.includes("brown"))) {
        return "Rust (Puccinia sorghii): Reddish-brown pustules on leaves. Spray Hexaconazole (2ml/10L) or Propiconazole. Early treatment is critical.";
      }
      if (text.includes("blight") || (text.includes("spot") && text.includes("brown"))) {
        return "Northern Corn Leaf Blight (Setosphaeria turcica): Elongated tan lesions. Spray Mancozeb (20g/10L) or Hexaconazole starting from 45 days after sowing.";
      }
      if (text.includes("wilt") || text.includes("droop")) {
        return "Charcoal Rot or moisture stress: Check soil moisture. If adequate and plant still wilts, remove infected plants. Practice crop rotation.";
      }
    }
    
    // POTATO-SPECIFIC DISEASES
    if (cropType.includes("potato")) {
      if (text.includes("late blight") || (text.includes("brown") && text.includes("water"))) {
        return "Late Blight (Phytophthora infestans): Water-soaked lesions, white mold on underside. URGENT: Spray Metalaxyl (10ml/10L) or Chlorothalonil immediately every 5 days.";
      }
      if (text.includes("early blight") || text.includes("concentric")) {
        return "Early Blight (Alternaria solani): Concentric brown rings on older leaves. Spray Mancozeb (25g/10L) or Chlorothalonil weekly. Remove lower leaves.";
      }
    }
    
    // GENERAL PEST ISSUES
    if (text.includes("aphid")) {
      return "Aphid Infestation: Small soft-bodied insects causing leaf yellowing. Spray Imidacloprid (5ml/10L) or Neem oil (5%) every 7-10 days. Remove heavily infested leaves.";
    }
    if (text.includes("mite")) {
      return "Spider Mite/Mite Infestation: Fine webbing on leaves, yellowing. Spray Wettable Sulfur (20g/10L) or Neem oil. Increase humidity - spray water on foliage.";
    }
    if (text.includes("worm")) {
      return "Caterpillar/Worm Infestation: Visible larvae, holes in leaves. Spray Spinosad (5ml/10L) or Bacillus thuringiensis (Bt). Remove and destroy affected leaves.";
    }
    if (text.includes("scale") || text.includes("mealy bug")) {
      return "Scale Insect/Mealy Bug: White cottony masses or hard scales on stems. Spray Neem oil (5%) or Imidacloprid (5ml/10L). Repeat after 10-14 days.";
    }
    
    // NUTRITIONAL DEFICIENCIES
    if (text.includes("yellow") && text.includes("leaf")) {
      return "Probable Nitrogen Deficiency or Iron Chlorosis: If uniform yellowing, apply Urea (20kg/hectare). If interveinal yellowing (veins green), apply Iron sulphate (5kg/hectare).";
    }
    if (text.includes("purple") || text.includes("red") && text.includes("leaf")) {
      return "Probable Phosphorus Deficiency: Apply DAP or single super phosphate (100kg/hectare). Improve soil pH if acidic.";
    }
    if (text.includes("interveinal") || text.includes("chlorosis")) {
      return "Iron Chlorosis (deficiency): Apply Iron sulphate (2-3kg/hectare) or Iron EDTA spray (2g/10L). Check soil pH - iron unavailable in alkaline soils.";
    }
    
    // ENVIRONMENTAL STRESS
    if (text.includes("wilt") || text.includes("wilting")) {
      return "Wilting - Environmental or Disease: Check soil moisture first. If dry, irrigate immediately. If moist, suspect root disease or Fusarium wilt - check roots for discoloration.";
    }
    if (text.includes("dry") || text.includes("drying") || text.includes("tip")) {
      return "Leaf Drying/Tip Burn: Could be moisture stress or Potassium deficiency. Ensure consistent irrigation. If problem persists, apply Muriate of Potash (50kg/hectare).";
    }
    
    // STRUCTURAL DAMAGE
    if (text.includes("hole") || text.includes("holes")) {
      return "Defoliator Pest (boring insects): Spray Carbaryl (20g/10L) or Spinosad (5ml/10L). Remove heavily damaged leaves. Check entire crop for spread.";
    }
    
    return `Problem with ${crop}: Detailed inspection recommended. Consult your local agricultural extension office or agricultural scientist for accurate diagnosis and treatment plan.`;
  }

  try {
    const prompt = `You are an agriculture expert assistant for farmers.

Your task is to analyze crop problems and provide guidance.

INPUT:
* Crop name: ${crop}
* Symptoms: ${problem}
* Language preference: ${languagePref || 'English'}

LANGUAGE RULES (STRICT):
1. If user input is in Hindi → respond in Hindi.
2. If user input is in English → respond in English.
3. If "Language preference" is provided:
   * Follow it strictly (override everything).
4. Response language must match user language or selected language.

OUTPUT FORMAT (STRICT JSON):
{
"disease_or_pest": "",
"cause": "",
"solution": "",
"prevention": ""
}

IMPORTANT:
* Use simple farmer-friendly language
* Give accurate disease/pest name
* Include both:
  * chemical treatment
  * organic solution
* Do not skip any field
* Do not return plain text

HINDI OUTPUT FORMAT:
{
"रोग_या_कीट": "",
"कारण": "",
"समाधान": "",
"रोकथाम": ""
}

ENGLISH OUTPUT FORMAT:
{
"disease_or_pest": "",
"cause": "",
"solution": "",
"prevention": ""
}

FINAL RULE:
Return ONLY JSON in the correct language.`;

    console.log('🔄 Calling Groq API with model: llama-3.3-70b-versatile');
    console.log('📝 Prompt:', prompt.substring(0, 200) + '...');

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
    });

    console.log('✅ Groq API response received');
    const content = response.choices[0].message.content.trim();
    console.log('📄 Response content:', content.substring(0, 200) + '...');
    const parsed = JSON.parse(content);
    
    if (parsed.रोग_या_कीट !== undefined) {
      return `<b>रोग/कीट:</b> ${parsed.रोग_या_कीट}<br><b>कारण:</b> ${parsed.कारण}<br><b>समाधान:</b> ${parsed.समाधान}<br><b>रोकथाम:</b> ${parsed.रोकथाम}`;
    } else {
      return `<b>Disease/Pest:</b> ${parsed.disease_or_pest || ''}<br><b>Cause:</b> ${parsed.cause || ''}<br><b>Solution:</b> ${parsed.solution || ''}<br><b>Prevention:</b> ${parsed.prevention || ''}`;
    }
  } catch (error) {
    console.error('Error generating guidance:', error);
    // Fallback to static guidance
    const text = problem.toLowerCase();
    if (text.includes("aphid") || text.includes("mite") || text.includes("worm") || text.includes("pest")) {
      return "Use neem oil or insecticidal soap and inspect plants daily for early signs of infestation.";
    }
    if (text.includes("blight") || text.includes("rust") || text.includes("mildew") || text.includes("disease")) {
      return "Remove affected leaves, improve air circulation, and apply a suitable fungicide.";
    }
    if (text.includes("yellow") || text.includes("spot") || text.includes("wilt")) {
      return "Check watering, soil drainage, and apply balanced nutrients. Monitor daily.";
    }
    return "Record the problem clearly and contact an agricultural advisor for specific treatment.";
  }
}

function buildQuickGuidanceFallback(crop, problem) {
  return `Problem reported in ${crop}: ${problem}. Please monitor the field, remove visibly affected leaves, and consult a local agriculture expert for crop-specific treatment.`;
}

async function getGuidanceWithTimeout(crop, problem, languagePref = "", timeoutMs = 3500) {
  const fallback = buildQuickGuidanceFallback(crop, problem);

  try {
    return await Promise.race([
      getGuidance(crop, problem, languagePref),
      new Promise(resolve => setTimeout(() => resolve(fallback), timeoutMs))
    ]);
  } catch (_) {
    return fallback;
  }
}

app.post("/report", upload.single("image"), async (req, res) => {
  const { name, location, crop, problem, language } = req.body;
  console.log('📨 /report endpoint called with:', { name, location, crop, problem, language });

  const resolveUserFromToken = async () => {
    const authHeader = String(req.headers?.authorization || "");
    if (!authHeader.startsWith("Bearer ")) {
      return null;
    }

    try {
      const token = authHeader.slice(7).trim();
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "your-secret-key-change-this");
      if (!decoded?.id) return null;
      const user = await User.findById(decoded.id).select("name email");
      return user || null;
    } catch (_) {
      return null;
    }
  };

  const loggedInUser = await resolveUserFromToken();
  const effectiveName = String(name || loggedInUser?.name || "").trim();
  const effectiveLocation = String(location || "").trim();
  const effectiveCrop = String(crop || "").trim();
  const effectiveProblem = String(problem || "").trim();
  const imageFile = req.file;

  if (!effectiveName || !effectiveLocation || !effectiveCrop || !effectiveProblem) {
    return res.status(400).json({ message: "Please provide name, location, crop and problem." });
  }

  if (imageFile && !String(imageFile.mimetype || "").startsWith("image/")) {
    return res.status(400).json({ message: "Please upload a valid image file." });
  }

  const extensionFromMime = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
  };
  let imageFileName = "";
  if (imageFile) {
    const imageExt = extensionFromMime[String(imageFile.mimetype || "").toLowerCase()] || ".jpg";
    imageFileName = `report-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${imageExt}`;
    const imageFilePath = path.join(reportUploadsDir, imageFileName);

    try {
      await fs.promises.writeFile(imageFilePath, imageFile.buffer);
    } catch (error) {
      console.error("Failed to save report image:", error.message);
      return res.status(500).json({ message: "Unable to store report image." });
    }
  }

  const advice = await getGuidanceWithTimeout(effectiveCrop, effectiveProblem, language, 3500);

  try {
    const reportData = {
      name: effectiveName,
      location: effectiveLocation,
      crop: effectiveCrop,
      problem: effectiveProblem,
      advice,
      imageUrl: imageFileName ? `/uploads/reports/${imageFileName}` : "",
      reportedAt: new Date(),
      userId: loggedInUser?._id || null,
      userEmail: String(loggedInUser?.email || "")
    };

    const savedReport = await new Report(reportData).save();
    
    // Send email in background
    sendEmailToAdmin(savedReport).catch(error => {
      console.error("Background email send failed:", error.message);
    });
    
    res.json({ message: "Report added", report: savedReport });
  } catch (error) {
    console.error("Failed to save report to MongoDB:", error.message);
    res.status(500).json({ message: "Error saving report." });
  }
});

// Hindi guidance endpoint
app.post("/hindi-guidance", (req, res) => {
  const { crop, problem } = req.body;
  if (!crop || !problem) {
    return res.status(400).json({ message: "Please provide crop and problem." });
  }

  const guidance = getHindiGuidance(crop, problem);
  res.json(guidance);
});

// Hindi report submission
app.post("/report-hindi", async (req, res) => {
  const { name, location, crop, problem } = req.body;
  if (!name || !location || !crop || !problem) {
    return res.status(400).json({ message: "कृपया सभी जानकारी प्रदान करें।" });
  }

  const guidance = getHindiGuidance(crop, problem);

  try {
    const reportData = {
      name,
      location,
      crop,
      problem,
      advice: typeof guidance === 'object' ? guidance["समाधान"] : guidance,
      guidance: typeof guidance === 'object' ? JSON.stringify(guidance) : guidance,
      reportedAt: new Date(),
      language: "hindi"
    };

    const savedReport = await new Report(reportData).save();
    res.json({ message: "रिपोर्ट जमा की गई", report: savedReport });
  } catch (error) {
    console.error("Failed to save Hindi report to MongoDB:", error.message);
    res.status(500).json({ message: "रिपोर्ट सहेजने में त्रुटि।" });
  }
});

app.get("/alerts", async (req, res) => {
  try {
    const reports = await Report.find().sort({ reportedAt: -1 }).limit(100);
    res.json(reports);
  } catch (error) {
    res.status(500).json({ message: "Error fetching alerts" });
  }
});

// 👨‍💼 ADMIN ENDPOINTS
// Admin Login
app.post("/api/admin/login", (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123456";
  
  if (password === adminPassword) {
    // Generate admin token
    const adminToken = jwt.sign(
      { isAdmin: true, email: process.env.ADMIN_EMAIL },
      process.env.JWT_SECRET || "your-secret-key-change-this",
      { expiresIn: "24h" }
    );
    return res.json({ 
      message: "Admin logged in",
      adminToken,
      adminEmail: process.env.ADMIN_EMAIL
    });
  }
  res.status(401).json({ message: "Invalid admin password" });
});

// Middleware to check admin token
const checkAdminToken = (req, res, next) => {
  const authHeader = String(req.headers?.authorization || "");
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No admin token provided" });
  }
  
  try {
    const token = authHeader.slice(7).trim();
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your-secret-key-change-this");
    if (!decoded.isAdmin) {
      return res.status(403).json({ message: "Not an admin token" });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid admin token" });
  }
};

// Get all reports
app.get("/api/admin/reports", checkAdminToken, async (req, res) => {
  try {
    const reports = await Report.find().sort({ reportedAt: -1 });
    res.json({
      totalReports: reports.length,
      reports: reports
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching reports" });
  }
});

// Get all users
app.get("/api/admin/users", checkAdminToken, async (req, res) => {
  try {
    const users = await User.find().select("_id name email createdAt");
    res.json({
      totalUsers: users.length,
      users: users.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching users", error: error.message });
  }
});

// Delete a report
app.delete("/api/admin/reports/:id", checkAdminToken, async (req, res) => {
  try {
    const reportId = req.params.id;
    let deletedReport;
    
    if (reportId.match(/^[0-9a-fA-F]{24}$/)) {
      deletedReport = await Report.findByIdAndDelete(reportId);
    } else {
      // Handle legacy numeric IDs
      deletedReport = await Report.findOneAndDelete({ id: parseInt(reportId) });
    }
    
    if (!deletedReport) {
      return res.status(404).json({ message: "Report not found" });
    }
    
    res.json({ 
      message: "Report deleted",
      deletedReport
    });
  } catch (error) {
    res.status(500).json({ message: "Error deleting report" });
  }
});

// Delete a user
app.delete("/api/admin/users/:id", checkAdminToken, async (req, res) => {
  try {
    const userId = req.params.id;
    console.log('🗑️ Attempting to delete user with ID:', userId);
    
    // Validate if userId is a valid MongoDB ObjectId
    if (!userId.match(/^[0-9a-fA-F]{24}$/)) {
      console.error('Invalid MongoDB ObjectId format:', userId);
      return res.status(400).json({ 
        success: false,
        message: "Invalid user ID format" 
      });
    }
    
    // Find and delete the user
    const user = await User.findByIdAndDelete(userId);
    
    if (!user) {
      console.log('User not found with ID:', userId);
      return res.status(404).json({ 
        success: false,
        message: "User not found" 
      });
    }
    
    console.log('✅ User deleted successfully:', user.email, user.name);
    res.json({ 
      success: true,
      message: `User "${user.name}" has been permanently deleted`,
      deletedUser: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('❌ Error deleting user:', error.message);
    console.error('Full error:', error);
    res.status(500).json({ 
      success: false,
      message: "Error deleting user: " + error.message,
      error: error.message 
    });
  }
});

// Get report statistics
app.get("/api/admin/stats", checkAdminToken, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalReports = await Report.countDocuments();
    
    const reports = await Report.find().select("crop reportedAt");
    
    // Count reports by crop
    const cropStats = {};
    reports.forEach(report => {
      cropStats[report.crop] = (cropStats[report.crop] || 0) + 1;
    });
    
    const today = new Date().toDateString();
    const reportsToday = reports.filter(r => new Date(r.reportedAt).toDateString() === today).length;
    
    res.json({
      totalUsers,
      totalReports,
      cropStats,
      reportsToday
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching stats", error: error.message });
  }
});

app.use(express.static(frontendPath, { index: false }));

async function ensureHttpsCredentials() {
  if (fs.existsSync(certKeyPath) && fs.existsSync(certCertPath)) {
    return {
      key: fs.readFileSync(certKeyPath, "utf8"),
      cert: fs.readFileSync(certCertPath, "utf8")
    };
  }

  if (!selfsigned) {
    throw new Error("Missing certificates and selfsigned package is unavailable.");
  }

  fs.mkdirSync(path.dirname(certKeyPath), { recursive: true });
  fs.mkdirSync(path.dirname(certCertPath), { recursive: true });

  const attrs = [{ name: "commonName", value: "localhost" }];
  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    days: 365,
    algorithm: "sha256",
    extensions: [
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" }
        ]
      }
    ]
  });

  const privateKeyPem = pems.private || pems.privateKey;
  const certPem = pems.cert || pems.certificate;
  if (!privateKeyPem || !certPem) {
    throw new Error("Failed to generate HTTPS certificate material.");
  }

  fs.writeFileSync(certKeyPath, privateKeyPem, "utf8");
  fs.writeFileSync(certCertPath, certPem, "utf8");

  return {
    key: privateKeyPem,
    cert: certPem
  };
}

function startHttpOnlyServer() {
  app.listen(port, host, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

async function startHttpsServer() {
  try {
    const credentials = await ensureHttpsCredentials();
    https.createServer(credentials, app).listen(httpsPort, host, () => {
      console.log(`HTTPS server running on https://localhost:${httpsPort}`);
      console.log(`Use this URL on phone: https://<your-laptop-ip>:${httpsPort}`);
    });

    if (httpsRedirectEnabled) {
      http.createServer((req, res) => {
        const hostHeader = String(req.headers.host || `localhost:${port}`).replace(/:\d+$/, "");
        const destination = `https://${hostHeader}:${httpsPort}${req.url || "/"}`;
        res.writeHead(301, { Location: destination });
        res.end();
      }).listen(port, host, () => {
        console.log(`HTTP redirect enabled on http://localhost:${port} -> HTTPS`);
      });
    } else {
      startHttpOnlyServer();
    }
  } catch (error) {
    console.error(`HTTPS startup failed: ${error.message}`);
    console.error("Falling back to HTTP server.");
    startHttpOnlyServer();
  }
}

(async () => {
  if (httpsDevEnabled) {
    await startHttpsServer();
  } else {
    startHttpOnlyServer();
  }
})();
