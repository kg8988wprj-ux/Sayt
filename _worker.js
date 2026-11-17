const MAX_BODY_BYTES = 12 * 1024;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 5;
const attemptsByIp = new Map();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function clean(value, maxLength) {
  return String(value ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, maxLength);
}

function rateLimited(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  const recent = (attemptsByIp.get(ip) || []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    attemptsByIp.set(ip, recent);
    return true;
  }
  recent.push(now);
  attemptsByIp.set(ip, recent);
  return false;
}

function validateLead(data) {
  const lead = {
    name: clean(data.name, 120),
    phone: clean(data.phone, 40),
    email: clean(data.email, 160),
    direction: clean(data.direction, 160),
    consent: data.consent === true,
    website: clean(data.website, 200)
  };
  if (lead.website) return { spam: true };
  if (lead.name.length < 2) return { error: "Проверьте ФИО." };
  if (lead.phone.replace(/\D/g, "").length < 7) return { error: "Проверьте номер телефона." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) return { error: "Проверьте адрес электронной почты." };
  if (lead.direction.length < 2) return { error: "Выберите направление обучения." };
  if (!lead.consent) return { error: "Необходимо согласие на обработку персональных данных." };
  return { lead };
}

async function handleLead(request, env) {
  if (request.method !== "POST") return json({ ok: false, message: "Метод не поддерживается." }, 405);
  if (rateLimited(request)) return json({ ok: false, message: "Слишком много попыток. Попробуйте позже." }, 429);

  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_BODY_BYTES) return json({ ok: false, message: "Слишком большой запрос." }, 413);

  let raw;
  try {
    raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
      return json({ ok: false, message: "Слишком большой запрос." }, 413);
    }
  } catch {
    return json({ ok: false, message: "Не удалось прочитать заявку." }, 400);
  }

  let data;
  try { data = JSON.parse(raw || "{}"); }
  catch { return json({ ok: false, message: "Некорректный формат заявки." }, 400); }

  const checked = validateLead(data);
  if (checked.spam) return json({ ok: true, message: "Заявка отправлена." });
  if (checked.error) return json({ ok: false, message: checked.error }, 400);

  if (!env.BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    return json({ ok: false, message: "Форма пока не подключена к Telegram. Администратору нужно добавить настройки бота." }, 503);
  }

  const lead = checked.lead;
  const message = [
    "📩 НОВАЯ ЗАЯВКА С САЙТА",
    "",
    `ФИО: ${lead.name}`,
    `Телефон: ${lead.phone}`,
    `Email: ${lead.email}`,
    `Направление: ${lead.direction}`,
    "",
    `Время: ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`
  ].join("\n");

  try {
    const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      return json({ ok: false, message: "Не удалось отправить заявку. Попробуйте позже или свяжитесь с нами по телефону." }, 502);
    }
    return json({ ok: true, message: "Заявка отправлена. Мы свяжемся с вами." });
  } catch {
    return json({ ok: false, message: "Ошибка соединения. Попробуйте позже." }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      if (request.method !== "GET") return json({ ok: false, message: "Метод не поддерживается." }, 405);
      return json({ ok: true, telegramConfigured: Boolean(env.BOT_TOKEN && env.TELEGRAM_CHAT_ID) });
    }

    if (url.pathname === "/api/lead") return handleLead(request, env);

    return env.ASSETS.fetch(request);
  }
};
