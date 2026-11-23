import {
  asteriskCensorStrategy,
  englishDataset,
  englishRecommendedTransformers,
  RegExpMatcher,
  TextCensor,
} from 'obscenity';

// The obscenity package's English list, with its look-alike handling
// ("sh1t", "fuuuck") - and its whitelist, so "Scunthorpe" and
// "assessment" pass.
const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});
const censor = new TextCensor().setStrategy(asteriskCensorStrategy());

/** Whether the text holds a slur or obscenity - for names, which are
 * refused rather than masked. */
export function isProfane(text: string): boolean {
  return matcher.hasMatch(text);
}

/** The text with each slur or obscenity masked with asterisks - for chat
 * and messages, which go through. */
export function maskProfanity(text: string): string {
  const matches = matcher.getAllMatches(text);
  return matches.length === 0 ? text : censor.applyTo(text, matches);
}
