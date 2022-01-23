import config from 'config';

export interface NotionConfig {
  secret: string;
  pageId: string;
}

export interface Config {
  notion: NotionConfig;
  dry: boolean;
}

export default config.util.toObject() as Config;
