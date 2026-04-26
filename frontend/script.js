const AUTH_STORAGE_KEY = "farmalert_logged_in";
const PROFILE_STORAGE_KEY = "farmalert_user_profile";
const REPORT_DRAFT_KEY_PREFIX = "farmalert_report_draft";
const DEFAULT_EMAIL = "admin@example.com";
const DEFAULT_PASSWORD = "admin123";

let alertDataCache = [];
let dashboardAlertCache = [];
const API_FALLBACK_ORIGIN = "http://127.0.0.1:3000";
const CHATBOT_SYSTEM_PROMPT = "You are FarmAlert assistant. Answer user questions about crop alerts, pests, diseases, and farm guidance in a friendly and concise way.";

function getApiUrl(path) {
  if (window.location.protocol === "file:") {
    return `${API_FALLBACK_ORIGIN}${path}`;
  }
  try {
    return new URL(path, window.location.origin).href;
  } catch {
    return `${API_FALLBACK_ORIGIN}${path}`;
  }
}

async function fetchApi(path, options = {}) {
  const localUrl = getApiUrl(path);
  const fallbackUrl = `${API_FALLBACK_ORIGIN}${path}`;
  const token = localStorage.getItem("farmalert_token");
  
  // Build headers with JWT token if available
  const headers = {
    ...options.headers
  };
  
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const fetchOptions = { 
    cache: "no-store",
    ...options,
    headers
  };

  // If body is FormData, let the browser set the Content-Type boundary
  if (fetchOptions.body instanceof FormData) {
    delete fetchOptions.headers["Content-Type"];
  } else {
    fetchOptions.headers["Content-Type"] = fetchOptions.headers["Content-Type"] || "application/json";
  }

  async function fetchWithErrorDetails(url) {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      const text = await response.text();
      let serverMessage = text || response.statusText;
      try {
        const parsed = JSON.parse(text);
        serverMessage = parsed.error || parsed.message || serverMessage;
      } catch (_) {}
      const apiError = new Error(serverMessage || response.statusText);
      apiError.status = response.status;
      apiError.serverMessage = serverMessage;
      throw apiError;
    }
    return response;
  }

  try {
    return await fetchWithErrorDetails(localUrl);
  } catch (primaryError) {
    console.warn(`Primary API fetch failed for ${localUrl}:`, primaryError);
    if (localUrl === fallbackUrl) {
      throw primaryError;
    }
    try {
      return await fetchWithErrorDetails(fallbackUrl);
    } catch (fallbackError) {
      console.error(`Fallback API fetch failed for ${fallbackUrl}:`, fallbackError);
      throw fallbackError;
    }
  }
}

function showAlertError(message) {
  const alertContainer = document.getElementById("alerts");
  if (!alertContainer) return;
  alertContainer.innerHTML = `<p class="alert-error">${message}</p>`;
}

function addChatMessage(role, text) {
  const container = document.getElementById("chatMessages");
  if (!container) return;

  const emptyState = container.querySelector(".chat-empty");
  if (emptyState) emptyState.remove();

  const message = document.createElement("div");
  message.className = `chat-message ${role}`;
  message.textContent = text;
  container.appendChild(message);
  container.scrollTop = container.scrollHeight;
}

function setChatStatus(status) {
  const statusEl = document.getElementById("chatStatus");
  if (!statusEl) return;
  statusEl.textContent = status;
}

function isMobileDevice() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function isChatPage() {
  return window.location.pathname.includes("chat.html");
}

function openChatOrToggle() {
  if (isMobileDevice() && !isChatPage()) {
    window.location.href = "chat.html";
    return;
  }
  toggleChatWidget();
}

function toggleChatWidget() {
  const widget = document.getElementById("chatWidget");
  const button = document.getElementById("chatToggleBtn");
  if (!widget) return;
  widget.classList.toggle("active");
  if (widget.classList.contains("active")) {
    document.getElementById("chatInput")?.focus();
    if (button) button.classList.add("active");
  } else {
    if (button) button.classList.remove("active");
    setChatStatus("");
  }
}

async function getChatbotReply(prompt) {
  const payload = {
    message: prompt
  };

  try {
    const response = await fetchApi("/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (result.reply) return result.reply;
    if (result.error) {
      throw new Error(result.error);
    }
    return "Sorry, the chat service did not return a reply.";
  } catch (error) {
    console.error("Chatbot error:", error);
    return "Sorry, I couldn't connect to the chat service. Please try again later.";
  }
}

async function submitChatMessage(event) {
  if (event) event.preventDefault();
  const input = document.getElementById("chatInput");
  if (!input) return;
  const userMessage = input.value.trim();
  if (!userMessage) return;

  addChatMessage("user", userMessage);
  input.value = "";
  input.disabled = true;
  setChatStatus("Typing...");

  const botReply = await getChatbotReply(userMessage);
  addChatMessage("bot", botReply);
  setChatStatus("");
  input.disabled = false;
  input.focus();
}

function showImagePreview(file) {
  const preview = document.getElementById("imagePreview");
  const previewContainer = document.getElementById("imagePreviewContainer");
  const placeholder = previewContainer?.querySelector(".preview-placeholder");

  if (!file || !preview) return;
  preview.src = URL.createObjectURL(file);
  preview.style.display = "block";
  if (placeholder) placeholder.style.display = "none";
}

function isFruitModelUnavailableText(text) {
  const normalized = String(text || "").toLowerCase();
  return normalized.includes("fruit model not loaded")
    || normalized.includes("fruit_model")
    || normalized.includes("fruit model file not found")
    || normalized.includes("fruit disease detection not available");
}

function isServiceUnavailableError(error) {
  const status = Number(error?.status);
  return status === 503 || String(error?.message || "").includes("503");
}

function containsInternalModelErrorText(text) {
  const normalized = String(text || "").toLowerCase();
  return normalized.includes("load error")
    || normalized.includes("error when deserializing")
    || normalized.includes("exception encountered")
    || normalized.includes("tensorflow/keras")
    || normalized.includes("keyword arguments")
    || normalized.includes("mock response")
    || normalized.includes("model was not loaded")
    || normalized.includes("traceback")
    || normalized.includes("fruit model file not found")
    || normalized.includes("fruit class names file not found");
}

function getModelUnavailableMessage(data) {
  const detectedType = String(data?.type || "").toLowerCase();
  if (detectedType === "fruit") {
    return trUI("analysisFruitUnavailable", "Fruit disease detection is not available yet. Please upload a leaf image.");
  }
  return trUI("analysisModelUnavailable", "Prediction model is temporarily unavailable. Please try again in a moment.");
}

window.__lastAnalysisResultData = null;

function trUI(key, fallback) {
  if (typeof t === "function") {
    return t(key) || fallback;
  }
  return fallback;
}

const diseaseNameHindiMap = {
  "Apple___Apple_scab": "सेब - स्कैब रोग",
  "Apple___Black_rot": "सेब - ब्लैक रॉट",
  "Apple___Cedar_apple_rust": "सेब - सीडर एप्पल रस्ट",
  "Apple___healthy": "सेब - स्वस्थ",
  "Potato___Early_blight": "आलू - अर्ली ब्लाइट",
  "Potato___Late_blight": "आलू - लेट ब्लाइट",
  "Potato___healthy": "आलू - स्वस्थ",
  "Tomato___Tomato_mosaic_virus": "टमाटर - मोज़ेक वायरस"
};

function formatDiseaseNameForLanguage(name) {
  const raw = String(name || "").trim();
  if (!raw) return raw;

  const currentLang = typeof getCurrentLanguage === "function" ? getCurrentLanguage() : "en";
  if (currentLang !== "hi") {
    return raw;
  }

  if (diseaseNameHindiMap[raw]) {
    return diseaseNameHindiMap[raw];
  }

  // Fallback formatting for unseen class labels.
  return raw.replace(/___/g, " - ").replace(/_/g, " ");
}

function getAnalyzeFriendlyError(error) {
  const serverMessage = String(error?.serverMessage || error?.message || "");
  if (isFruitModelUnavailableText(serverMessage) || isServiceUnavailableError(error)) {
    return {
      type: "warning",
      text: trUI("analysisFruitUnavailable", "Fruit disease detection is not available yet. Please upload a leaf image.")
    };
  }

  if (
    /does not look like a crop|non_plant|unsupported image type|upload a clear plant leaf|valid leaf/i.test(serverMessage)
  ) {
    return {
      type: "warning",
      text: "This image is not a valid plant sample. Please upload a close, clear leaf or fruit photo."
    };
  }

  if (containsInternalModelErrorText(serverMessage)) {
    return {
      type: "warning",
      text: trUI("analysisModelUnavailable", "Prediction model is temporarily unavailable. Please try again in a moment.")
    };
  }

  return {
    type: "error",
    text: trUI("analysisFailed", "Unable to analyze image right now. Please try again.")
  };
}

async function displayAnalysisResult(data) {
  const result = document.getElementById("analysisResult");
  if (!result) return;

  window.__lastAnalysisResultData = data;

  const payloadMessage = data?.message || data?.error || data?.suggestion || "";
  if (isFruitModelUnavailableText(payloadMessage) || Number(data?.status) === 503) {
    result.innerHTML = `<div class="analysis-warning">${trUI("analysisFruitUnavailable", "Fruit disease detection is not available yet. Please upload a leaf image.")}</div>`;
    return;
  }

  const rawSuggestionText = String(data?.suggestion || data?.solution || "");
  const isMockDisease = String(data?.disease || "").toLowerCase().startsWith("mock:");
  const isFallbackNote = String(data?.note || "").toLowerCase().includes("fallback");
  const hasInternalDetails = containsInternalModelErrorText(payloadMessage)
    || containsInternalModelErrorText(rawSuggestionText)
    || containsInternalModelErrorText(data?.details || "");

  if (isMockDisease || isFallbackNote || hasInternalDetails) {
    result.innerHTML = `<div class="analysis-warning">${getModelUnavailableMessage(data)}</div>`;
    return;
  }

  if (data.error) {
    result.innerHTML = `<div class="analysis-error">${trUI("analysisFailed", "Unable to analyze image right now. Please try again.")}</div>`;
    return;
  }

  const confidenceValue = Number(data.confidence);
  const confidencePercent = Number.isFinite(confidenceValue)
    ? `${(confidenceValue * 100).toFixed(1)}%`
    : "N/A";
  const detectedType = String(data.type || "unknown").toUpperCase();
  const modelUsed = String(data.model_used || "none").toUpperCase();
  const diseaseName = formatDiseaseNameForLanguage(data.disease || "");
  let suggestion = data.suggestion || data.solution || trUI("analysisNotAvailable", "Not available");
  if (typeof getCurrentLanguage === "function" && getCurrentLanguage() === "hi" && suggestion) {
    try {
      suggestion = await translateWithMyMemory(String(suggestion), "Hindi");
    } catch (error) {
      // Keep English suggestion if translation service fails.
    }
  }
  const message = data.message || "";
  const isLowConfidence = data.low_confidence || (Number.isFinite(confidenceValue) && confidenceValue < 0.5);

  const lowConfidenceNote = isLowConfidence
    ? `<div class="result-note">${trUI("analysisLowConfidence", "Low confidence. Please upload a clearer image.")}</div>`
    : "";

  const diseaseRow = !isLowConfidence && diseaseName
    ? `<div class="result-badge">${trUI("analysisDisease", "Disease")}: <strong>${diseaseName}</strong></div>`
    : `<div class="result-badge">${trUI("analysisDisease", "Disease")}: <strong>${trUI("analysisNotAvailable", "Not available")}</strong></div>`;

  result.innerHTML = `
    ${diseaseRow}
    <div class="result-item"><span>${trUI("analysisDetectedType", "Detected type")}:</span> ${detectedType}</div>
    <div class="result-item"><span>${trUI("analysisModelUsed", "Model used")}:</span> ${modelUsed}</div>
    <div class="result-item"><span>${trUI("analysisConfidence", "Confidence")}:</span> ${confidencePercent}</div>
    <div class="result-item"><span>${trUI("analysisSuggestion", "Suggestion")}:</span> ${suggestion}</div>
    ${lowConfidenceNote}
  `;
}

window.refreshAnalysisResultForLanguage = async function refreshAnalysisResultForLanguage() {
  const result = document.getElementById("analysisResult");
  if (!result) return;
  if (!window.__lastAnalysisResultData) return;

  await displayAnalysisResult(window.__lastAnalysisResultData);
};

async function analyzeDiseaseImage() {
  const fileInput = document.getElementById("diseaseImageInput");
  const analyzeButton = document.getElementById("analyzeButton");
  const result = document.getElementById("analysisResult");

  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    if (result) result.innerHTML = `<div class="analysis-error">${trUI("analysisSelectImageFirst", "Please select an image first.")}</div>`;
    return;
  }

  const file = fileInput.files[0];
  if (result) result.innerHTML = `<div class="analysis-loading">${trUI("analysisLoading", "Analyzing image... Please wait.")}</div>`;
  if (analyzeButton) analyzeButton.disabled = true;

  try {
    const formData = new FormData();
    formData.append("image", file);

    const response = await fetchApi("/analyze", {
      method: "POST",
      body: formData
    });

    const data = await response.json();
    await displayAnalysisResult(data);
  } catch (error) {
    console.error("Image analysis failed:", error);
    const friendly = getAnalyzeFriendlyError(error);
    if (result) {
      result.innerHTML = friendly.type === "warning"
        ? `<div class="analysis-warning">${friendly.text}</div>`
        : `<div class="analysis-error">${friendly.text}</div>`;
    }
  } finally {
    if (analyzeButton) analyzeButton.disabled = false;
  }
}

function initializeChatWidget() {
  const form = document.getElementById("chatForm");
  if (!form) return;
  form.addEventListener("submit", submitChatMessage);
  const input = document.getElementById("chatInput");
  input?.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitChatMessage(event);
    }
  });
}

// Check login immediately on page load
(function() {
  const path = window.location.pathname;
  const isLoginPage = path.includes("login.html");
  const isLoggedIn = localStorage.getItem(AUTH_STORAGE_KEY) === "true";

  // If not on login page and not logged in, redirect immediately
  if (!isLoginPage && !isLoggedIn) {
    window.location.href = "/auth/login.html";
  }

  // If on root path and not logged in, redirect immediately
  if ((path === "/" || path === "") && !isLoggedIn) {
    window.location.href = "/auth/login.html";
  }
})();

// Dark mode toggle
function toggleDarkMode() {
  const body = document.body;
  body.classList.toggle("dark-mode");
  
  // Persist dark mode preference
  if (body.classList.contains("dark-mode")) {
    localStorage.setItem("darkMode", "enabled");
  } else {
    localStorage.setItem("darkMode", "disabled");
  }
}

function isLoggedIn() {
  return localStorage.getItem(AUTH_STORAGE_KEY) === "true";
}

function requireLogin() {
  const path = window.location.pathname;
  const isLoginPage = path.includes("login.html") || path === "/" || path === "";
  const token = localStorage.getItem("farmalert_token");
  const isLoggedIn = token !== null && token !== undefined;

  // If not on login page and not logged in, redirect to login
  if (!isLoginPage && !isLoggedIn) {
    window.location.href = "/auth/login.html";
    return;
  }

  // If on root path and not logged in, redirect to login
  if ((path === "/" || path === "") && !isLoggedIn) {
    window.location.href = "/auth/login.html";
    return;
  }
}

function redirectIfLoggedIn() {
  const path = window.location.pathname;
  const token = localStorage.getItem("farmalert_token");
  const isLoggedIn = token !== null && token !== undefined;

  if (path.includes("login.html") && isLoggedIn) {
    window.location.href = "/index.html";
  }
}

function getStoredProfile() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function setStoredProfile(profile) {
  if (!profile || typeof profile !== "object") return;
  const previous = getStoredProfile() || {};
  const incomingName = String(profile.name || "").trim();
  const incomingEmail = String(profile.email || localStorage.getItem("farmalert_user_email") || "").trim().toLowerCase();
  const incomingAvatar = String(profile.avatar || "");

  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({
    id: profile.id || previous.id || localStorage.getItem("farmalert_user_id") || "",
    name: incomingName || String(previous.name || "").trim(),
    email: incomingEmail || String(previous.email || "").trim().toLowerCase(),
    avatar: incomingAvatar || String(previous.avatar || "")
  }));
}

function getEffectiveProfile() {
  const stored = getStoredProfile() || {};
  const email = stored.email || localStorage.getItem("farmalert_user_email") || "";
  const name = stored.name || (email.includes("@") ? email.split("@")[0] : "Farmer");
  return {
    id: stored.id || localStorage.getItem("farmalert_user_id") || "",
    name,
    email,
    avatar: stored.avatar || ""
  };
}

