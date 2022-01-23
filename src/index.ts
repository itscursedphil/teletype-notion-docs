/* eslint-disable camelcase */
import fetchDocs from './fetch';
import { readFile, writeFile } from './fs';
import { BlockObjectRequest, ListBlockChildrenResponse } from './interfaces.d';
import config from './lib/config';
import notion, {
  ChildPageResponse,
  fetchExample,
  getChildPagesFromBlockChildrenResults,
  getOrCreateChildPage,
  getPageBlocks,
} from './lib/notion';
import { parseBlocksFromDOMElement, parseHTML } from './parser';

// TODO:
// - Fix links that include code
// - Highlight paragraphs that start with "Warning"
// - Parse .AlphaOpList
// - Clean up and refactor

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
    const example = await readFile('example.json');
    console.log('Successfully loaded example from downloads folder');

    return example;
  } catch (err) {
    console.log('Example file does not exist, fetching');

    const example = await fetchExample();
    await writeFile(JSON.stringify(example, null, 4), 'example.json');
    return example;
  }
};

const chunkList = <T>(list: T[], chunkLimit: number) =>
  list.reduce(
    (sets, block) => {
      const currentSet = sets[sets.length - 1];

      if (!currentSet.length || currentSet.length % chunkLimit)
        return [...sets.slice(0, -1), [...currentSet, block]];

      return [...sets, [block]];
    },
    [[]] as T[][]
  );

const addBlockChunksToPage = async (
  pageId: string,
  chunks: BlockObjectRequest[][]
) => {
  const currentChunk = chunks[0];

  console.log(`\nAdding chunk of length ${currentChunk.length}`);

  if (!config.dry) {
    await notion.blocks.children.append({
      block_id: pageId,
      children: currentChunk,
    });

    await new Promise((res) => setTimeout(res, 200));
  }

  console.log(`Finished adding chunk of length ${currentChunk.length}\n`);

  if (chunks.length > 1) {
    await addBlockChunksToPage(pageId, chunks.slice(1));
  }
};

const updateSectionPagesSequentially = async (
  parentPageId: string,
  parentPageChildPages: ChildPageResponse[],
  sections: Element[][]
) => {
  const currentSection = sections[0];
  const currentSectionTitle = currentSection[0].textContent;

  console.log('-----');
  console.log(`\n${currentSectionTitle}`);

  const currentSectionBlocks = currentSection
    .map((el) => parseBlocksFromDOMElement(el))
    .filter((v) => !!v)
    .flat();

  // Cut blocks array into sets of 999 because of request limit of 1000 children
  const currentSectionBlockChunks = chunkList<BlockObjectRequest>(
    currentSectionBlocks,
    999
  );

  console.log(
    currentSectionBlockChunks.map((chunk) => chunk.length),
    currentSectionBlocks.length
  );

  const currentSectionPage = await getOrCreateChildPage(
    parentPageId,
    parentPageChildPages,
    currentSectionTitle
  );

  if (!config.dry) {
    await notion.blocks.children.append({
      block_id: currentSectionPage.id,
      children: [{ table_of_contents: {} }],
    });
  }

  await addBlockChunksToPage(currentSectionPage.id, currentSectionBlockChunks);

  console.log('-----');

  if (sections.length > 1) {
    await updateSectionPagesSequentially(
      parentPageId,
      parentPageChildPages,
      sections.slice(1)
    );
  }
};

const init = async () => {
  // await getExample();
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

  const titleSection = sections.filter((s, i) => i === 0).map((s) => s[0]);
  const versionString = titleSection[0].textContent.replace('Teletype ', '');

  const pageBlocks = await getPageBlocks(config.notion.pageId);
  const childPages = getChildPagesFromBlockChildrenResults(pageBlocks.results);

  const currentVersionPage = await getOrCreateChildPage(
    config.notion.pageId,
    childPages,
    versionString
  );
  const currentVersionPageBlocks = await getPageBlocks(currentVersionPage.id);
  const currentVersionChildPages = getChildPagesFromBlockChildrenResults(
    currentVersionPageBlocks.results
  );

  const contentSections = sections.filter((s, i) => i > 0);

  await updateSectionPagesSequentially(
    currentVersionPage.id,
    currentVersionChildPages,
    contentSections
  );
};

init();
