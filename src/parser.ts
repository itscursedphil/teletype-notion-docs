import { JSDOM } from 'jsdom';

export const parseHTML = (domString: string) => {
  return new JSDOM(domString, { pretendToBeVisual: true });
};
