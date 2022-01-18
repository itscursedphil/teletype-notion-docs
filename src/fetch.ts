import fetch from 'node-fetch';

const URL = 'https://monome.org/docs/teletype/manual/';

const fetchDocs = async (): Promise<string> => {
  try {
    const res = await fetch(URL);

    return await res.text();
  } catch (err) {
    console.log(err);
    return '';
  }
};

export default fetchDocs;
