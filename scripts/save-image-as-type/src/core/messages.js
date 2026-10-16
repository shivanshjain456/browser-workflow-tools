/**
 * New configuration-boundary messages live here, never inside validation logic.
 * English is the explicit fallback. This small catalogue is NOT a claim that
 * the legacy UI is translated; full extraction/locale selection is G-20 work.
 * A missing key falls back visibly rather than producing an empty label.
 */
export const CONFIG_MESSAGES = Object.freeze({
  en: Object.freeze({ importTooLarge: 'That file is too large to be a settings file.', tooLarge: 'Configuration JSON is too large (maximum 1 MiB of text).' }),
});
export function configMessage(key, language = 'en') {
  const catalogue = CONFIG_MESSAGES[language] || CONFIG_MESSAGES.en;
  return catalogue[key] || CONFIG_MESSAGES.en[key] || 'Translation unavailable';
}

/**
 * Message catalogue for newly added interface strings.
 *
 * Scope, stated honestly: the rest of this interface is still English-only
 * inline text. Catalogue-wide extraction, right-to-left layout for every
 * existing dialog and all remaining languages are G-20/G-21 work that is NOT
 * claimed here. What this module guarantees is narrower and testable — every
 * string ADDED by the configuration-profile feature exists in every catalogue,
 * the lookup never invents a key, and text direction is derived from the
 * catalogue rather than guessed per string.
 *
 * Strings are the *interface* only. File names, error codes and anything that
 * reaches `textContent` from data stay in the caller's own namespace.
 */

export const UI_MESSAGES = Object.freeze({
  en: Object.freeze({
    profileSection: 'Configuration profiles',
    profileIntro:
      'A profile is a named snapshot of your whole configuration — formats, quality, naming, shortcuts, batch and site behaviour. Conversion presets stay per-conversion; applying a profile switches everything at once. Profiles are stored with your settings, so Export JSON includes them.',
    profileListLabel: 'Saved profiles',
    profileName: 'Profile name',
    profileNamePlaceholder: 'Work laptop',
    profileSave: 'Save current settings as a profile',
    profileApply: 'Apply',
    profileDelete: 'Delete',
    profileEmpty: 'No profiles yet. Name the current configuration and save it to switch between setups later.',
    profileLimit: 'Only {max} profiles are kept; delete one first.',
    profileNameRequired: 'Give the profile a name first.',
    profileSaved: 'Profile “{name}” added. Press Save at the bottom to store it.',
    profileApplied: 'Applied the profile “{name}”. Every saved setting now uses it.',
    profileDeleted: 'Profile “{name}” deleted. Press Save at the bottom to store the change.',
    profileApplyFailed: 'The profile could not be applied: {reason}',
  }),
  ar: Object.freeze({
    profileSection: 'ملفات الإعدادات',
    profileIntro:
      'الملف هو نسخة مُسمّاة من إعداداتك الكاملة — الصيغ والجودة والتسمية والاختصارات والدفعات وقواعد المواقع. تبقى الإعدادات المسبقة لكل عملية تحويل، أما تطبيق الملف فيبدّل كل شيء دفعة واحدة. تُخزَّن الملفات مع إعداداتك، لذا يشمل «تصدير JSON» جميعها.',
    profileListLabel: 'الملفات المحفوظة',
    profileName: 'اسم الملف',
    profileNamePlaceholder: 'حاسوب العمل',
    profileSave: 'احفظ الإعدادات الحالية كملف',
    profileApply: 'تطبيق',
    profileDelete: 'حذف',
    profileEmpty: 'لا توجد ملفات بعد. سمِّ الإعدادات الحالية واحفظها للتبديل بينها لاحقًا.',
    profileLimit: 'يُحتفظ بـ{max} ملفات فقط؛ احذف واحدًا أولًا.',
    profileNameRequired: 'أدخل اسمًا للملف أولًا.',
    profileSaved: 'تمت إضافة الملف «{name}». اضغط «حفظ» في الأسفل لتخزينه.',
    profileApplied: 'تم تطبيق الملف «{name}». كل الإعدادات المحفوظة تستخدمه الآن.',
    profileDeleted: 'تم حذف الملف «{name}». اضغط «حفظ» في الأسفل لتخزين التغيير.',
    profileApplyFailed: 'تعذّر تطبيق الملف: {reason}',
  }),
  hi: Object.freeze({
    profileSection: 'कॉन्फ़िगरेशन प्रोफ़ाइल',
    profileIntro:
      'प्रोफ़ाइल आपकी पूरी सेटिंग की नामित प्रति है — फ़ॉर्मैट, क्वालिटी, नामकरण, शॉर्टकट, बैच और साइट व्यवहार। कन्वर्ज़न प्रीसेट हर बार के लिए अलग रहते हैं; प्रोफ़ाइल लागू करने पर सब कुछ एक साथ बदल जाता है। प्रोफ़ाइल आपकी सेटिंग के साथ संग्रहीत होती हैं, इसलिए JSON निर्यात में सब शामिल होती हैं।',
    profileListLabel: 'सहेजी गई प्रोफ़ाइल',
    profileName: 'प्रोफ़ाइल नाम',
    profileNamePlaceholder: 'ऑफ़िस लैपटॉप',
    profileSave: 'मौजूदा सेटिंग को प्रोफ़ाइल के रूप में सहेजें',
    profileApply: 'लागू करें',
    profileDelete: 'हटाएँ',
    profileEmpty: 'अभी कोई प्रोफ़ाइल नहीं है। मौजूदा सेटिंग को नाम देकर सहेजें, ताकि बाद में बदल सकें।',
    profileLimit: 'केवल {max} प्रोफ़ाइल रखी जाती हैं; पहले एक हटाएँ।',
    profileNameRequired: 'पहले प्रोफ़ाइल का नाम लिखें।',
    profileSaved: 'प्रोफ़ाइल “{name}” जोड़ी गई। संग्रहीत करने के लिए नीचे सेव दबाएँ।',
    profileApplied: 'प्रोफ़ाइल “{name}” लागू हुई। अब हर सहेजी गई सेटिंग उसी का उपयोग करती है।',
    profileDeleted: 'प्रोफ़ाइल “{name}” हटाई गई। बदलाव संग्रहीत करने के लिए नीचे सेव दबाएँ।',
    profileApplyFailed: 'प्रोफ़ाइल लागू नहीं हो सकी: {reason}',
  }),
});

