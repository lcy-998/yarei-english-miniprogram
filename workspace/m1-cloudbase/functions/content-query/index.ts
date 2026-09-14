import { createUnconfiguredFunction } from '../shared/unconfigured-function';

export const main = createUnconfiguredFunction('content-query', ['listReadingResources', 'getReadingResource', 'listVocabularyPacks', 'getVocabularyPack'] as const);
