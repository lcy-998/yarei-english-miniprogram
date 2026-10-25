import type { PronunciationScore, RecognitionResult } from './types';

export const VOICE_MODEL_VERSION = 'vosk-model-small-en-us-0.15';
export const VOICE_ALGORITHM_VERSION = 'experimental-word-alignment-v1';

function tokens(value: string): string[] {
  return value.toLowerCase().replace(/['’]/g, '').match(/[a-z]+/g) ?? [];
}

export type ScoreDecision = Readonly<{ status: 'scored'; score: PronunciationScore }>
  | Readonly<{ status: 'unreliable'; qualityReason: 'NO_SPEECH' | 'LOW_CONFIDENCE' | 'INCOMPLETE' }>;

/** Deliberately conservative: recognition confidence is only a clarity proxy. */
export function scoreRecognition(referenceText: string, recognition: RecognitionResult): ScoreDecision {
  const expected = tokens(referenceText);
  const heard = recognition.words.filter(word => Number.isFinite(word.confidence)
    && word.confidence >= 0 && word.confidence <= 1 && Number.isFinite(word.start)
    && Number.isFinite(word.end) && word.end >= word.start);
  if (expected.length === 0 || heard.length === 0) return { status: 'unreliable', qualityReason: 'NO_SPEECH' };
  const actual = heard.map(word => tokens(word.word)[0] ?? '');
  const aligned: number[] = [];
  let next = 0;
  for (const target of expected) {
    const index = actual.indexOf(target, next);
    if (index >= 0) { aligned.push(index); next = index + 1; }
  }
  const coverage = aligned.length / expected.length;
  if (coverage < 0.5) return { status: 'unreliable', qualityReason: 'INCOMPLETE' };
  const confidence = aligned.reduce((sum, index) => sum + heard[index]!.confidence, 0) / aligned.length;
  if (confidence < 0.55) return { status: 'unreliable', qualityReason: 'LOW_CONFIDENCE' };
  const speechSeconds = Math.max(0.1, heard[heard.length - 1]!.end - heard[0]!.start);
  const expectedSeconds = Math.max(0.5, expected.length / 2.4);
  const pacing = Math.max(0, 1 - Math.abs(speechSeconds - expectedSeconds) / Math.max(speechSeconds, expectedSeconds));
  let pauseSeconds = 0;
  for (let index = 1; index < heard.length; index += 1) {
    pauseSeconds += Math.max(0, heard[index]!.start - heard[index - 1]!.end - 0.35);
  }
  const pausePenalty = Math.min(0.5, pauseSeconds / Math.max(1, speechSeconds));
  const round = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
  const score: PronunciationScore = {
    pronunciation: round(confidence * 100),
    fluency: round((pacing - pausePenalty) * 100),
    completeness: round(coverage * 100),
    total: 0,
  };
  return { status: 'scored', score: { ...score,
    total: round(score.pronunciation * 0.4 + score.fluency * 0.25 + score.completeness * 0.35) } };
}
