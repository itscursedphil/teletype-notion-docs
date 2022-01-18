import { Client } from '@notionhq/client';

import config from './config';

const notion = new Client({
  auth: config.notion.secret,
});

export const fetchExample = () =>
  notion.blocks.children.list({ block_id: config.notion.pageId });

export default notion;
