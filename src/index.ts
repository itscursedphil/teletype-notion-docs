import { decode } from 'html-entities';

import fetchDocs from './fetch';
import { readFile, writeFile } from './fs';
import { BlockObjectRequest, RichTextItemRequest } from './interfaces.d';
import config from './lib/config';
import notion, { fetchExample } from './lib/notion';
import { parseHTML } from './parser';

// TODO:
// - Parse lists
// - Parse tables in .OpList
// - Clean up and refactor

interface RichTextObjectRequest {
  text: RichTextItemRequest[];
}

const parseAnnotationsFromHTML =
  (
    matchRegex: RegExp,
    markupRegex: RegExp,
    annotation: 'bold' | 'italic' | 'strikethrough' | 'underline' | 'code'
  ) =>
  (html: string) => {
    const matches = html.match(matchRegex);

    if (!matches?.length) return html;

    return html.split(matchRegex).reduce((all, fragment, i) => {
      if (!matches[i]) return [...all, fragment];

      const text = matches[i].replace(markupRegex, '');

      const block: RichTextObjectRequest = {
        text: [
          {
            text: { content: decode(text) },
            annotations: { [annotation]: true },
          },
        ],
      };

      return [...all, fragment, block];
    }, [] as (RichTextObjectRequest | string)[]);
  };

const parseBoldAnnotationsFromHTML = parseAnnotationsFromHTML(
  /<strong>.*?<\/strong>/g,
  /<\/?strong>/g,
  'bold'
);

const parseItalicAnnotationsFromHTML = parseAnnotationsFromHTML(
  /<em>.*?<\/em>/g,
  /<\/?em>/g,
  'italic'
);

const parseCodeAnnotationsFromHTML = parseAnnotationsFromHTML(
  /<code>.*?<\/code>/g,
  /<\/?code>/g,
  'code'
);

const parseLinksFromHTML = (html: string) => {
  const regex = /<a href.+?\/a>/g;
  const matches = html.match(regex);

  if (!matches?.length) return html;

  return html.split(regex).reduce((all, fragment, i) => {
    if (!matches[i]) return [...all, fragment];

    const match = matches[i];
    const text = match.replace(/(<a .*?>|<\/a>)/g, '');
    const link = match.match(/<a href="(.+?)">/)[1];

    const block: RichTextObjectRequest = {
      text: [{ text: { content: text, link: { url: link } } }],
    };

    return [...all, fragment, block];
  }, [] as (RichTextObjectRequest | string)[]);
};

const transformNestedRichTextInput = (
  input: (RichTextObjectRequest | string)[],
  transform: (
    element: RichTextObjectRequest | string
  ) => RichTextObjectRequest | string | (RichTextObjectRequest | string)[]
) =>
  input
    .map((i) => (typeof i === 'string' ? transform(i) : i))
    .reduce<(RichTextObjectRequest | string)[]>((reduced, element) => {
      if (Array.isArray(element)) return [...reduced, ...element];

      return [...reduced, element];
    }, []);

const parseRichTextFromHTML = (html: string): RichTextObjectRequest => {
  const parsed = [
    parseBoldAnnotationsFromHTML,
    parseItalicAnnotationsFromHTML,
    parseCodeAnnotationsFromHTML,
    parseLinksFromHTML,
  ]
    // Apply all transformations and reduce to flat array in each iteration
    .reduce(
      (output, transform) => transformNestedRichTextInput(output, transform),
      [html] as (RichTextObjectRequest | string)[]
    )
    // Transform all left strings without annotations
    .map((p) => {
      if (typeof p !== 'string') return p;

      return {
        text: [{ text: { content: p } }],
      };
    })
    // Reduce into rich text object
    .reduce(
      (output, el) => ({
        text: [...output.text, ...el.text],
      }),
      {
        text: [],
      } as RichTextObjectRequest
    );

  return parsed;
};

const parseBlockFromElement = (element: Element): BlockObjectRequest | null => {
  if (element.tagName.toLowerCase() === 'h2') {
    return {
      heading_1: {
        text: [{ text: { content: element.textContent } }],
      },
    };
  }

  if (element.tagName.toLowerCase() === 'p') {
    const { text } = parseRichTextFromHTML(element.innerHTML);

    return {
      paragraph: {
        text,
      },
    };
  }

  if (element.tagName.toLowerCase() === 'pre') {
    const code = element.querySelector('code').textContent;

    return {
      code: {
        text: [{ text: { content: code } }],
        language: 'plain text',
      },
    };
  }

  return null;
};

const getDocs = async () => {
  try {
    const docs = await readFile('docs.html');
    console.log('Successfully loaded docs from downloads folder');

    return docs;
  } catch (err) {
    console.log('Docs file does not exist, fetching');

    const docs = await fetchDocs();
    await writeFile(docs.replace(/\n\s+/g, '\n'), 'docs.html');
    return docs;
  }
};

const getExample = async () => {
  try {
    const example = await readFile('page.json');
    console.log('Successfully loaded example from downloads folder');

    return example;
  } catch (err) {
    console.log('Example file does not exist, fetching');

    const example = await fetchExample();
    await writeFile(JSON.stringify(example, null, 4), 'page.json');
    return example;
  }
};

const init = async () => {
  await getExample();
  const docs = await getDocs();
  const dom = parseHTML(docs);
  const content = Array.from(
    dom.window.document.querySelector('.Content-inner').children
  );
  const sections = content.reduce((reducedSections, element) => {
    if (!reducedSections.length && element.tagName.toLowerCase() !== 'h1')
      return [];

    if (element.tagName.toLocaleLowerCase() === 'h1')
      return [...reducedSections, [element]];

    return reducedSections.map((s, i) =>
      i < reducedSections.length - 1 ? s : [...s, element]
    );
  }, [] as any as [Element[]]);
  const opsSection = sections.find(
    (section) => section[0].id === 'ops-and-mods'
  );

  const blocks = opsSection
    .map((el) => parseBlockFromElement(el))
    .filter((v) => !!v);

  await writeFile(JSON.stringify(blocks, null, 2), 'output.json');

  // notion.pages.create({
  //   parent: { page_id: config.notion.pageId },
  //   properties: { title: [{ text: { content: 'Ops' } }] },
  //   children: blocks,
  // });
};

init();
