'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const als = new AsyncLocalStorage();
module.exports = {
  run: (store, fn) => als.run(store, fn),
  get: () => als.getStore() || {},
};
