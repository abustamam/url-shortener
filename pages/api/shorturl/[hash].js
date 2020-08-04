import nextConnect from 'next-connect';
import { Url } from '../../../lib/url';

import middlewares from '../../../middleware';

const handler = nextConnect();
handler.use(middlewares);
handler.get(async (req, res) => {
  try {
    const {
      query: { hash },
    } = req;
    const { original_url } = await Url.findOne({ short_url: hash });
    if (/http(s?):\/\//.test(original_url)) {
      res.statusCode = 301;
      return res.redirect(original_url);
    }
    res.statusCode = 400;
    res.json({
      error: 'Invalid URL',
      ok: false,
    });
  } catch (err) {
    res.json({ error: 'an error occurred', ok: false });
  }
});

export default handler;
