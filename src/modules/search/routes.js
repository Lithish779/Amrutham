'use strict';
const express = require('express');
const { z } = require('zod');
const { validate, asyncH } = require('../../middleware/common');
const { SORTS } = require('./service');

const schema = z.object({
  q: z.string().trim().min(2).max(100).optional(),
  specialization: z.string().trim().max(60).optional(),
  language: z.string().trim().max(20).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  minFee: z.coerce.number().int().min(0).optional(),
  maxFee: z.coerce.number().int().min(0).optional(),
  availableFrom: z.coerce.date().optional(),
  availableTo: z.coerce.date().optional(),
  sort: z.enum(Object.keys(SORTS)).default('rating'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(300).optional(),
}).strict();

function searchRoutes({ searchService }) {
  const r = express.Router();
  r.get('/', validate({ query: schema }), asyncH(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=15');
    res.json(await searchService.searchDoctors(req.query));
  }));
  return r;
}
module.exports = { searchRoutes };
