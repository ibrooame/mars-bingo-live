const crypto = require('crypto');
const jwt = require('jsonwebtoken');
require('dotenv').config();

function verifyTelegramWebappData(initData) {
  if (!initData) return false;
  
  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  urlParams.delete('hash');

  const sortedParams = Array.from(urlParams.entries())
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(process.env.TELEGRAM_BOT_TOKEN || '')
    .digest();

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(sortedParams)
    .digest('hex');

  return calculatedHash === hash;
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or invalid' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or unauthorized token' });
  }
}

function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (Number(req.user.telegram_id) !== Number(process.env.ADMIN_TELEGRAM_ID)) {
      return res.status(403).json({ error: 'Access denied: Admin privileges required' });
    }
    next();
  });
}

module.exports = { verifyTelegramWebappData, authMiddleware, adminMiddleware };