function profileInitials(name, email) {
  const source = String(name || email || "F").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function closeProfileMenu() {
  const menu = document.getElementById("profileMenu");
  if (menu) menu.classList.remove("active");
}

function renderProfileButton(button, profile) {
  if (!button) return;
  button.classList.add("profile-trigger");
  button.removeAttribute("onclick");
  button.title = "Profile";
  button.setAttribute("aria-label", "Open profile menu");
  button.dataset.profileButton = "1";

  const initials = profileInitials(profile.name, profile.email);
  if (profile.avatar) {
    button.innerHTML = `<img src="${escapeAttr(profile.avatar)}" alt="Profile" class="profile-avatar-img">`;
  } else {
    button.innerHTML = `<span class="profile-initials">${escapeHtml(initials)}</span>`;
  }

  if (!button.dataset.profileBound) {
    button.addEventListener("click", event => {
      event.stopPropagation();
      toggleProfileMenu(button);
    });
    button.dataset.profileBound = "1";
  }
}

function ensureProfileMenu() {
  let menu = document.getElementById("profileMenu");
  if (menu) return menu;

  menu = document.createElement("div");
  menu.id = "profileMenu";
  menu.className = "profile-menu";
  menu.innerHTML = `
    <div class="profile-menu-header">
      <div id="profileMenuAvatar" class="profile-menu-avatar"></div>
      <div class="profile-menu-text">
        <p id="profileMenuName" class="profile-menu-name"></p>
        <p id="profileMenuEmail" class="profile-menu-email"></p>
      </div>
    </div>
    <div class="profile-menu-divider"></div>
    <button type="button" id="profileEditBtn" class="profile-menu-item">
      <span class="profile-menu-icon" aria-hidden="true">✏️</span>
      <span class="profile-menu-copy">
        <span class="profile-menu-item-main">Edit Profile</span>
        <span class="profile-menu-item-sub">Update name, email, and photo</span>
      </span>
    </button>
    <button type="button" id="profileLogoutBtn" class="profile-menu-item logout">
      <span class="profile-menu-icon" aria-hidden="true">↪</span>
      <span class="profile-menu-copy">
        <span class="profile-menu-item-main">Logout</span>
        <span class="profile-menu-item-sub">Sign out of your account</span>
      </span>
    </button>
  `;
  document.body.appendChild(menu);

  menu.addEventListener("click", event => {
    event.stopPropagation();
  });

  const editBtn = menu.querySelector("#profileEditBtn");
  const logoutBtn = menu.querySelector("#profileLogoutBtn");
  editBtn?.addEventListener("click", () => {
    closeProfileMenu();
    openProfileModal();
  });
  logoutBtn?.addEventListener("click", logout);

  return menu;
}

function updateProfileMenuContent(profile) {
  const menu = ensureProfileMenu();
  const avatarEl = menu.querySelector("#profileMenuAvatar");
  const nameEl = menu.querySelector("#profileMenuName");
  const emailEl = menu.querySelector("#profileMenuEmail");

  const initials = profileInitials(profile.name, profile.email);
  if (avatarEl) {
    avatarEl.innerHTML = profile.avatar
      ? `<img src="${escapeAttr(profile.avatar)}" alt="Profile" class="profile-avatar-img">`
      : `<span class="profile-initials">${escapeHtml(initials)}</span>`;
  }
  if (nameEl) nameEl.textContent = profile.name || "Farmer";
  if (emailEl) emailEl.textContent = profile.email || "";
}

function toggleProfileMenu(anchorButton) {
  const menu = ensureProfileMenu();
  const rect = anchorButton.getBoundingClientRect();
  menu.style.top = `${Math.round(rect.bottom + 8)}px`;
  menu.style.left = `${Math.max(12, Math.round(rect.right - 250))}px`;
  menu.classList.toggle("active");
}

function ensureProfileModal() {
  let overlay = document.getElementById("profileModalOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "profileModalOverlay";
  overlay.className = "profile-modal-overlay";
  overlay.innerHTML = `
    <div class="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profileModalTitle">
      <div class="profile-modal-header">
        <div>
          <h3 id="profileModalTitle">Edit Profile</h3>
          <p class="profile-modal-subtitle">Update your details and photo shown across the dashboard.</p>
        </div>
        <button type="button" id="profileModalClose" class="close-btn" aria-label="Close">x</button>
      </div>
      <div class="profile-modal-body">
        <div class="profile-hero">
          <div id="profileImagePreview" class="profile-image-preview" role="button" tabindex="0" title="Click to adjust photo"></div>
          <div class="profile-identity">
            <p id="profileMetaName" class="profile-meta-name"></p>
            <p id="profileMetaEmail" class="profile-meta-email"></p>
            <p class="profile-adjust-hint">Click or drag photo to position. Use two fingers to zoom on mobile.</p>
          </div>
        </div>
        <div id="profileAdjustControls" class="profile-adjust-controls">
          <div class="profile-adjust-row">
            <label for="profileZoomInput">Zoom</label>
            <input type="range" id="profileZoomInput" min="1" max="3" step="0.01" value="1">
            <span id="profileZoomValue">1.00x</span>
          </div>
          <div class="profile-adjust-row">
            <label for="profileOffsetXInput">Horizontal</label>
            <input type="range" id="profileOffsetXInput" min="-100" max="100" step="1" value="0">
            <span id="profileOffsetXValue">0%</span>
          </div>
          <div class="profile-adjust-row">
            <label for="profileOffsetYInput">Vertical</label>
            <input type="range" id="profileOffsetYInput" min="-100" max="100" step="1" value="0">
            <span id="profileOffsetYValue">0%</span>
          </div>
          <button type="button" id="profileAdjustReset" class="btn btn-secondary profile-adjust-reset">Reset</button>
        </div>

        <div class="profile-field">
          <label for="profileNameInput">Name</label>
          <input type="text" id="profileNameInput" maxlength="80" placeholder="Your name">
        </div>

        <div class="profile-field">
          <label for="profileEmailInput">Email</label>
          <input type="email" id="profileEmailInput" placeholder="you@example.com">
        </div>

        <div class="profile-field">
          <label for="profileImageInput">Profile Image</label>
          <input type="file" id="profileImageInput" accept="image/*" hidden>
          <label for="profileImageInput" class="profile-file-picker">
            <span class="profile-file-title">Choose photo</span>
            <span class="profile-file-note">JPG or PNG, max 5 MB</span>
          </label>
        </div>
      </div>
      <div class="profile-modal-actions">
        <button type="button" id="profileCancelBtn" class="btn btn-secondary">Cancel</button>
        <button type="button" id="profileSaveBtn" class="btn">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener("click", event => {
    if (event.target === overlay) closeProfileModal();
  });

  overlay.querySelector("#profileModalClose")?.addEventListener("click", closeProfileModal);
  overlay.querySelector("#profileCancelBtn")?.addEventListener("click", closeProfileModal);
  overlay.querySelector("#profileSaveBtn")?.addEventListener("click", saveProfile);
  overlay.querySelector("#profileImageInput")?.addEventListener("change", handleProfileImageChange);
  overlay.querySelector("#profileImagePreview")?.addEventListener("click", toggleAdjustControlsFromPreview);
  overlay.querySelector("#profileImagePreview")?.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleAdjustControlsFromPreview();
    }
  });
  overlay.querySelector("#profileNameInput")?.addEventListener("input", syncProfileMetaWithInputs);
  overlay.querySelector("#profileEmailInput")?.addEventListener("input", syncProfileMetaWithInputs);
  overlay.querySelector("#profileZoomInput")?.addEventListener("input", handleAvatarAdjustInput);
  overlay.querySelector("#profileOffsetXInput")?.addEventListener("input", handleAvatarAdjustInput);
  overlay.querySelector("#profileOffsetYInput")?.addEventListener("input", handleAvatarAdjustInput);
  overlay.querySelector("#profileAdjustReset")?.addEventListener("click", resetAvatarAdjustments);
  const previewEl = overlay.querySelector("#profileImagePreview");
  previewEl?.addEventListener("pointerdown", beginAvatarPreviewDrag);
  previewEl?.addEventListener("pointermove", onAvatarPreviewDrag);
  previewEl?.addEventListener("pointerup", endAvatarPreviewDrag);
  previewEl?.addEventListener("pointercancel", endAvatarPreviewDrag);
  previewEl?.addEventListener("pointerleave", endAvatarPreviewDrag);

  if (!document.body.dataset.profileEscapeBound) {
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        closeProfileModal();
        closeProfileMenu();
      }
    });
    document.body.dataset.profileEscapeBound = "1";
  }

  return overlay;
}

let pendingProfileAvatar = "";
let pendingAvatarSource = "";
let pendingAvatarAdjustments = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0
};
let avatarDragState = {
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  startOffsetX: 0,
  startOffsetY: 0
};
let avatarPointerPositions = new Map();
let avatarPinchState = {
  active: false,
  startDistance: 0,
  startZoom: 1
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setAdjustControlsVisible(visible) {
  const controls = document.getElementById("profileAdjustControls");
  if (controls) {
    controls.classList.toggle("active", Boolean(visible));
  }
}

function toggleAdjustControlsFromPreview() {
  if (!pendingAvatarSource) return;
  const controls = document.getElementById("profileAdjustControls");
  if (!controls) return;
  controls.classList.toggle("active");
}

function updateAdjustLabels() {
  const zoomValue = document.getElementById("profileZoomValue");
  const offsetXValue = document.getElementById("profileOffsetXValue");
  const offsetYValue = document.getElementById("profileOffsetYValue");

  if (zoomValue) zoomValue.textContent = `${pendingAvatarAdjustments.zoom.toFixed(2)}x`;
  if (offsetXValue) offsetXValue.textContent = `${Math.round(pendingAvatarAdjustments.offsetX)}%`;
  if (offsetYValue) offsetYValue.textContent = `${Math.round(pendingAvatarAdjustments.offsetY)}%`;
}

function syncAdjustInputsWithState() {
  const zoomInput = document.getElementById("profileZoomInput");
  const offsetXInput = document.getElementById("profileOffsetXInput");
  const offsetYInput = document.getElementById("profileOffsetYInput");

  if (zoomInput) zoomInput.value = String(pendingAvatarAdjustments.zoom);
  if (offsetXInput) offsetXInput.value = String(pendingAvatarAdjustments.offsetX);
  if (offsetYInput) offsetYInput.value = String(pendingAvatarAdjustments.offsetY);

  updateAdjustLabels();
}

function applyPreviewTransform(preview) {
  const img = preview?.querySelector(".profile-image-preview-img");
  if (!img || !pendingAvatarSource) return;

  const xShift = pendingAvatarAdjustments.offsetX * 0.48;
  const yShift = pendingAvatarAdjustments.offsetY * 0.48;
  img.style.transform = `translate(${xShift}%, ${yShift}%) scale(${pendingAvatarAdjustments.zoom})`;
  img.style.transformOrigin = "center";
}

function isAdjustmentsDefault() {
  return pendingAvatarAdjustments.zoom === 1
    && pendingAvatarAdjustments.offsetX === 0
    && pendingAvatarAdjustments.offsetY === 0;
}

function resetAvatarAdjustments() {
  pendingAvatarAdjustments = {
    zoom: 1,
    offsetX: 0,
    offsetY: 0
  };

  syncAdjustInputsWithState();

  const preview = document.getElementById("profileImagePreview");
  if (preview) {
    renderProfileImagePreview(preview, {
      name: String(document.getElementById("profileNameInput")?.value || "").trim(),
      email: String(document.getElementById("profileEmailInput")?.value || "").trim(),
      avatar: pendingAvatarSource || pendingProfileAvatar
    });
  }
}

function handleAvatarAdjustInput() {
  const zoomInput = document.getElementById("profileZoomInput");
  const offsetXInput = document.getElementById("profileOffsetXInput");
  const offsetYInput = document.getElementById("profileOffsetYInput");

  pendingAvatarAdjustments.zoom = clamp(Number(zoomInput?.value || 1), 1, 3);
  pendingAvatarAdjustments.offsetX = clamp(Number(offsetXInput?.value || 0), -100, 100);
  pendingAvatarAdjustments.offsetY = clamp(Number(offsetYInput?.value || 0), -100, 100);

  updateAdjustLabels();
  const preview = document.getElementById("profileImagePreview");
  applyPreviewTransform(preview);
}

function getPointerDistance() {
  const points = Array.from(avatarPointerPositions.values());
  if (points.length < 2) return 0;
  const a = points[0];
  const b = points[1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

function startPinchIfPossible() {
  if (avatarPointerPositions.size < 2) return;
  const distance = getPointerDistance();
  if (!distance) return;

  avatarPinchState.active = true;
  avatarPinchState.startDistance = distance;
  avatarPinchState.startZoom = pendingAvatarAdjustments.zoom;

  avatarDragState.active = false;
  avatarDragState.pointerId = null;
}

function beginAvatarPreviewDrag(event) {
  if (!pendingAvatarSource) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;

  const preview = event.currentTarget;
  if (!preview) return;

  avatarPointerPositions.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY
  });

  if (avatarPointerPositions.size === 1) {
    avatarDragState.active = true;
    avatarDragState.pointerId = event.pointerId;
    avatarDragState.startX = event.clientX;
    avatarDragState.startY = event.clientY;
    avatarDragState.startOffsetX = pendingAvatarAdjustments.offsetX;
    avatarDragState.startOffsetY = pendingAvatarAdjustments.offsetY;
  } else {
    startPinchIfPossible();
  }

  if (typeof preview.setPointerCapture === "function") {
    preview.setPointerCapture(event.pointerId);
  }

  preview.classList.add("dragging");
  setAdjustControlsVisible(true);
  event.preventDefault();
}

function onAvatarPreviewDrag(event) {
  const preview = event.currentTarget;
  if (!preview) return;

  avatarPointerPositions.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY
  });

  if (avatarPointerPositions.size >= 2) {
    if (!avatarPinchState.active) {
      startPinchIfPossible();
    }

    if (avatarPinchState.active) {
      const distance = getPointerDistance();
      if (distance > 0 && avatarPinchState.startDistance > 0) {
        const nextZoom = avatarPinchState.startZoom * (distance / avatarPinchState.startDistance);
        pendingAvatarAdjustments.zoom = clamp(nextZoom, 1, 3);
        syncAdjustInputsWithState();
        applyPreviewTransform(preview);
      }
      event.preventDefault();
    }
    return;
  }

  if (!avatarDragState.active || event.pointerId !== avatarDragState.pointerId) return;

  const width = preview.clientWidth || 1;
  const height = preview.clientHeight || 1;
  const deltaX = event.clientX - avatarDragState.startX;
  const deltaY = event.clientY - avatarDragState.startY;

  const xPercent = avatarDragState.startOffsetX + (deltaX / width) * 200;
  const yPercent = avatarDragState.startOffsetY + (deltaY / height) * 200;

  pendingAvatarAdjustments.offsetX = clamp(xPercent, -100, 100);
  pendingAvatarAdjustments.offsetY = clamp(yPercent, -100, 100);

  syncAdjustInputsWithState();
  applyPreviewTransform(preview);
  event.preventDefault();
}

function endAvatarPreviewDrag(event) {
  const preview = event.currentTarget;
  avatarPointerPositions.delete(event.pointerId);

  if (avatarDragState.active && event.pointerId === avatarDragState.pointerId) {
    avatarDragState.active = false;
    avatarDragState.pointerId = null;
  }

  if (avatarPinchState.active && avatarPointerPositions.size < 2) {
    avatarPinchState.active = false;
    avatarPinchState.startDistance = 0;
    avatarPinchState.startZoom = pendingAvatarAdjustments.zoom;
  }

  if (preview) {
    if (typeof preview.releasePointerCapture === "function") {
      try {
        preview.releasePointerCapture(event.pointerId);
      } catch (_) {
        // Ignore release errors.
      }
    }
    if (avatarPointerPositions.size === 0) {
      preview.classList.remove("dragging");
    }
  }
}

function buildAdjustedAvatarDataUrl(source, adjustments, size = 320) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Unable to create image canvas"));
        return;
      }

      const baseScale = Math.max(size / image.width, size / image.height);
      const zoom = clamp(Number(adjustments?.zoom || 1), 1, 3);
      const scale = baseScale * zoom;
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;

      const requestedX = (clamp(Number(adjustments?.offsetX || 0), -100, 100) / 100) * (size / 2);
      const requestedY = (clamp(Number(adjustments?.offsetY || 0), -100, 100) / 100) * (size / 2);

      const maxOffsetX = Math.max(0, (drawWidth - size) / 2);
      const maxOffsetY = Math.max(0, (drawHeight - size) / 2);
      const offsetX = clamp(requestedX, -maxOffsetX, maxOffsetX);
      const offsetY = clamp(requestedY, -maxOffsetY, maxOffsetY);

      const drawX = (size - drawWidth) / 2 + offsetX;
      const drawY = (size - drawHeight) / 2 + offsetY;

      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);

      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    image.onerror = () => reject(new Error("Failed to process profile image"));
    image.src = source;
  });
}

function renderProfileImagePreview(preview, profile) {
  if (!preview) return;
  const initials = profileInitials(profile?.name || "", profile?.email || "");
  const avatarSrc = pendingAvatarSource || profile?.avatar || pendingProfileAvatar;
  preview.classList.toggle("has-image", Boolean(avatarSrc));
  preview.innerHTML = avatarSrc
    ? `<img src="${escapeAttr(avatarSrc)}" alt="Profile preview" class="profile-image-preview-img">`
    : `<span class="profile-image-placeholder">${escapeHtml(initials)}</span>`;

  if (avatarSrc) {
    applyPreviewTransform(preview);
  }
}

function syncProfileMetaWithInputs() {
  const name = String(document.getElementById("profileNameInput")?.value || "").trim();
  const email = String(document.getElementById("profileEmailInput")?.value || "").trim();
  const metaName = document.getElementById("profileMetaName");
  const metaEmail = document.getElementById("profileMetaEmail");

  if (metaName) metaName.textContent = name || "Farmer";
  if (metaEmail) metaEmail.textContent = email || "No email";
}

function openProfileModal() {
  const overlay = ensureProfileModal();
  const profile = getEffectiveProfile();
  pendingProfileAvatar = profile.avatar || "";
  pendingAvatarSource = profile.avatar || "";

  const nameInput = overlay.querySelector("#profileNameInput");
  const emailInput = overlay.querySelector("#profileEmailInput");
  const preview = overlay.querySelector("#profileImagePreview");
  const fileInput = overlay.querySelector("#profileImageInput");

  if (nameInput) nameInput.value = profile.name || "";
  if (emailInput) emailInput.value = profile.email || "";
  if (fileInput) fileInput.value = "";

  resetAvatarAdjustments();
  setAdjustControlsVisible(Boolean(pendingAvatarSource));

  renderProfileImagePreview(preview, profile);
  syncProfileMetaWithInputs();

  overlay.classList.add("active");
}

function closeProfileModal() {
  const overlay = document.getElementById("profileModalOverlay");
  if (overlay) overlay.classList.remove("active");
  avatarPointerPositions = new Map();
  avatarPinchState = {
    active: false,
    startDistance: 0,
    startZoom: 1
  };
  avatarDragState.active = false;
  avatarDragState.pointerId = null;
}

function handleProfileImageChange(event) {
  const file = event.target?.files?.[0];
  const preview = document.getElementById("profileImagePreview");
  if (!file || !preview) return;

  const isImage = String(file.type || "").startsWith("image/");
  if (!isImage) {
    alert("Please choose a valid image file.");
    event.target.value = "";
    return;
  }

  const maxBytes = 5 * 1024 * 1024;
  if (file.size > maxBytes) {
    alert("Image is too large. Please choose an image under 5 MB.");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    pendingAvatarSource = String(reader.result || "");
    pendingProfileAvatar = pendingAvatarSource;
    resetAvatarAdjustments();
    setAdjustControlsVisible(true);
    renderProfileImagePreview(preview, {
      name: String(document.getElementById("profileNameInput")?.value || "").trim(),
      email: String(document.getElementById("profileEmailInput")?.value || "").trim(),
      avatar: pendingAvatarSource
    });
  };
  reader.readAsDataURL(file);
}

async function saveProfile() {
  const saveBtn = document.getElementById("profileSaveBtn");
  const originalSaveText = saveBtn?.textContent || "Save";
  const name = String(document.getElementById("profileNameInput")?.value || "").trim();
  const email = normalizeEmail(document.getElementById("profileEmailInput")?.value || "");

  if (!isValidEmail(email)) {
    alert("Please enter a valid email.");
    return;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
  }

  let avatarToSave = pendingProfileAvatar || "";
  if (pendingAvatarSource) {
    if (isAdjustmentsDefault()) {
      avatarToSave = pendingAvatarSource;
    } else {
      try {
        avatarToSave = await buildAdjustedAvatarDataUrl(pendingAvatarSource, pendingAvatarAdjustments);
      } catch (_) {
        avatarToSave = pendingAvatarSource;
      }
    }
  }

  const payload = {
    name,
    email,
    avatar: avatarToSave
  };

  let updatedUser = null;
  try {
    const response = await fetchApi("/api/auth/profile", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    updatedUser = data.user || payload;
  } catch (error) {
    // Keep profile editing available even if backend update fails.
    updatedUser = payload;
  }

  localStorage.setItem("farmalert_user_email", updatedUser.email || email);
  setStoredProfile(updatedUser);
  pendingProfileAvatar = updatedUser.avatar || payload.avatar || "";
  pendingAvatarSource = pendingProfileAvatar;
  applyProfileUI();
  closeProfileModal();

  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = originalSaveText;
  }
}

async function syncProfileFromServer() {
  try {
    const response = await fetchApi("/api/auth/me", { method: "GET" });
    const data = await response.json();
    if (data?.success && data.user) {
      const incoming = {
        id: data.user._id || data.user.id || "",
        name: data.user.name || "",
        email: data.user.email || localStorage.getItem("farmalert_user_email") || "",
        avatar: data.user.avatar || ""
      };
      localStorage.setItem("farmalert_user_email", incoming.email || "");
      if (incoming.id) localStorage.setItem("farmalert_user_id", incoming.id);
      setStoredProfile(incoming);
      return incoming;
    }
  } catch (_) {
    // Best effort only.
  }
  return null;
}

function applyProfileUI() {
  const profile = getEffectiveProfile();
  const triggerButtons = document.querySelectorAll('.header-actions .icon-btn[onclick="logout()"], .header-actions .icon-btn[data-profile-button="1"]');
  triggerButtons.forEach(btn => renderProfileButton(btn, profile));
  updateProfileMenuContent(profile);
}

async function initializeProfileUI() {
  applyProfileUI();
  await syncProfileFromServer();
  applyProfileUI();

  if (!document.body.dataset.profileOutsideClickBound) {
    document.addEventListener("click", () => {
      closeProfileMenu();
    });
    document.body.dataset.profileOutsideClickBound = "1";
  }
}

function isValidEmail(email) {
  const value = normalizeEmail(email);
  if (!value || value.length > 254) return false;

  const parts = value.split("@");
  if (parts.length !== 2) return false;

  const [localPart, domainPart] = parts;
  if (!localPart || !domainPart) return false;
  if (localPart.length > 64) return false;
  if (localPart.startsWith(".") || localPart.endsWith(".")) return false;
  if (domainPart.startsWith(".") || domainPart.endsWith(".")) return false;
  if (value.includes("..")) return false;

  const labels = domainPart.split(".");
  if (labels.length < 2) return false;
  if (!labels.every(label => /^[a-z0-9-]+$/i.test(label) && !label.startsWith("-") && !label.endsWith("-"))) {
    return false;
  }

  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/i.test(tld)) return false;

  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/i.test(value);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getSavedUsers() {
  try {
    return JSON.parse(localStorage.getItem("farmalert_users") || "{}") || {};
  } catch {
    return {};
  }
}

function saveUsers(users) {
  localStorage.setItem("farmalert_users", JSON.stringify(users));
}

function getUserByEmail(email) {
  const normalized = normalizeEmail(email);
  const users = getSavedUsers();
  return users[normalized] || null;
}

function createUser(email, password) {
  const normalized = normalizeEmail(email);
  const users = getSavedUsers();
  users[normalized] = {
    email: normalized,
    password: password
  };
  saveUsers(users);
  return users[normalized];
}

function isOtpStepActive() {
  return document.body.dataset.authOtpStep === "1";
}

function setOtpStep(active, email = "") {
  const otpGroup = document.getElementById("otpGroup");
  const otpInput = document.getElementById("signupOtp");
  const resendOtpBtn = document.getElementById("resendOtpBtn");
  const confirmGroup = document.getElementById("confirmPasswordGroup");
  const confirmInput = document.getElementById("confirmPassword");
  const passwordInput = document.getElementById("password");
  const nameInput = document.getElementById("authName");
  const emailInput = document.getElementById("email");
  const authHint = document.getElementById("authHint");
  const loginBtn = document.getElementById("loginBtn");

  document.body.dataset.authOtpStep = active ? "1" : "0";
  if (active && email) {
    document.body.dataset.authOtpEmail = normalizeEmail(email);
  }
  if (!active) {
    delete document.body.dataset.authOtpEmail;
  }

  if (otpGroup) otpGroup.style.display = active ? "grid" : "none";
  if (resendOtpBtn) resendOtpBtn.style.display = active ? "inline-flex" : "none";
  if (confirmGroup) confirmGroup.style.display = active ? "none" : (getAuthMode() === "signup" ? "grid" : "none");

  if (otpInput) {
    otpInput.required = active;
    otpInput.disabled = !active;
    if (!active) otpInput.value = "";
  }

  if (passwordInput) {
    passwordInput.disabled = active;
    passwordInput.required = !active;
  }

  if (confirmInput) {
    confirmInput.disabled = active;
    confirmInput.required = getAuthMode() === "signup" && !active;
  }

  if (nameInput) {
    nameInput.disabled = active;
  }

  if (emailInput) {
    emailInput.readOnly = false;
  }

  if (loginBtn) {
    const btnText = loginBtn.querySelector(".btn-text");
    if (btnText) {
      btnText.textContent = active ? "Verify OTP" : (getAuthMode() === "signup" ? "Create account" : "Login");
    }
  }

  if (authHint) {
    authHint.textContent = active
      ? "Enter the 6-digit OTP sent to your email to finish signup."
      : (getAuthMode() === "signup"
        ? "Create a FarmAlert account with your name, email, and password."
        : "Sign in with your email and password. You can also set your display name.");
  }
}

function setAuthMode(mode) {
  const isSignup = mode === "signup";
  const loginBtn = document.getElementById("loginBtn");
  const authHint = document.getElementById("authHint");
  const nameGroup = document.getElementById("nameGroup");
  const nameInput = document.getElementById("authName");
  const confirmGroup = document.getElementById("confirmPasswordGroup");
  const authToggleButtons = document.querySelectorAll(".auth-toggle-small");
  const passwordInput = document.getElementById("password");

  document.body.dataset.authMode = mode;
  setOtpStep(false);

  authToggleButtons.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });

  if (confirmGroup) {
    confirmGroup.style.display = isSignup ? "grid" : "none";
  }

  if (nameGroup) {
    nameGroup.style.display = "grid";
  }

  if (nameInput) {
    nameInput.required = isSignup;
    nameInput.placeholder = isSignup ? "Your full name" : "Name (optional)";
  }

  if (passwordInput) {
    passwordInput.placeholder = isSignup ? "Create a password" : "Your password";
  }

  if (loginBtn) {
    const text = isSignup ? "Create account" : "Login";
    loginBtn.querySelector(".btn-text").textContent = text;
  }

  if (authHint) {
    authHint.textContent = isSignup
      ? "Create a FarmAlert account with your name, email, and password."
      : "Sign in with your email and password. You can also set your display name.";
  }

  hideFeedback();
}

function getAuthMode() {
  return document.body.dataset.authMode || "login";
}

function showFeedback(message, type = "error") {
  const feedbackEl = document.getElementById("authFeedback");
  if (!feedbackEl) return;
  feedbackEl.textContent = message;
  feedbackEl.style.display = "block";
  feedbackEl.className = type === "success" ? "error-message success-message" : "error-message";
}

function hideFeedback() {
  const feedbackEl = document.getElementById("authFeedback");
  if (!feedbackEl) return;
  feedbackEl.style.display = "none";
  feedbackEl.textContent = "";
}

async function login(event) {
  if (event) event.preventDefault();

  const nameInput = document.getElementById("authName");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const confirmInput = document.getElementById("confirmPassword");
  const otpInput = document.getElementById("signupOtp");
  const loginBtn = document.getElementById("loginBtn");
  const btnText = loginBtn?.querySelector(".btn-text");
  const btnSpinner = loginBtn?.querySelector(".btn-spinner");
  const mode = getAuthMode();
  const otpStep = mode === "signup" && isOtpStepActive();
  const providedName = String(nameInput?.value || "").trim();
  const email = normalizeEmail(emailInput?.value || "");
  const password = String(passwordInput?.value || "").trim();
  const confirmPassword = String(confirmInput?.value || "").trim();
  const otp = String(otpInput?.value || "").trim();
  const otpTargetEmail = normalizeEmail(document.body.dataset.authOtpEmail || "");

  hideFeedback();

  if (!email || !isValidEmail(email)) {
    showFeedback("Please enter a valid email address.");
    return;
  }

  if (mode === "signup") {
    if (!otpStep) {
      if (!password || password.length < 6) {
        showFeedback("Password must be at least 6 characters long.");
        return;
      }

      if (providedName.length < 2) {
        showFeedback("Please enter your full name.");
        return;
      }

      if (!confirmPassword || password !== confirmPassword) {
        showFeedback("Passwords do not match.");
        return;
      }
    } else {
      if (otpTargetEmail && email !== otpTargetEmail) {
        if (!password || password.length < 6 || !confirmPassword || password !== confirmPassword || providedName.length < 2) {
          setOtpStep(false);
          showFeedback("Email changed. Please confirm your details and click Create account again.");
          return;
        }
      } else if (!/^\d{6}$/.test(otp)) {
        showFeedback("Please enter the 6-digit OTP sent to your email.");
        return;
      }
    }
  } else if (!password || password.length < 6) {
    showFeedback("Password must be at least 6 characters long.");
    return;
  }

  // Show loading state
  if (loginBtn) loginBtn.disabled = true;
  if (btnText) {
    if (mode === "signup") {
      if (otpStep && otpTargetEmail && email !== otpTargetEmail) {
        btnText.textContent = "Sending new OTP...";
      } else {
        btnText.textContent = otpStep ? "Verifying OTP..." : "Creating account...";
      }
    } else {
      btnText.textContent = "Signing in...";
    }
  }
  if (btnSpinner) btnSpinner.style.display = "block";

  try {
    const emailChangedDuringOtp = mode === "signup" && otpStep && otpTargetEmail && email !== otpTargetEmail;
    const endpoint = mode === "signup"
      ? (otpStep
          ? (emailChangedDuringOtp ? "/api/auth/signup" : "/api/auth/verify-signup-otp")
          : "/api/auth/signup")
      : "/api/auth/login";
    const payload = mode === "signup"
      ? (otpStep
          ? (emailChangedDuringOtp
              ? { name: providedName, email, password, confirmPassword }
              : { email, otp })
          : { name: providedName, email, password, confirmPassword })
      : { email, password };

    const response = await fetchApi(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.success) {
      if (mode === "signup" && data.requiresOtp) {
        showFeedback(data.message || "OTP sent. Please verify your email.", "success");
        setOtpStep(true, email);
        if (loginBtn) loginBtn.disabled = false;
        if (btnSpinner) btnSpinner.style.display = "none";
        return;
      }

      const existingProfile = getStoredProfile() || {};
      const resolvedName = String(data.user.name || providedName || existingProfile.name || "").trim();

      // Store token and user info
      localStorage.setItem("farmalert_token", data.token);
      localStorage.setItem("farmalert_logged_in", "true");
      localStorage.setItem("farmalert_user_email", data.user.email);
      localStorage.setItem("farmalert_user_id", data.user.id);
      setStoredProfile({
        id: data.user.id,
        name: resolvedName,
        email: data.user.email || "",
        avatar: data.user.avatar || ""
      });

      if (providedName && providedName !== (data.user.name || "")) {
        try {
          await fetchApi("/api/auth/profile", {
            method: "PUT",
            body: JSON.stringify({
              name: providedName,
              email: data.user.email,
              avatar: data.user.avatar || ""
            })
          });
          setStoredProfile({
            id: data.user.id,
            name: providedName,
            email: data.user.email,
            avatar: data.user.avatar || ""
          });
        } catch (_) {
          // Keep local profile even if server update fails.
        }
      }

      showFeedback(data.message, "success");
      setTimeout(() => window.location.href = "/index.html", 900);
    } else {
      showFeedback(data.message || "Authentication failed. Please try again.");
      if (loginBtn) loginBtn.disabled = false;
      if (btnText) {
        btnText.textContent = mode === "signup"
          ? (otpStep ? "Verify OTP" : "Create account")
          : "Login";
      }
      if (btnSpinner) btnSpinner.style.display = "none";
    }
  } catch (error) {
    console.error("Auth error:", error);
    const msg = String(error?.serverMessage || error?.message || "").trim();
    showFeedback(msg || "Connection error. Please check your connection and try again.");
    if (loginBtn) loginBtn.disabled = false;
    if (btnText) {
      btnText.textContent = mode === "signup"
        ? (otpStep ? "Verify OTP" : "Create account")
        : "Login";
    }
    if (btnSpinner) btnSpinner.style.display = "none";
  }
}

function showError(message) {
  showFeedback(message, "error");
}

function logout() {
  localStorage.removeItem("farmalert_token");
  localStorage.removeItem("farmalert_logged_in");
  localStorage.removeItem("farmalert_user_email");
  localStorage.removeItem("farmalert_user_id");
  localStorage.removeItem(PROFILE_STORAGE_KEY);
  window.location.href = "auth/login.html";
}

function setupLoginForm() {
  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", login);
  }

  const authToggleButtons = document.querySelectorAll(".auth-toggle-small");
  authToggleButtons.forEach(button => {
    button.addEventListener("click", () => setAuthMode(button.dataset.mode || "login"));
  });

  document.body.dataset.authMode = "login";
  setAuthMode("login");

  const togglePassword = document.getElementById("togglePassword");
  if (togglePassword) {
    togglePassword.addEventListener("click", function() {
      const passwordInput = document.getElementById("password");
      if (passwordInput) {
        const type = passwordInput.type === "password" ? "text" : "password";
        passwordInput.type = type;
        this.setAttribute("aria-label", type === "password" ? "Show password" : "Hide password");
      }
    });
  }

  const otpInput = document.getElementById("signupOtp");
  if (otpInput) {
    otpInput.addEventListener("input", () => {
      otpInput.value = otpInput.value.replace(/\D/g, "").slice(0, 6);
    });
  }

  const resendOtpBtn = document.getElementById("resendOtpBtn");
  if (resendOtpBtn) {
    resendOtpBtn.addEventListener("click", async () => {
      const nameInput = document.getElementById("authName");
      const passwordInput = document.getElementById("password");
      const confirmInput = document.getElementById("confirmPassword");
      const emailInput = document.getElementById("email");
      const providedName = String(nameInput?.value || "").trim();
      const email = normalizeEmail(emailInput?.value || "");
      const password = String(passwordInput?.value || "").trim();
      const confirmPassword = String(confirmInput?.value || "").trim();
      const otpTargetEmail = normalizeEmail(document.body.dataset.authOtpEmail || "");
      const changedEmail = isOtpStepActive() && !!otpTargetEmail && email !== otpTargetEmail;

      if (!email || !isValidEmail(email)) {
        showFeedback("Please enter a valid email before resending OTP.");
        return;
      }

      if (changedEmail) {
        if (providedName.length < 2) {
          showFeedback("Please enter your full name.");
          return;
        }
        if (!password || password.length < 6) {
          showFeedback("Password must be at least 6 characters long.");
          return;
        }
        if (!confirmPassword || confirmPassword !== password) {
          showFeedback("Passwords do not match.");
          return;
        }
      }

      resendOtpBtn.disabled = true;
      const originalText = resendOtpBtn.textContent;
      resendOtpBtn.textContent = "Sending...";

      try {
        const endpoint = changedEmail ? "/api/auth/signup" : "/api/auth/resend-signup-otp";
        const body = changedEmail
          ? { name: providedName, email, password, confirmPassword }
          : { email };
        const response = await fetchApi(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        const data = await response.json();
        if (data.success) {
          if (changedEmail) {
            setOtpStep(true, email);
          }
          showFeedback(data.message || "OTP resent successfully.", "success");
        } else {
          showFeedback(data.message || "Unable to resend OTP.");
        }
      } catch (error) {
        const msg = String(error?.serverMessage || error?.message || "").trim();
        showFeedback(msg || "Connection error while resending OTP.");
      } finally {
        resendOtpBtn.disabled = false;
        resendOtpBtn.textContent = originalText;
      }
    });
  }

}


function normalizeSearchQuery(value) {
  if (value == null) return "";
  return String(value).trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightMatch(text, query) {
  const safeText = text == null ? '' : String(text);
  const safeQuery = query == null ? '' : String(query);
  if (!safeQuery || !safeText) return escapeHtml(safeText);
  const normalized = safeText.toLowerCase();
  const start = normalized.indexOf(safeQuery);
  if (start === -1) return escapeHtml(safeText);
  const end = start + safeQuery.length;
  return escapeHtml(safeText.slice(0, start)) +
    '<span class="highlight">' + escapeHtml(safeText.slice(start, end)) + '</span>' +
    escapeHtml(safeText.slice(end));
}

function highlightHtmlText(html, query) {
  const safeHtml = html == null ? '' : String(html);
  const safeQuery = query == null ? '' : String(query);
  if (!safeQuery || !safeHtml) return safeHtml;
  const escapedQuery = escapeRegExp(safeQuery);
  return safeHtml.replace(new RegExp(escapedQuery, 'gi'), match => `<span class="highlight">${match}</span>`);
}

function stripHtmlTags(value) {
  return String(value == null ? "" : value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeGuidanceText(value, maxLength = 260) {
  const plain = stripHtmlTags(value);
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, maxLength).trimEnd()}...`;
}

function formatGuidanceForCard(rawGuidance) {
  let formatted = String(rawGuidance == null ? "" : rawGuidance).trim();
  if (!formatted) return "";

  // Ensure key guidance parts are displayed on separate vertical lines.
  formatted = formatted
    .replace(/\s*(Disease\/Pest:|Cause:|Solution:|Prevention:)/gi, "<br><strong>$1</strong> ")
    .replace(/\s*(रोग\/कीट:|कारण:|समाधान:|रोकथाम:)/g, "<br><strong>$1</strong> ")
    .replace(/^<br>/i, "")
    .replace(/<br>\s*<br>/gi, "<br>");

  return formatted;
}

function formatGuidanceWithBoldHeaders(guidanceText, queryString = "") {
  let html = String(guidanceText == null ? "" : guidanceText).trim();
  if (!html) return "";
  
  // Replace headers with bold versions
  const headerPatterns = [
    { singular: "Disease/Pest", variants: ["Disease/Pest:", "Disease or Pest:", "रोग/कीट:", "রোग/কীট:"] },
    { singular: "Cause", variants: ["Cause:", "कारण:", "কারণ:"] },
    { singular: "Solution", variants: ["Solution:", "समाधान:", "সমাধান:"] },
    { singular: "Prevention", variants: ["Prevention:", "रोकथाम:", "প্রতিরোধ:"] },
  ];
  
  // Count occurrences of each header type
  const headerCounts = {};
  headerPatterns.forEach(pattern => {
    headerCounts[pattern.singular] = 0;
  });
  
  // First pass: count how many times each header appears
  let tempHtml = html;
  headerPatterns.forEach(pattern => {
    pattern.variants.forEach(variant => {
      const regex = new RegExp(`(${variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      const matches = tempHtml.match(regex);
      if (matches) {
        headerCounts[pattern.singular] += matches.length;
      }
    });
  });
  
  // Second pass: replace headers with numbered versions if they appear more than once
  const headerIndices = {};
  headerPatterns.forEach(pattern => {
    headerIndices[pattern.singular] = 0;
  });
  
  let processedHtml = html;
  headerPatterns.forEach(pattern => {
    pattern.variants.forEach(variant => {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escaped})`, 'gi');
      
      if (headerCounts[pattern.singular] > 1) {
        // Multiple occurrences - add numbering
        processedHtml = processedHtml.replace(regex, () => {
          headerIndices[pattern.singular]++;
          return `<strong>${headerIndices[pattern.singular]} ${pattern.singular}:</strong>`;
        });
      } else {
        // Single occurrence - just bold it
        processedHtml = processedHtml.replace(regex, `<strong>${pattern.singular}:</strong>`);
      }
    });
  });
  
  // Split by line breaks and create structured HTML
  const lines = processedHtml.split(/\n+/).filter(line => line.trim());
  const content = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    // Return the line as-is to preserve HTML tags, wrapped in paragraph
    return `<p class="guidance-paragraph">${trimmed}</p>`;
  }).join('');
  
  return content || processedHtml;
}

