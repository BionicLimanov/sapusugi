import { NextApiRequest, NextApiResponse } from 'next';
import httpProxy from 'http-proxy';

const proxy = httpProxy.createProxyServer({
  target: 'http://localhost:8888',
  changeOrigin: true,
});

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Simple proxy - just forward everything to Jupyter
  return new Promise((resolve, reject) => {
    proxy.web(req, res, {}, (err) => {
      if (err) {
        console.error('Jupyter proxy error:', err);
        res.status(500).json({ error: 'Failed to connect to Jupyter' });
        reject(err);
      } else {
        resolve(null);
      }
    });
  });
}