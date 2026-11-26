"use strict";
/**
 * fcaCompat.js
 * Mirai-style FCA (callback based) কে Goat-style (promise + flexible args) বানায়,
 * যাতে RX-এর সব command কোনো পরিবর্তন ছাড়াই চলে।
 *
 *  - সব async method সবসময় Promise return করে (callback দিলেও)
 *  - api.unsendMessage(id, threadID) / api.sendMessage(msg, threadID, replyMsgID) দুই স্টাইলই চলে
 *  - callback কখনো না ডাকলেও await চিরতরে আটকে থাকে না (timeout)
 */

const noop = () => {};

function makeWrapper(api, name, normalize, opts = {}) {
  const orig = api[name];
  if (typeof orig !== "function" || orig.__fcaCompat) return;
  const timeoutMs = opts.timeoutMs || 60000;
  const softTimeout = !!opts.softTimeout; // true হলে timeout এ error না দিয়ে চুপচাপ resolve

  const wrapped = function (...args) {
    const { pre, post = [], cb } = normalize(args);
    return new Promise((resolve, reject) => {
      let done = false;
      let timer = null;

      const finish = (err, data) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (cb) {
          try { cb(err || null, data); } catch (e) { console.error(`[fcaCompat] ${name} callback error:`, e); }
          return resolve(data);
        }
        if (err) return reject(err);
        resolve(data);
      };

      timer = setTimeout(() => {
        if (softTimeout) return finish(null, undefined);
        finish(new Error(`[fcaCompat] ${name} timeout (${timeoutMs}ms)`));
      }, timeoutMs);

      try {
        const ret = orig.call(api, ...pre, finish, ...post);
        // কিছু fca নিজেই Promise return করে
        if (ret && typeof ret.then === "function")
          ret.then(d => finish(null, d), e => finish(e));
      } catch (e) {
        finish(e);
      }
    });
  };
  wrapped.__fcaCompat = true;
  api[name] = wrapped;
}

const firstFn = (arr) => arr.find(a => typeof a === "function");

// generic: callback অবস্থান = idx
const generic = (idx) => (args) => {
  const pre = args.slice(0, idx);
  while (pre.length < idx) pre.push(undefined);
  // idx এর আগে ভুলে callback চলে গেলে সেটা সরিয়ে দিই
  const clean = pre.map(a => (typeof a === "function" ? undefined : a));
  return { pre: clean, cb: firstFn(args) };
};

module.exports = function applyFcaCompat(api) {
  if (!api || api.__fcaCompatApplied) return api;

  // ---- sendMessage(msg, threadID, [callback], [replyMessageID], [isGroup]) ----
  makeWrapper(api, "sendMessage", (args) => {
    const [msg, threadID, a, b, c] = args;
    let cb, replyTo, isGroup;
    for (const x of [a, b, c]) {
      if (typeof x === "function") cb = cb || x;
      else if (typeof x === "string" || typeof x === "number") replyTo = replyTo || String(x);
      else if (typeof x === "boolean") isGroup = x;
    }
    const post = [];
    if (replyTo !== undefined || isGroup !== undefined) post.push(replyTo);
    if (isGroup !== undefined) post.push(isGroup);
    return { pre: [msg, threadID], post, cb };
  }, { timeoutMs: 180000 });

  // ---- unsendMessage(messageID, [threadID বা callback]) ----
  makeWrapper(api, "unsendMessage", (args) => ({
    pre: [args[0]],
    cb: firstFn(args)
  }), { timeoutMs: 8000, softTimeout: true });

  // ---- setMessageReaction(emoji, messageID, [threadID], [callback], [forceCustom]) ----
  makeWrapper(api, "setMessageReaction", (args) => {
    const force = args.find(a => typeof a === "boolean");
    return { pre: [args[0], args[1]], post: force === undefined ? [] : [force], cb: firstFn(args) };
  }, { timeoutMs: 15000, softTimeout: true });

  // ---- বাকি callback-style method গুলো ----
  const CB_INDEX = {
    getUserInfo: 1, getThreadInfo: 1, getThreadList: 3, getFriendsList: 0,
    getUserID: 1, removeUserFromGroup: 2, addUserToGroup: 2, changeNickname: 3,
    changeThreadColor: 2, changeThreadEmoji: 2, setTitle: 2, handleFriendRequest: 2,
    changeAdminStatus: 3, httpPost: 2, httpGet: 2, forwardAttachment: 2
  };
  for (const [name, idx] of Object.entries(CB_INDEX))
    makeWrapper(api, name, generic(idx), { timeoutMs: 45000 });

  // ---- editMessage: Goat style editMessage(text, messageID) ----
  if (typeof api.editMessage === "function") {
    makeWrapper(api, "editMessage", (args) => ({
      pre: [args[0], args[1]], cb: firstFn(args)
    }), { timeoutMs: 20000, softTimeout: true });
  } else {
    api.editMessage = () => Promise.resolve();
  }

  // ---- Mirai fca তে না থাকলে crash এড়াতে stub ----
  if (typeof api.refreshFb_dtsg !== "function") api.refreshFb_dtsg = () => Promise.resolve();
  if (typeof api.getOptions !== "function") api.getOptions = () => ({});

  api.__fcaCompatApplied = true;
  return api;
};