function splitGuidanceSections(formattedGuidance) {
  const html = String(formattedGuidance == null ? "" : formattedGuidance).trim();
  if (!html) return [];

  const normalizeLabel = (label) => {
    const raw = String(label || "").trim().toLowerCase();
    if (raw === "disease/pest" || raw === "disease or pest" || raw === "रोग/कीट") return "Disease/Pest";
    if (raw === "cause" || raw === "कारण") return "Cause";
    if (raw === "solution" || raw === "समाधान") return "Solution";
    if (raw === "prevention" || raw === "रोकथाम") return "Prevention";
    return String(label || "").trim();
  };

  const compactValue = (value, maxLength = 180) => {
    const plain = stripHtmlTags(value);
    if (plain.length <= maxLength) return plain;
    return `${plain.slice(0, maxLength).trimEnd()}...`;
  };

  const sections = [];
  const pattern = /<strong>\s*([^<:]+):\s*<\/strong>\s*([\s\S]*?)(?=(?:<br>\s*)*<strong>\s*[^<:]+:\s*<\/strong>|$)/gi;
  let match;

  while ((match = pattern.exec(html)) !== null) {
    const label = normalizeLabel(match[1]);
    const value = compactValue(match[2] || "");
    if (label && value) {
      sections.push({ label, value });
    }
  }

  if (sections.length) {
    const deduped = [];
    const seen = new Set();

    sections.forEach(section => {
      const key = section.label.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(section);
    });

    return deduped;
  }

  const plain = stripHtmlTags(html);
  return plain ? [{ label: "Guidance", value: compactValue(plain) }] : [];
}

