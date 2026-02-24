// frontend/pages/api/jupyter/[...path].js
import httpProxy from 'http-proxy'

export const config = {
  api: { bodyParser: false },
}

// Base URL of your Jupyter server (no trailing slash)
const target = process.env.JUPYTER_PUBLIC_BASE || 'http://localhost:8888'

// Create a single proxy instance
const proxy = httpProxy.createProxyServer({
  target,
  changeOrigin: true,
  secure: false, // use false for local dev (HTTP), true for HTTPS with valid cert
})

export default function handler(req, res) {
  // Rewrite /api/jupyter/... -> /...
  req.url = req.url.replace(/^\/api\/jupyter/, '')

  // Modify response headers to allow embedding in your Next.js site
  proxy.once('proxyRes', (proxyRes) => {
    delete proxyRes.headers['x-frame-options']
    if (proxyRes.headers['content-security-policy']) {
      proxyRes.headers['content-security-policy'] = "frame-ancestors 'self'"
    }
    // Allow CORS for dev convenience
    proxyRes.headers['access-control-allow-origin'] = '*'
  })

  // Basic error handling
  proxy.once('error', (err) => {
    res.status(502).json({ error: String(err) })
  })

  // Forward the request to Jupyter
  proxy.web(req, res)
}
