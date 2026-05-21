require("dotenv").config({
  path: require("path").join(__dirname, "..", ".env"),
  quiet: true,
  override: true,
});

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const SMS_LOG_DIR = path.join(__dirname, "..", "logs");
const SMS_LOG_FILE = path.join(SMS_LOG_DIR, "sms.log");

function getUniSmsApiBaseUrl() {
  return String(
    process.env.UNISMS_API_BASE_URL ||
      process.env.UNISMS_API_URL ||
      "https://unismsapi.com/api"
  )
    .trim()
    .replace(/\/+$/, "");
}

function getUniSmsSendUrl() {
  return `${getUniSmsApiBaseUrl()}/sms`;
}

function getUniSmsSecretKey() {
  return String(
    process.env.UNISMS_API_SECRET_KEY ||
      process.env.UNISMS_SECRET_KEY ||
      process.env.UNISMS_API_KEY ||
      ""
  ).trim();
}

function maskPhone(value) {
  const text = String(value || "");
  const digits = text.replace(/\D/g, "");
  if (!digits) return "";
  const masked = `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
  return text.trim().startsWith("+") ? `+${masked}` : masked;
}

function logSmsEvent(event, details = {}) {
  const safeDetails = {
    ...details,
    normalizedPhone: maskPhone(details.normalizedPhone),
    providerPhone: maskPhone(details.providerPhone),
  };

  const line = JSON.stringify({
    at: new Date().toISOString(),
    event,
    ...safeDetails,
  });

  console.log(`[${event}]`, safeDetails);

  fs.mkdir(SMS_LOG_DIR, { recursive: true }, () => {
    fs.appendFile(SMS_LOG_FILE, `${line}\n`, () => {});
  });
}

function getSmsMaxLength() {
  const value = Number(process.env.SMS_MAX_LENGTH || 150);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 160) : 150;
}

function trimSmsMessage(message, maxLength = 150) {
  const clean = String(message || "")
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length <= maxLength) return clean;

  return clean.slice(0, Math.max(0, maxLength - 3)).trimEnd() + "...";
}

function normalizePhilippinePhoneNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");

  if (!digits) return "";

  if (digits.startsWith("09") && digits.length === 11) {
    return "+63" + digits.slice(1);
  }

  if (digits.startsWith("9") && digits.length === 10) {
    return "+63" + digits;
  }

  if (digits.startsWith("639") && digits.length === 12) {
    return "+" + digits;
  }

  if (digits.startsWith("63") && digits.length === 12) {
    return "+" + digits;
  }

  return "";
}

async function sendUniSms({ to, message, metadata = {} }) {
  const secretKey = getUniSmsSecretKey();
  const senderId = String(process.env.UNISMS_SENDER_ID || "").trim();
  const maxLength = getSmsMaxLength();

  logSmsEvent("sms config", {
    provider: "unisms",
    hasToken: Boolean(secretKey),
    apiBaseUrl: getUniSmsApiBaseUrl(),
    senderId: senderId || "default",
    phoneFormat: "e164",
    maxLength: String(maxLength),
  });

  if (!secretKey) {
    logSmsEvent("sms skipped missing token", { provider: "unisms" });
    return { ok: false, skipped: true, reason: "missing_token" };
  }

  const normalizedTo = normalizePhilippinePhoneNumber(to);

  logSmsEvent("sms normalized phone", {
    normalizedPhone: normalizedTo,
    providerPhone: normalizedTo,
  });

  if (!normalizedTo) {
    logSmsEvent("sms skipped missing/invalid phone", {
      normalizedPhone: normalizedTo,
      providerPhone: normalizedTo,
    });
    return { ok: false, skipped: true, reason: "invalid_phone" };
  }

  const finalMessage = trimSmsMessage(message, maxLength);
  const body = {
    recipient: normalizedTo,
    content: finalMessage,
    ...(senderId ? { sender_id: senderId } : {}),
    ...(metadata && Object.keys(metadata).length ? { metadata } : {}),
  };

  try {
    logSmsEvent("sms sending", {
      provider: "unisms",
      normalizedPhone: normalizedTo,
      providerPhone: normalizedTo,
      senderId: senderId || "default",
      length: finalMessage.length,
    });

    const response = await fetch(getUniSmsSendUrl(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));

    logSmsEvent("sms provider response", {
      provider: "unisms",
      status: response.status,
      data,
    });

    const messageStatus = String(data?.message?.status || data?.status || "").toLowerCase();
    const failed = messageStatus === "failed" || Boolean(data?.message?.fail_reason);

    if (!response.ok || failed) {
      const errorMessage =
        data?.message?.fail_reason ||
        data?.message ||
        data?.error ||
        `UniSMS request failed (${response.status})`;
      logSmsEvent("sms failed", {
        provider: "unisms",
        status: response.status,
        data,
        length: finalMessage.length,
        normalizedPhone: normalizedTo,
        providerPhone: normalizedTo,
        message: errorMessage,
      });
      return {
        ok: false,
        skipped: false,
        reason: "provider_error",
        status: response.status,
        errorMessage,
        data,
      };
    }

    logSmsEvent("sms sent", {
      provider: "unisms",
      normalizedPhone: normalizedTo,
      providerPhone: normalizedTo,
      status: response.status,
    });

    return {
      ok: true,
      skipped: false,
      to: normalizedTo,
      providerTo: normalizedTo,
      message: finalMessage,
      data,
    };
  } catch (err) {
    logSmsEvent("sms failed", {
      provider: "unisms",
      normalizedPhone: normalizedTo,
      providerPhone: normalizedTo,
      length: finalMessage.length,
      message: err?.message || String(err),
    });
    return {
      ok: false,
      skipped: false,
      reason: "send_failed",
      errorMessage: err?.message || String(err),
    };
  }
}

async function checkUniSmsBalance() {
  return {
    ok: false,
    skipped: true,
    reason: "unsupported",
    errorMessage: "UniSMS balance checking is not configured in this app.",
  };
}

module.exports = {
  checkUniSmsBalance,
  sendUniSms,
  normalizePhilippinePhoneNumber,
  trimSmsMessage,
};
