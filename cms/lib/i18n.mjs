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
  // ---- Профили ----
  'Не е намерено.': 'Not found.',
  'Възникна вътрешна грешка.': 'An internal error occurred.',
  'Необходим е вход.': 'You need to sign in.',
  'Влезте в профила си, за да продължите.': 'Sign in to your account to continue.',
  'Невалиден или липсващ CSRF токен. Презаредете страницата.': 'Invalid or missing security token. Please reload the page.',
  'Потвърдете имейла си, за да продължите.': 'Confirm your email address to continue.',
  'Потвърдете имейла си, за да коментирате.': 'Confirm your email address to comment.',
  'Регистрацията временно не е налична.': 'Registration is temporarily unavailable.',
  'Изпращането на писма временно не е налично.': 'Sending emails is temporarily unavailable.',
  'Необходимо е да приемете правилата и политиката за поверителност.': 'You need to accept the community rules and the privacy policy.',
  'Твърде много опити. Опитайте по-късно.': 'Too many attempts. Please try again later.',
  'Твърде много неуспешни опити. Опитайте по-късно.': 'Too many failed attempts. Please try again later.',
  'Грешен имейл или парола.': 'Wrong email or password.',
  'Профилът е спрян. Свържете се с редакцията.': 'This account has been suspended. Please contact the editors.',
  'Проверете пощата си: изпратихме писмо с указания.': 'Check your inbox: we have sent you an email with instructions.',
  'Връзката е невалидна или е изтекла.': 'The link is invalid or has expired.',
  'Връзката е невалидна или е изтекла. Поискайте нова.': 'The link is invalid or has expired. Please request a new one.',
  'Имейлът е потвърден.': 'Your email address is confirmed.',
  'Имейлът вече е потвърден.': 'Your email address is already confirmed.',
  'Изпратихме ново писмо за потвърждение.': 'We have sent a new confirmation email.',
  'Ако има профил с този адрес, ще получите писмо с връзка за нова парола.': 'If an account exists for this address, you will receive an email with a link to set a new password.',
  'Паролата е сменена. Влезте с новата парола.': 'Your password has been changed. Sign in with the new password.',
  'Паролата е сменена. Излязохте от другите устройства.': 'Your password has been changed. You have been signed out on your other devices.',
  'Излязохте от другите устройства.': 'You have been signed out on your other devices.',
  'Текущата парола не е вярна.': 'The current password is not correct.',
  'Паролата не е вярна.': 'The password is not correct.',
  'Паролата е твърде дълга.': 'The password is too long.',
  'Паролата не бива да съдържа имейла ви.': 'The password must not contain your email address.',
  'Паролата е твърде проста.': 'The password is too simple.',
  'Невалиден език.': 'Invalid language.',
  'Профилът е изтрит.': 'Your account has been deleted.',
  'Името трябва да е между 2 и 40 знака.': 'The name must be between 2 and 40 characters.',
  'Очаква се списък.': 'A list is expected.',
  'Записът не е намерен.': 'The entry was not found.',
  'Оценката не е намерена.': 'The rating was not found.',
  'Порциите трябва да са цяло число от 1 до 48.': 'Servings must be a whole number from 1 to 48.',
  'Бележката е твърде дълга (най-много 500 знака).': 'The note is too long (at most 500 characters).',
  'Невалидна дата.': 'Invalid date.',
  'Коментарът ви очаква одобрение.': 'Your comment is awaiting approval.',
  'Този коментар не може да се редактира.': 'This comment cannot be edited.',
  'Коментарът е изтрит.': 'The comment has been deleted.',
  'Изберете причина за сигнала.': 'Choose a reason for the report.',
  'Не можете да докладвате собствен коментар.': 'You cannot report your own comment.',
  'Вече сте докладвали този коментар.': 'You have already reported this comment.',
  'Благодарим – ще го прегледаме.': 'Thank you – we will review it.',
  'Нямате права за това действие.': 'You do not have permission for this action.',
  'Непознато действие.': 'Unknown action.',
  'Посочете причина.': 'Please give a reason.',
  'Коментарът е изтрит от автора си.': 'The comment was deleted by its author.',
  'Профилът не е намерен.': 'The account was not found.',
  'Не можете да променяте собствената си роля или статус.': 'You cannot change your own role or status.',
  'Невалидна роля.': 'Invalid role.',
  'Невалиден статус.': 'Invalid status.',
};

// Съобщения с числа
const PATTERNS = [
  [/^Паролата трябва да е поне (\d+) знака\.$/, (m) => `The password must be at least ${m[1]} characters long.`],
  [/^Действието не е позволено за коментар със статус „(.+)“\.$/, () => 'This action is not allowed for a comment with this status.'],
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
