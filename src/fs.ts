import fs from 'fs/promises';
import path from 'path';

const fileDir = path.resolve(__dirname, '../', 'downloads');

export const writeFile = async (contents: string, fileName: string) => {
  try {
    await fs.mkdir(fileDir);
    console.log('Downloads folder does not exist, creating');
  } catch (err) {
    console.log('Downloads folder exists');
  }

  const filePath = path.resolve(fileDir, fileName);
  await fs.writeFile(filePath, contents);
};

export const readFile = async (fileName: string) => {
  const filePath = path.resolve(fileDir, fileName);
  return fs.readFile(filePath, {
    encoding: 'utf-8',
  });
};
