import { useEffect, useState } from "react";

/** Customer-facing pages speak English, Hindi and Arabic (right-to-left). The back office is English. */
export type Lang = "en" | "hi" | "ar";
export const LANGS: { key: Lang; label: string }[] = [{ key: "en", label: "English" }, { key: "hi", label: "हिन्दी" }, { key: "ar", label: "العربية" }];

const D = {
  holidays: { en: "Holidays", hi: "हॉलिडे पैकेज", ar: "العطلات" },
  flights: { en: "Flights", hi: "फ़्लाइट", ar: "رحلات الطيران" },
  hotels: { en: "Hotels", hi: "होटल", ar: "الفنادق" },
  series: { en: "Group fares", hi: "ग्रुप किराया", ar: "أسعار المجموعات" },
  insurance: { en: "Insurance", hi: "बीमा", ar: "التأمين" },
  visa: { en: "Visa status", hi: "वीज़ा स्थिति", ar: "حالة التأشيرة" },
  myTrips: { en: "My trips", hi: "मेरी यात्राएँ", ar: "رحلاتي" },
  search: { en: "Search", hi: "खोजें", ar: "بحث" },
  from: { en: "From", hi: "कहाँ से", ar: "من" },
  to: { en: "To", hi: "कहाँ तक", ar: "إلى" },
  date: { en: "Date", hi: "तारीख़", ar: "التاريخ" },
  adults: { en: "Adults", hi: "वयस्क", ar: "البالغون" },
  children: { en: "Children", hi: "बच्चे", ar: "الأطفال" },
  city: { en: "City", hi: "शहर", ar: "المدينة" },
  checkIn: { en: "Check-in", hi: "चेक-इन", ar: "تسجيل الوصول" },
  nights: { en: "Nights", hi: "रातें", ar: "الليالي" },
  rooms: { en: "Rooms", hi: "कमरे", ar: "الغرف" },
  yourName: { en: "Your name", hi: "आपका नाम", ar: "اسمك" },
  phone: { en: "Mobile number", hi: "मोबाइल नंबर", ar: "رقم الجوال" },
  email: { en: "Email", hi: "ईमेल", ar: "البريد الإلكتروني" },
  bookNow: { en: "Book now", hi: "अभी बुक करें", ar: "احجز الآن" },
  continue: { en: "Continue to payment", hi: "भुगतान पर जाएँ", ar: "المتابعة للدفع" },
  perPerson: { en: "per person", hi: "प्रति व्यक्ति", ar: "للشخص" },
  total: { en: "Total", hi: "कुल", ar: "الإجمالي" },
  seatsLeft: { en: "seats left", hi: "सीटें बचीं", ar: "مقاعد متبقية" },
  roomsLeft: { en: "rooms left", hi: "कमरे बचे", ar: "غرف متبقية" },
  instant: { en: "Instant confirmation", hi: "तुरंत पुष्टि", ar: "تأكيد فوري" },
  onRequest: { en: "On request", hi: "अनुरोध पर", ar: "عند الطلب" },
  nonStop: { en: "Non-stop", hi: "नॉन-स्टॉप", ar: "بدون توقف" },
  stop: { en: "stop", hi: "स्टॉप", ar: "توقف" },
  passengers: { en: "Traveller names (as on passport)", hi: "यात्रियों के नाम (पासपोर्ट के अनुसार)", ar: "أسماء المسافرين (كما في الجواز)" },
  noResults: { en: "Nothing available for these dates. Try other dates or send us an enquiry.", hi: "इन तारीख़ों पर कुछ उपलब्ध नहीं है। दूसरी तारीख़ें आज़माएँ या हमें पूछताछ भेजें।", ar: "لا يوجد توفر لهذه التواريخ. جرّب تواريخ أخرى أو أرسل لنا استفسارًا." },
  signIn: { en: "Sign in", hi: "साइन इन करें", ar: "تسجيل الدخول" },
  sendCode: { en: "Send me a code", hi: "मुझे कोड भेजें", ar: "أرسل لي رمزًا" },
  enterCode: { en: "Enter the 6-digit code", hi: "6 अंकों का कोड डालें", ar: "أدخل الرمز المكوّن من 6 أرقام" },
  phoneOrEmail: { en: "Mobile number or email", hi: "मोबाइल नंबर या ईमेल", ar: "رقم الجوال أو البريد الإلكتروني" },
  signOut: { en: "Sign out", hi: "साइन आउट", ar: "تسجيل الخروج" },
  payBalance: { en: "Pay balance", hi: "बकाया भुगतान करें", ar: "ادفع المتبقي" },
  upload: { en: "Upload", hi: "अपलोड करें", ar: "رفع" },
  documents: { en: "Documents", hi: "दस्तावेज़", ar: "المستندات" },
  chooseOption: { en: "Choose your option", hi: "अपना विकल्प चुनें", ar: "اختر خيارك" },
  payOnline: { en: "Pay online", hi: "ऑनलाइन भुगतान", ar: "ادفع عبر الإنترنت" },
  payAdvance: { en: "Pay advance", hi: "अग्रिम भुगतान", ar: "ادفع العربون" },
  payFull: { en: "Pay in full", hi: "पूरा भुगतान", ar: "ادفع كامل المبلغ" },
  hold: { en: "Hold — pay later", hi: "होल्ड करें — बाद में भुगतान", ar: "احجز مؤقتًا — ادفع لاحقًا" },
  emi: { en: "Pay in EMIs", hi: "EMI में भुगतान", ar: "الدفع بالتقسيط" },
  coupon: { en: "Coupon code", hi: "कूपन कोड", ar: "رمز القسيمة" },
  apply: { en: "Apply", hi: "लागू करें", ar: "تطبيق" },
  chat: { en: "Chat with us", hi: "हमसे चैट करें", ar: "تحدث معنا" },
  chatHello: { en: "Hi! Tell us where and when you'd like to travel.", hi: "नमस्ते! बताइए आप कहाँ और कब यात्रा करना चाहते हैं।", ar: "مرحبًا! أخبرنا أين ومتى تود السفر." },
  startChat: { en: "Start chat", hi: "चैट शुरू करें", ar: "ابدأ المحادثة" },
  send: { en: "Send", hi: "भेजें", ar: "إرسال" },
  typeMessage: { en: "Type your message…", hi: "अपना संदेश लिखें…", ar: "اكتب رسالتك…" },
  language: { en: "Language", hi: "भाषा", ar: "اللغة" },
  travelDates: { en: "Travel dates", hi: "यात्रा की तारीख़ें", ar: "تواريخ السفر" },
  dob: { en: "Date of birth", hi: "जन्म तिथि", ar: "تاريخ الميلاد" },
  getQuote: { en: "Get price", hi: "कीमत देखें", ar: "اعرض السعر" },
  claims: { en: "Claims", hi: "क्लेम", ar: "المطالبات" },
  wallet: { en: "Wallet balance", hi: "वॉलेट बैलेंस", ar: "رصيد المحفظة" },
} as const;

export type Key = keyof typeof D;

const KEY = "voyadesk.lang";
function initial(): Lang {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "hi" || v === "ar" || v === "en") return v;
  } catch {
    /* storage blocked */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  return nav.startsWith("hi") ? "hi" : nav.startsWith("ar") ? "ar" : "en";
}

let current: Lang = typeof window !== "undefined" ? initial() : "en";
const subs = new Set<(l: Lang) => void>();

export function setLang(l: Lang) {
  current = l;
  try {
    window.localStorage.setItem(KEY, l);
  } catch {
    /* fine: kept for this visit */
  }
  subs.forEach((f) => f(l));
}

/** Translation hook for customer pages; also flips the page to right-to-left for Arabic. */
export function useLang() {
  const [lang, set] = useState<Lang>(current);
  useEffect(() => {
    subs.add(set);
    return () => void subs.delete(set);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    return () => {
      document.documentElement.dir = "ltr";
      document.documentElement.lang = "en";
    };
  }, [lang]);
  const t = (k: Key) => D[k][lang];
  return { lang, setLang, t };
}