function toggleAlertCardDetails(button) {
  const card = button?.closest?.(".alert-card");
  if (!card) return;

  const isExpanded = card.classList.toggle("expanded");
  const lang = typeof getCurrentLanguage === "function" ? getCurrentLanguage() : "en";
  button.textContent = isExpanded
    ? (lang === "hi" ? "कम दिखाएं" : "Show less")
    : (lang === "hi" ? "और पढ़ें" : "Read more");
}

function matchesAlertQuery(item, query) {
  if (!query) return true;
  const text = [item.crop, item.location, item.problem, item.name, item.advice]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text.includes(query);
}

function renderAlertCards(items, query) {
  const recentContainer = document.getElementById("recent-alerts");
  if (!recentContainer) return;
  if (!items.length) {
    recentContainer.innerHTML = "<p>No matching alerts found.</p>";
    return;
  }
  recentContainer.innerHTML = items.map(item => buildAlertCard(item, query)).join("");
}

function renderAlertsList(items, query) {
  const alertContainer = document.getElementById("alerts");
  if (!alertContainer) return;
  if (!items.length) {
    alertContainer.innerHTML = "<p>No matching alerts found.</p>";
    return;
  }
  alertContainer.innerHTML = items.map(item => buildAlertCard(item, query)).join("");
}

function setupSearchInputs() {
  const searchBars = document.querySelectorAll('.search-bar input');
  searchBars.forEach(input => {
    input.addEventListener('input', () => {
      const query = normalizeSearchQuery(input.value);
      if (window.location.pathname.includes('alerts.html')) {
        const filtered = alertDataCache.filter(item => matchesAlertQuery(item, query));
        renderAlertsList(filtered, query);
      } else if (window.location.pathname.includes('index.html') || window.location.pathname === "/") {
        const filtered = dashboardAlertCache.filter(item => matchesAlertQuery(item, query));
        renderAlertCards(filtered, query);
      }
    });
  });
}

// Load dark mode preference on page load
window.addEventListener("DOMContentLoaded", () => {
  const path = window.location.pathname;
  const darkMode = localStorage.getItem("darkMode");
  if (darkMode === "enabled") {
    document.body.classList.add("dark-mode");
  }

  // Handle login page
  if (path.includes("login.html")) {
    setupLoginForm();
    return;
  }

  // Check login for all other pages
  requireLogin();
  initializeProfileUI();

  // Handle input placeholders with translations
  document.querySelectorAll("input[data-i18n]").forEach(input => {
    const key = input.getAttribute("data-i18n");
    input.placeholder = t(key);
  });

  setupSearchInputs();
  loadNotifications();
  initializeChatWidget();

  if (path.includes("report.html")) {
    initializeReportFormPersistence();
  }

  const imageInput = document.getElementById("diseaseImageInput");
  const analyzeButton = document.getElementById("analyzeButton");

  if (imageInput) {
    imageInput.addEventListener("change", () => {
      showImagePreview(imageInput.files[0]);
      document.getElementById("analysisResult").innerHTML = "";
    });
  }

  if (analyzeButton) {
    analyzeButton.addEventListener("click", analyzeDiseaseImage);
  }
});

// Notification panel toggle
function toggleNotifications() {
  const panel = document.getElementById("notificationPanel");
  const overlay = document.getElementById("notificationOverlay");
  
  if (panel && overlay) {
    panel.classList.toggle("active");
    overlay.classList.toggle("active");
  }
}

// Sidebar toggle for mobile
function toggleSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const overlay = document.querySelector(".sidebar-overlay");
  
  if (sidebar && overlay) {
    sidebar.classList.toggle("active");
    overlay.classList.toggle("active");
  }
}

// Load notifications from alerts
function updateNotificationBadge(count) {
  document.querySelectorAll(".icon-btn.badge").forEach(btn => {
    if (count > 0) {
      btn.dataset.count = count > 99 ? "99+" : String(count);
    } else {
      btn.removeAttribute("data-count");
    }
  });
}

async function loadNotifications() {
  try {
    const res = await fetchApi("/alerts");
    const data = await res.json();
    const notificationList = document.getElementById("notificationList");
    if (!notificationList) return;

    updateNotificationBadge(data.length);
    if (!data.length) {
      notificationList.innerHTML = "<p class=\"no-notifications\">No new notifications</p>";
      return;
    }

    const lang = getCurrentLanguage();
    const recentNotifications = data.slice(-5).reverse();
    const translatedNotifications = lang === 'hi'
      ? await Promise.all(recentNotifications.map(item => translateAlertItem(item, lang)))
      : recentNotifications;

    notificationList.innerHTML = translatedNotifications.map(item => {
      const time = new Date(item.reportedAt);
      const dateStr = time.toLocaleDateString();
      const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const reporter = item.name ? (lang === 'hi' ? `रिपोर्ट किया गया ${item.name}` : `Reported by ${item.name}`) : (lang === 'hi' ? "रिपोर्टर अज्ञात" : "Reported by unknown");
      const place = item.location ? (lang === 'hi' ? `स्थान: ${item.location}` : `Location: ${item.location}`) : (lang === 'hi' ? "स्थान अज्ञात" : "Location unknown");

      return `
        <div class="notification-item">
          <p class="notification-item-title">${item.crop} - ${item.location || 'Unknown'}</p>
          <p class="notification-item-text">${item.problem}</p>
          <p class="notification-item-meta">${reporter} · ${place}</p>
          <p class="notification-item-time">${dateStr} ${timeStr}</p>
        </div>
      `;
    }).join("");
  } catch (error) {
    updateNotificationBadge(0);
    const notificationList = document.getElementById("notificationList");
    if (notificationList) {
      notificationList.innerHTML = "<p class=\"no-notifications\">Unable to load notifications</p>";
    }
  }
}

// File Upload Handler Functions
function initializeFileUpload() {
  const fileUploadArea = document.getElementById('fileUploadArea');
  const fileInput = document.getElementById('reportImage');
  
  if (!fileUploadArea || !fileInput) return;
  
  // Click to upload
  fileUploadArea.addEventListener('click', () => fileInput.click());
  
  // Drag and drop
  fileUploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileUploadArea.classList.add('drag-over');
  });
  
  fileUploadArea.addEventListener('dragleave', () => {
    fileUploadArea.classList.remove('drag-over');
  });
  
  fileUploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    fileUploadArea.classList.remove('drag-over');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      fileInput.files = files;
      handleFileSelect(files[0]);
    }
  });
  
  // File input change
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  });
}

function handleFileSelect(file) {
  const fileUploadArea = document.getElementById('fileUploadArea');
  const filePreviewContainer = document.getElementById('filePreviewContainer');
  const fileName = document.getElementById('fileName');
  const fileSize = document.getElementById('fileSize');
  const previewImage = document.getElementById('previewImage');
  
  // Validate file
  if (!file.type.startsWith('image/')) {
    alert('Please select a valid image file');
    return;
  }
  
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) {
    alert('File size exceeds 5MB limit');
    return;
  }
  
  // Hide upload area, show preview
  fileUploadArea.style.display = 'none';
  filePreviewContainer.style.display = 'flex';
  
  // Set file name and size
  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);
  
  // Show image preview
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImage.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removeFileUpload() {
  const fileInput = document.getElementById('reportImage');
  const fileUploadArea = document.getElementById('fileUploadArea');
  const filePreviewContainer = document.getElementById('filePreviewContainer');
  
  // Clear file input
  fileInput.value = '';
  
  // Show upload area, hide preview
  fileUploadArea.style.display = 'flex';
  filePreviewContainer.style.display = 'none';
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Initialize file upload on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeFileUpload);
} else {
  initializeFileUpload();
}

async function submitData() {
  const profile = getEffectiveProfile();
  const imageInput = document.getElementById("reportImage");
  const imageFile = imageInput?.files?.[0] || null;
  const submitButton = document.getElementById("reportSubmitBtn");
  const defaultButtonText = submitButton?.textContent || "Submit Report";
  const data = {
    name: document.getElementById("name").value.trim(),
    location: document.getElementById("location").value.trim(),
    crop: document.getElementById("crop").value.trim(),
    problem: document.getElementById("problem").value.trim(),
    language: typeof getCurrentLanguage !== 'undefined' ? (getCurrentLanguage() === 'hi' ? 'Hindi' : 'English') : 'English',
    userId: profile.id || "",
    userEmail: profile.email || ""
  };

  if (!data.name || !data.location || !data.crop || !data.problem) {
    alert("Please fill all required fields before submitting.");
    return;
  }

  if (imageFile && !String(imageFile.type || "").startsWith("image/")) {
    alert("Please upload a valid image file.");
    return;
  }

  const formData = new FormData();
  formData.append("name", data.name);
  formData.append("location", data.location);
  formData.append("crop", data.crop);
  formData.append("problem", data.problem);
  formData.append("language", data.language);
  formData.append("userId", data.userId);
  formData.append("userEmail", data.userEmail);
  if (imageFile) {
    formData.append("image", imageFile);
  }

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Submitting...";
  }

  try {
    const res = await fetchApi("/report", {
      method: "POST",
      body: formData
    });

    const response = await res.json();
    if (!res.ok) {
      throw new Error(response?.message || "Could not submit report.");
    }

    persistReportDraft({
      name: data.name,
      location: data.location,
      crop: data.crop,
      problem: ""
    });
    alert("Report submitted successfully.");
    window.location.href = "alerts.html";
  } catch (error) {
    alert(error?.message || "Could not submit report. Please try again.");
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = defaultButtonText;
    }
  }
}

