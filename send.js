"use strict";

/* =====================================================================
 * Отправка заявок сайта
 * ---------------------------------------------------------------------
 * Все формы с классом .form-submit (квиз, обратный звонок, общая форма)
 * отправляются на рабочий backend сайта (sendmail.php) — без сервера на
 * стороне GitHub Pages. Опционально можно включить дублирование заявок
 * в Telegram, заполнив BOT_TOKEN и CHAT_ID.
 *
 * Telegram (необязательно):
 *   BOT_TOKEN — токен бота, созданного у @BotFather (например,
 *               "7123456789:AAH...xyz");
 *   CHAT_ID   — id чата, куда слать заявки. Свой id можно узнать у
 *               бота @userinfobot.
 *
 * По умолчанию (если токен не заполнен) заявки уходят в
 * PRODUCTION_SEND_URL — на тот же backend, что и основной сайт.
 * =================================================================== */

const CONFIG = {
  BOT_TOKEN: "",          // ← необязательно: токен бота для дубля в Telegram
  CHAT_ID: "",            // ← необязательно: id чата для дубля в Telegram
  THANKYOU_URL: "./thankyou.html",
  SUBMIT_DELAY_MS: 800,   // минимальная задержка, чтобы был виден статус кнопки
};

// Рабочий backend основного сайта — сюда уходят заявки по умолчанию.
const PRODUCTION_SEND_URL = "https://remont-kaknado.ru/sendmail.php";

// Доступно из консоли браузера для проверки (window.SEND_CONFIG)
window.SEND_CONFIG = CONFIG;

/* ------------------------- утилиты ------------------------------- */

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function isValidPhone(value) {
  // Российский номер: 11 цифр (7/8 + код + номер)
  return digits(value).length === 11;
}

function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function utmQuery() {
  const params = new URLSearchParams(window.location.search);
  const utm = {};
  ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function (key) {
    if (params.get(key)) utm[key] = params.get(key);
  });
  return utm;
}

/* --------------------- сбор данных формы ------------------------- */

const QUESTION_LABELS = {
  question1: "Тип объекта",
  question2: "Жилой комплекс",
  question3: "Площадь",
  question4: "Стиль",
  question5: "Сроки ремонта",
  messenger: "Способ связи",
  when: "Время звонка",
  time: "Когда удобно принять звонок",
  name: "Имя",
  phone: "Телефон",
};

function collectFormData(form) {
  const fd = new FormData(form);
  const data = { fields: [], utm: utmQuery() };

  // Скрытое поле "from" — источник заявки
  const fromInput = form.querySelector('input[name="from"]');
  let from = fromInput ? fromInput.value : "";
  if (!from) from = form.dataset.from || "";
  data.from = from || "Форма сайта";

  // Текстовые поля и select
  form.querySelectorAll('input[type="text"], input[type="tel"], input[type="hidden"], select, textarea').forEach(function (el) {
    const name = el.name;
    if (!name || name === "newToken" || name === "accept-policy" || name === "from") return;
    if (!el.value) return;
    data.fields.push({ name: name, label: QUESTION_LABELS[name] || name, value: el.value });
  });

  // Выбранные radio (по одному на группу имён)
  const seen = {};
  form.querySelectorAll('input[type="radio"]:checked').forEach(function (el) {
    if (!el.name || seen[el.name]) return;
    seen[el.name] = true;
    data.fields.push({ name: el.name, label: QUESTION_LABELS[el.name] || el.name, value: el.value });
  });

  // Чекбокс согласия
  const policy = form.querySelector('input[name="accept-policy"]');
  data.policyAccepted = !policy || policy.checked;

  return data;
}

function buildMessage(data) {
  const lines = [];
  lines.push("\u{1F3E0} <b>Новая заявка с сайта</b>");
  lines.push("\u{1F4CB} Источник: <b>" + escapeHtml(data.from) + "</b>");
  if (data.fields.length) {
    data.fields.forEach(function (f) {
      lines.push((QUESTION_LABELS[f.name] ? "\u{2022} " : "\u{2022} ") + escapeHtml(f.label) + ": <b>" + escapeHtml(f.value) + "</b>");
    });
  }
  lines.push("\u{1F4CD} Страница: " + escapeHtml(window.location.href));
  if (document.referrer) lines.push("\u{1F517} Переход с: " + escapeHtml(document.referrer));
  const utm = Object.keys(data.utm);
  if (utm.length) {
    lines.push("\u{1F3AF} UTM: " + utm.map(function (k) { return k + "=" + escapeHtml(data.utm[k]); }).join(" | "));
  }
  lines.push("\u{23F0} " + new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }));
  return lines.join("\n");
}

