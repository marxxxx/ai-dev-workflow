// The user-facing texts the simulated user speaks (opening, default answers, nudge), per language.
export const LANGUAGES = ['en', 'de'];

const QUESTIONS = ['Offer to skip the questions and just start', 'Should the agent test end to end or the user manually', 'Approve the implementation plan',
  'Isolation / worktree choice', 'Create a new ticket'];

const defaults = (answers) => answers.map((answer, i) => ({ id: `A${i + 1}`, question: QUESTIONS[i], answer, source: 'default' }));

const TEXTS = {
  en: {
    opening: (ticket) => `Use the agent-dev skill for ticket ${ticket}.`,
    defaultAnswers: defaults(["No, please ask your questions, don't skip them.", "Please test end to end yourself, I won't test manually.",
      'The plan is approved, take the option you recommend.', 'Take the option you recommend.', 'No, no new ticket, the ticket already exists.']),
    continueText: 'Carry on and report back when you have results or need a decision from me.',
    replyLanguage: 'English',
  },
  de: {
    opening: (ticket) => `Nutze den agent-dev Skill für Ticket ${ticket}.`,
    defaultAnswers: defaults(['Nein, bitte stell deine Fragen, überspring sie nicht.', 'Teste bitte selbst Ende-zu-Ende, ich teste nicht manuell.',
      'Der Plan ist freigegeben, nimm die von dir empfohlene Option.', 'Nimm die von dir empfohlene Option.', 'Nein, kein neues Ticket, das Ticket existiert bereits.']),
    continueText: 'Mach weiter und melde dich, wenn du Ergebnisse hast oder eine Entscheidung von mir brauchst.',
    replyLanguage: 'German',
  },
};

export const textsFor = (lang) => TEXTS[lang];

const GERMAN = ['der', 'die', 'das', 'und', 'nicht', 'ist', 'mit', 'für'];
const ENGLISH = ['the', 'and', 'is', 'with', 'for', 'not'];

// German when its stop words outnumber the English ones in the text, else English.
export function detectLanguage(text) {
  const words = String(text).toLowerCase().match(/[\p{L}]+/gu) ?? [];
  const count = (list) => words.filter((w) => list.includes(w)).length;
  return count(GERMAN) > count(ENGLISH) ? 'de' : 'en';
}
