/**
 * Utility functions for asynchronous operations.
 */

/**
 * Limit the number of concurrent asynchronous operations.
 * 
 * @param {number} limit - Maximum number of concurrent operations
 * @param {Array} items - Array of items to process
 * @param {Function} fn - Async function to run for each item (receives item and index)
 * @returns {Promise<Array>} Results of the operations
 */
async function asyncLimit(limit, items, fn) {
  const results = [];
  const executing = new Set();
  
  for (const [index, item] of items.entries()) {
    const p = Promise.resolve().then(() => fn(item, index));
    results.push(p);
    executing.add(p);
    
    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);
    
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  
  return Promise.all(results);
}

/**
 * Limit the number of concurrent asynchronous operations and return allSettled results.
 * 
 * @param {number} limit - Maximum number of concurrent operations
 * @param {Array} items - Array of items to process
 * @param {Function} fn - Async function to run for each item (receives item and index)
 * @returns {Promise<Array>} results (similar to Promise.allSettled)
 */
async function asyncLimitSettled(limit, items, fn) {
  const results = [];
  const executing = new Set();
  
  for (const [index, item] of items.entries()) {
    const p = Promise.resolve()
      .then(() => fn(item, index))
      .then(value => ({ status: 'fulfilled', value }))
      .catch(reason => ({ status: 'rejected', reason }));
      
    results.push(p);
    executing.add(p);
    
    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);
    
    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }
  
  return Promise.all(results);
}

/**
 * Like asyncLimitSettled but checks getCancelFlag() before enqueueing each item.
 * When cancelled, stops enqueueing new work and waits for in-flight promises, then returns.
 *
 * @param {number} limit - Maximum number of concurrent operations
 * @param {Array} items - Array of items to process
 * @param {Function} fn - Async function to run for each item (receives item and index)
 * @param {() => boolean} getCancelFlag - Called before each new item; if true, stop enqueueing and return after in-flight complete
 * @returns {Promise<Array<{status: 'fulfilled'|'rejected', value?: any, reason?: any}>>} allSettled-style results
 */
async function asyncLimitSettledWithCancel(limit, items, fn, getCancelFlag) {
  const results = [];
  const executing = new Set();

  for (const [index, item] of items.entries()) {
    if (getCancelFlag && getCancelFlag()) {
      break;
    }
    const p = Promise.resolve()
      .then(() => fn(item, index))
      .then(value => ({ status: 'fulfilled', value }))
      .catch(reason => ({ status: 'rejected', reason }));

    results.push(p);
    executing.add(p);

    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

module.exports = {
  asyncLimit,
  asyncLimitSettled,
  asyncLimitSettledWithCancel,
};
