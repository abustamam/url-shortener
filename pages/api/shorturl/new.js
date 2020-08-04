import nextConnect from 'next-connect';
import { generate } from 'short-id';
import { promises } from 'dns';
import { URL } from 'url';

import middlewares from '../../../middleware';
import { Url } from '../../../lib/url';

const { lookup } = promises;

const handler = nextConnect();
handler.use(middlewares);
handler.post(async (req, res) => {
  try {
    const { original_url } = JSON.parse(req.body);
    const existingRecord = await Url.findOne({ original_url });
    if (existingRecord) {
      res.statusCode = 200;
      return res.json({ record: existingRecord, ok: true });
    }
    const { hostname } = new URL(original_url);
    await lookup(hostname);
    const short_url = generate();
    const data = { original_url, short_url };
    const record = await Url.create(data);
    res.statusCode = 200;
    res.json({ record, ok: true });
  } catch (err) {
    res.statusCode = 400;
    res.json({
      error: err,
      ok: false,
    });
  }
});

export default handler;
