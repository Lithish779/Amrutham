'use strict';
const { E } = require('./errors');
const encodeCursor = (arr) => Buffer.from(JSON.stringify(arr)).toString('base64url');
function decodeCursor(c) {
  if (!c) return null;
  try {
    const v = JSON.parse(Buffer.from(c, 'base64url').toString());
    if (!Array.isArray(v)) throw new Error('bad');
    return v;
  } catch { throw E.badRequest('Invalid cursor'); }
}
module.exports = { encodeCursor, decodeCursor };
