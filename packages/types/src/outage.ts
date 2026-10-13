// Shared wording for outage headlines (status page, homepage list, WhatsApp
// share text and Open Graph tags), so every surface says the same thing.

export type OutageStatusWord = 'down' | 'slow' | 'dropping';

export const STATUS_LABELS: Record<OutageStatusWord, { en: string; ml: string; phrase: string }> = {
  down: { en: 'Down', ml: 'നെറ്റ് ഇല്ല', phrase: 'down' },
  slow: { en: 'Very slow', ml: 'വളരെ സ്ലോ', phrase: 'very slow' },
  dropping: { en: 'Keeps dropping', ml: 'ഇടയ്ക്കിടെ പോകുന്നു', phrase: 'dropping repeatedly' },
};

export const KIND_PHRASE = { broadband: 'home broadband', mobile: 'mobile data' } as const;

/** "5 people reported Kerala Vision down in Kakkanad in the last 30 min" */
export function outageHeadline(input: {
  reporters: number;
  provider: string;
  place: string;
  status: OutageStatusWord;
  windowMin: number;
}): string {
  const who = input.reporters === 1 ? '1 person' : `${input.reporters} people`;
  return `${who} reported ${input.provider} ${STATUS_LABELS[input.status].phrase} in ${input.place} in the last ${input.windowMin} min`;
}
