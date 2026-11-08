const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadDeleteAllQuestions(redis) {
  const source = fs.readFileSync(path.join(__dirname, "../handlers/questions/mine.js"), "utf8");
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require(id) {
      if (id === "../../lib/quota") {
        return {
          getAccount: async () => ({ uid: "a".repeat(48) }),
          redis,
          consumeIpRateLimit: async () => ({ count: 1, limit: 30, windowSeconds: 900 })
        };
      }
      throw new Error("Unexpected module: " + id);
    }
  };
  vm.runInNewContext(source, sandbox, { filename: "handlers/questions/mine.js" });
  return module.exports.deleteAllOwnedQuestions;
}

test("bulk question-history deletion rejects invalid owners before touching Redis", async () => {
  let calls = 0;
  const removeAll = loadDeleteAllQuestions(async () => { calls += 1; return 0; });
  await assert.rejects(
    removeAll({ userListKey: "vy:user:bad:questions", userId: "not-a-user-id" }),
    /Invalid question-history owner/
  );
  assert.equal(calls, 0);
});

test("bulk question-history deletion uses one bounded owner-checked atomic Redis script", async () => {
  const uid = "a".repeat(48);
  let command;
  const removeAll = loadDeleteAllQuestions(async args => {
    command = args;
    return 3;
  });
  const deleted = await removeAll({ userListKey: "vy:user:" + uid + ":questions", userId: uid });
  assert.equal(deleted, 3);
  assert.equal(command[0], "EVAL");
  assert.equal(command[2], "1");
  assert.equal(command[3], "vy:user:" + uid + ":questions");
  assert.match(command[1], /LRANGE.*0, 499/);
  assert.match(command[1], /question\.user_id == ARGV\[1\]/);
  assert.match(command[1], /LREM/);
  assert.match(command[1], /DEL.*KEYS\[1\]/);
  assert.equal(command[4], uid);
});