/** Right-to-left scripts rotate the whole section, not individual strings. */
export const RTL_LANGUAGES = Object.freeze(['ar', 'fa', 'he', 'ur']);

export const DEFAULT_LANGUAGE = 'en';

/** `en-GB` → `en`; unknown tags fall back, never throw. */
export function baseLanguage(tag) {
  return String(tag == null ? '' : tag).trim().toLowerCase().split(/[-_]/)[0];
}

/**
 * First supported language in preference order, else the default.
 * `tags` is usually [documentElement.lang, ...navigator.languages].
 */
export function resolveLanguage(tags) {
  for (const tag of Array.isArray(tags) ? tags : [tags]) {
    const base = baseLanguage(tag);
    if (base && Object.prototype.hasOwnProperty.call(UI_MESSAGES, base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

export function directionFor(language) {
  return RTL_LANGUAGES.includes(baseLanguage(language)) ? 'rtl' : 'ltr';
}

/**
 * @param {string} language resolved language id
 * @returns {{language:string,direction:'ltr'|'rtl',t:(key:string,params?:object)=>string}}
 * @throws when asked for a key no catalogue defines — a missing string must fail
 *   loudly in tests rather than render a raw identifier to the user.
 */
export function createTranslator(language) {
  const chosen = Object.prototype.hasOwnProperty.call(UI_MESSAGES, baseLanguage(language)) ? baseLanguage(language) : DEFAULT_LANGUAGE;
  const table = UI_MESSAGES[chosen];
  const fallback = UI_MESSAGES[DEFAULT_LANGUAGE];
  const t = (key, params) => {
    const template = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : fallback && Object.prototype.hasOwnProperty.call(fallback, key) ? fallback[key] : null;
    if (template === null) throw new Error(`Unknown message key: ${key}`);
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
    );
  };
  return { language: chosen, direction: directionFor(chosen), t };
}

/** Sortable, test-facing view of every catalogue's keys. */
export function catalogueKeys() {
  return Object.keys(UI_MESSAGES).reduce((map, language) => {
    map[language] = Object.keys(UI_MESSAGES[language]).sort();
    return map;
  }, {});
}

/** Language chosen from a document without a new setting or stored key: the
 *  page's explicit `lang` attribute wins, then the browser's own preference
 *  order. Page storage is never read. */
export function languageFromDocument(doc) {
  const element = doc && doc.documentElement;
  const navigatorObject = doc && doc.defaultView ? doc.defaultView.navigator : null;
  const requested = navigatorObject && navigatorObject.languages ? navigatorObject.languages : [];
  return resolveLanguage([element && element.lang, ...(Array.isArray(requested) ? requested : [requested])]);
}
