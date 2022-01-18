import { AppendBlockChildrenParameters } from '@notionhq/client/build/src/api-endpoints';
import { decode } from 'html-entities';

import fetchDocs from './fetch';
import { readFile, writeFile } from './fs';
import config from './lib/config';
import notion, { fetchExample } from './lib/notion';
import { parseHTML } from './parser';

// TODO:
// - Parse lists
// - Parse tables in .OpList
// - Clean up and refactor

type Flatten<Type> = Type extends Array<infer Item> ? Item : Type;

type BlockParameters = Flatten<AppendBlockChildrenParameters['children']>;

const parseBlocksFromParagraph = (
  paragraph: (BlockParameters | string)[],
  parseElement: (
    element: BlockParameters | string
  ) => BlockParameters | string | (BlockParameters | string)[]
) =>
  paragraph
    .map(parseElement)
    .reduce<(BlockParameters | string)[]>((reduced, element) => {
      if (Array.isArray(element)) return [...reduced, ...element];

      return [...reduced, element];
    }, []);

const parseAnnotationBlocksFromParagraph =
  (
    matchRegex: RegExp,
    markupRegex: RegExp,
    annotation: 'bold' | 'italic' | 'strikethrough' | 'underline' | 'code'
  ) =>
  (paragraph: (BlockParameters | string)[]) =>
    parseBlocksFromParagraph(paragraph, (p) => {
      if (typeof p !== 'string') return p;

      const matches = p.match(matchRegex);

      if (!matches?.length) return p;

      return p.split(matchRegex).reduce((all, fragment, i) => {
        if (!matches[i]) return [...all, fragment];

        const text = matches[i].replace(markupRegex, '');

        const block: BlockParameters = {
          type: 'paragraph',
          paragraph: {
            text: [
              {
                text: { content: decode(text) },
                annotations: { [annotation]: true },
              },
            ],
          },
        };

        return [...all, fragment, block];
      }, [] as (BlockParameters | string)[]);
    });

const parseBoldBlocksFromParagraph = parseAnnotationBlocksFromParagraph(
  /<strong>.*?<\/strong>/g,
  /<\/?strong>/g,
  'code'
);

const parseItalicBlocksFromParagraph = parseAnnotationBlocksFromParagraph(
  /<em>.*?<\/em>/g,
  /<\/?em>/g,
  'code'
);

const parseCodeBlocksFromParagraph = parseAnnotationBlocksFromParagraph(
  /<code>.*?<\/code>/g,
  /<\/?code>/g,
  'code'
);

const parseLinkBlocksFromParagraph = (
  paragraph: (BlockParameters | string)[]
) =>
  parseBlocksFromParagraph(paragraph, (p) => {
    if (typeof p !== 'string') return p;

    const regex = /<a href.+?\/a>/g;

    const matches = p.match(regex);

    if (!matches?.length) return p;

    return p.split(regex).reduce((all, fragment, i) => {
      if (!matches[i]) return [...all, fragment];

      const match = matches[i];
      const text = match.replace(/(<a .*?>|<\/a>)/g, '');
      const link = match.match(/<a href="(.+?)">/)[1];

      const block: BlockParameters = {
        type: 'paragraph',
        paragraph: {
          text: [{ text: { content: text, link: { url: link } } }],
        },
      };

      return [...all, fragment, block];
    }, [] as (BlockParameters | string)[]);
  });

const parseTextBlocksFromParagraph = (
  paragraph: (BlockParameters | string)[]
): BlockParameters[] =>
  paragraph.map((p) => {
    if (typeof p !== 'string') return p;

    return {
      type: 'paragraph',
      paragraph: {
        text: [{ text: { content: p } }],
      },
    };
  });

const parseParagraph = (paragraph: string): BlockParameters[] => {
  const parsed = [
    parseBoldBlocksFromParagraph,
    parseItalicBlocksFromParagraph,
    parseCodeBlocksFromParagraph,
    parseLinkBlocksFromParagraph,
    parseTextBlocksFromParagraph,
  ].reduce((output, transform) => transform(output), [paragraph] as (
    | BlockParameters
    | string
  )[]);

  return parsed as any as BlockParameters[];
};

const parseBlockFromElement = (element: Element): BlockParameters | null => {
  if (element.tagName.toLowerCase() === 'h2') {
    return {
      heading_1: {
        text: [{ text: { content: element.textContent } }],
      },
    };
  }

  if (element.tagName.toLowerCase() === 'p') {
    return parseParagraph(element.innerHTML).reduce<BlockParameters>(
      (output, el) => {
        if (
          typeof el === 'string' ||
          el.type !== 'paragraph' ||
          output.type !== 'paragraph'
        )
          return output;

        return {
          type: 'paragraph',
          paragraph: {
            ...output.paragraph,
            text: [...output.paragraph.text, ...el.paragraph.text],
          },
        };
      },
      {
        type: 'paragraph',
        paragraph: {
          text: [],
        },
      }
    );
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