/* ----------------------- отправка заявки --------------------------- */

async function sendToTelegram(text) {
  const url = "https://api.telegram.org/bot" + CONFIG.BOT_TOKEN + "/sendMessage";
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CONFIG.CHAT_ID,
      text: text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const json = await response.json().catch(function () { return null; });
  if (!response.ok || !json || json.ok !== true) {
    throw new Error(json && json.description ? json.description : "HTTP " + response.status);
  }
  return json;
}

function sendToProduction(form) {
  // Отправка в backend основного сайта. Запрос без CORS-чтения ответа:
  // данные доходят до сервера, браузер получает opaque-ответ.
  const fd = new FormData(form);
  fd.append("newToken", Date.now().toString(36) + Math.random().toString(36).slice(2));
  const utm = utmQuery();
  Object.keys(utm).forEach(function (k) { fd.append(k, utm[k]); });
  return fetch(PRODUCTION_SEND_URL, {
    method: "POST",
    body: fd,
    mode: "no-cors",
  });
}

/* ---------------------- UI-состояния формы ------------------------ */

function setSubmitLoading(form, loading) {
  const btn = form.querySelector('button[type="submit"], input[type="submit"]');
  const submitBtn = form.querySelector("button[type=submit]");
  const el = btn || submitBtn;
  if (!el) return;
  if (loading) {
    el.dataset.originalHtml = el.innerHTML;
    el.dataset.originalValue = el.value;
    el.disabled = true;
    if (el.tagName === "INPUT") el.value = "Отправка формы...";
    else el.innerHTML = "Отправка формы...";
  } else {
    el.disabled = false;
    if (el.tagName === "INPUT") el.value = el.dataset.originalValue || "";
    else el.innerHTML = el.dataset.originalHtml || "";
  }
}

function showFormError(form, message) {
  let box = form.querySelector(".form-send-error");
  if (!box) {
    box = document.createElement("div");
    box.className = "form-send-error";
    box.style.cssText = "color:#d64541;font-size:14px;line-height:1.4;margin:12px 0 0;text-align:center;";
    const after = form.querySelector(".form__items") || form.querySelector(".form__content") || form;
    after.insertAdjacentElement("afterend", box);
  }
  box.textContent = message;
  setTimeout(function () { if (box && box.parentNode) box.parentNode.removeChild(box); }, 6000);
}

/* ------------------------ обработчик submit ----------------------- */

document.addEventListener("DOMContentLoaded", function () {
  document.addEventListener("submit", function (event) {
    const form = event.target;
    if (!form || !form.classList.contains("form-submit")) return;

    event.preventDefault();

    const phoneInput = form.querySelector('input[type="tel"]');
    if (phoneInput && !isValidPhone(phoneInput.value)) {
      showFormError(form, "Пожалуйста, введите полный номер телефона (+7 (XXX) XXX-XX-XX)");
      phoneInput.focus();
      return;
    }

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    // Защита от повторной отправки
    if (form.dataset.submitting === "1") return;
    form.dataset.submitting = "1";

    const data = collectFormData(form);
    const message = buildMessage(data);
    setSubmitLoading(form, true);
    form.classList.add("_sending");

    const finish = function () {
      window.location.href = CONFIG.THANKYOU_URL;
    };
    const fail = function (err) {
      console.error("Ошибка отправки формы:", err);
      form.dataset.submitting = "0";
      form.classList.remove("_sending");
      setSubmitLoading(form, false);
      showFormError(form, "Не удалось отправить заявку. Попробуйте ещё раз или позвоните нам по телефону.");
    };

    if (CONFIG.BOT_TOKEN && CONFIG.CHAT_ID) {
      // Дубль в Telegram (необязательно) + отправка в backend сайта
      sendToTelegram(message).catch(function (err) {
        console.error("Telegram-дубль не отправлен:", err);
      });
    }

    sendToProduction(form)
      .then(function () {
        form.reset();
        window.setTimeout(finish, CONFIG.SUBMIT_DELAY_MS);
      })
      .catch(fail);
  });
});
