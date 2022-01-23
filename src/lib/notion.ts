/* eslint-disable camelcase */
import { Client } from '@notionhq/client';

import {
  CreatePageResponse,
  GetPageResponse,
  ListBlockChildrenResponse,
} from '../interfaces.d';
import config from './config';

export interface ChildPageResponse {
  type: 'child_page';
  child_page: {
    title: string;
  };
  object: 'block';
  id: string;
  created_time: string;
  last_edited_time: string;
  has_children: boolean;
  archived: boolean;
}

const notion = new Client({
  auth: config.notion.secret,
});

export const fetchExample = () =>
  notion.blocks.children.list({ block_id: config.notion.pageId });

export const getPageBlocks = async (pageId: string) =>
  !config.dry
    ? notion.blocks.children.list({
        block_id: pageId,
      })
    : ({ results: [] } as ListBlockChildrenResponse);

export const getChildPagesFromBlockChildrenResults = (
  results: ListBlockChildrenResponse['results']
) =>
  !config.dry
    ? (results.filter(
        (item) => 'type' in item && item.type === 'child_page'
      ) as any as ChildPageResponse[])
    : ([] as ChildPageResponse[]);

export const getOrCreateChildPage = async (
  parentPageId: string,
  pages: ChildPageResponse[],
  title: string
): Promise<CreatePageResponse | GetPageResponse> => {
  if (config.dry) return new Promise((res) => res({} as GetPageResponse));

  const existingChildPage = pages.find(
    (page) => page.child_page.title === title
  );

  if (existingChildPage) {
    return notion.pages.retrieve({ page_id: existingChildPage.id });
  }

  const createdChildPage = await notion.pages.create({
    parent: { page_id: parentPageId },
    properties: { title: { title: [{ text: { content: title } }] } },
  });

  return createdChildPage;
};

export default notion;
