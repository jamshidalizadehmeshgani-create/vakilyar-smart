"use strict";

const IRAN_ALIASES = new Set(["iran", "ایران", "ir"]);

function normalizeText(value) {
  return value.normalize("NFKC")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u0640\u064B-\u065F\u0670]/g, "")
    .replace(/[\u200c\u200d]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const FOREIGN_COUNTRIES = [
  "آلمان", "ژاپن", "چین", "روسیه", "آمریکا", "ایالات متحده", "انگلستان", "بریتانیا", "فرانسه", "ترکیه",
  "کانادا", "کندا", "استرالیا", "ایتالیا", "اسپانیا", "هلند", "بلژیک", "سوئیس", "اتریش", "سوئد", "نروژ", "دانمارک",
  "فنلاند", "لهستان", "اوکراین", "ایرلند", "پرتغال", "ایسلند", "یونان", "چک", "رومانی", "مجارستان", "بلغارستان", "کرواسی", "صربستان", "اسلواکی", "اسلوونی", "لیتوانی", "لتونی", "استونی", "هند", "پاکستان", "افغانستان", "عراق", "عربستان", "امارات", "قطر", "کویت",
  "بحرین", "عمان", "مصر", "لبنان", "سوریه", "اردن", "آذربایجان", "ارمنستان", "گرجستان", "کره جنوبی",
  "سنگاپور", "مالزی", "اندونزی", "تایلند", "برزیل", "مکزیک", "آفریقای جنوبی", "نیوزیلند",
  "germany", "japan", "china", "russia", "united states", "usa", "america", "united kingdom", "uk", "ireland", "portugal", "iceland", "greece", "czech republic", "romania", "hungary", "bulgaria", "croatia", "serbia", "slovakia", "slovenia", "lithuania", "latvia", "estonia",
  "england", "france", "turkey", "canada", "australia", "italy", "spain", "netherlands", "belgium",
  "switzerland", "austria", "sweden", "norway", "denmark", "finland", "poland", "ukraine", "india",
  "pakistan", "afghanistan", "iraq", "saudi arabia", "uae", "qatar", "kuwait", "bahrain", "oman",
  "egypt", "lebanon", "syria", "jordan", "azerbaijan", "armenia", "georgia", "south korea", "singapore",
  "malaysia", "indonesia", "thailand", "brazil", "mexico", "south africa", "new zealand",
  "نپال", "بنگلادش", "ویتنام", "فیلیپین", "کامبوج", "لائوس", "میانمار", "سریلانکا", "مالدیو", "مغولستان",
  "قزاقستان", "ازبکستان", "ترکمنستان", "تاجیکستان", "قرقیزستان", "یمن", "فلسطین", "لیبی", "تونس", "الجزایر",
  "مراکش", "اتیوپی", "کنیا", "نیجریه", "غنا", "سنگال", "تانزانیا", "اوگاندا", "زیمبابوه", "زامبیا",
  "شیلی", "آرژانتین", "کلمبیا", "پرو", "ونزوئلا", "کوبا", "اکوادور", "بولیوی", "پاراگوئه", "اروگوئه",
  "پاناما", "کاستاریکا", "گواتمالا", "هندوراس", "السالوادور", "نیکاراگوئه", "جامائیکا", "هائیتی",
  "لوکزامبورگ", "مالت", "قبرس", "موناکو", "آلبانی", "مقدونیه شمالی", "بوسنی و هرزگوین", "مونته‌نگرو",
  "nepal", "bangladesh", "vietnam", "philippines", "cambodia", "laos", "myanmar", "sri lanka", "maldives", "mongolia",
  "kazakhstan", "uzbekistan", "turkmenistan", "tajikistan", "kyrgyzstan", "yemen", "palestine", "libya", "tunisia", "algeria",
  "morocco", "ethiopia", "kenya", "nigeria", "ghana", "senegal", "tanzania", "uganda", "zimbabwe", "zambia",
  "chile", "argentina", "colombia", "peru", "venezuela", "cuba", "ecuador", "bolivia", "paraguay", "uruguay",
  "panama", "costa rica", "guatemala", "honduras", "el salvador", "nicaragua", "jamaica", "haiti",
  "luxembourg", "malta", "cyprus", "monaco", "albania", "north macedonia", "bosnia and herzegovina", "montenegro"
];

const EXPLICIT_FOREIGN_LAW = /حقوق بین.?الملل|قوانین بین.?الملل|قانون بین.?الملل|حقوق خارجی|قوانین? خارجی|کشورهای خارجی|کشور خارجی|قوانین? (?:کشور|دولت) دیگر|قانون (?:کشور|دولت) دیگر/i;

function mentionsForeignCountry(message) {
  if (typeof message !== "string" || !message) return false;
  const normalizedMessage = normalizeText(message);
  return FOREIGN_COUNTRIES.some((name) => {
    const normalizedName = normalizeText(name);
    const pattern = new RegExp("(^|[^\\p{L}])" + normalizedName + "([^\\p{L}]|$)", "iu");
    return pattern.test(normalizedMessage);
  });
}

function isKnownCountry(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const normalized = normalizeText(value);
  return IRAN_ALIASES.has(normalized) || FOREIGN_COUNTRIES.some((name) => normalizeText(name) === normalized);
}

function isIranScope(value) {
  return typeof value === "string" && IRAN_ALIASES.has(normalizeText(value));
}

function isForeignLegalRequest(message, requestedScope, countryLabel) {
  const scopeRequestsForeign =
    (typeof requestedScope === "string" && requestedScope.trim() && !isIranScope(requestedScope)) ||
    (typeof countryLabel === "string" && countryLabel.trim() && !isIranScope(countryLabel));
  return Boolean(scopeRequestsForeign ||
    (typeof message === "string" && EXPLICIT_FOREIGN_LAW.test(normalizeText(message))) ||
    mentionsForeignCountry(message));
}

module.exports = { isForeignLegalRequest, mentionsForeignCountry, isIranScope, isKnownCountry };