function getReportDraftStorageKey() {
  const profile = getEffectiveProfile();
  const scopedUser = profile.id || profile.email || "anonymous";
  return `${REPORT_DRAFT_KEY_PREFIX}:${scopedUser}`;
}

function persistReportDraft(draft) {
  const payload = {
    name: String(draft?.name || "").trim(),
    location: String(draft?.location || "").trim(),
    crop: String(draft?.crop || "").trim(),
    problem: String(draft?.problem || "").trim(),
    updatedAt: Date.now()
  };

  localStorage.setItem(getReportDraftStorageKey(), JSON.stringify(payload));
}

function readReportDraft() {
  try {
    const raw = localStorage.getItem(getReportDraftStorageKey());
    const parsed = JSON.parse(raw || "null");
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function initializeReportFormPersistence() {
  const nameInput = document.getElementById("name");
  const locationInput = document.getElementById("location");
  const cropInput = document.getElementById("crop");
  const problemInput = document.getElementById("problem");

  if (!nameInput || !locationInput || !cropInput || !problemInput) return;

  const profile = getEffectiveProfile();
  const draft = readReportDraft();

  if (!nameInput.value.trim()) {
    nameInput.value = String(draft?.name || profile.name || "").trim();
  }
  if (!locationInput.value.trim() && draft?.location) {
    locationInput.value = String(draft.location || "").trim();
  }
  if (!cropInput.value.trim() && draft?.crop) {
    cropInput.value = String(draft.crop || "").trim();
  }
  if (!problemInput.value.trim() && draft?.problem) {
    problemInput.value = String(draft.problem || "").trim();
  }

  const syncDraft = () => {
    persistReportDraft({
      name: nameInput.value,
      location: locationInput.value,
      crop: cropInput.value,
      problem: problemInput.value
    });
  };

  [nameInput, locationInput, cropInput, problemInput].forEach(input => {
    if (!input.dataset.reportDraftBound) {
      input.addEventListener("input", syncDraft);
      input.dataset.reportDraftBound = "1";
    }
  });
}

function getAlertType(problem) {
  const text = problem.toLowerCase();
  if (text.includes("blight") || text.includes("rust") || text.includes("mildew") || text.includes("disease") || text.includes("spot") || text.includes("wilt")) {
    return "Disease";
  }
  return "Pest";
}

// Simple translation dictionary for common agricultural terms
const translationDict = {
  // Crops
  "rice": "चावल",
  "wheat": "गेहूं",
  "maize": "मक्का",
  "corn": "मक्का",
  "cotton": "कपास",
  "sugarcane": "गन्ना",
  "potato": "आलू",
  "tomatoes": "टमाटर",
  "tomato": "टमाटर",
  "onion": "प्याज",
  "onions": "प्याज",
  "leaf blast": "पत्ती ब्लास्ट",
  "blast": "ब्लास्ट",

  // Problems/Diseases
  "fungal infection": "फंगल संक्रमण",
  "due to high humidity": "उच्च नमी के कारण",
  "pest": "कीट",
  "disease": "रोग",
  "yellow": "पीला",
  "yellow leaf": "पीली पत्ती",
  "spot": "धब्बा",
  "spots": "धब्बे",
  "wilt": "मुरझाना",
  "wilting": "मुरझाना",
  "blight": "ब्लाइट",
  "rust": "जंग",
  "mildew": "मिल्ड्यू",
  "aphid": "एफिड",
  "aphids": "एफिड",
  "mite": "माइट",
  "mites": "माइट",
  "worm": "कीड़ा",
  "worms": "कीड़े",
  "leaf problem": "पत्ती की समस्या",
  "rust on leaves": "पत्तियों पर जंग",
  "s;ldkfj": "अमान्य इनपुट",

  // Locations (common Indian locations)
  "nawada": "नवादा",
  "patna": "पटना",
  "delhi": "दिल्ली",
  "mumbai": "मुंबई",

  // Common words
  "on": "पर",
  "in": "में",
  "the": "यह",
  "and": "और",
  "or": "या",
  "of": "का",
  "to": "को",
  "for": "के लिए",
  "with": "के साथ",
  "by": "द्वारा",
  "from": "से",
  "at": "पर",
  "as": "जैसे",
  "is": "है",
  "are": "हैं",
  "was": "था",
  "were": "थे",
  "has": "है",
  "have": "हैं",
  "had": "था",
  "will": "होगा",
  "can": "सकता",
  "cannot": "नहीं सकता",
  "should": "चाहिए",
  "would": "होता",
  "could": "सकता",
  "may": "हो सकता",
  "might": "हो सकता",
  "must": "जरूरी",
  "do": "करो",
  "does": "करता",
  "did": "किया",
  "make": "बनाओ",
  "made": "बनाया",
  "take": "लो",
  "took": "लिया",
  "give": "दो",
  "gave": "दिया",
  "come": "आओ",
  "came": "आया",
  "go": "जाओ",
  "went": "गया",
  "see": "देखो",
  "saw": "देखा",
  "know": "जानो",
  "knew": "जाना",
  "think": "सोचो",
  "thought": "सोचा",
  "say": "कहो",
  "said": "कहा",
  "tell": "बताओ",
  "told": "बताया",
  "work": "काम",
  "worked": "किया",
  "help": "मदद",
  "helped": "मदद की",
  "need": "जरूरत",
  "needed": "जरूरी",
  "want": "चाहता",
  "wanted": "चाहता था",
  "use": "उपयोग",
  "used": "उपयोग किया",
  "find": "खोजो",
  "found": "मिला",
  "look": "देखो",
  "looked": "देखा",
  "ask": "पूछो",
  "asked": "पूछा",
  "try": "कोशिश",
  "tried": "कोशिश की",
  "call": "बुलाओ",
  "called": "बुलाया",
  "turn": "मोड़ो",
  "turned": "मुड़ा",
  "follow": "अनुसरण",
  "followed": "अनुसरण किया",
  "move": "हिलो",
  "moved": "हिला",
  "live": "जीओ",
  "lived": "जिया",
  "believe": "विश्वास",
  "believed": "विश्वास किया",
  "bring": "लाओ",
  "brought": "लाया",
  "happen": "होना",
  "happened": "हुआ",
  "write": "लिखो",
  "wrote": "लिखा",
  "sit": "बैठो",
  "sat": "बैठा",
  "stand": "खड़े हो",
  "stood": "खड़ा",
  "lose": "खोना",
  "lost": "खोया",
  "pay": "भुगतान",
  "paid": "भुगतान किया",
  "meet": "मिलना",
  "met": "मिला",
  "run": "दौड़ना",
  "ran": "दौड़ा",
  "cut": "काटना",
  "cut": "काटा",
  "show": "दिखाना",
  "showed": "दिखाया",
  "carry": "ले जाना",
  "carried": "ले गया",
  "begin": "शुरू",
  "began": "शुरू किया",
  "hear": "सुनना",
  "heard": "सुना",
  "feel": "महसूस",
  "felt": "महसूस किया",
  "become": "बनना",
  "became": "बन गया",
  "leave": "छोड़ना",
  "left": "छोड़ा",
  "put": "रखना",
  "put": "रखा",
  "mean": "मतलब",
  "meant": "मतलब था",
  "keep": "रखना",
  "kept": "रखा",
  "let": "अनुमति",
  "let": "अनुमति दी",
  "begin": "शुरू",
  "began": "शुरू किया",
  "seem": "लगना",
  "seemed": "लगा",
  "help": "मदद",
  "helped": "मदद की",
  "talk": "बात",
  "talked": "बात की",
  "turn": "मोड़",
  "turned": "मुड़ा",
  "start": "शुरू",
  "started": "शुरू किया",
  "might": "हो सकता",
  "might": "हो सकता",
  "close": "बंद",
  "closed": "बंद किया",
  "seem": "लगना",
  "seemed": "लगा",
  "next": "अगला",
  "next": "अगला",
  "hard": "कठिन",
  "hard": "कठिन",
  "open": "खुला",
  "opened": "खोला",
  "appear": "दिखाई देना",
  "appeared": "दिखाई दिया",
  "love": "प्यार",
  "loved": "प्यार किया",
  "consider": "विचार",
  "considered": "विचार किया",
  "expect": "उम्मीद",
  "expected": "उम्मीद की",
  "explain": "समझाना",
  "explained": "समझाया",
  "develop": "विकसित",
  "developed": "विकसित किया",
  "carry": "ले जाना",
  "carried": "ले गया",
  "happen": "होना",
  "happened": "हुआ",
  "offer": "प्रस्ताव",
  "offered": "प्रस्ताव दिया",
  "remember": "याद",
  "remembered": "याद किया",
  "reach": "पहुंचना",
  "reached": "पहुंचा",
  "allow": "अनुमति",
  "allowed": "अनुमति दी",
  "add": "जोड़ना",
  "added": "जोड़ा",
  "spend": "खर्च",
  "spent": "खर्च किया",
  "accept": "स्वीकार",
  "accepted": "स्वीकार किया",
  "decide": "फैसला",
  "decided": "फैसला किया",
  "provide": "प्रदान",
  "provided": "प्रदान किया",
  "appear": "दिखाई देना",
  "appeared": "दिखाई दिया",
  "create": "बनाना",
  "created": "बनाया",
  "require": "आवश्यक",
  "required": "आवश्यक",
  "hope": "आशा",
  "hoped": "आशा की",
  "include": "शामिल",
  "included": "शामिल किया",
  "continue": "जारी",
  "continued": "जारी रखा",
  "change": "बदलना",
  "changed": "बदला",
  "watch": "देखना",
  "watched": "देखा",
  "follow": "अनुसरण",
  "followed": "अनुसरण किया",
  "stop": "रुकना",
  "stopped": "रुका",
  "produce": "उत्पादन",
  "produced": "उत्पादित",
  "stay": "रहना",
  "stayed": "रहा",
  "suggest": "सुझाव",
  "suggested": "सुझाव दिया",
  "raise": "उठाना",
  "raised": "उठाया",
  "return": "वापसी",
  "returned": "वापस आया",
  "explain": "समझाना",
  "explained": "समझाया",
  "choose": "चुनना",
  "chose": "चुना",
  "cause": "कारण",
  "caused": "कारण बना",
  "enough": "पर्याप्त",
  "enough": "पर्याप्त",
  "state": "राज्य",
  "stated": "कहा",
  "increase": "वृद्धि",
  "increased": "बढ़ाया",
  "support": "समर्थन",
  "supported": "समर्थन किया",
  "agree": "सहमत",
  "agreed": "सहमत हुआ",
  "include": "शामिल",
  "included": "शामिल किया",
  "continue": "जारी",
  "continued": "जारी रखा",
  "learn": "सीखना",
  "learned": "सीखा",
  "include": "शामिल",
  "included": "शामिल किया",
  "understand": "समझना",
  "understood": "समझा",
  "reach": "पहुंचना",
  "reached": "पहुंचा",
  "remain": "बना रहना",
  "remained": "बना रहा",
  "lose": "खोना",
  "lost": "खोया",
  "face": "चेहरा",
  "faced": "सामना किया",
  "involve": "शामिल",
  "involved": "शामिल किया",
  "refuse": "इनकार",
  "refused": "इनकार किया",
  "receive": "प्राप्त",
  "received": "प्राप्त किया",
  "improve": "सुधार",
  "improved": "सुधारा",
  "maintain": "बनाए रखना",
  "maintained": "बनाए रखा",
  "watch": "देखना",
  "watched": "देखा",
  "seem": "लगना",
  "seemed": "लगा",
  "attempt": "कोशिश",
  "attempted": "कोशिश की",
  "concern": "चिंता",
  "concerned": "चिंतित",
  "discover": "खोज",
  "discovered": "खोजा",
  "achieve": "प्राप्त",
  "achieved": "प्राप्त किया",
  "obtain": "प्राप्त",
  "obtained": "प्राप्त किया",
  "notice": "नोटिस",
  "noticed": "ध्यान दिया",
  "lead": "नेतृत्व",
  "led": "नेतृत्व किया",
  "listen": "सुनना",
  "listened": "सुना",
  "serve": "सेवा",
  "served": "सेवा की",
  "decide": "फैसला",
  "decided": "फैसला किया",
  "intend": "इरादा",
  "intended": "इरादा था",
  "walk": "चलना",
  "walked": "चला",
  "measure": "माप",
  "measured": "मापा",
  "represent": "प्रतिनिधित्व",
  "represented": "प्रतिनिधित्व किया",
  "apply": "लागू",
  "applied": "लागू किया",
  "contain": "शामिल",
  "contained": "शामिल किया",
  "report": "रिपोर्ट",
  "reported": "रिपोर्ट किया",
  "rise": "वृद्धि",
  "rose": "बढ़ा",
  "break": "टूटना",
  "broke": "टूटा",
  "accept": "स्वीकार",
  "accepted": "स्वीकार किया",
  "depend": "निर्भर",
  "depended": "निर्भर था",
  "determine": "निर्धारित",
  "determined": "निर्धारित किया",
  "prepare": "तैयार",
  "prepared": "तैयार किया",
  "establish": "स्थापित",
  "established": "स्थापित किया",
  "obtain": "प्राप्त",
  "obtained": "प्राप्त किया",
  "assume": "मानना",
  "assumed": "माना",
  "require": "आवश्यक",
  "required": "आवश्यक",
  "identify": "पहचान",
  "identified": "पहचाना",
  "remove": "हटाना",
  "removed": "हटाया",
  "thank": "धन्यवाद",
  "thanked": "धन्यवाद दिया",
  "indicate": "संकेत",
  "indicated": "संकेत दिया",
  "develop": "विकसित",
  "developed": "विकसित किया",
  "reduce": "कम",
  "reduced": "कम किया",
  "prove": "साबित",
  "proved": "साबित किया",
  "perform": "प्रदर्शन",
  "performed": "प्रदर्शन किया",
  "wait": "प्रतीक्षा",
  "waited": "प्रतीक्षा की",
  "replace": "बदलना",
  "replaced": "बदला",
  "avoid": "बचना",
  "avoided": "बचा",
  "kill": "मारना",
  "killed": "मारा",
  "realize": "जागरूक",
  "realized": "जागरूक हुआ",
  "recognize": "पहचानना",
  "recognized": "पहचाना",
  "occur": "होना",
  "occurred": "हुआ",
  "reflect": "परावर्तन",
  "reflected": "परावर्तित",
  "regard": "विचार",
  "regarded": "विचार किया",
  "reveal": "खुलासा",
  "revealed": "खुलासा किया",
  "tend": "झुकाव",
  "tended": "झुका",
  "treat": "इलाज",
  "treated": "इलाज किया",
  "vary": "भिन्न",
  "varied": "भिन्न था",
  "wonder": "आश्चर्य",
  "wondered": "आश्चर्य हुआ",
  "worry": "चिंता",
  "worried": "चिंतित",
  "yield": "उपज",
  "yielded": "उपज दी",
  "affect": "प्रभावित",
  "affected": "प्रभावित किया",
  "argue": "विवाद",
  "argued": "विवाद किया",
  "arise": "उठना",
  "arose": "उठा",
  "arrive": "पहुंचना",
  "arrived": "पहुंचा",
  "base": "आधार",
  "based": "आधारित",
  "benefit": "लाभ",
  "benefited": "लाभ हुआ",
  "bind": "बांधना",
  "bound": "बांधा",
  "check": "जांच",
  "checked": "जांचा",
  "claim": "दावा",
  "claimed": "दावा किया",
  "commit": "समर्पित",
  "committed": "समर्पित किया",
  "complete": "पूर्ण",
  "completed": "पूर्ण किया",
  "concern": "चिंता",
  "concerned": "चिंतित",
  "confirm": "पुष्टि",
  "confirmed": "पुष्टि की",
  "connect": "जोड़ना",
  "connected": "जोड़ा",
  "consist": "समाहित",
  "consisted": "समाहित था",
  "contain": "शामिल",
  "contained": "शामिल किया",
  "contribute": "योगदान",
  "contributed": "योगदान दिया",
  "control": "नियंत्रण",
  "controlled": "नियंत्रित",
  "cost": "लागत",
  "cost": "लागत थी",
  "count": "गिनती",
  "counted": "गिना",
  "cover": "कवर",
  "covered": "कवर किया",
  "deal": "सौदा",
  "dealt": "सौदा किया",
  "decline": "गिरावट",
  "declined": "गिरा",
  "define": "परिभाषित",
  "defined": "परिभाषित किया",
  "deliver": "डिलीवर",
  "delivered": "डिलीवर किया",
  "demand": "मांग",
  "demanded": "मांग की",
  "demonstrate": "प्रदर्शन",
  "demonstrated": "प्रदर्शन किया",
  "describe": "वर्णन",
  "described": "वर्णन किया",
  "design": "डिजाइन",
  "designed": "डिजाइन किया",
  "destroy": "नष्ट",
  "destroyed": "नष्ट किया",
  "develop": "विकसित",
  "developed": "विकसित किया",
  "direct": "सीधा",
  "directed": "निर्देशित",
  "discuss": "चर्चा",
  "discussed": "चर्चा की",
  "draw": "खींचना",
  "drew": "खींचा",
  "drive": "ड्राइव",
  "drove": "ड्राइव किया",
  "drop": "गिराना",
  "dropped": "गिराया",
  "eat": "खाना",
  "ate": "खाया",
  "enable": "सक्षम",
  "enabled": "सक्षम किया",
  "encourage": "प्रोत्साहित",
  "encouraged": "प्रोत्साहित किया",
  "engage": "सगाई",
  "engaged": "सगाई हुई",
  "enhance": "बढ़ाना",
  "enhanced": "बढ़ाया",
  "ensure": "सुनिश्चित",
  "ensured": "सुनिश्चित किया",
  "establish": "स्थापित",
  "established": "स्थापित किया",
  "evaluate": "मूल्यांकन",
  "evaluated": "मूल्यांकन किया",
  "examine": "परीक्षा",
  "examined": "परीक्षा की",
  "exist": "मौजूद",
  "existed": "मौजूद था",
  "expand": "विस्तार",
  "expanded": "विस्तार किया",
  "expect": "उम्मीद",
  "expected": "उम्मीद की",
  "experience": "अनुभव",
  "experienced": "अनुभव किया",
  "explain": "समझाना",
  "explained": "समझाया",
  "explore": "अन्वेषण",
  "explored": "अन्वेषण किया",
  "express": "व्यक्त",
  "expressed": "व्यक्त किया",
  "extend": "विस्तार",
  "extended": "विस्तार किया",
  "fail": "विफल",
  "failed": "विफल हुआ",
  "feature": "विशेषता",
  "featured": "विशेषता थी",
  "fill": "भरना",
  "filled": "भरा",
  "finish": "खत्म",
  "finished": "खत्म किया",
  "focus": "फोकस",
  "focused": "फोकस किया",
  "force": "बल",
  "forced": "बलपूर्वक",
  "forget": "भूलना",
  "forgot": "भूला",
  "form": "फॉर्म",
  "formed": "बनाया",
  "gain": "लाभ",
  "gained": "प्राप्त किया",
  "gather": "इकट्ठा",
  "gathered": "इकट्ठा किया",
  "generate": "उत्पन्न",
  "generated": "उत्पन्न किया",
  "grow": "बढ़ना",
  "grew": "बढ़ा",
  "handle": "हैंडल",
  "handled": "हैंडल किया",
  "harm": "नुकसान",
  "harmed": "नुकसान पहुंचाया",
  "hit": "हिट",
  "hit": "हिट किया",
  "hold": "पकड़ना",
  "held": "पकड़ा",
  "hurt": "दर्द",
  "hurt": "दर्द हुआ",
  "identify": "पहचान",
  "identified": "पहचाना",
  "ignore": "अनदेखा",
  "ignored": "अनदेखा किया",
  "illustrate": "चित्रण",
  "illustrated": "चित्रण किया",
  "imagine": "कल्पना",
  "imagined": "कल्पना की",
  "implement": "लागू",
  "implemented": "लागू किया",
  "imply": "सूचित",
  "implied": "सूचित किया",
  "improve": "सुधार",
  "improved": "सुधारा",
  "include": "शामिल",
  "included": "शामिल किया",
  "indicate": "संकेत",
  "indicated": "संकेत दिया",
  "influence": "प्रभाव",
  "influenced": "प्रभावित",
  "inform": "सूचित",
  "informed": "सूचित किया",
  "introduce": "परिचय",
  "introduced": "परिचय कराया",
  "investigate": "जांच",
  "investigated": "जांच की",
  "invite": "निमंत्रण",
  "invited": "निमंत्रण दिया",
  "involve": "शामिल",
  "involved": "शामिल किया",
  "join": "जोड़ना",
  "joined": "जोड़ा",
  "jump": "कूदना",
  "jumped": "कूदा",
  "kill": "मारना",
  "killed": "मारा",
  "know": "जानना",
  "knew": "जाना",
  "lack": "कमी",
  "lacked": "कमी थी",
  "last": "अंतिम",
  "lasted": "चला",
  "launch": "लॉन्च",
  "launched": "लॉन्च किया",
  "learn": "सीखना",
  "learned": "सीखा",
  "leave": "छोड़ना",
  "left": "छोड़ा",
  "let": "अनुमति",
  "let": "अनुमति दी",
  "lie": "झूठ",
  "lay": "लेटा",
  "like": "पसंद",
  "liked": "पसंद किया",
  "limit": "सीमा",
  "limited": "सीमित",
  "link": "लिंक",
  "linked": "लिंक किया",
  "listen": "सुनना",
  "listened": "सुना",
  "live": "जीना",
  "lived": "जिया",
  "locate": "स्थान",
  "located": "स्थित",
  "look": "देखना",
  "looked": "देखा",
  "lose": "खोना",
  "lost": "खोया",
  "love": "प्यार",
  "loved": "प्यार किया",
  "maintain": "बनाए रखना",
  "maintained": "बनाए रखा",
  "make": "बनाना",
  "made": "बनाया",
  "manage": "प्रबंधन",
  "managed": "प्रबंधन किया",
  "mark": "निशान",
  "marked": "निशान लगाया",
  "matter": "मामला",
  "mattered": "महत्वपूर्ण था",
  "mean": "मतलब",
  "meant": "मतलब था",
  "measure": "माप",
  "measured": "मापा",
  "meet": "मिलना",
  "met": "मिला",
  "mention": "उल्लेख",
  "mentioned": "उल्लेख किया",
  "mind": "दिमाग",
  "minded": "दिमाग था",
  "miss": "मिस",
  "missed": "मिस किया",
  "move": "हिलना",
  "moved": "हिला",
  "need": "जरूरत",
  "needed": "जरूरी",
  "note": "नोट",
  "noted": "नोट किया",
  "notice": "नोटिस",
  "noticed": "ध्यान दिया",
  "obtain": "प्राप्त",
  "obtained": "प्राप्त किया",
  "occur": "होना",
  "occurred": "हुआ",
  "offer": "प्रस्ताव",
  "offered": "प्रस्ताव दिया",
  "open": "खुलना",
  "opened": "खोला",
  "operate": "संचालन",
  "operated": "संचालन किया",
  "order": "आदेश",
  "ordered": "आदेश दिया",
  "organize": "संगठित",
  "organized": "संगठित किया",
  "overcome": "पराजित",
  "overcame": "पराजित किया",
  "own": "स्वयं",
  "owned": "मालिक था",
  "participate": "भागीदारी",
  "participated": "भागीदारी की",
  "pay": "भुगतान",
  "paid": "भुगतान किया",
  "perform": "प्रदर्शन",
  "performed": "प्रदर्शन किया",
  "pick": "चुनना",
  "picked": "चुना",
  "place": "स्थान",
  "placed": "रखा",
  "plan": "योजना",
  "planned": "योजना बनाई",
  "play": "खेलना",
  "played": "खेला",
  "point": "बिंदु",
  "pointed": "इशारा किया",
  "possess": "कब्जा",
  "possessed": "कब्जा था",
  "practice": "अभ्यास",
  "practiced": "अभ्यास किया",
  "prefer": "पसंद",
  "preferred": "पसंद किया",
  "prepare": "तैयार",
  "prepared": "तैयार किया",
  "present": "वर्तमान",
  "presented": "पेश किया",
  "prevent": "रोकना",
  "prevented": "रोका",
  "process": "प्रक्रिया",
  "processed": "प्रक्रिया की",
  "produce": "उत्पादन",
  "produced": "उत्पादित",
  "program": "प्रोग्राम",
  "programmed": "प्रोग्राम किया",
  "promote": "प्रवर्द्धन",
  "promoted": "प्रवर्द्धन किया",
  "protect": "सुरक्षा",
  "protected": "सुरक्षा की",
  "prove": "साबित",
  "proved": "साबित किया",
  "provide": "प्रदान",
  "provided": "प्रदान किया",
  "publish": "प्रकाशित",
  "published": "प्रकाशित किया",
  "pull": "खींचना",
  "pulled": "खींचा",
  "push": "धक्का",
  "pushed": "धक्का दिया",
  "put": "रखना",
  "put": "रखा",
  "qualify": "योग्य",
  "qualified": "योग्य बना",
  "question": "सवाल",
  "questioned": "सवाल किया",
  "quit": "छोड़ना",
  "quit": "छोड़ा",
  "raise": "उठाना",
  "raised": "उठाया",
  "reach": "पहुंचना",
  "reached": "पहुंचा",
  "read": "पढ़ना",
  "read": "पढ़ा",
  "realize": "जागरूक",
  "realized": "जागरूक हुआ",
  "receive": "प्राप्त",
  "received": "प्राप्त किया",
  "recognize": "पहचानना",
  "recognized": "पहचाना",
  "recommend": "सिफारिश",
  "recommended": "सिफारिश की",
  "record": "रिकॉर्ड",
  "recorded": "रिकॉर्ड किया",
  "reduce": "कम",
  "reduced": "कम किया",
  "reflect": "परावर्तन",
  "reflected": "परावर्तित",
  "refuse": "इनकार",
  "refused": "इनकार किया",
  "regard": "विचार",
  "regarded": "विचार किया",
  "relate": "संबंधित",
  "related": "संबंधित था",
  "release": "रिलीज़",
  "released": "रिलीज़ किया",
  "remain": "बना रहना",
  "remained": "बना रहा",
  "remember": "याद",
  "remembered": "याद किया",
  "remove": "हटाना",
  "removed": "हटाया",
  "repeat": "दोहराना",
  "repeated": "दोहराया",
  "replace": "बदलना",
  "replaced": "बदला",
  "reply": "जवाब",
  "replied": "जवाब दिया",
  "report": "रिपोर्ट",
  "reported": "रिपोर्ट किया",
  "represent": "प्रतिनिधित्व",
  "represented": "प्रतिनिधित्व किया",
  "require": "आवश्यक",
  "required": "आवश्यक",
  "research": "अनुसंधान",
  "researched": "अनुसंधान किया",
  "respond": "प्रतिक्रिया",
  "responded": "प्रतिक्रिया दी",
  "result": "परिणाम",
  "resulted": "परिणाम हुआ",
  "return": "वापसी",
  "returned": "वापस आया",
  "reveal": "खुलासा",
  "revealed": "खुलासा किया",
  "ride": "सवारी",
  "rode": "सवारी की",
  "rise": "वृद्धि",
  "rose": "बढ़ा",
  "risk": "जोखिम",
  "risked": "जोखिम लिया",
  "run": "दौड़ना",
  "ran": "दौड़ा",
  "save": "बचाना",
  "saved": "बचाया",
  "say": "कहना",
  "said": "कहा",
  "search": "खोज",
  "searched": "खोज की",
  "see": "देखना",
  "saw": "देखा",
  "seek": "खोजना",
  "sought": "खोजा",
  "select": "चुनना",
  "selected": "चुना",
  "sell": "बेचना",
  "sold": "बेचा",
  "send": "भेजना",
  "sent": "भेजा",
  "serve": "सेवा",
  "served": "सेवा की",
  "set": "सेट",
  "set": "सेट किया",
  "settle": "बसाना",
  "settled": "बसाया",
  "shake": "हिलाना",
  "shook": "हिलाया",
  "share": "साझा",
  "shared": "साझा किया",
  "shift": "शिफ्ट",
  "shifted": "शिफ्ट किया",
  "shoot": "गोलियां चलाना",
  "shot": "गोलियां चलाईं",
  "should": "चाहिए",
  "should": "चाहिए",
  "show": "दिखाना",
  "showed": "दिखाया",
  "shut": "बंद",
  "shut": "बंद किया",
  "sign": "साइन",
  "signed": "साइन किया",
  "sing": "गाना",
  "sang": "गाया",
  "sit": "बैठना",
  "sat": "बैठा",
  "sleep": "सोना",
  "slept": "सोया",
  "slide": "फिसलना",
  "slid": "फिसला",
  "smile": "मुस्कान",
  "smiled": "मुस्कराया",
  "solve": "हल",
  "solved": "हल किया",
  "sort": "सॉर्ट",
  "sorted": "सॉर्ट किया",
  "sound": "ध्वनि",
  "sounded": "ध्वनि हुई",
  "speak": "बोलना",
  "spoke": "बोला",
  "spend": "खर्च",
  "spent": "खर्च किया",
  "split": "विभाजित",
  "split": "विभाजित किया",
  "spread": "फैलाना",
  "spread": "फैलाया",
  "spring": "वसंत",
  "sprang": "उछला",
  "stand": "खड़े होना",
  "stood": "खड़ा",
  "start": "शुरू",
  "started": "शुरू किया",
  "state": "राज्य",
  "stated": "कहा",
  "stay": "रहना",
  "stayed": "रहा",
  "steal": "चोरी",
  "stole": "चोरी की",
  "step": "कदम",
  "stepped": "कदम रखा",
  "stick": "चिपकाना",
  "stuck": "चिपका",
  "stop": "रुकना",
  "stopped": "रुका",
  "strike": "हड़ताल",
  "struck": "हड़ताल की",
  "study": "अध्ययन",
  "studied": "अध्ययन किया",
  "submit": "सबमिट",
  "submitted": "सबमिट किया",
  "succeed": "सफल",
  "succeeded": "सफल हुआ",
  "suffer": "दुख",
  "suffered": "दुख उठाया",
  "suggest": "सुझाव",
  "suggested": "सुझाव दिया",
  "suit": "सूट",
  "suited": "सूट किया",
  "supply": "आपूर्ति",
  "supplied": "आपूर्ति की",
  "support": "समर्थन",
  "supported": "समर्थन किया",
  "suppose": "मानना",
  "supposed": "माना",
  "surprise": "आश्चर्य",
  "surprised": "आश्चर्य हुआ",
  "survive": "बचना",
  "survived": "बचा",
  "suspect": "संदेह",
  "suspected": "संदेह किया",
  "swim": "तैरना",
  "swam": "तैरा",
  "swing": "झूलना",
  "swung": "झूला",
  "take": "लेना",
  "took": "लिया",
  "talk": "बात",
  "talked": "बात की",
  "teach": "सिखाना",
  "taught": "सिखाया",
  "tear": "फाड़ना",
  "tore": "फाड़ा",
  "tell": "बताना",
  "told": "बताया",
  "tend": "झुकाव",
  "tended": "झुका",
  "test": "टेस्ट",
  "tested": "टेस्ट किया",
  "thank": "धन्यवाद",
  "thanked": "धन्यवाद दिया",
  "think": "सोचना",
  "thought": "सोचा",
  "throw": "फेंकना",
  "threw": "फेंका",
  "touch": "छूना",
  "touched": "छुआ",
  "train": "ट्रेन",
  "trained": "ट्रेन किया",
  "transfer": "स्थानांतरण",
  "transferred": "स्थानांतरित",
  "travel": "यात्रा",
  "traveled": "यात्रा की",
  "treat": "इलाज",
  "treated": "इलाज किया",
  "try": "कोशिश",
  "tried": "कोशिश की",
  "turn": "मोड़ना",
  "turned": "मुड़ा",
  "understand": "समझना",
  "understood": "समझा",
  "use": "उपयोग",
  "used": "उपयोग किया",
  "visit": "मिलना",
  "visited": "मिला",
  "vote": "वोट",
  "voted": "वोट दिया",
  "wait": "प्रतीक्षा",
  "waited": "प्रतीक्षा की",
  "wake": "जागना",
  "woke": "जागा",
  "walk": "चलना",
  "walked": "चला",
  "want": "चाहना",
  "wanted": "चाहता था",
  "warn": "चेतावनी",
  "warned": "चेतावनी दी",
  "wash": "धोना",
  "washed": "धोया",
  "watch": "देखना",
  "watched": "देखा",
  "wear": "पहनना",
  "wore": "पहना",
  "win": "जीतना",
  "won": "जीता",
  "wish": "इच्छा",
  "wished": "इच्छा की",
  "wonder": "आश्चर्य",
  "wondered": "आश्चर्य हुआ",
  "work": "काम",
  "worked": "किया",
  "worry": "चिंता",
  "worried": "चिंतित",
  "write": "लिखना",
  "wrote": "लिखा",
  "yield": "उपज",
  "yielded": "उपज दी"
};

function translateToHindi(text) {
  if (text == null) return text;
  const safeText = String(text).trim();
  if (!safeText) return safeText;

  // Handle proper names (locations, names) - don't translate them
  const properNamePattern = /^[A-Z][a-z]+(\s[A-Z][a-z]+)*$/;
  if (properNamePattern.test(safeText)) {
    return safeText; // Keep proper names as is
  }

  // For other text, translate word by word but preserve case structure
  let translated = safeText;

  // Sort keys by length (longest first) to handle multi-word phrases
  const sortedKeys = Object.keys(translationDict).sort((a, b) => b.length - a.length);

  sortedKeys.forEach(english => {
    const hindi = translationDict[english];
    // Use word boundaries and case-insensitive matching
    const regex = new RegExp('\\b' + english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    translated = translated.replace(regex, hindi);
  });

  return translated;
}

async function translateWithMyMemory(text, targetLanguage = "Hindi") {
  if (!text) return text;
  const normalized = String(text).trim().toLowerCase();

  // Prefer exact sentence translations for model suggestions so users get clear Hindi guidance.
  const suggestionMap = {
    "monitor the crop for 2-3 days and consult a local agriculture expert for confirmation.": "फसल को 2-3 दिन तक निगरानी में रखें और पुष्टि के लिए स्थानीय कृषि विशेषज्ञ से परामर्श लें।",
    
    "action needed (check daily): 1. remove all infected leaves and fruits today 2. spray the remaining plant with bordeaux mixture (1%) or copper fungicide 3. stop using water from above - water only at the base 4. spray again after 7-10 days 5. remove infected plants if more than 30% is affected. why? this disease spreads fast in wet weather. act immediately!": "तत्काल कार्रवाई करें (हर दिन देखें): 1. आज ही सभी बीमार पत्तियों और फलों को तोड़कर हटाएं 2. बाकी पौधे पर बोर्डो मिश्रण (1%) या कॉपर दवा का छिड़काव करें 3. ऊपर से पानी देना बंद करें - सिर्फ जड़ के पास पानी दें 4. 7-10 दिन बाद फिर से छिड़काव करें 5. अगर पौधा 30% से ज्यादा बीमार है तो पूरा पौधा निकाल दें। क्यों? यह बीमारी बारिश में तेजी से फैलती है। जल्दी करें!",
    
    "start treatment now: 1. cut and remove all spotted leaves (burn or bury them) 2. spray entire plant with fungicide (mancozeb or captan) 3. make sure air flows between plants - remove extra leaves from bottom 4. repeat spray every 10 days until flowering stops 5. do not touch wet plants - disease spreads easily. tip: remove lowest leaves to improve airflow": "अभी इलाज शुरू करें: 1. सभी धब्बेदार पत्तियों को काटकर जला दें या मिट्टी में दबा दें 2. पूरे पौधे पर मैंकोजेब या कैप्टन दवा का छिड़काव करें 3. पौधों के बीच हवा का प्रवाह बढ़ाएं - नीचे की पत्तियों को हटाएं 4. फूल आने तक हर 10 दिन बाद छिड़काव करें 5. भीगे हुए पौधों को न छुएं - बीमारी आसानी से फैलती है। सुझाव: नीचे की पत्तियों को हटाने से हवा का प्रवाह बेहतर होता है",
    
    "urgent - act today: 1. remove all spotted leaves and fruits (throw away or burn) 2. do not use water sprinklers - water only at roots 3. spray with copper fungicide or bordeaux mixture 4. wash your hands and tools with soap before touching other plants 5. spray again after 7-10 days. warning: spreads through water and touch!": "जरूरी - आज ही करें: 1. सभी धब्बेदार पत्तियों और फलों को हटाएं (जला दें या फेंक दें) 2. ऊपर से पानी न डालें - सिर्फ जड़ों के पास पानी दें 3. कॉपर दवा या बोर्डो मिश्रण का छिड़काव करें 4. दूसरे पौधों को छूने से पहले हाथ और औजारों को साबुन से धोएं 5. 7-10 दिन बाद फिर से छिड़काव करें। चेतावनी: यह बीमारी पानी और स्पर्श से फैलती है!",
    
    "remove infected parts: 1. cut off all infected branches (cut 30cm below the dark spot) 2. burn or bury the cut branches immediately 3. spray the whole tree with copper sulfate or fungicide 4. do this in early morning or late evening 5. repeat spray every 14 days during wet season. best time: spray when weather is dry for 24 hours": "बीमार शाखाओं को हटाएं: 1. सभी बीमार शाखों को काटें (काले धब्बे के नीचे 30cm तक) 2. कटी हुई शाखों को तुरंत जला दें या दबा दें 3. पूरे पेड़ पर कॉपर सल्फेट या दवा का छिड़काव करें 4. यह सुबह जल्दी या शाम को करें 5. बारिश के मौसम में हर 14 दिन बाद छिड़काव दोहराएं। सर्वश्रेष्ठ समय: तब छिड़काव करें जब 24 घंटे तक सूखा रहे",
    
    "critical - act immediately: 1. remove all diseased leaves and plants 2. do not harvest yet - disease will spread to potatoes 3. spray surrounding plants with fungicide now 4. stop overhead watering today 5. spray every 7-10 days for 4 weeks. if more than 25% plant is infected - remove the whole plant": "घातक - अभी तुरंत करें: 1. सभी बीमार पत्तियों और पौधों को निकाल दें 2. अभी तक खोदाई न करें - आलू तक बीमारी पहुंचेगी 3. आसपास के पौधों पर तुरंत दवा का छिड़काव करें 4. ऊपर से पानी देना आज बंद करें 5. 4 हफ्ते तक हर 7-10 दिन बाद छिड़काव करें। अगर पौधा 25% से ज्यादा बीमार है - पूरा पौधा निकाल दें",
    
    "needs attention: 1. remove all infected fruits and leaves (cut and destroy) 2. spray with sulfur dust or copper fungicide 3. repeat spray every 2 weeks until fruit harvest 4. remove any cedar/juniper plants nearby (they help disease spread) 5. clean fallen leaves and fruits. better prevention than cure!": "ध्यान देने की जरूरत है: 1. सभी बीमार फलों और पत्तियों को काटकर फेंक दें 2. गंधक पाउडर या कॉपर दवा का छिड़काव करें 3. फल तोड़ने तक हर 2 हफ्ते में छिड़काव करें 4. पास में देवदार या जुनिपर के पेड़ों को हटा दें (ये बीमारी फैलाते हैं) 5. गिरी हुई पत्तियों और फलों को साफ करें। रोकथाम इलाज से बेहतर है!",
    
    "prevent spread: 1. remove all infected leaves and fruits 2. clean all fallen leaves from ground (bury or burn) 3. spray with sulfur dust in early morning 4. improve air circulation - prune extra branches 5. repeat spray every 10-14 days. clean field = healthy plant": "फैलाव को रोकें: 1. सभी बीमार पत्तियों और फलों को निकाल दें 2. जमीन से सभी गिरी हुई पत्तियों को साफ करें (जला दें या दबा दें) 3. सुबह जल्दी गंधक पाउडर का छिड़काव करें 4. हवा का प्रवाह बेहतर करें - अतिरिक्त शाखों को काटें 5. हर 10-14 दिन बाद छिड़काव दोहराएं। साफ खेत = स्वस्थ पेड़",
    
    "no spray works - remove plant: 1. remove the entire infected plant immediately 2. burn or bury it (do not compost) 3. wash your hands and tools with hot soapy water 4. do not touch other plants for 30 minutes 5. choose virus-resistant seeds for next season. viruses cannot be killed - only removed!": "दवा काम नहीं करेगी - पौधा निकाल दें: 1. पूरे बीमार पौधे को तुरंत निकाल दें 2. जला दें या दबा दें (कंपोस्ट न बनाएं) 3. गर्म साबुन के पानी से हाथ और औजारों को धोएं 4. 30 मिनट के लिए दूसरे पौधों को न छुएं 5. अगली बार वायरस-प्रतिरोधी बीज लगाएं। वायरस को मारा नहीं जा सकता - सिर्फ निकाला जा सकता है!",
    
    "start immediately: 1. remove all brown/spotted lower leaves (up to first flower branch) 2. spray with mancozeb, chlorothalonil, or copper fungicide 3. water only at roots - never from above 4. space plants further apart for better air 5. spray again after 7-10 days. caught early? easy to control!": "अभी शुरू करें: 1. सभी भूरी/धब्बेदार नीचे की पत्तियों को हटाएं (पहली फूल की शाखा तक) 2. मैंकोजेब, क्लोरोथेलोनिल, या कॉपर दवा का छिड़काव करें 3. सिर्फ जड़ों पर पानी दें - ऊपर से कभी न दें 4. पौधों को एक-दूसरे से दूर लगाएं 5. 7-10 दिन बाद फिर से छिड़काव करें। जल्दी पकड़ा जाए तो आसानी से नियंत्रित किया जा सकता है!",
    
    "good news - keep it healthy: 1. continue checking leaves every 3-4 days 2. remove any yellowing or spotted leaves immediately 3. water at the base, not from above 4. apply fertilizer as per schedule 5. stay alert - healthy plants can get sick quickly. keep watching!": "अच्छी खबर - इसे स्वस्थ रखें: 1. हर 3-4 दिन बाद पत्तियों की जांच करते रहें 2. किसी भी पीली या धब्बेदार पत्ती को तुरंत निकाल दें 3. जड़ के पास ही पानी दें, ऊपर से न दें 4. समय पर खाद दें 5. सतर्क रहें - स्वस्थ पौधे भी जल्दी बीमार हो सकते हैं। देखते रहें!",
    
    "plant is healthy - maintain care: 1. check for signs of disease every 2-3 days 2. remove old/lower leaves to improve airflow 3. water early morning only 4. give fertilizer as planned 5. remove any weeds nearby. prevention is easier than treatment!": "पौधा स्वस्थ है - देखभाल करते रहें: 1. हर 2-3 दिन बाद बीमारी के संकेत देखें 2. पुरानी/नीचे की पत्तियों को हटाएं हवा के लिए 3. सुबह जल्दी ही पानी दें 4. समय पर खाद दें 5. पास के खरपतवारों को हटा दें। रोकथाम इलाज से आसान है!",
    
    "apple tree is healthy: 1. monitor leaves and fruits every week 2. remove fallen leaves and fruits immediately 3. prune dead or crowded branches 4. water during dry season 5. remove nearby diseased plants. healthy tree = good harvest!": "सेब का पेड़ स्वस्थ है: 1. हर हफ्ते पत्तियों और फलों की निगरानी करें 2. गिरी हुई पत्तियों और फलों को तुरंत उठा लें 3. मरी हुई या घनी शाखों को काटें 4. सूखे मौसम में पानी दें 5. पास के बीमार पौधों को हटा दें। स्वस्थ पेड़ = अच्छी फसल!",
    
    "plant looks healthy - keep it that way: 1. check every 3-4 days for any spots or yellowing 2. water properly (not too wet, not too dry) 3. remove dead leaves and weeds 4. give nutrients on time 5. keep the field clean. better to prevent than to cure!": "पौधा स्वस्थ दिखता है - इसे स्वस्थ रखें: 1. हर 3-4 दिन बाद किसी भी धब्बे या पीलापन की जांच करें 2. सही तरीके से पानी दें (न बहुत गीला, न बहुत सूखा) 3. मरी हुई पत्तियों और खरपतवारों को हटाएं 4. समय पर खाद दें 5. खेत को साफ रखें। रोकथाम इलाज से बेहतर है!",
    
    "remove heavily infected lower leaves. spray chlorothalonil or mancozeb as labeled. maintain plant spacing and avoid prolonged leaf wetness.": "ज्यादा संक्रमित निचली पत्तियों को हटा दें। लेबल के अनुसार क्लोरोथालोनिल या मैनकोजेब का छिड़काव करें। पौधों के बीच उचित दूरी रखें और पत्तियों को लंबे समय तक गीला न रहने दें।",
    "immediately remove infected plants/leaves and avoid moving wet foliage between fields. apply late-blight specific fungicide (metalaxyl or cymoxanil mixes) as per label and repeat at short intervals in humid weather.": "संक्रमित पौधों और पत्तियों को तुरंत हटा दें और गीली पत्तियों को एक खेत से दूसरे खेत में न ले जाएं। लेबल के अनुसार लेट ब्लाइट के लिए उपयुक्त फफूंदनाशक (मेटालेक्सिल या साइमोक्सानिल मिश्रण) का छिड़काव करें और नम मौसम में कम अंतराल पर दोहराएं।",
    "remove and destroy infected leaves. spray a fungicide such as captan or myclobutanil at 7-10 day intervals during wet periods. prune canopy for airflow and avoid overhead irrigation.": "संक्रमित पत्तियों को हटाकर नष्ट कर दें। गीले मौसम में 7-10 दिन के अंतराल पर कैप्टान या माइकोब्यूटानिल जैसे फफूंदनाशक का छिड़काव करें। हवा के प्रवाह के लिए छंटाई करें और ऊपर से सिंचाई करने से बचें।",
    "prune infected twigs and remove mummified fruits. spray a recommended fungicide (captan or mancozeb-based) on schedule. keep orchard floor clean to reduce reinfection.": "संक्रमित टहनियों की छंटाई करें और सूखे/सड़े फलों को हटा दें। निर्धारित समय पर अनुशंसित फफूंदनाशक (कैप्टान या मैनकोजेब आधारित) का छिड़काव करें। दोबारा संक्रमण कम करने के लिए बाग की जमीन साफ रखें।",
    "remove nearby juniper hosts if possible. apply preventive fungicide at pink bud through petal-fall stages. prune for airflow and monitor new lesions weekly.": "संभव हो तो आसपास के जुनिपर पौधों को हटा दें। पिंक बड से लेकर पंखुड़ी गिरने तक बचावात्मक फफूंदनाशक का छिड़काव करें। हवा के प्रवाह के लिए छंटाई करें और हर सप्ताह नए धब्बों की जांच करें।",
    "there is no curative spray for mosaic virus. remove infected plants, disinfect tools and hands, control weeds, and use resistant seed/varieties in the next cycle.": "मोज़ेक वायरस के लिए कोई उपचारात्मक स्प्रे नहीं है। संक्रमित पौधों को हटाएं, औज़ारों और हाथों को कीटाणुरहित करें, खरपतवार नियंत्रित करें और अगले चक्र में प्रतिरोधी बीज/किस्में उपयोग करें।",
    "this result comes from the trained plant disease model. if confidence is low, verify with a plant health expert.": "यह परिणाम प्रशिक्षित पौधा-रोग मॉडल से आया है। यदि विश्वसनीयता कम हो तो पौधा-स्वास्थ्य विशेषज्ञ से पुष्टि करें।",
    "plant appears healthy. continue routine scouting, balanced nutrition, and preventive sanitation.": "पौधा स्वस्थ दिख रहा है। नियमित निरीक्षण, संतुलित पोषण और रोकथाम आधारित स्वच्छता जारी रखें।",
    "plant appears healthy. maintain crop rotation, balanced fertilizer, and regular scouting.": "पौधा स्वस्थ दिख रहा है। फसल चक्र, संतुलित उर्वरक और नियमित निरीक्षण बनाए रखें।"
  };

  if (suggestionMap[normalized]) {
    return suggestionMap[normalized];
  }

  return translateToHindi(text);
}

async function translateTextIfNeeded(text, lang) {
  if (text == null) return text;
  if (lang !== "hi") return text;
  if (typeof text !== 'string') return text;

  return translateWithMyMemory(text, "Hindi");
}

async function translateAlertItem(item, lang) {
  if (lang !== "hi") return item;

  const [crop, location, problem, advice] = await Promise.all([
    translateTextIfNeeded(item.crop, lang),
    translateTextIfNeeded(item.location, lang),
    translateTextIfNeeded(item.problem, lang),
    translateTextIfNeeded(item.advice, lang)
  ]);

  return { ...item, crop, location, problem, advice };
}

const adviceTranslationDict = {
  "disease/pest": "रोग/कीट",
  "cause": "कारण",
  "solution": "समाधान",
  "prevention": "रोकथाम",
  "chemical treatment": "रासायनिक उपचार",
  "organic solution": "जैविक समाधान",
  "use": "उपयोग करें",
  "spray": "छिड़काव करें",
  "apply": "लगाएं",
  "remove": "हटाएं",
  "maintain": "बनाए रखें",
  "check": "जांच करें",
  "improve": "सुधारें",
  "keep": "रखें",
  "avoid": "बचें",
  "report": "रिपोर्ट",
  "on": "को"
};

function translateAdviceToHindi(text) {
  if (!text) return text;

  // Create a temporary DOM element to parse HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = text;

  // Function to translate text nodes recursively
  function translateTextNodes(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Translate the text content
      let translated = node.textContent;

      // First apply the main translation dictionary
      Object.keys(translationDict).forEach(english => {
        const hindi = translationDict[english];
        const regex = new RegExp('\\b' + english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
        translated = translated.replace(regex, hindi);
      });

      // Then apply advice-specific translations
      Object.keys(adviceTranslationDict).forEach(english => {
        const hindi = adviceTranslationDict[english];
        const regex = new RegExp('\\b' + english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
        translated = translated.replace(regex, hindi);
      });

      node.textContent = translated;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Recursively translate child nodes
      for (let child of node.childNodes) {
        translateTextNodes(child);
      }
    }
  }

  // Translate all text nodes
  translateTextNodes(tempDiv);

  return tempDiv.innerHTML;
}

function buildAlertCard(item, query = "") {
  const adviceText = item.advice == null ? '' : item.advice;
  const guidanceText = formatGuidanceForCard(adviceText);

  const cropText = item.crop;
  const locationText = item.location;
  const problemText = item.problem;
  const reportedByText = item.name || '';
  const queryString = normalizeSearchQuery(query);

  const highlightedCrop = highlightMatch(cropText, queryString);
  const highlightedLocation = highlightMatch(locationText, queryString);
  const highlightedProblem = highlightMatch(problemText, queryString);
  const highlightedReporter = highlightMatch(reportedByText, queryString);

  const reportDate = new Date(item.reportedAt);
  const dateStr = reportDate.toLocaleDateString();
  const timeStr = reportDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const rawGuidance = escapeAttr(stripHtmlTags(guidanceText));
  
  // Check if guidance is long enough to warrant expand/collapse
  const guidanceLength = stripHtmlTags(guidanceText).length;
  const canExpandGuidance = guidanceLength > 300;
  
  const lang = typeof getCurrentLanguage === "function" ? getCurrentLanguage() : "en";
  const readMoreLabel = lang === "hi" ? "और पढ़ें" : "Read more";
  
  // Format guidance with proper bold section headers
  const formattedGuidance = formatGuidanceWithBoldHeaders(guidanceText, queryString);

  return `
    <div class="alert-card">
      <div class="alert-header">
        <h3 class="alert-title">${highlightedCrop}</h3>
        <span class="alert-location">— ${highlightedLocation}</span>
      </div>
      <p class="alert-problem">${highlightedProblem}</p>
      <section class="alert-guidance" title="${rawGuidance}">
        <p class="alert-guidance-title" data-i18n="guidance">Guidance</p>
        <div class="guidance-content">${formattedGuidance}</div>
      </section>
      ${canExpandGuidance ? `<button type="button" class="alert-more-btn" onclick="toggleAlertCardDetails(this)">${readMoreLabel}</button>` : ""}
      <p class="meta"><span data-i18n="reportedBy">Reported by</span> ${highlightedReporter} <span data-i18n="on">on</span> ${dateStr} at ${timeStr}</p>
    </div>
  `;
}

async function loadAlerts() {
  try {
    const res = await fetchApi("/alerts");
    const data = await res.json();
    alertDataCache = data;
    const alertContainer = document.getElementById("alerts");
    if (!data.length) {
      alertContainer.innerHTML = "<p>No alerts have been submitted yet.</p>";
      return;
    }

    const lang = getCurrentLanguage();
    const items = lang === 'hi'
      ? await Promise.all(data.map(item => translateAlertItem(item, lang)))
      : data;

    alertContainer.innerHTML = items.map(buildAlertCard).join("");
    updateUILanguage();
  } catch (error) {
    console.error("loadAlerts error:", error);
    showAlertError(`Unable to load alerts. ${error.message || "Check that the backend server is running at http://127.0.0.1:3000."}`);
  }
}

async function loadDashboard() {
  try {
    const res = await fetchApi("/alerts");
    const data = await res.json();
    dashboardAlertCache = data.slice(-2).reverse();
    const total = data.length;
    const pest = data.filter(item => getAlertType(item.problem) === "Pest").length;
    const disease = data.filter(item => getAlertType(item.problem) === "Disease").length;
    const recent = dashboardAlertCache;

    document.getElementById("total-alerts").textContent = total;
    document.getElementById("pest-count").textContent = pest;
    document.getElementById("disease-count").textContent = disease;
    document.getElementById("recent-count").textContent = recent.length;

    const recentContainer = document.getElementById("recent-alerts");
    if (!recent.length) {
      recentContainer.innerHTML = "<p>No recent alerts yet. Submit a report to see it here.</p>";
      return;
    }

    const lang = getCurrentLanguage();
    const items = lang === 'hi'
      ? await Promise.all(recent.map(item => translateAlertItem(item, lang)))
      : recent;

    recentContainer.innerHTML = items.map(item => buildAlertCard(item)).join("");
    updateUILanguage();
  } catch (error) {
    const recentContainer = document.getElementById("recent-alerts");
    if (recentContainer) {
      recentContainer.innerHTML = "<p>Unable to load dashboard data.</p>";
    }
  }
}

function loadJSONView() {
  fetchApi("/alerts")
    .then(res => res.json())
    .then(data => {
      const jsonContainer = document.getElementById("json-output");
      if (!jsonContainer) return;
      jsonContainer.textContent = JSON.stringify(data, null, 2);
    })
    .catch(() => {
      const jsonContainer = document.getElementById("json-output");
      if (jsonContainer) {
        jsonContainer.textContent = "Unable to load JSON data.";
      }
    });
}

function copyJSON() {
  const jsonContainer = document.getElementById("json-output");
  if (!jsonContainer) return;
  navigator.clipboard.writeText(jsonContainer.textContent)
    .then(() => alert("JSON copied to clipboard."))
    .catch(() => alert("Could not copy JSON."));
}

function weatherCodeToText(code) {
  const map = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Rain",
    65: "Heavy rain",
    71: "Slight snow",
    73: "Snow",
    75: "Heavy snow",
    80: "Rain showers",
    81: "Strong rain showers",
    82: "Violent rain showers",
    95: "Thunderstorm"
  };
  return map[code] || "Weather update";
}

function setWeatherStatus(text, isError = false) {
  const status = document.getElementById("weatherStatus");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("error", isError);
}

function renderWeatherCurrent(data, locationLabel) {
  const current = document.getElementById("weatherCurrent");
  if (!current) return;

  const unitTemp = "°C";
  const unitWind = "m/s";
  const unitHumidity = "%";
  const weatherLabel = String(data?.weather?.[0]?.description || "Weather update");

  current.innerHTML = `
    <div class="weather-current-card">
      <p class="weather-location">${escapeHtml(locationLabel || "Selected location")}</p>
      <h2>${Number(data?.main?.temp ?? 0).toFixed(1)}${unitTemp}</h2>
      <p class="weather-condition">${weatherLabel}</p>
      <div class="weather-meta">
        <span>Humidity: ${data?.main?.humidity ?? "-"}${unitHumidity}</span>
        <span>Wind: ${data?.wind?.speed ?? "-"} ${unitWind}</span>
      </div>
    </div>
  `;
}

function renderWeatherForecast(data) {
  const forecast = document.getElementById("weatherForecast");
  if (!forecast) return;

  const groupedByDate = {};
  (data?.list || []).forEach(item => {
    const key = String(item?.dt_txt || "").split(" ")[0];
    if (!key) return;
    if (!groupedByDate[key]) {
      groupedByDate[key] = {
        dateStr: key,
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY,
        rain: 0
      };
    }

    const tempMin = Number(item?.main?.temp_min);
    const tempMax = Number(item?.main?.temp_max);
    if (Number.isFinite(tempMin)) groupedByDate[key].min = Math.min(groupedByDate[key].min, tempMin);
    if (Number.isFinite(tempMax)) groupedByDate[key].max = Math.max(groupedByDate[key].max, tempMax);

    const popPercent = Math.round((Number(item?.pop) || 0) * 100);
    groupedByDate[key].rain = Math.max(groupedByDate[key].rain, popPercent);
  });

  const days = Object.values(groupedByDate)
    .slice(0, 3)
    .map(day => ({
      dateStr: day.dateStr,
      min: Number.isFinite(day.min) ? day.min : 0,
      max: Number.isFinite(day.max) ? day.max : 0,
      rain: day.rain
    }));

  forecast.innerHTML = days.map(day => {
    const formatted = new Date(day.dateStr).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric"
    });
    return `
      <article class="weather-day-card">
        <h3>${formatted}</h3>
        <p class="weather-temp">${Number(day.max ?? 0).toFixed(0)}° / ${Number(day.min ?? 0).toFixed(0)}°</p>
        <p class="weather-rain">Rain chance: ${day.rain ?? "-"}%</p>
      </article>
    `;
  }).join("");
}

async function fetchAndRenderWeather(lat, lon, locationLabel) {
  setWeatherStatus("Loading weather...");
  const weatherResponse = await fetchApi(`/weather/by-coords?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, {
    method: "GET"
  });
  const weatherData = await weatherResponse.json();
  if (weatherData?.error) {
    throw new Error(weatherData.error);
  }

  renderWeatherCurrent(weatherData.current, locationLabel);
  renderWeatherForecast(weatherData.forecast);
  setWeatherStatus(`Updated for ${locationLabel}`);
}

async function fetchCurrentWeatherByCity(city) {
  const currentResponse = await fetchApi(`/weather/current?city=${encodeURIComponent(city)}`, {
    method: "GET"
  });
  const currentData = await currentResponse.json();
  if (currentData?.error) {
    throw new Error(currentData.error);
  }
  return currentData;
}

async function searchWeatherByCity() {
  const cityInput = document.getElementById("weatherCityInput");
  const city = String(cityInput?.value || "").trim();
  if (!city) {
    setWeatherStatus("Please enter a city name.", true);
    return;
  }

  try {
    setWeatherStatus(`Searching ${city}...`);
    const currentWeather = await fetchCurrentWeatherByCity(city);
    renderWeatherCurrent(currentWeather, city);
    const geoRes = await fetchApi(`/weather/geocode?city=${encodeURIComponent(city)}`, {
      method: "GET"
    });
    const geoData = await geoRes.json();
    if (geoData?.error) {
      throw new Error(geoData.error);
    }
    if (!geoData || !Number.isFinite(Number(geoData.lat)) || !Number.isFinite(Number(geoData.lon))) {
      setWeatherStatus("City not found. Try another name.", true);
      return;
    }

    await fetchAndRenderWeather(geoData.lat, geoData.lon, `${geoData.name || city}, ${geoData.country || ""}`.replace(/,\s*$/, ""));
  } catch (error) {
    setWeatherStatus(error.message || "Unable to load weather.", true);
  }
}

async function useCurrentLocationWeather() {
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  if (!window.isSecureContext && !isLocalHost) {
    setWeatherStatus("Using approximate location from network...");
    try {
      const ipGeoRes = await fetch("https://ipapi.co/json/", { cache: "no-store" });
      const ipGeo = await ipGeoRes.json();
      const lat = Number(ipGeo?.latitude);
      const lon = Number(ipGeo?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error("Unable to detect location from network.");
      }

      const label = [ipGeo?.city, ipGeo?.region, ipGeo?.country_name]
        .filter(Boolean)
        .join(", ") || "Approximate location";

      await fetchAndRenderWeather(lat, lon, `${label} (approx)`);
      setWeatherStatus("Showing weather by network location. Enable HTTPS for precise GPS.");
      return;
    } catch (_) {
      setWeatherStatus("Precise GPS needs HTTPS. Use city search or open HTTPS to use exact location.", true);
      return;
    }
  }

  if (!navigator.geolocation) {
    setWeatherStatus("Geolocation is not supported in this browser.", true);
    return;
  }

  setWeatherStatus("Getting your location...");
  navigator.geolocation.getCurrentPosition(async position => {
    try {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      let locationLabel = "Your location";

      try {
        const reverseRes = await fetchApi(`/weather/reverse-geocode?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`, {
          method: "GET"
        });
        const reverseData = await reverseRes.json();
        if (!reverseData?.error) {
          locationLabel = [reverseData.name, reverseData.state, reverseData.country]
            .filter(Boolean)
            .join(", ");
        }
      } catch (_) {
        // Fall back to generic label if reverse geocoding fails.
      }

      await fetchAndRenderWeather(lat, lon, locationLabel);
    } catch (error) {
      setWeatherStatus(error.message || "Unable to load weather.", true);
    }
  }, error => {
    if (error && error.code === error.PERMISSION_DENIED) {
      setWeatherStatus("Location permission denied. Allow location in browser settings and try again.", true);
      return;
    }
    if (error && error.code === error.POSITION_UNAVAILABLE) {
      setWeatherStatus("Unable to detect device location right now. Try again or search by city.", true);
      return;
    }
    if (error && error.code === error.TIMEOUT) {
      setWeatherStatus("Location request timed out. Move to open sky and try again.", true);
      return;
    }
    setWeatherStatus("Could not read location from this device. Search by city instead.", true);
  }, {
    enableHighAccuracy: false,
    timeout: 10000
  });
}

async function loadWeatherPage() {
  const cityInput = document.getElementById("weatherCityInput");
  const searchBtn = document.getElementById("weatherSearchBtn");
  const locationBtn = document.getElementById("weatherLocationBtn");

  if (!cityInput || !searchBtn || !locationBtn) return;

  if (!searchBtn.dataset.bound) {
    searchBtn.addEventListener("click", searchWeatherByCity);
    searchBtn.dataset.bound = "1";
  }

  if (!locationBtn.dataset.bound) {
    locationBtn.addEventListener("click", useCurrentLocationWeather);
    locationBtn.dataset.bound = "1";
  }

  if (!cityInput.dataset.bound) {
    cityInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        searchWeatherByCity();
      }
    });
    cityInput.dataset.bound = "1";
  }

  await fetchAndRenderWeather(28.6139, 77.2090, "New Delhi");
}

window.loadWeatherPage = loadWeatherPage;

if (window.location.pathname.includes("alerts.html")) {
  loadAlerts();
}
if (window.location.pathname.includes("index.html") || window.location.pathname === "/") {
  loadDashboard();
}
if (window.location.pathname.includes("json.html")) {
  loadJSONView();
}
if (window.location.pathname.includes("weather.html")) {
  loadWeatherPage();
}

/* ========================================================= */
/* MOBILE ENHANCEMENTS FOR UNIVERSAL PHONE COMPATIBILITY */
/* ========================================================= */

// Mobile-specific enhancements
document.addEventListener("DOMContentLoaded", function() {
  // Detect mobile devices and add appropriate classes
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);
  
  if (isMobile) {
    document.body.classList.add("mobile-device");
  }
  if (isIOS) {
    document.body.classList.add("ios-device");
  }
  if (isAndroid) {
    document.body.classList.add("android-device");
  }
  
  // Handle orientation changes
  window.addEventListener("orientationchange", function() {
    // Small delay to allow orientation to complete
    setTimeout(function() {
      // Close sidebar on orientation change for better UX
      const sidebar = document.querySelector(".sidebar");
      const overlay = document.querySelector(".sidebar-overlay");
      if (sidebar && overlay) {
        sidebar.classList.remove("active");
        overlay.classList.remove("active");
      }
      
      // Force layout recalculation
      window.dispatchEvent(new Event("resize"));
    }, 100);
  });
  
  // Handle viewport height changes (keyboard, notches, etc.)
  let viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function() {
      const currentHeight = window.visualViewport.height;
      const heightDiff = viewportHeight - currentHeight;
      
      if (Math.abs(heightDiff) > 150) { // Keyboard likely shown/hidden
        document.body.classList.toggle("keyboard-visible", heightDiff > 0);
        viewportHeight = currentHeight;
      }
    });
  }
  
  // Improve touch interactions
  if ('ontouchstart' in window) {
    // Add touch feedback for buttons
    document.querySelectorAll('.btn, .icon-btn, .hamburger-btn, .view-all').forEach(btn => {
      btn.addEventListener('touchstart', function() {
        this.style.transform = 'scale(0.95)';
      });
      
      btn.addEventListener('touchend', function() {
        this.style.transform = '';
      });
    });
    
    // Prevent double-tap zoom on regular buttons without breaking trusted gestures
    // required by APIs like geolocation/camera/file picker on mobile browsers.
    document.querySelectorAll('button, .btn, .icon-btn, .hamburger-btn').forEach(btn => {
      btn.addEventListener('touchend', function(e) {
        if (
          this.id === 'weatherLocationBtn'
          || this.id === 'uploadBtn'
          || this.id === 'capturePhotoBtn'
          || this.hasAttribute('data-require-user-gesture')
        ) {
          return;
        }
        e.preventDefault();
        // Allow click to proceed
        setTimeout(() => this.click(), 10);
      });
    });
  }
  
  // Handle pull-to-refresh (if supported)
  if ('serviceWorker' in navigator && 'caches' in window) {
    // Add pull-to-refresh functionality for PWA-like experience
    let startY = 0;
    let isPulling = false;
    
    document.addEventListener('touchstart', function(e) {
      startY = e.touches[0].clientY;
    });
    
    document.addEventListener('touchmove', function(e) {
      if (window.scrollY === 0 && e.touches[0].clientY > startY + 50) {
        isPulling = true;
        // Add visual feedback for pull-to-refresh
        document.body.style.transform = `translateY(${Math.min(e.touches[0].clientY - startY - 50, 60)}px)`;
      }
    });
    
    document.addEventListener('touchend', function() {
      if (isPulling && window.scrollY === 0) {
        document.body.style.transform = '';
        // Refresh the page
        window.location.reload();
      }
      isPulling = false;
    });
  }
  
  // Handle back button for mobile
  if (window.history && window.history.pushState) {
    // Close sidebar when back button is pressed
    window.addEventListener('popstate', function() {
      const sidebar = document.querySelector(".sidebar");
      const overlay = document.querySelector(".sidebar-overlay");
      if (sidebar && overlay && sidebar.classList.contains("active")) {
        sidebar.classList.remove("active");
        overlay.classList.remove("active");
      }
    });
  }
  
  // Improve form handling on mobile
  document.querySelectorAll('input, textarea').forEach(input => {
    input.addEventListener('focus', function() {
      // Scroll input into view on mobile
      setTimeout(() => {
        this.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    });
  });
  
  // Handle device-specific features
  if (isIOS) {
    // iOS-specific enhancements
    document.body.classList.add('ios-scroll-fix');
    
    // Prevent zoom on form focus
    document.querySelectorAll('input, textarea').forEach(input => {
      input.setAttribute('inputmode', input.type === 'email' ? 'email' : 'text');
    });
  }
  
  if (isAndroid) {
    // Android-specific enhancements
    document.body.classList.add('android-scroll-fix');
  }
});

// Performance optimizations for mobile
if ('requestIdleCallback' in window) {
  requestIdleCallback(() => {
    // Lazy load non-critical resources
    console.log('Mobile optimizations loaded');
  });
}
