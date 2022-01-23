import { decode } from 'html-entities';
import { JSDOM } from 'jsdom';

import { BlockObjectRequest, RichTextItemRequest } from './interfaces.d';

export const parseHTML = (domString: string) => {
  return new JSDOM(domString, { pretendToBeVisual: true });
};

interface RichTextObjectRequest {
  text: RichTextItemRequest[];
}

const parseRichTextAnnotationsFromHTML =
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

const parseBoldRichTextAnnotationsFromHTML = parseRichTextAnnotationsFromHTML(
  /<strong>.*?<\/strong>/g,
  /<\/?strong>/g,
  'bold'
);

const parseItalicRichTextAnnotationsFromHTML = parseRichTextAnnotationsFromHTML(
  /<em>.*?<\/em>/g,
  /<\/?em>/g,
  'italic'
);

const parseCodeRichTextAnnotationsFromHTML = parseRichTextAnnotationsFromHTML(
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
    parseBoldRichTextAnnotationsFromHTML,
    parseItalicRichTextAnnotationsFromHTML,
    parseCodeRichTextAnnotationsFromHTML,
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

const parseOpList = (element: Element) => {
  const rows = Array.from(element.querySelectorAll('table tr'));
  const ops = rows
    .map((row) => {
      const cols = Array.from(row.querySelectorAll('td'));
      return cols
        .map<BlockObjectRequest | BlockObjectRequest[]>((col, i) => {
          // First three cols in oplist are ops
          if (i < 3) {
            return {
              paragraph: {
                text: [
                  {
                    text: {
                      content: decode(col.textContent),
                    },
                    annotations: {
                      code: true,
                      bold: true,
                    },
                  },
                ],
              },
            };
          }

          // Last col in oplist is description
          const htmlInput = col.innerHTML
            // Parse numbered lists
            .replace(/<br>\s*(\d+)\.\s*/g, '\n$1. ')
            // Parse unnumbered lists with dash decorator
            .replace(/<br>\s*-\s*/g, '\n- ')
            // Parse unnumbered lists with star decorator
            .replace(/<br>\s*\*\s*/g, '\n- ')
            // Parse paragraph line breaks
            .replace(/<br><br>/g, '\n\n')
            // Remove unneccessary line breaks
            .replace(/<br>/g, ' ');

          const codeParts = Array.from(col.getElementsByTagName('code'))
            .map((el) => el.textContent)
            .filter((code) => code.includes('<br/>'))
            .map((code) => {
              return code
                .replace(/^<br\/>/, '')
                .replace(/<br\/>$/, '')
                .replace(/<br\/>/g, '\n')
                .replace(/\s{2,}/g, ' ')
                .replace(/^text /, '');
            });

          const htmlParts = htmlInput.split(/<code>(?:text)?&lt;.*?<\/code>/);

          return htmlParts.reduce((blocks, htmlPart, idx) => {
            const { text } = parseRichTextFromHTML(htmlPart);
            const codePart = codeParts[idx];

            const paragraphBlock = {
              paragraph: {
                text,
              },
            };

            if (!codePart) return [...blocks, paragraphBlock];

            const codeBlock: BlockObjectRequest = {
              code: {
                text: [{ text: { content: codePart } }],
                language: 'json',
              },
            };

            return [...blocks, paragraphBlock, codeBlock];
          }, [] as BlockObjectRequest[]);
        })
        .concat({ divider: {} });
    })
    .flat(2);

  return ops;
};

export const parseBlocksFromDOMElement = (
  element: Element
): BlockObjectRequest | BlockObjectRequest[] | null => {
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
        language: 'json',
      },
    };
  }

  if (element.tagName.toLocaleLowerCase() === 'ul') {
    const listItems = Array.from(element.children);

    return listItems.map((item) => {
      const { text } = parseRichTextFromHTML(item.innerHTML);
      return {
        bulleted_list_item: {
          text,
        },
      };
    });
  }

  if (element.className.toLowerCase() === 'oplist') {
    return parseOpList(element);
  }

  console.log(
    'Element could not be parsed',
    element.tagName,
    element.id,
    element.className
  );

  return null;
};
