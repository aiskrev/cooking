// Езици на публичния сайт и превод на съобщенията на публичния API.
// Сървърът пази съобщенията на български (основният език); когато браузърът изпрати заглавка „x-site-language: en“,
// отговорите на /api/public/* се превеждат тук. Езикът се проверява строго по списък – друга стойност се игнорира.
export const LOCALES = ['bg', 'en'];
export const DEFAULT_LOCALE = 'bg';
export const isLocale = (v) => typeof v === 'string' && LOCALES.includes(v);

/** Език на заявката от заглавката x-site-language (само bg/en; иначе – основният) */
export const requestLocale = (c) => {
  const v = (c.req.header('x-site-language') || '').trim().toLowerCase();
  return isLocale(v) ? v : DEFAULT_LOCALE;
};

const EXACT = {
  'Заявката е твърде голяма.': 'The request is too large.',
  'Заявката е от друг произход.': 'The request comes from a different origin.',
  'Очаква се JSON.': 'JSON is expected.',
  'Невалиден JSON.': 'Invalid JSON.',
  'Рецептата не е намерена.': 'The recipe was not found.',
  'Проверката срещу автоматични съобщения не успя.': 'The anti-spam check failed.',
  'Благодарим ви! Коментарът ще се покаже, след като бъде одобрен.': 'Thank you! Your comment will appear once it has been approved.',
  'Оценката трябва да е цяло число от 1 до 5.': 'The rating must be a whole number from 1 to 5.',
  'Не можете да оценявате.': 'You cannot leave ratings.',
  'Не можете да коментирате.': 'You cannot comment.',
  'Не можете да отбелязвате.': 'You cannot mark recipes.',
  'Твърде много заявки. Опитайте по-късно.': 'Too many requests. Please try again later.',
  'Твърде много заявки.': 'Too many requests.',
  'Оценката ви е премахната от администратор.': 'Your rating has been removed by an administrator.',
  'Името не може да съдържа връзки или имейл адреси.': 'The name cannot contain links or email addresses.',
  'Коментарът е твърде кратък.': 'The comment is too short.',
  'Коментарите не могат да съдържат връзки.': 'Comments cannot contain links.',
  'Невалиден имейл адрес.': 'Invalid email address.',
  'Коментарът, на който отговаряте, не е наличен.': 'The comment you are replying to is not available.',
  'Достигнато е максималното ниво на отговори.': 'The maximum reply depth has been reached.',
  'Този коментар вече е изпратен.': 'This comment has already been sent.',
  'Изпращате твърде често. Опитайте след малко.': 'You are sending too often. Please try again in a moment.',
  'Коментарът не е намерен.': 'The comment was not found.',
};

// Съобщения с числа
const PATTERNS = [
  [/^Името трябва да е между 2 и (\d+) знака\.$/, (m) => `The name must be between 2 and ${m[1]} characters.`],
  [/^Коментарът е твърде дълъг \(най-много (\d+) знака\)\.$/, (m) => `The comment is too long (at most ${m[1]} characters).`],
];

export function translateMessage(msg, locale) {
  if (locale === 'bg' || typeof msg !== 'string') return msg;
  if (EXACT[msg]) return EXACT[msg];
  for (const [re, fn] of PATTERNS) { const m = re.exec(msg); if (m) return fn(m); }
  return msg;
}

/** Превежда полетата „error“ и „message“ на JSON отговор (по една позиция дълбочина) */
export function translateBody(body, locale) {
  if (locale === 'bg' || !body || typeof body !== 'object') return body;
  const out = { ...body };
  for (const k of ['error', 'message']) if (typeof out[k] === 'string') out[k] = translateMessage(out[k], locale);
  return out;
}
