import fetchDocs from './fetch';
import { readFile, writeFile } from './fs';
import { BlockObjectRequest } from './interfaces.d';
import config from './lib/config';
import notion, { fetchExample } from './lib/notion';
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

  const opsSection = sections.find(
    (section) => section[0].id === 'ops-and-mods'
  );

  const blocks = opsSection
    .map((el) => parseBlocksFromDOMElement(el))
    .filter((v) => !!v)
    .flat();

  await writeFile(JSON.stringify(blocks, null, 2), 'output.json');

  // Cut blocks array into sets of 999 because of request limit of 1000 children
  const blockChunks = chunkList<BlockObjectRequest>(blocks, 999);

  console.log(
    blockChunks.map((chunk) => chunk.length),
    blocks.length
  );

  // const page = await notion.pages.create({
  //   parent: { page_id: config.notion.pageId },
  //   properties: { title: [{ text: { content: opsSection[0].textContent } }] },
  //   children: [{ table_of_contents: {} }],
  // });

  // const addBlockChunksToPage = async (chunks: BlockObjectRequest[][]) => {
  //   const currentSet = chunks[0];

  //   console.log(currentSet.length);

  //   await notion.blocks.children.append({
  //     block_id: page.id,
  //     children: currentSet,
  //   });

  //   await new Promise((res) => setTimeout(res, 200));

  //   if (chunks.length > 1) {
  //     await addBlockChunksToPage(chunks.slice(1));
  //   }
  // };

  // await addBlockChunksToPage(blockChunks);
};

init();
